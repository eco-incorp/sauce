import * as acorn from 'acorn';
import { processNode } from './processor/index.js';
import {
  CompilerContext,
  type ElementType,
  type VariableKind,
  type StructType,
  type CompileTarget,
  type FunctionMeta,
} from './context.js';
import { OPS } from './saucer/ops.js';
import { OPS_V12 } from './saucer/ops-v12.js';
import { encodeInt } from './saucer/integer.js';
import { encodeBytes } from './saucer/bytes.js';
import { concatBytes, V12Saucer } from './saucer/saucer-v12.js';
import type { RefPlaceholder, CallPlaceholder } from './saucer/saucer-v12.js';
import type { ContractsConfig } from './contracts.js';
import { estimatePacket } from './planner/index.js';
import type { AccountPlan } from './planner/index.js';
import { compileCacheKey, cloneCompileResult, getDefaultCompileCache } from './cache.js';
import type { CompileCache } from './cache.js';
import { tsPartialEvalWithMeta } from './ts-frontend.js';

export {
  createCompileCache,
  compileCacheKey,
  cloneCompileResult,
  getDefaultCompileCache,
  clearDefaultCompileCache,
} from './cache.js';
export type { CompileCache, BoundedCompileCache, CompileCacheStats } from './cache.js';

export { Saucer } from './saucer/saucer.js';
export { V12Saucer } from './saucer/saucer-v12.js';
export type { SaucerLike, OutputSpec } from './saucer/saucer-like.js';
export { CompilerContext } from './context.js';
export type { CompileTarget } from './context.js';
export { OPS } from './saucer/ops.js';
export { OPS_V12 } from './saucer/ops-v12.js';
export { SVM_UNSUPPORTED } from './saucer/svm-profile.js';
export { UnsupportedTargetError, TARGET_CAPABILITIES } from './capabilities.js';
export { estimatePacket, stagingTransactionCount, PAYER_REF } from './planner/index.js';
export type { AccountMeta, AccountPlan, PacketBudget, PacketBudgetOptions, PacketMode } from './planner/index.js';

export type {
  AbiParameter,
  AbiFunction,
  AbiItem,
  Abi,
  ContractConfig,
  ContractsConfig,
  ContractInfo,
} from './contracts.js';

export type ArgValue = bigint | string | ArgValue[] | ArgObject;

/**
 * A struct arg at the main() boundary. Passed as a plain object, it is encoded as a
 * TUPLE with fields sorted ALPHABETICALLY — byte-identical to an in-script object
 * literal (see `extractStructType`/`processObjectExpression`) — so main() reads its
 * fields with `param.field` (and nested `param.child.field`) via the same INDEX
 * lowering as any in-script struct. Nested objects recurse; array/scalar/bytes field
 * values encode as their normal ArgValue forms.
 */
export interface ArgObject {
  [key: string]: ArgValue;
}

/** A plain struct object (excludes bigint, string, and arrays — all also `object`-ish). */
function isArgObject(v: ArgValue): v is ArgObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Sorted (alphabetical, localeCompare — matching `extractSortedProperties`) field names
 * of a struct arg, so the encoded tuple order and the compiled `getFieldIndex` order agree.
 */
function sortedArgObjectKeys(obj: ArgObject): string[] {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

/**
 * The StructType (field names + nested field struct types) for a struct arg, mirroring
 * `extractStructType` on an in-script object literal so member access on the main() param
 * resolves the same field indices.
 */
function structTypeFromArg(obj: ArgObject): StructType {
  const fields = sortedArgObjectKeys(obj);
  const fieldStructTypes = fields.map((k) =>
    isArgObject(obj[k]) ? structTypeFromArg(obj[k] as ArgObject) : undefined,
  );
  const hasNestedStruct = fieldStructTypes.some((t) => t !== undefined);

  return hasNestedStruct ? { fields, fieldStructTypes } : { fields };
}

// ── staged svm arg ABI (payload args over CALLDATA) ──
//
// A staged program (target 'svm', staged: true) does NOT bake compile-time args
// into the blob — restaging 16 KB to change one amount is the exact failure the
// buffer split exists to avoid. Per-execution args ride the execute_from_account
// INSTRUCTION PAYLOAD (after the flags byte and optional hash pin) and the engine
// exposes the composite `buffer bytecode ++ args` through CALLDATA — byte-identical
// to an inline execute with the args appended after the compiled STOP. The
// assembly prologue materializes the composite ONCE (a second CALLDATA would copy
// the whole program to the heap again), parks the descriptor in VALUES slot 0,
// and reads each arg exactly where the inline arg-prologue would have pushed it:
//
//   [CALLDATA][WRITE_VALUE 0]                              — once
//   scalar arg (bigint): a 32-byte BIG-ENDIAN word in the payload;
//     [READ_VALUE 0][BYTE_2 L+offset][BYTE_1 32][SLICE][CAST_BE] → scalar.
//   bytes arg (hex string): the raw bytes, length fixed at compile time;
//     [READ_VALUE 0][BYTE_2 L+offset][len][SLICE] → Bytes descriptor (no copy).
//   array args: unsupported in staged mode (ABI-encode to a bytes arg and
//     abi.decode on-chain instead).
//
// `L` = programLength, the compiled program byte length — a compile-time
// constant, so every SLICE offset is an immediate. Slot offsets are relative to
// the start of the payload args (composite offset = L + slot.offset). The SDK
// encodes execute payloads against this exact layout — argsLayout on the
// CompileResult is that contract. The parked slot 0 is safe: the prologue
// finishes with it before main's body runs, and every compiled variable is
// written before it is read (declarations require initializers).

export type ArgsLayoutKind = 'scalar' | 'bytes';

export interface ArgsLayoutSlot {
  /** main() parameter position this slot feeds (slot i ↔ arg i, in order). */
  arg: number;
  kind: ArgsLayoutKind;
  /** Byte offset within the payload args (composite CALLDATA offset = programLength + offset). */
  offset: number;
  /** Slot byte length (32 for scalars; the fixed compile-time length for bytes). */
  length: number;
}

export interface ArgsLayout {
  /** Args transport: per-execution values ride the instruction payload, read via CALLDATA. */
  mode: 'calldata';
  /** Compiled program byte length L — arg i lives at composite offset L + slots[i].offset. */
  programLength: number;
  /** Total payload-arg bytes (slots laid out back to back, no padding). */
  byteLength: number;
  slots: ArgsLayoutSlot[];
}

/** Mirrors the engine's MAX_BUFFER_CAPACITY (u16::MAX) — the composite `program ++ args` ceiling. */
const MAX_COMPOSITE_BYTES = 65_535;

export interface CompileOptions {
  label?: string;
  baseDirs?: string[];
  contracts?: ContractsConfig;
  args?: ArgValue[];
  /**
   * Bytecode target: 'v1' (prefix, Solidity interpreter), 'v12' (postfix, Huff runtime) or
   * 'svm' (postfix v12 dialect for the Solana engine — same assembler/opcodes, divergent
   * call/storage lowering; the result carries an accountPlan). Default 'v1'.
   */
  target?: CompileTarget;
  /**
   * Target 'svm' only: compile for STAGED execution (execute_from_account).
   * Compile-time `args` are not baked into the bytecode — the prologue reads
   * them from the instruction payload via CALLDATA (see the staged arg ABI
   * above) so one staged buffer serves every per-execution argument set. User
   * refs intern from index 0 (no reserved accounts); ctx.msgData() is rejected (the
   * prologue owns the single CALLDATA). The result carries `argsLayout`, the
   * contract the SDK encodes execute payload args against.
   */
  staged?: boolean;
  /**
   * Transform an imported SOURCE module's text before parsing — e.g. strip TypeScript types.
   * Receives (code, absoluteFilePath); return plain JS. Only invoked for source-file function
   * imports (`import { fn } from "./mod"`), never for `.json` contract ABIs, and only OVERRIDES
   * the built-in behavior: absent this, a `.ts`/`.sauce.ts` import already runs through the
   * compiler's own ts-evaluator-powered fold+strip front-end automatically; plain `.js`/`.sauce`
   * modules need no transform either way.
   */
  transformModule?: (code: string, filePath: string) => string;
  /**
   * Treat the top-level `source` string as TypeScript: runs it through the same built-in
   * fold+strip front-end as a `.ts`/`.sauce.ts` import (constant-condition branches provably
   * dead per `ts-evaluator` are dropped, then types are stripped) before `acorn.parse` ever
   * sees it. Default false — a plain SauceScript/JS `source` needs no TS handling and this
   * option is a no-op cost otherwise. `options.label`, if set, is used as the synthetic
   * filename ts-evaluator/TypeScript diagnostics reference.
   */
  tsSource?: boolean;
  /**
   * Drop every function NOT reachable from main() (after compile-time constant folding) so an
   * imported-but-unreferenced function — or a handler behind a statically-false branch — is not
   * emitted. Default true — minimal bytecode by default. Set `false` for the legacy shape where
   * every declared/imported function is emitted regardless of use (e.g. a test pinning an exact
   * v1 function-table layout, where dropping a function would shift every later index).
   */
  treeshake?: boolean;
  /**
   * Whether an if/ternary/`&&`/`||` whose condition is a compile-time constant (a literal, a
   * `defines` name, or a top-level `const X = <literal>`) emits only its taken branch. Default
   * true — this can only ever act on an ACTUALLY-constant condition (anything runtime-derived
   * evaluates to `undefined` and compiles as a normal branch, unchanged), so it's always safe.
   * Set `false` to get the pre-folding literal output, e.g. a test pinning the exact unfolded
   * bytecode of `if (1 === 1)`.
   */
  fold?: boolean;
  /**
   * Compile-time constants (name → value) used for conditional compilation: an `if`/ternary/
   * `&&`/`||` whose condition folds to a known value emits only the taken branch, so a guarded
   * protocol handler call (`if (HAS_CURVE) curve(...)`) vanishes when its flag is false — and
   * with `treeshake`, the now-unreferenced handler is dropped from the bytecode. Booleans map to
   * 1n/0n. Top-level `const X = <literal>` in the program are folded the same way.
   */
  defines?: Record<string, bigint | boolean | number>;
  /**
   * Module specifiers whose EXPORTED functions and top-level consts are broadcast into this
   * compile's global resolution set with NO import line — the same resolution + registration
   * a normal `import { x } from "./mod"` performs, just seeded from this list instead of an
   * `ImportDeclaration` in the source. Each specifier is resolved exactly like a source-file
   * import (relative or bare/package, via the same `baseDirs`/node_modules lookup); an ambient
   * module that itself defines `main()` is rejected, mirroring a regular import. Precedence:
   * **user code always wins** — an ambient function/const is registered only when the entry
   * program's own local/imported functions, consts, or (for the const channel) a runtime
   * variable/parameter of the same name doesn't already claim it; two DIFFERENT ambient modules
   * exporting the same name is a compile error (neither side is "the user's"). Mirrors
   * compiler-rs's `CompileOptions.ambient` primitive — the stdlib/DSL plugin's injection
   * mechanism (see `docs/plans/ambient-import-chain-scope-design.md` §1). Default: none.
   */
  ambient?: string[];
  /**
   * Compile cache — ON BY DEFAULT. `compile()` returns a cached result for a
   * repeat (source + options) instead of recompiling, and stores each fresh
   * result. Values:
   *   - omitted / `true` → the process-global default cache (getDefaultCompileCache)
   *   - `false`          → no caching; always recompile (a guaranteed-fresh compile)
   *   - a `CompileCache` → use that store (a Map, or createCompileCache() for
   *                        bounded size + hit/miss stats)
   * The key covers every serializable input, so a difference can only ever miss,
   * never mis-hit. The two inputs it cannot capture — `transformModule`'s behavior
   * and the on-disk contents of `baseDirs` imports — are an environment contract:
   * keep them stable for the process, or pin them with `cacheKeyExtra`, or pass
   * `cache: false` when you need to bypass a possibly-stale entry (e.g. after
   * editing an imported file — see also clearDefaultCompileCache()).
   */
  cache?: CompileCache | boolean;
  /**
   * Opaque string mixed verbatim into the cache key — only consulted when `cache`
   * is set. Use it to pin the inputs the key cannot capture on its own: the
   * behavior of `transformModule` and the on-disk contents of `baseDirs` imports.
   * A caller whose imported files can change mid-process (a watch/dev server), or
   * that swaps `transformModule` against a shared cache, should pass a fingerprint
   * (e.g. a hash of the transform config plus the imported files' mtime/size) so a
   * changed input yields a distinct key instead of a stale hit. Omit it and those
   * inputs remain the caller's documented environment contract (see cache.ts).
   */
  cacheKeyExtra?: string;
}

export interface CompileResult {
  bytecode: Uint8Array[];
  warnings: string[];
  /** target 'svm' only: ordered user-account plan (metas[i] = user-account index i). */
  accountPlan?: AccountPlan;
  /** target 'svm' + staged only: the payload-args layout the SDK encodes execute args against. */
  argsLayout?: ArgsLayout;
}

function inferArgType(v: ArgValue): { kind: VariableKind; elementType?: ElementType; structType?: StructType } {
  if (typeof v === 'bigint') return { kind: 'scalar' };

  if (typeof v === 'string') return { kind: 'dynamic' }; // hex bytes

  if (isArgObject(v)) return { kind: 'dynamic', structType: structTypeFromArg(v) }; // struct (TUPLE)

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

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  // Cache is ON by default: undefined/true → the process-global store, false →
  // bypass, an instance → that store.
  const opt = options.cache;
  const cache = opt === false ? undefined : opt === undefined || opt === true ? getDefaultCompileCache() : opt;

  if (!cache) return compileFresh(source, options);

  const key = compileCacheKey(source, options);
  const hit = cache.get(key);

  if (hit) return cloneCompileResult(hit);

  const result = compileFresh(source, options);
  // Store a clone so a caller mutating the returned result can't corrupt the
  // cache; return a clone so a later compile can't corrupt this caller's result.
  cache.set(key, cloneCompileResult(result));

  return result;
}

function compileFresh(source: string, options: CompileOptions = {}): CompileResult {
  const target: CompileTarget = options.target ?? 'v1';
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

  if (pre && pre.wideReturnArrays.size > 0) ctx.wideReturnArrays = pre.wideReturnArrays;

  // §1.5 — explicit storage-kind annotations captured before the ts-frontend's type strip.
  // Empty (untouched) for a non-tsSource compile, so `storeExpression`'s cross-check is inert.
  if (pre && pre.annotatedKinds.size > 0) ctx.setAnnotatedKinds(pre.annotatedKinds);

  if (options.defines) ctx.setDefines(options.defines);

  if (options.ambient && options.ambient.length > 0) ctx.ambient = options.ambient;

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
        throw new Error(
          `staged svm program (${argsLayout.programLength} bytes) plus payload args (${argsLayout.byteLength} bytes) ` +
            `exceeds the ${MAX_COMPOSITE_BYTES}-byte CALLDATA composite ceiling`,
        );
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

function patchCalls(
  bc: Uint8Array,
  calls: CallPlaceholder[],
  funcOffsets: (number | undefined)[],
  posShift = 0,
  mainIndex = -1,
): void {
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

function patchSdup(bc: Uint8Array, position: number, realPos: number): void {
  if (realPos < 1 || realPos > 16) throw new Error(`REF position out of range: ${realPos}`);

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
function buildArgsLayout(args: ArgValue[]): ArgsLayout {
  const slots: ArgsLayoutSlot[] = [];
  let offset = 0;

  args.forEach((value, arg) => {
    if (Array.isArray(value) || isArgObject(value)) {
      throw new Error(
        `staged svm args do not support ${Array.isArray(value) ? 'array' : 'struct'} values (arg ${arg}); ABI-encode the collection into a bytes arg and abi.decode it on-chain`,
      );
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
function stagedSlotReadLen(slot: ArgsLayoutSlot): number {
  return 2 + 3 + (slot.length <= 0xff ? 2 : 3) + 1 + (slot.kind === 'scalar' ? 1 : 0);
}

/** [CALLDATA][WRITE_VALUE 0] (3) + the per-slot reads; empty for a no-arg layout. */
function stagedPrologueLen(layout: ArgsLayout): number {
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
function buildStagedPrologue(layout: ArgsLayout, programLength: number): Uint8Array {
  if (layout.slots.length === 0) return new Uint8Array(0);

  const parts: number[] = [OPS.CALLDATA, OPS.WRITE_VALUE, 0x00];

  for (const slot of layout.slots) {
    const offset = programLength + slot.offset;

    parts.push(OPS.READ_VALUE, 0x00);
    parts.push(OPS.BYTE_2, (offset >> 8) & 0xff, offset & 0xff);

    if (slot.length <= 0xff) parts.push(OPS.BYTE_1, slot.length);
    else parts.push(OPS.BYTE_2, (slot.length >> 8) & 0xff, slot.length & 0xff);

    parts.push(OPS.SLICE);

    if (slot.kind === 'scalar') parts.push(OPS.CAST_BE);
  }

  return new Uint8Array(parts);
}

function assembleV12(ctx: CompilerContext, args: ArgValue[], argsLayout?: ArgsLayout): Uint8Array {
  const meta: FunctionMeta[] = ctx.funcMeta;
  const mainMeta = meta.find((m) => m.isMain);

  if (!mainMeta) throw new Error('missing main() function');

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
  const patchMainRefs = (bc: Uint8Array, refs: RefPlaceholder[]): void => {
    for (const r of refs) patchSdup(bc, r.position + mainPrefixLen, r.depth + mainMeta.paramCount - r.paramIndex);
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
  const funcOffsets: (number | undefined)[] = [];
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

  const parts: (Uint8Array | number[])[] = [mainBc, [OPS.STOP]];
  for (const h of built) parts.push(h.bc, [OPS_V12.FUNC_RETURN]);

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
function assembleV12WithArgs(
  ctx: CompilerContext,
  mainMeta: FunctionMeta,
  meta: FunctionMeta[],
  args: ArgValue[],
  argsLayout?: ArgsLayout,
): Uint8Array {
  // Prologue: push each arg (postfix, forward order so arg0 is deepest = paramIndex 0).
  // Inline: literal pushes of the compile-time values. Staged: CALLDATA-composite
  // SLICEs per argsLayout — same count, order, and net +1 per arg. The staged
  // prologue's offsets embed the TOTAL program length, so its bytes are emitted
  // after the total is known; its length is a pure function of the layout.
  const inlinePrologue = argsLayout ? undefined : concatBytes(args.map((a) => encodeArgValueV12(ctx, a)._bytes));
  const prologueLen = argsLayout ? stagedPrologueLen(argsLayout) : inlinePrologue!.length;

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
  const funcOffsets: (number | undefined)[] = [];
  let off = prologueLen + mainBody.length + 1; // after [prologue][main body (+ALLOCATE)][STOP]
  for (const h of built) {
    funcOffsets[ctx.getFunc(h.meta.name)] = off;
    off += h.bc.length + 1; // body + FUNC_RETURN
  }

  // `off` is now the total program length L — the staged prologue's composite
  // SLICE offsets are L + slot.offset (arg i rides the payload right after the
  // program bytes).
  const prologue = argsLayout ? buildStagedPrologue(argsLayout, off) : inlinePrologue!;

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

  const parts: (Uint8Array | number[])[] = [prologue, mainBody, [OPS.STOP]];
  for (const h of built) parts.push(h.bc, [OPS_V12.FUNC_RETURN]);

  return concatBytes(parts);
}

// Postfix arg encoder mirroring `encodeArgValue` (the v1 prefix form) but emitting
// V12 builder ops: scalar → int push, hex string → bytes, array → tuple(elems).
// Built via the V12Saucer methods so the runtime decodes args identically to how
// the compiler builds the same values inline (nested tuples recurse).
function encodeArgValueV12(ctx: CompilerContext, v: ArgValue): V12Saucer {
  if (Array.isArray(v)) {
    return new V12Saucer(ctx).tuple(v.map((el) => encodeArgValueV12(ctx, el)));
  }

  // Struct: a TUPLE of the field values in alphabetical order (matches the in-script
  // object literal so main() reads its fields by the same INDEX).
  if (isArgObject(v)) {
    return new V12Saucer(ctx).tuple(sortedArgObjectKeys(v).map((k) => encodeArgValueV12(ctx, v[k])));
  }

  if (typeof v === 'string') return new V12Saucer(ctx).bytes(hexToBytes(v));

  return new V12Saucer(ctx).int(typeof v === 'bigint' ? v : BigInt(v));
}

function encodeArgValue(v: ArgValue): Uint8Array {
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

  if (typeof v === 'string') return encodeBytes(hexToBytes(v));

  return encodeInt(typeof v === 'bigint' ? v : BigInt(v));
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}
