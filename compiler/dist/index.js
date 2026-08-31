import * as acorn from 'acorn';
import { processNode } from './processor/index.js';
import { CompilerContext, } from './context.js';
import { OPS } from './saucer/ops.js';
import { OPS_V12 } from './saucer/ops-v12.js';
import { encodeInt } from './saucer/integer.js';
import { encodeBytes } from './saucer/bytes.js';
import { concatBytes, V12Saucer } from './saucer/saucer-v12.js';
import { estimatePacket } from './planner/index.js';
import { compileCacheKey, cloneCompileResult, getDefaultCompileCache } from './cache.js';
import { tsPartialEvalWithMeta } from './ts-frontend.js';
export { createCompileCache, compileCacheKey, cloneCompileResult, getDefaultCompileCache, clearDefaultCompileCache, } from './cache.js';
export { Saucer } from './saucer/saucer.js';
export { V12Saucer } from './saucer/saucer-v12.js';
export { CompilerContext } from './context.js';
export { OPS } from './saucer/ops.js';
export { OPS_V12 } from './saucer/ops-v12.js';
export { SVM_UNSUPPORTED } from './saucer/svm-profile.js';
export { UnsupportedTargetError, TARGET_CAPABILITIES } from './capabilities.js';
export { estimatePacket, stagingTransactionCount, PAYER_REF } from './planner/index.js';
/** A plain struct object (excludes bigint, string, and arrays — all also `object`-ish). */
function isArgObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/**
 * Sorted (alphabetical, localeCompare — matching `extractSortedProperties`) field names
 * of a struct arg, so the encoded tuple order and the compiled `getFieldIndex` order agree.
 */
function sortedArgObjectKeys(obj) {
    return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}
/**
 * The StructType (field names + nested field struct types) for a struct arg, mirroring
 * `extractStructType` on an in-script object literal so member access on the main() param
 * resolves the same field indices.
 */
function structTypeFromArg(obj) {
    const fields = sortedArgObjectKeys(obj);
    const fieldStructTypes = fields.map((k) => isArgObject(obj[k]) ? structTypeFromArg(obj[k]) : undefined);
    const hasNestedStruct = fieldStructTypes.some((t) => t !== undefined);
    return hasNestedStruct ? { fields, fieldStructTypes } : { fields };
}
/** Mirrors the engine's MAX_BUFFER_CAPACITY (u16::MAX) — the composite `program ++ args` ceiling. */
const MAX_COMPOSITE_BYTES = 65_535;
function inferArgType(v) {
    if (typeof v === 'bigint')
        return { kind: 'scalar' };
    if (typeof v === 'string')
        return { kind: 'dynamic' }; // hex bytes
    if (isArgObject(v))
        return { kind: 'dynamic', structType: structTypeFromArg(v) }; // struct (TUPLE)
    if (Array.isArray(v)) {
        // Infer element type from first element
        if (v.length > 0) {
            const inner = inferArgType(v[0]);
            return { kind: 'dynamic', elementType: { kind: inner.kind, element: inner.elementType } };
        }
        return { kind: 'dynamic' };
    }
    return { kind: 'scalar' };
}
export function compile(source, options = {}) {
    // Cache is ON by default: undefined/true → the process-global store, false →
    // bypass, an instance → that store.
    const opt = options.cache;
    const cache = opt === false ? undefined : opt === undefined || opt === true ? getDefaultCompileCache() : opt;
    if (!cache)
        return compileFresh(source, options);
    const key = compileCacheKey(source, options);
    const hit = cache.get(key);
    if (hit)
        return cloneCompileResult(hit);
    const result = compileFresh(source, options);
    // Store a clone so a caller mutating the returned result can't corrupt the
    // cache; return a clone so a later compile can't corrupt this caller's result.
    cache.set(key, cloneCompileResult(result));
    return result;
}
function compileFresh(source, options = {}) {
    const target = options.target ?? 'v1';
    const staged = options.staged ?? false;
    if (staged && target !== 'svm') {
        throw new Error(`staged compilation requires target 'svm', got '${target}'`);
    }
    // `tsPartialEvalWithMeta` (not the signature-preserving `tsPartialEval` wrapper) so the
    // out-of-band width-forcing signal the return-array escape fold produces (see
    // ts-frontend.ts's "Forcing uint256 element width" doc note) survives past the plain-string
    // hand-off to `acorn.parse` — `pre` is `undefined` entirely for a non-tsSource compile, so
    // `ctx.wideReturnArrays` below is never even touched in that case.
    const pre = options.tsSource ? tsPartialEvalWithMeta(source, options.label ?? 'source.ts') : undefined;
    const sourceText = pre ? pre.text : source;
    const ast = acorn.parse(sourceText, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowReturnOutsideFunction: true,
    });
    const ctx = new CompilerContext(options.baseDirs, options.contracts, target);
    ctx.transformModule = options.transformModule;
    ctx.treeshake = options.treeshake ?? true;
    ctx.fold = options.fold ?? true;
    ctx.setStaged(staged);
    if (pre && pre.wideReturnArrays.size > 0)
        ctx.wideReturnArrays = pre.wideReturnArrays;
    if (options.defines)
        ctx.setDefines(options.defines);
    if (options.args && options.args.length > 0) {
        ctx.mainArgTypes = options.args.map(inferArgType);
    }
    const saucers = processNode(ast, ctx);
    if (target !== 'v1') {
        // v12 (and its svm dialect) assembles every function into a single blob. The
        // runtime entry pushes only a stack-bottom sentinel and jumps to offset 0 — it
        // does NOT marshal main()'s parameters onto the stack. So when args are supplied,
        // we synthesize a no-param WRAPPER entry that pushes the args and CALL_FUNCTIONs
        // the original main (now a normal table function whose params arrive via the call
        // frame) — the v12 analogue of v1's appended [CALL_FUNCTION, mainIndex, argCount, …args].
        // In staged svm mode the prologue does not PUSH literal values — it SLICEs each
        // arg out of the CALLDATA composite per argsLayout (same count, order, and
        // stack shape); the layout's programLength is stamped after assembly.
        const argsLayout = staged ? buildArgsLayout(options.args ?? []) : undefined;
        const bytecode = [assembleV12(ctx, options.args ?? [], argsLayout)];
        if (argsLayout) {
            argsLayout.programLength = bytecode[0].length;
            if (argsLayout.programLength + argsLayout.byteLength > MAX_COMPOSITE_BYTES) {
                throw new Error(`staged svm program (${argsLayout.programLength} bytes) plus payload args (${argsLayout.byteLength} bytes) ` +
                    `exceeds the ${MAX_COMPOSITE_BYTES}-byte CALLDATA composite ceiling`);
            }
        }
        if (target === 'svm') {
            // The account plan is the interned-ref registry in first-use order (empty
            // metas for pure-compute programs or raw-index programs). The packet-budget
            // check runs with default send options (fee payer + plan-declared signers,
            // the reserved 'payer' ref counted as the fee payer, no lookup tables, no
            // prepends) and is non-fatal — its warnings ride along with the compile
            // warnings. Staged compiles are budgeted against the execute_from_account
            // packet shape (flags + hash-pin + payload args data, buffer account,
            // 65,535-byte composite ceiling).
            const accountPlan = ctx.buildAccountPlan();
            const budget = estimatePacket(accountPlan, bytecode[0].length, {
                mode: staged ? 'staged' : 'inline',
                ...(argsLayout ? { argsBytes: argsLayout.byteLength } : {}),
            });
            return {
                bytecode,
                warnings: [...ctx.warnings, ...budget.warnings],
                accountPlan,
                ...(argsLayout ? { argsLayout } : {}),
            };
        }
        return { bytecode, warnings: ctx.warnings };
    }
    const bytecodes = saucers.map((saucer) => saucer.build());
    if (options.args && options.args.length > 0) {
        const mainIndex = ctx.getFunc('main');
        const argBytes = options.args.map(encodeArgValue);
        const argsFlat = argBytes.reduce((acc, bytes) => new Uint8Array([...acc, ...bytes]), new Uint8Array());
        bytecodes.push(new Uint8Array([OPS.CALL_FUNCTION, mainIndex, options.args.length, ...argsFlat]));
    }
    return {
        bytecode: bytecodes,
        warnings: ctx.warnings,
    };
}
// ── v12 assembly: [main][STOP][func0][FUNC_RETURN][func1][FUNC_RETURN]… ──
//
// CALL_FUNCTION sentinels (0xFF00|index, recorded as callPositions) are patched
// to each helper's absolute byte offset; parameter-read SDUP sentinels (recorded
// as refPositions) are patched to a concrete SDUPn from the tracked stack depth.
function patchCalls(bc, calls, funcOffsets, posShift = 0, mainIndex = -1) {
    for (const { pos, funcIndex } of calls) {
        // funcOffsets maps a function's REGISTRY index to its absolute body offset.
        // main has no body offset — it is the entry (no-arg path) or inlined behind the
        // arg-prologue (with-args path), so a main() self-call can't be resolved.
        const offset = funcOffsets[funcIndex];
        if (offset === undefined) {
            if (funcIndex === mainIndex) {
                throw new Error(`cannot resolve CALL_FUNCTION target (index ${funcIndex}); calling main() is not supported`);
            }
            throw new Error(`cannot resolve CALL_FUNCTION target (index ${funcIndex}); no body offset recorded`);
        }
        bc[pos + posShift] = (offset >> 8) & 0xff;
        bc[pos + posShift + 1] = offset & 0xff;
    }
}
function patchSdup(bc, position, realPos) {
    if (realPos < 1 || realPos > 16)
        throw new Error(`REF position out of range: ${realPos}`);
    bc[position] = OPS_V12.SDUP1 + realPos - 1;
}
/**
 * Lays the staged payload-arg slots out back to back in arg order: scalars are
 * 32-byte big-endian words, bytes args their fixed compile-time length (no
 * padding — SLICE addresses arbitrary byte offsets). Offsets are relative to
 * the payload-args start; `programLength` is stamped after assembly (the
 * prologue length is a pure function of the slots, so the total is known
 * before the offsets are emitted).
 */
function buildArgsLayout(args) {
    const slots = [];
    let offset = 0;
    args.forEach((value, arg) => {
        if (Array.isArray(value) || isArgObject(value)) {
            throw new Error(`staged svm args do not support ${Array.isArray(value) ? 'array' : 'struct'} values (arg ${arg}); ABI-encode the collection into a bytes arg and abi.decode it on-chain`);
        }
        if (typeof value === 'string') {
            const length = hexToBytes(value).length;
            slots.push({ arg, kind: 'bytes', offset, length });
            offset += length;
            return;
        }
        slots.push({ arg, kind: 'scalar', offset, length: 32 });
        offset += 32;
    });
    return { mode: 'calldata', programLength: 0, byteLength: offset, slots };
}
// The staged prologue's per-slot byte cost: [READ_VALUE 0] (2) + [BYTE_2 offset]
// (3, always 2-byte — the composite ceiling is u16::MAX) + the length push
// (BYTE_1/BYTE_2) + [SLICE] (1) + [CAST_BE] (1, scalars only). Fixed widths keep
// the prologue length a pure function of the layout, breaking the length ↔
// offset circularity (offsets embed the total program length).
function stagedSlotReadLen(slot) {
    return 2 + 3 + (slot.length <= 0xff ? 2 : 3) + 1 + (slot.kind === 'scalar' ? 1 : 0);
}
/** [CALLDATA][WRITE_VALUE 0] (3) + the per-slot reads; empty for a no-arg layout. */
function stagedPrologueLen(layout) {
    return layout.slots.length === 0 ? 0 : 3 + layout.slots.reduce((n, slot) => n + stagedSlotReadLen(slot), 0);
}
/**
 * The staged arg prologue: ONE CALLDATA (the `program ++ args` composite,
 * materialized once) parked in VALUES slot 0, then per slot
 * [READ_VALUE 0][BYTE_2 L+offset][len][SLICE] (+[CAST_BE] for scalars —
 * payload scalars are 32-byte big-endian words). Net stack effect +1 per arg —
 * identical shape to the inline literal pushes it replaces, so SDUP patching
 * and the arg order contract (arg0 deepest) are untouched.
 */
function buildStagedPrologue(layout, programLength) {
    if (layout.slots.length === 0)
        return new Uint8Array(0);
    const parts = [OPS.CALLDATA, OPS.WRITE_VALUE, 0x00];
    for (const slot of layout.slots) {
        const offset = programLength + slot.offset;
        parts.push(OPS.READ_VALUE, 0x00);
        parts.push(OPS.BYTE_2, (offset >> 8) & 0xff, offset & 0xff);
        if (slot.length <= 0xff)
            parts.push(OPS.BYTE_1, slot.length);
        else
            parts.push(OPS.BYTE_2, (slot.length >> 8) & 0xff, slot.length & 0xff);
        parts.push(OPS.SLICE);
        if (slot.kind === 'scalar')
            parts.push(OPS.CAST_BE);
    }
    return new Uint8Array(parts);
}
function assembleV12(ctx, args, argsLayout) {
    const meta = ctx.funcMeta;
    const mainMeta = meta.find((m) => m.isMain);
    if (!mainMeta)
        throw new Error('missing main() function');
    // With compile-time args, main becomes a normal table function called by a
    // synthesized no-param wrapper entry (see the wrapper path below). Without args,
    // main is the entry itself (the runtime jumps to offset 0) — preserved exactly.
    if (args.length > 0) {
        return assembleV12WithArgs(ctx, mainMeta, meta, args, argsLayout);
    }
    const helpers = meta.filter((m) => !m.isMain); // function-index order (0..n-1)
    const main = mainMeta.saucer;
    // main carries its own ALLOCATE_VALUE/ALLOCATE_HEAP prefix declaring its frame
    // stride to the runtime (the runtime strides per call by the caller's declared slot
    // count, default 0), so a main→helper call strides past main's slots and the callee's
    // frame can't alias/clobber them. ALLOCATE is stack-neutral, so the prefix shifts only
    // BYTE positions (by mainPrefixLen) — SDUP depths are unchanged.
    const { bytes: mainBc, prefixLen: mainPrefixLen } = main.buildMain();
    const mainIndex = ctx.getFunc('main');
    // Main params are pre-pushed by the runtime, so no frame-pointer offset; shift
    // recorded positions past the ALLOCATE prefix.
    const patchMainRefs = (bc, refs) => {
        for (const r of refs)
            patchSdup(bc, r.position + mainPrefixLen, r.depth + mainMeta.paramCount - r.paramIndex);
    };
    if (helpers.length === 0) {
        // No helper bodies to jump to: any CALL_FUNCTION here is a main() self-call,
        // which patchCalls rejects (empty offset table) rather than emit corrupt bytes.
        patchCalls(mainBc, main.callPositions, [], mainPrefixLen, mainIndex);
        patchMainRefs(mainBc, main.refPositions);
        return mainBc;
    }
    const built = helpers.map((h) => {
        const saucer = h.saucer;
        const bc = saucer.buildFunctionBody();
        return { meta: h, saucer, bc, prefixLen: bc.length - saucer._bytes.length };
    });
    // Helper registry indices are 0..n-1 (main is registered last, index n); main is
    // the entry here so its slot stays undefined (a main self-call is unsupported).
    const funcOffsets = [];
    let off = mainBc.length + 1;
    for (const h of built) {
        funcOffsets.push(off);
        off += h.bc.length + 1;
    }
    patchCalls(mainBc, main.callPositions, funcOffsets, mainPrefixLen, mainIndex);
    patchMainRefs(mainBc, main.refPositions);
    for (const h of built) {
        // Helper bodies sit behind an ALLOCATE prefix, so shift recorded positions.
        patchCalls(h.bc, h.saucer.callPositions, funcOffsets, h.prefixLen);
        for (const r of h.saucer.refPositions) {
            // Helpers are entered via CALL_FUNCTION (+1 frame-pointer word on the stack).
            patchSdup(h.bc, r.position + h.prefixLen, r.depth + 1 + h.meta.paramCount - r.paramIndex);
        }
    }
    const parts = [mainBc, [OPS.STOP]];
    for (const h of built)
        parts.push(h.bc, [OPS_V12.FUNC_RETURN]);
    return concatBytes(parts);
}
// ── v12 arg-prologue path: [arg pushes][main body][STOP][helper][FUNC_RETURN]… ──
//
// A synthesized no-param ENTRY pushes the compile-time args, then main's body is
// INLINED right after (fall-through) — main reads its params straight off the stack
// with the MAIN SDUP formula (depth + paramCount - paramIndex), NO call frame.
//
// Why inline rather than CALL_FUNCTION the original main: a CALL_FUNCTION frame adds
// a frame-pointer word ABOVE the params (the helper +1), so a main reading its first
// param under ~7 live locals lands at SDUP17 — past the EVM DUP16 ceiling. Falling
// through with the args already on the stack keeps the deepest read at SDUP16. The
// args sit above the runtime's stack-bottom sentinel; main never reads below them.
// (main therefore can't be recursive — it's inlined, not a table entry — which is
// fine: v1 likewise cannot call main, and recipes never recurse main.)
function assembleV12WithArgs(ctx, mainMeta, meta, args, argsLayout) {
    // Prologue: push each arg (postfix, forward order so arg0 is deepest = paramIndex 0).
    // Inline: literal pushes of the compile-time values. Staged: CALLDATA-composite
    // SLICEs per argsLayout — same count, order, and net +1 per arg. The staged
    // prologue's offsets embed the TOTAL program length, so its bytes are emitted
    // after the total is known; its length is a pure function of the layout.
    const inlinePrologue = argsLayout ? undefined : concatBytes(args.map((a) => encodeArgValueV12(ctx, a)._bytes));
    const prologueLen = argsLayout ? stagedPrologueLen(argsLayout) : inlinePrologue.length;
    const main = mainMeta.saucer;
    // main carries its ALLOCATE_VALUE/ALLOCATE_HEAP prefix (frame-stride declaration)
    // AND the result-MSTORE. The prefix sits AFTER the arg prologue (which already
    // pushed the args) and BEFORE main's body; ALLOCATE is stack-neutral so the args
    // and SDUP depths are untouched — only main's byte positions shift by mainPrefixLen.
    // Without it, a main→helper call would stride by the default 0 and the callee's
    // frame would alias/clobber main's slots from base 0.
    const { bytes: mainBody, prefixLen: mainPrefixLen } = main.buildMain();
    const helpers = meta.filter((m) => !m.isMain); // registry indices 0..n-1
    const built = helpers.map((h) => {
        const saucer = h.saucer;
        const bc = saucer.buildFunctionBody();
        return { meta: h, saucer, bc, prefixLen: bc.length - saucer._bytes.length };
    });
    // funcOffsets keyed by registry index (helpers 0..n-1; main is inlined so its slot
    // stays undefined — a main self-call is unsupported, same as the no-arg path).
    const funcOffsets = [];
    let off = prologueLen + mainBody.length + 1; // after [prologue][main body (+ALLOCATE)][STOP]
    for (const h of built) {
        funcOffsets[ctx.getFunc(h.meta.name)] = off;
        off += h.bc.length + 1; // body + FUNC_RETURN
    }
    // `off` is now the total program length L — the staged prologue's composite
    // SLICE offsets are L + slot.offset (arg i rides the payload right after the
    // program bytes).
    const prologue = argsLayout ? buildStagedPrologue(argsLayout, off) : inlinePrologue;
    // main's sentinels are patched in its own standalone array; shift recorded positions
    // past the ALLOCATE prefix. main reads params with the MAIN formula — the args are
    // directly on the stack, no frame-pointer word. main is inlined (not a table entry),
    // so a main() self-call is unsupported.
    patchCalls(mainBody, main.callPositions, funcOffsets, mainPrefixLen, ctx.getFunc('main'));
    for (const r of main.refPositions) {
        patchSdup(mainBody, r.position + mainPrefixLen, r.depth + mainMeta.paramCount - r.paramIndex);
    }
    // Helpers are entered via CALL_FUNCTION → +1 frame-pointer word.
    for (const h of built) {
        patchCalls(h.bc, h.saucer.callPositions, funcOffsets, h.prefixLen);
        for (const r of h.saucer.refPositions) {
            patchSdup(h.bc, r.position + h.prefixLen, r.depth + 1 + h.meta.paramCount - r.paramIndex);
        }
    }
    const parts = [prologue, mainBody, [OPS.STOP]];
    for (const h of built)
        parts.push(h.bc, [OPS_V12.FUNC_RETURN]);
    return concatBytes(parts);
}
// Postfix arg encoder mirroring `encodeArgValue` (the v1 prefix form) but emitting
// V12 builder ops: scalar → int push, hex string → bytes, array → tuple(elems).
// Built via the V12Saucer methods so the runtime decodes args identically to how
// the compiler builds the same values inline (nested tuples recurse).
function encodeArgValueV12(ctx, v) {
    if (Array.isArray(v)) {
        return new V12Saucer(ctx).tuple(v.map((el) => encodeArgValueV12(ctx, el)));
    }
    // Struct: a TUPLE of the field values in alphabetical order (matches the in-script
    // object literal so main() reads its fields by the same INDEX).
    if (isArgObject(v)) {
        return new V12Saucer(ctx).tuple(sortedArgObjectKeys(v).map((k) => encodeArgValueV12(ctx, v[k])));
    }
    if (typeof v === 'string')
        return new V12Saucer(ctx).bytes(hexToBytes(v));
    return new V12Saucer(ctx).int(typeof v === 'bigint' ? v : BigInt(v));
}
function encodeArgValue(v) {
    if (Array.isArray(v)) {
        const elements = v.map((el) => encodeArgValue(el));
        const flat = elements.reduce((acc, bytes) => new Uint8Array([...acc, ...bytes]), new Uint8Array());
        return new Uint8Array([OPS.TUPLE, elements.length, ...flat]);
    }
    // Struct: a TUPLE of the alphabetically-ordered field values (same order as an
    // in-script object literal, so `getFieldIndex` and this encoding agree).
    if (isArgObject(v)) {
        const keys = sortedArgObjectKeys(v);
        const elements = keys.map((k) => encodeArgValue(v[k]));
        const flat = elements.reduce((acc, bytes) => new Uint8Array([...acc, ...bytes]), new Uint8Array());
        return new Uint8Array([OPS.TUPLE, elements.length, ...flat]);
    }
    if (typeof v === 'string')
        return encodeBytes(hexToBytes(v));
    return encodeInt(typeof v === 'bigint' ? v : BigInt(v));
}
function hexToBytes(hex) {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
