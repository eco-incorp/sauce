import { OPS } from './ops.js';
import { OPS_V12 } from './ops-v12.js';
import { encodeInt } from './integer.js';
import { encodeBytes, encodeString } from './bytes.js';
import { encodeArray } from './array.js';
import { assertSvmSupported } from './svm-profile.js';
import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { SaucerLike, SaucerIfLike, SaucerThenLike, SaucerLoopLike, OutputSpec } from './saucer-like.js';

/**
 * V12Saucer — postfix (stack-based) bytecode emitter for the engine-v12 Huff
 * runtime, the gas-efficient sibling of the v1 Solidity interpreter.
 *
 *   v1  (Saucer):     [OP][a][b]            prefix tree, variables in slot memory
 *   v12 (V12Saucer):  [a][b][OP]            postfix stack, params on the EVM stack
 *
 * It mirrors `Saucer`'s lowercase method surface (so the processor stays
 * target-agnostic — see `SaucerLike`) while emitting bytes byte-identical to the
 * engine-v12 Solidity `V12Saucer.sol` builder. Beyond the shared surface it tracks:
 *
 *   - stackEffect    net stack items the expression leaves behind
 *   - isDynamic      whether the result is a heap descriptor (vs a 32-byte scalar)
 *   - callPositions  CALL_FUNCTION offset sentinels   (0xFF00|index → byte offset)
 *   - refPositions   parameter-read SDUP sentinels     (patched at assembly)
 *
 * Sentinels propagate on every compose: a child's byte positions shift by the
 * preceding bytes and its REF depths shift by the preceding stackEffect
 * (`mergeSentinels`). The assembly in `compile()` resolves them once all offsets
 * are known. Non-commutative ops swap operands so `a - b` emits `[a][b][SUB]`
 * with the engine's expected operand order.
 *
 * Local `let`/`const` variables still live in slot memory (`WRITE_VALUE`/
 * `READ_VALUE`, postfix); only function PARAMETERS live on the stack (REF→SDUP
 * read, SET→SSWAP+SDROP write). `read`/`store` consult the context to pick.
 */

export interface RefPlaceholder {
  /** byte offset of the SDUP sentinel inside this builder's bytes */
  position: number;
  /** 0-indexed parameter slot (storedStackPos - 1) */
  paramIndex: number;
  /** stack depth at the point the REF was emitted */
  depth: number;
}

export interface CallPlaceholder {
  /** byte offset of the 2-byte CALL_FUNCTION sentinel */
  pos: number;
  funcIndex: number;
}

// Non-commutative ops: emit operands [a][b] but the engine wants [b][a], so swap.
const SWAPPED_OPS = new Set<number>([
  OPS.SUB,
  OPS.DIV,
  OPS.MOD,
  OPS.EXP,
  OPS.S_DIV,
  OPS.S_MOD,
  OPS.BOOL_GT,
  OPS.BOOL_LT,
  OPS.BOOL_GTE,
  OPS.BOOL_LTE,
  OPS.BOOL_SGT,
  OPS.BOOL_SLT,
  OPS.BOOL_SGTE,
  OPS.BOOL_SLTE,
]);

/** Flatten byte chunks (Uint8Arrays or number[]) into one Uint8Array. */
export const concatBytes = (parts: (Uint8Array | number[])[]): Uint8Array => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }

  return out;
};

// Variadic convenience wrapper used throughout the postfix builder.
const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => concatBytes(parts);

// Shift a child's sentinels into the parent's frame and collect them: byte
// positions move by `posOffset` (the preceding bytes) and REF depths by
// `depthOffset` (the preceding stackEffect). The single source of truth for both
// V12Saucer and its control-flow helper classes.
function mergeSentinels(
  calls: CallPlaceholder[],
  refs: RefPlaceholder[],
  src: V12Saucer,
  posOffset: number,
  depthOffset: number,
): void {
  for (const c of src.callPositions) calls.push({ pos: c.pos + posOffset, funcIndex: c.funcIndex });
  for (const r of src.refPositions)
    refs.push({ position: r.position + posOffset, paramIndex: r.paramIndex, depth: r.depth + depthOffset });
}

const MAX_BYTE_1 = 0xff;
const MAX_BYTE_2 = 0xffff;

export class V12Saucer implements SaucerLike {
  constructor(
    readonly ctx: CompilerContext,
    readonly _bytes: Uint8Array = new Uint8Array(),
    readonly stackEffect: number = 0,
    readonly isDynamic: boolean = false,
    readonly callPositions: CallPlaceholder[] = [],
    readonly refPositions: RefPlaceholder[] = [],
  ) {}

  /**
   * Append a run of operands, threading the running byte/stack offsets through
   * `mergeSentinels` once. Operands are emitted forward by default, or reversed
   * (ARRAY/TUPLE/CONCAT want elements in reverse); `wrap` MSTORE-wraps each scalar
   * into a heap descriptor (for CONCAT). The single accumulator behind `nary`,
   * `concat`, `callFunction` and `log`. Returns the parts plus the final offsets so
   * callers can append their own header (and a CALL_FUNCTION sentinel).
   */
  private appendOperands(
    operands: SaucerLike[],
    opts: { reverse?: boolean; wrap?: boolean } = {},
  ): {
    parts: Uint8Array[];
    calls: CallPlaceholder[];
    refs: RefPlaceholder[];
    posOff: number;
    effectSum: number;
  } {
    const parts: Uint8Array[] = [this._bytes];
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    let posOff = this._bytes.length;
    let depthOff = this.stackEffect;
    let effectSum = 0;
    const ordered = opts.reverse ? [...operands].reverse() : operands;
    for (const operandL of ordered) {
      const operand = operandL as V12Saucer;
      const bytes = opts.wrap ? V12Saucer.wrapDescriptor(operand) : operand._bytes;
      mergeSentinels(calls, refs, operand, posOff, depthOff);
      parts.push(bytes);
      posOff += bytes.length;
      depthOff += operand.stackEffect;
      effectSum += operand.stackEffect;
    }

    return { parts, calls, refs, posOff, effectSum };
  }

  /** Append literal bytes (a constant/context op) to this builder. */
  private withBytes(extra: Uint8Array | number[], stackEffect: number, isDynamic: boolean): V12Saucer {
    return new V12Saucer(
      this.ctx,
      concat(this._bytes, extra),
      stackEffect,
      isDynamic,
      [...this.callPositions],
      [...this.refPositions],
    );
  }

  join(other: SaucerLike): V12Saucer {
    const o = other as V12Saucer;

    if (o._bytes.length === 0) return this;

    if (this._bytes.length === 0) return o;

    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, o, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, o._bytes),
      this.stackEffect + o.stackEffect,
      o.isDynamic,
      calls,
      refs,
    );
  }

  // ── core operand shapes ──

  private binary(op: number, aL: SaucerLike, bL: SaucerLike, isDynamic = false): V12Saucer {
    const a = aL as V12Saucer;
    const b = bL as V12Saucer;
    const [first, second] = SWAPPED_OPS.has(op) ? [b, a] : [a, b];
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    const firstOff = this._bytes.length;
    mergeSentinels(calls, refs, first, firstOff, this.stackEffect);
    mergeSentinels(calls, refs, second, firstOff + first._bytes.length, this.stackEffect + first.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, first._bytes, second._bytes, [op]),
      this.stackEffect + a.stackEffect + b.stackEffect - 1,
      isDynamic,
      calls,
      refs,
    );
  }

  private unary(op: number, operandL: SaucerLike, isDynamic = false): V12Saucer {
    const operand = operandL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, operand, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, operand._bytes, [op]),
      this.stackEffect + operand.stackEffect,
      isDynamic,
      calls,
      refs,
    );
  }

  private ternary(op: number, aL: SaucerLike, bL: SaucerLike, cL: SaucerLike, isDynamic = false): V12Saucer {
    const a = aL as V12Saucer;
    const b = bL as V12Saucer;
    const c = cL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    const aOff = this._bytes.length;
    mergeSentinels(calls, refs, a, aOff, this.stackEffect);
    const bOff = aOff + a._bytes.length;
    mergeSentinels(calls, refs, b, bOff, this.stackEffect + a.stackEffect);
    const cOff = bOff + b._bytes.length;
    mergeSentinels(calls, refs, c, cOff, this.stackEffect + a.stackEffect + b.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, a._bytes, b._bytes, c._bytes, [op]),
      this.stackEffect + a.stackEffect + b.stackEffect + c.stackEffect - 2,
      isDynamic,
      calls,
      refs,
    );
  }

  /** Append a sequence of operands (reverse order) followed by a header. */
  private nary(operands: SaucerLike[], header: number[], stackEffect: number, isDynamic: boolean): V12Saucer {
    const { parts, calls, refs } = this.appendOperands(operands, { reverse: true });
    parts.push(new Uint8Array(header));

    return new V12Saucer(this.ctx, concat(...parts), stackEffect, isDynamic, calls, refs);
  }

  // ── context — nullary ──
  msgSender(): V12Saucer {
    return this.withBytes([OPS.MSG_SENDER], this.stackEffect + 1, false);
  }
  msgValue(): V12Saucer {
    return this.withBytes([OPS.CALL_VALUE], this.stackEffect + 1, false);
  }
  msgData(): V12Saucer {
    // Staged svm user code must never emit its own CALLDATA: every CALLDATA
    // materializes the WHOLE `program ++ args` composite into the 65,535-byte
    // heap (25% of it at 16 KB), and the staged arg prologue already owns the
    // single sanctioned one — per-execution values arrive as payload args.
    if (this.ctx.isSvm && this.ctx.staged) {
      throw new Error(
        'msg.data is not supported in staged svm mode (CALLDATA copies the whole staged program to the heap); pass per-execution values as payload args instead',
      );
    }

    return this.withBytes([OPS.CALLDATA], this.stackEffect + 1, true);
  }
  blockNumber(): V12Saucer {
    return this.withBytes([OPS.BLOCK_NUMBER], this.stackEffect + 1, false);
  }
  blockTimestamp(): V12Saucer {
    return this.withBytes([OPS.TIMESTAMP], this.stackEffect + 1, false);
  }
  blockCoinbase(): V12Saucer {
    return this.withBytes([OPS.COINBASE], this.stackEffect + 1, false);
  }
  blockPrevrandao(): V12Saucer {
    return this.withBytes([OPS.PREVRANDAO], this.stackEffect + 1, false);
  }
  blockGasLimit(): V12Saucer {
    return this.withBytes([OPS.GAS_LIMIT], this.stackEffect + 1, false);
  }
  blockBaseFee(): V12Saucer {
    return this.withBytes([OPS.BASE_FEE], this.stackEffect + 1, false);
  }
  blockBlobBaseFee(): V12Saucer {
    return this.withBytes([OPS.BLOB_BASE_FEE], this.stackEffect + 1, false);
  }
  blockChainId(): V12Saucer {
    return this.withBytes([OPS.CHAIN_ID], this.stackEffect + 1, false);
  }
  txOrigin(): V12Saucer {
    return this.withBytes([OPS.TX_ORIGIN], this.stackEffect + 1, false);
  }
  txGasPrice(): V12Saucer {
    return this.withBytes([OPS.GAS_PRICE], this.stackEffect + 1, false);
  }
  addressSelf(): V12Saucer {
    return this.withBytes([OPS.THIS_ADDRESS], this.stackEffect + 1, false);
  }
  addressBalance(): V12Saucer {
    return this.withBytes([OPS.SELF_BALANCE], this.stackEffect + 1, false);
  }
  gasLeft(): V12Saucer {
    return this.withBytes([OPS.GAS_LEFT], this.stackEffect + 1, false);
  }

  // ── context — unary ──
  balanceOf(addr: SaucerLike): V12Saucer {
    return this.unary(OPS.BALANCE, addr);
  }
  blockHash(n: SaucerLike): V12Saucer {
    return this.unary(OPS.BLOCK_HASH, n);
  }
  codeSize(addr: SaucerLike): V12Saucer {
    return this.unary(OPS.EXT_CODE_SIZE, addr);
  }
  codeHash(addr: SaucerLike): V12Saucer {
    return this.unary(OPS.EXT_CODE_HASH, addr);
  }
  blobHash(n: SaucerLike): V12Saucer {
    return this.unary(OPS.BLOB_HASH, n);
  }
  isContract(addr: SaucerLike): V12Saucer {
    return this.unary(OPS.IS_CONTRACT, addr);
  }
  isEOA(addr: SaucerLike): V12Saucer {
    return this.unary(OPS.IS_EOA, addr);
  }

  // ── values ──
  int(value: bigint): V12Saucer {
    // encodeInt emits v1's PREFIX form for negatives ([NEG, BYTE_N, …]); the
    // postfix engines pop NEG's operand off the stack, so the literal must come
    // first and NEG last (the Solidity builder's NEG(UINT(n)) order).
    const bytes = encodeInt(value);

    return this.withBytes(value < 0n ? concat(bytes.slice(1), [OPS.NEG]) : bytes, this.stackEffect + 1, false);
  }
  bytes(data: Uint8Array): V12Saucer {
    return this.withBytes(encodeBytes(data), this.stackEffect + 1, true);
  }
  string(value: string): V12Saucer {
    return this.withBytes(encodeString(value), this.stackEffect + 1, true);
  }

  tuple(elements: SaucerLike[]): V12Saucer {
    if (elements.length > MAX_BYTE_1) throw new Error(`tuple too large: ${elements.length} exceeds ${MAX_BYTE_1}`);

    return this.nary(elements, [OPS.TUPLE, elements.length], this.naryEffect(elements), true);
  }

  array(elements: SaucerLike[], forcedWidth?: number): V12Saucer {
    // An array literal is a self-contained constant whose encoding (static-packed
    // for fixed-width literals, inlined for dynamic literals) is identical in v1
    // and v12 — the engine reads it the same way. Reuse the shared encoder.
    return this.withBytes(encodeArray(elements, forcedWidth), this.stackEffect + 1, true);
  }

  private naryEffect(elements: SaucerLike[]): number {
    const sum = elements.reduce((n, e) => n + (e as V12Saucer).stackEffect, 0);

    return this.stackEffect + sum - (elements.length - 1);
  }

  index(arr: SaucerLike, idx: SaucerLike): V12Saucer {
    // v12: [idx][arr][INDEX] — idx deeper, array on top.
    const i = idx as V12Saucer;
    const a = arr as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, i, this._bytes.length, this.stackEffect);
    mergeSentinels(calls, refs, a, this._bytes.length + i._bytes.length, this.stackEffect + i.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, i._bytes, a._bytes, [OPS.INDEX]),
      this.stackEffect + i.stackEffect + a.stackEffect - 1,
      false,
      calls,
      refs,
    );
  }

  length(arr: SaucerLike): V12Saucer {
    return this.unary(OPS.LENGTH, arr, false);
  }

  setIndex(arrL: SaucerLike, idxL: SaucerLike, valueL: SaucerLike): V12Saucer {
    // v12: [value][index][array][SET_INDEX] — value deepest, array on top.
    // Returns the (same) array descriptor; isDynamic=false matches the engine $$
    // reference (the idempotent smart-MSTORE passes the descriptor through unchanged).
    const value = valueL as V12Saucer;
    const idx = idxL as V12Saucer;
    const arr = arrL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    const valueOff = this._bytes.length;
    mergeSentinels(calls, refs, value, valueOff, this.stackEffect);
    const idxOff = valueOff + value._bytes.length;
    mergeSentinels(calls, refs, idx, idxOff, this.stackEffect + value.stackEffect);
    const arrOff = idxOff + idx._bytes.length;
    mergeSentinels(calls, refs, arr, arrOff, this.stackEffect + value.stackEffect + idx.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, value._bytes, idx._bytes, arr._bytes, [OPS.SET_INDEX]),
      this.stackEffect + value.stackEffect + idx.stackEffect + arr.stackEffect - 2,
      false,
      calls,
      refs,
    );
  }

  newArray(count: SaucerLike): V12Saucer {
    // v12: [count][NEW_ARRAY] — consumes count, pushes a fresh TUPLE descriptor.
    // isDynamic=true (matches TUPLE).
    return this.unary(OPS.NEW_ARRAY, count, true);
  }

  /** Wrap a scalar operand as a heap descriptor (append MSTORE) for ops that consume dynamic data. */
  private static wrapDescriptor(op: V12Saucer): Uint8Array {
    return op.isDynamic ? op._bytes : concat(op._bytes, [OPS_V12.MSTORE]);
  }

  concat(operands: SaucerLike[]): V12Saucer {
    if (operands.length === 0 || operands.length > MAX_BYTE_1)
      throw new Error(`concat requires 1-255 operands, got ${operands.length}`);

    // Reverse order, each scalar MSTORE-wrapped into a heap descriptor.
    const { parts, calls, refs } = this.appendOperands(operands, { reverse: true, wrap: true });
    parts.push(new Uint8Array([OPS.CONCAT, operands.length]));

    return new V12Saucer(this.ctx, concat(...parts), this.naryEffect(operands), true, calls, refs);
  }

  slice(dataL: SaucerLike, offsetL: SaucerLike, lengthL: SaucerLike): V12Saucer {
    const data = dataL as V12Saucer;

    if (data.isDynamic) return this.ternary(OPS.SLICE, data, offsetL, lengthL, true);

    // Insert MSTORE after a scalar data operand to make a heap descriptor.
    const offset = offsetL as V12Saucer;
    const length = lengthL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    const dataOff = this._bytes.length;
    mergeSentinels(calls, refs, data, dataOff, this.stackEffect);
    const offsetOff = dataOff + data._bytes.length + 1; // +1 for MSTORE
    mergeSentinels(calls, refs, offset, offsetOff, this.stackEffect + data.stackEffect);
    const lengthOff = offsetOff + offset._bytes.length;
    mergeSentinels(calls, refs, length, lengthOff, this.stackEffect + data.stackEffect + offset.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, data._bytes, [OPS_V12.MSTORE], offset._bytes, length._bytes, [OPS.SLICE]),
      this.stackEffect + data.stackEffect + offset.stackEffect + length.stackEffect - 2,
      true,
      calls,
      refs,
    );
  }

  abiEncode(tuple: SaucerLike): V12Saucer {
    return this.unary(OPS.ABI_ENCODE, tuple, true);
  }

  abiDecode(count: number, dataL: SaucerLike, typeSpecs: number[]): V12Saucer {
    const data = dataL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, data, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, data._bytes, [OPS.ABI_DECODE, count], typeSpecs),
      this.stackEffect + data.stackEffect,
      true,
      calls,
      refs,
    );
  }

  /** v12-only: CAST_BE — cast a dynamic value to a scalar word, big-endian. */
  castBe(data: SaucerLike): V12Saucer {
    return this.unary(OPS.CAST_BE, data, false);
  }

  /** v12-only: CAST_LE — CAST_BE with the dereferenced bytes read little-endian (byte 0 least significant). The svm-native cast: uint() lowers to it on target 'svm'. */
  castLe(data: SaucerLike): V12Saucer {
    return this.unary(OPS.CAST_LE, data, false);
  }

  // ── variables ──
  store(
    name: string,
    valueL: SaucerLike,
    _kind: VariableKind = 'scalar',
    elementType?: ElementType,
    structType?: StructType,
  ): V12Saucer {
    const value = valueL as V12Saucer;
    const existing = this.ctx.getVar(name);

    if (existing?.isParam) {
      // SET: [value][SSWAP_pos][SDROP] — replace the param in place on the stack.
      //
      // `findStackVar` alone is only the STATIC distance from the top of the param
      // block, assuming this write executes with NOTHING else on the stack above the
      // frame's params — true only for a bare `main()` writing its own single-value
      // top-level parameter. It omits two things the READ path (below) already
      // accounts for via its patched SDUP sentinel (see `compile()`'s
      // `depth + 1 + paramCount - paramIndex` for a helper / `depth + paramCount -
      // paramIndex` for main): (1) the +1 call-frame return-address word a HELPER's
      // frame carries (main has none — it's inlined, never called), and (2) the
      // live expression-stack depth already built up by the time this SSWAP actually
      // executes — `this.stackEffect` (bytes already emitted before `value`) plus
      // `value.stackEffect` (what `value`'s own bytes push). Omitting both meant a
      // param write was only ever correct for main() writing its sole parameter with
      // an empty stack — every other shape (a helper's own param, the 2nd/3rd of
      // several params, a write nested inside an `if`/`while` body, two writes to one
      // param) silently computed the WRONG SSWAP target, either corrupting an
      // unrelated stack slot or (for a scalar write) just returning the pre-write
      // value with NO revert at all. Confirmed via one-byte bytecode patches on the
      // real Huff runtime before this fix landed (see CLAUDE.md's "v12/svm parameter
      // WRITE" note) — reproducing identically on the pinned AND a newer engine-v12
      // checkout, so this is compiler-side, not engine-side.
      //
      // The final `- 1` is SSWAPn-vs-SDUPn semantics, not a second omission: SDUPn
      // (EVM DUPn) duplicates the nth stack item counting the top as n=1, but SSWAPn
      // (EVM SWAPn) exchanges the top with the (n+1)th item — SWAP1 swaps position 1
      // (top) with position 2. So the SAME "position from top" the read path patches
      // directly into a DUPn needs one subtracted to become the matching SWAPn.
      const depth = this.stackEffect + value.stackEffect;
      const frame = this.ctx.isMainFunction ? 0 : 1;
      const pos = depth + frame + this.ctx.findStackVar(name) - 1;

      if (pos < 1 || pos > 16) throw new Error(`param '${name}' out of stack range: ${pos}`);

      const calls = [...this.callPositions];
      const refs = [...this.refPositions];
      mergeSentinels(calls, refs, value, this._bytes.length, this.stackEffect);

      return new V12Saucer(
        this.ctx,
        concat(this._bytes, value._bytes, [OPS_V12.SSWAP1 + pos - 1, OPS_V12.SDROP]),
        this.stackEffect + value.stackEffect - 1,
        false,
        calls,
        refs,
      );
    }

    // Local: slot store, postfix [value][WRITE_VALUE/WRITE_HEAP][slot].
    const kind: VariableKind = value.isDynamic ? 'dynamic' : 'scalar';
    const variable = existing ?? this.ctx.setVar(name, kind, elementType, structType);
    const op = variable.kind === 'scalar' ? OPS.WRITE_VALUE : OPS.WRITE_HEAP;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, value, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, value._bytes, [op, variable.slot]),
      this.stackEffect + value.stackEffect - 1,
      variable.kind !== 'scalar',
      calls,
      refs,
    );
  }

  read(name: string): V12Saucer {
    const variable = this.ctx.getVar(name);

    if (!variable) throw new Error(`undefined variable: ${name}`);

    if (variable.isParam) {
      // REF: emit an SDUP sentinel (placeholder); compile() patches the real depth.
      const storedPos = this.ctx.getStackVarPos(name);

      if (storedPos < 1 || storedPos > 16) throw new Error(`param '${name}' out of stack range: ${storedPos}`);

      const refs = [
        ...this.refPositions,
        { position: this._bytes.length, paramIndex: storedPos - 1, depth: this.stackEffect },
      ];

      return new V12Saucer(
        this.ctx,
        concat(this._bytes, [OPS_V12.SDUP1 + storedPos - 1]),
        this.stackEffect + 1,
        false,
        [...this.callPositions],
        refs,
      );
    }

    const op = variable.kind === 'scalar' ? OPS.READ_VALUE : OPS.READ_HEAP;

    return this.withBytes([op, variable.slot], this.stackEffect + 1, variable.kind !== 'scalar');
  }

  // ── arithmetic ──
  add(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.ADD, l, r);
  }
  sub(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.SUB, l, r);
  }
  neg(o: SaucerLike): V12Saucer {
    return this.unary(OPS.NEG, o);
  }
  mul(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.MUL, l, r);
  }
  div(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.DIV, l, r);
  }
  mod(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.MOD, l, r);
  }
  exp(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.EXP, l, r);
  }
  sqrt(o: SaucerLike): V12Saucer {
    return this.unary(OPS.SQRT, o);
  }
  mulDiv(a: SaucerLike, b: SaucerLike, c: SaucerLike): V12Saucer {
    return this.ternary(OPS.MUL_DIV, a, b, c);
  }

  // ── extended / signed arithmetic (v12-only) ──
  addMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): V12Saucer {
    return this.ternary(OPS.ADD_MOD, a, b, n);
  }
  mulMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): V12Saucer {
    return this.ternary(OPS.MUL_MOD, a, b, n);
  }
  sDiv(a: SaucerLike, b: SaucerLike): V12Saucer {
    return this.binary(OPS.S_DIV, a, b);
  }
  sMod(a: SaucerLike, b: SaucerLike): V12Saucer {
    return this.binary(OPS.S_MOD, a, b);
  }
  sShr(value: SaucerLike, shift: SaucerLike): V12Saucer {
    return this.binary(OPS.S_AR, value, shift);
  }
  // Math.signExtend(value, fromByte): SIGN_EXTEND wants the byte index (fromByte) on top
  // (popped first), so operands push in source order — SIGN_EXTEND is intentionally NOT in
  // SWAPPED_OPS, matching compiler-rs's `math_operand_order` (source order for signExtend).
  signExtend(value: SaucerLike, fromByte: SaucerLike): V12Saucer {
    return this.binary(OPS.SIGN_EXTEND, value, fromByte);
  }
  sGt(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_SGT, l, r);
  }
  sLt(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_SLT, l, r);
  }
  sGte(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_SGTE, l, r);
  }
  sLte(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_SLTE, l, r);
  }

  // ── crypto ──
  keccak256(dataL: SaucerLike): V12Saucer {
    const data = dataL as V12Saucer;

    if (data.isDynamic) return this.unary(OPS.KECCAK256, data, false);

    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, data, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, data._bytes, [OPS_V12.MSTORE, OPS.KECCAK256]),
      this.stackEffect + data.stackEffect,
      false,
      calls,
      refs,
    );
  }
  ecdsaVerify(signer: SaucerLike, hash: SaucerLike, signature: SaucerLike): V12Saucer {
    return this.ternary(OPS.ECDSA_VERIFY, signer, hash, signature, false);
  }

  // ── storage ──
  sload(slot: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'storage.read'); // svm SLOAD reads account data, not slots

    return this.unary(OPS.SLOAD, slot);
  }
  sstore(slot: SaucerLike, value: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'storage.write'); // svm SSTORE writes account data, not slots

    // v12: [value][slot][SSTORE] — value before slot.
    return this.binaryRaw(OPS.SSTORE, value, slot, false);
  }
  tload(key: SaucerLike): V12Saucer {
    return this.unary(OPS.TLOAD, key);
  }
  tstore(key: SaucerLike, value: SaucerLike): V12Saucer {
    return this.binaryRaw(OPS.TSTORE, value, key, false);
  }

  /**
   * Binary op with explicit (no-swap) operand order: [first][second][OP].
   * `opStackEffect` is the opcode's own net stack delta: -2 for ops that consume
   * both operands and push nothing (SSTORE/TSTORE), -1 for ops that leave a result
   * (STATIC/DELEGATE push a descriptor). Mirrors `../sauce/engine-v12/src/V12Saucer.sol`
   * (`_propagate2(..., -2)` for the stores vs `_binaryOp(..., -1)` for the calls).
   */
  private binaryRaw(
    op: number,
    firstL: SaucerLike,
    secondL: SaucerLike,
    isDynamic: boolean,
    opStackEffect = -2,
  ): V12Saucer {
    const first = firstL as V12Saucer;
    const second = secondL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, first, this._bytes.length, this.stackEffect);
    mergeSentinels(calls, refs, second, this._bytes.length + first._bytes.length, this.stackEffect + first.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, first._bytes, second._bytes, [op]),
      this.stackEffect + first.stackEffect + second.stackEffect + opStackEffect,
      isDynamic,
      calls,
      refs,
    );
  }

  /**
   * Ternary op with explicit (no-swap) operand order: [first][second][third][OP].
   * `opStackEffect` is the opcode's own net stack delta: -2 for ops that consume
   * three operands and push a result (svm SLOAD), -3 for ops that push nothing
   * (svm SSTORE). The 3-operand sibling of `binaryRaw`.
   */
  private ternaryRaw(
    op: number,
    firstL: SaucerLike,
    secondL: SaucerLike,
    thirdL: SaucerLike,
    isDynamic: boolean,
    opStackEffect: number,
  ): V12Saucer {
    const first = firstL as V12Saucer;
    const second = secondL as V12Saucer;
    const third = thirdL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    const firstOff = this._bytes.length;
    mergeSentinels(calls, refs, first, firstOff, this.stackEffect);
    const secondOff = firstOff + first._bytes.length;
    mergeSentinels(calls, refs, second, secondOff, this.stackEffect + first.stackEffect);
    const thirdOff = secondOff + second._bytes.length;
    mergeSentinels(calls, refs, third, thirdOff, this.stackEffect + first.stackEffect + second.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, first._bytes, second._bytes, third._bytes, [op]),
      this.stackEffect + first.stackEffect + second.stackEffect + third.stackEffect + opStackEffect,
      isDynamic,
      calls,
      refs,
    );
  }

  // ── create ──
  create(value: SaucerLike, bytecode: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'create');

    return this.binary(OPS.CREATE, value, bytecode);
  }
  create2(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'create2');

    return this.ternary(OPS.CREATE2, value, salt, bytecode);
  }
  create3(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'create3');

    return this.ternary(OPS.CREATE3, value, salt, bytecode);
  }
  createAddress(deployer: SaucerLike, nonce: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'createAddress');

    return this.binary(OPS.CREATE_ADDRESS, deployer, nonce);
  }
  create2Address(deployer: SaucerLike, salt: SaucerLike, bytecodeHash: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'create2Address');

    return this.ternary(OPS.CREATE2_ADDRESS, deployer, salt, bytecodeHash);
  }
  create3Address(salt: SaucerLike): V12Saucer {
    assertSvmSupported(this.ctx, 'create3Address');

    return this.unary(OPS.CREATE3_ADDRESS, salt);
  }

  // ── bitwise ──
  bitAnd(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.AND, l, r);
  }
  bitOr(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.OR, l, r);
  }
  bitXor(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.XOR, l, r);
  }
  bitNot(o: SaucerLike): V12Saucer {
    return this.unary(OPS.NOT, o);
  }
  shl(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.SHL, l, r);
  }
  shr(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.SHR, l, r);
  }

  // ── comparison / boolean ──
  eq(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_EQ, l, r);
  }
  neq(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_NEQ, l, r);
  }
  gt(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_GT, l, r);
  }
  lt(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_LT, l, r);
  }
  gte(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_GTE, l, r);
  }
  lte(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_LTE, l, r);
  }
  and(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_AND, l, r);
  }
  or(l: SaucerLike, r: SaucerLike): V12Saucer {
    return this.binary(OPS.BOOL_OR, l, r);
  }
  not(o: SaucerLike): V12Saucer {
    return this.unary(OPS.BOOL_NOT, o);
  }
  isZero(o: SaucerLike): V12Saucer {
    return this.unary(OPS.BOOL_ZERO, o);
  }
  isNotZero(o: SaucerLike): V12Saucer {
    return this.unary(OPS.BOOL_NOT_ZERO, o);
  }

  // ── control flow ──
  if(condition: SaucerLike): SaucerIfLike {
    return new V12If(this, condition as V12Saucer);
  }
  for(init?: SaucerLike, condition?: SaucerLike, update?: SaucerLike): SaucerLoopLike {
    const parent = init ? this.join(init) : this;

    return new V12Loop(parent, condition as V12Saucer | undefined, update as V12Saucer | undefined);
  }
  while(condition: SaucerLike): SaucerLoopLike {
    return new V12Loop(this, condition as V12Saucer, undefined);
  }
  break(): V12Saucer {
    throw new Error('break is not supported with target v12 yet');
  }
  continue(): V12Saucer {
    throw new Error('continue is not supported with target v12 yet');
  }

  // ── calls ──
  callFunction(functionName: string, args: SaucerLike[]): V12Saucer {
    if (args.length > MAX_BYTE_1) throw new Error(`too many params (max 255), got ${args.length}`);

    const index = this.ctx.getFunc(functionName);
    // Args forward, then the CALL_FUNCTION header + a sentinel at the 2-byte index.
    const { parts, calls, refs, posOff, effectSum } = this.appendOperands(args);
    const sentinel = (0xff00 | index) & 0xffff;
    const callPos = posOff + 1; // position of the 2-byte sentinel
    parts.push(new Uint8Array([OPS.CALL_FUNCTION, (sentinel >> 8) & 0xff, sentinel & 0xff, args.length]));
    calls.push({ pos: callPos, funcIndex: index });

    return new V12Saucer(
      this.ctx,
      concat(...parts),
      this.stackEffect + effectSum - args.length + 1,
      false,
      calls,
      refs,
    );
  }

  externalCall(target: SaucerLike, value: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer {
    const raw = this.ternary(OPS.CALL, target, value, calldata, true);

    return raw.decodeOutput(output);
  }
  staticCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer {
    // STATIC consumes target+calldata and pushes a result descriptor → net -1.
    const raw = this.binaryRaw(OPS.STATIC, target, calldata, true, -1);

    return raw.decodeOutput(output);
  }
  delegateCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer {
    assertSvmSupported(this.ctx, 'delegatecall');

    // DELEGATE consumes target+calldata and pushes a result descriptor → net -1.
    const raw = this.binaryRaw(OPS.DELEGATE, target, calldata, true, -1);

    return raw.decodeOutput(output);
  }

  // ── svm-target lowering (divergent shapes — see svm-profile.ts) ──

  /**
   * svm CALL (0xA2): [accountsArray][calldata][target][CALL] — target (32-byte
   * program id) on top, then the calldata Bytes descriptor, then a static ARRAY
   * of scalar user-account indices (element data inline in bytecode; the engine
   * pops only the descriptor). No value operand. Pushes the CPI returndata as a
   * Bytes descriptor (net -2). `.catch()` composes exactly as on the EVM call,
   * but on SVM it intercepts only PRE-FLIGHT failures (unresolvable target /
   * calldata / accounts operands) — once invoke() launches, a failing callee
   * aborts the whole transaction.
   */
  svmCall(target: SaucerLike, calldata: SaucerLike, accountsArray: SaucerLike): V12Saucer {
    return this.ternary(OPS.CALL, accountsArray, calldata, target, true);
  }

  /** svm STATIC (0xA3): exact alias of svm CALL — identical operands and result. */
  svmStaticCall(target: SaucerLike, calldata: SaucerLike, accountsArray: SaucerLike): V12Saucer {
    return this.ternary(OPS.STATIC, accountsArray, calldata, target, true);
  }

  /**
   * svm SLOAD (0x81): [len][offset][index][SLOAD] — account index on top, then
   * offset, then len. Reads accounts[index].data[offset..offset+len] and pushes
   * a Bytes descriptor (net -2). Surface: accountData(ref, offset, len).
   */
  svmAccountData(index: SaucerLike, offset: SaucerLike, len: SaucerLike): V12Saucer {
    return this.ternaryRaw(OPS.SLOAD, len, offset, index, true, -2);
  }

  /**
   * svm SSTORE (0xC5): [value][offset][index][SSTORE] — account index on top,
   * then offset, then the value Bytes descriptor. Writes the bytes into the
   * (writable) account's data; pushes nothing (net -3, so a bare statement's
   * dropIfUnused is a no-op). Surface: writeAccountData(ref, offset, value).
   * The engine REQUIRES a Bytes descriptor for the value, so a scalar operand
   * is MSTORE-wrapped into a 32-byte heap word first (the CONCAT wrap idiom).
   */
  svmWriteAccountData(index: SaucerLike, offset: SaucerLike, value: SaucerLike): V12Saucer {
    const v = value as V12Saucer;
    const wrapped = v.isDynamic ? v : v.withBytes([OPS_V12.MSTORE], v.stackEffect, true);

    return this.ternaryRaw(OPS.SSTORE, wrapped, offset, index, false, -3);
  }

  private decodeOutput(output?: OutputSpec): V12Saucer {
    if (!output?.count) return this;

    // Decode in place: the raw call bytes ARE the data operand of ABI_DECODE.
    const decoded = new V12Saucer(this.ctx).abiDecode(output.count, this, output.typeSpecs);

    if (output.count > 1) return decoded;

    return new V12Saucer(this.ctx).index(decoded, new V12Saucer(this.ctx).int(0n));
  }

  catch(handlerL: SaucerLike): V12Saucer {
    const handler = handlerL as V12Saucer;

    if (handler._bytes.length > MAX_BYTE_1)
      throw new Error(`catch handler too large: ${handler._bytes.length} bytes exceeds 255`);

    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, handler, this._bytes.length + 2, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, [OPS.CATCH, handler._bytes.length], handler._bytes),
      this.stackEffect,
      this.isDynamic,
      calls,
      refs,
    );
  }

  // ── statements ──
  return(saucer?: SaucerLike): V12Saucer {
    // v12: main is INLINED — its `return` just leaves the value on the stack and the
    // assembly terminates it (build() appends MSTORE, trailing STOP). A HELPER is
    // entered via CALL_FUNCTION, so EVERY `return` must emit FUNC_RETURN to pop its
    // frame+params and jump back to the caller. This MUST include an EARLY return
    // inside a conditional: without the FUNC_RETURN the value is merely left on the
    // stack and execution FALLS THROUGH into the rest of the body, leaking a stack
    // item per call (over a loop of calls → EVM "out of stack"). The function's tail
    // return self-terminates too, making the assembly's trailing FUNC_RETURN dead
    // (harmless) code.
    const withValue = saucer ? this.join(saucer) : this;

    if (this.ctx.isMainFunction) return withValue;

    // Helper: append FUNC_RETURN — it terminates this path (pops frame+params, jumps
    // to the caller). For the BUILDER's stack-height bookkeeping, model the whole
    // `return …` as NET-NEUTRAL (report `this.stackEffect`, the height BEFORE the
    // return value): control leaves here, so any CONTINUATION (e.g. an enclosing IF's
    // fall-through, which only runs when this branch was NOT taken) must see the
    // returning branch as height-neutral, not +1 from the pushed value. SDUP depths
    // INSIDE the return expression are already resolved against this.stackEffect.
    return new V12Saucer(
      this.ctx,
      concat(withValue._bytes, [OPS_V12.FUNC_RETURN]),
      this.stackEffect,
      false,
      [...withValue.callPositions],
      [...withValue.refPositions],
    );
  }

  revert(dataL: SaucerLike): V12Saucer {
    const data = dataL as V12Saucer;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];
    mergeSentinels(calls, refs, data, this._bytes.length, this.stackEffect);

    return new V12Saucer(
      this.ctx,
      concat(this._bytes, data._bytes, [OPS.REVERT]),
      this.stackEffect + data.stackEffect - 1,
      false,
      calls,
      refs,
    );
  }

  log(dataL: SaucerLike, topics: SaucerLike[]): V12Saucer {
    if (topics.length > 4) throw new Error(`log supports 0-4 topics, got ${topics.length}`);

    // Data then topics, forward; LOG consumes them all (net -1: descriptor + topics
    // in, nothing out).
    const { parts, calls, refs, effectSum } = this.appendOperands([dataL, ...topics]);
    parts.push(new Uint8Array([OPS.LOG, topics.length]));

    return new V12Saucer(
      this.ctx,
      concat(...parts),
      this.stackEffect + effectSum - topics.length - 1,
      false,
      calls,
      refs,
    );
  }

  eval(bytecode: SaucerLike): V12Saucer {
    return this.unary(OPS.EVAL, bytecode, true);
  }

  // A bare expression statement discards its result; pop whatever it left on the
  // stack so it does not leak (side-effect-only ops like log net zero and are
  // untouched). The v1 counterpart is a no-op.
  dropIfUnused(): V12Saucer {
    return this.stackEffect > 0 ? this.sdrop().dropIfUnused() : this;
  }

  // ── raw stack ops (v12-only) ──
  sswap(n: number): V12Saucer {
    if (n < 1 || n > 16) throw new Error(`SSWAP position out of range (1-16): ${n}`);

    return this.withBytes([OPS_V12.SSWAP1 + n - 1], this.stackEffect, this.isDynamic);
  }
  sdrop(): V12Saucer {
    return this.withBytes([OPS_V12.SDROP], this.stackEffect - 1, this.isDynamic);
  }
  srot(): V12Saucer {
    return this.withBytes([OPS_V12.SROT], this.stackEffect, this.isDynamic);
  }

  // ── build ──
  /** Main body: append MSTORE for a scalar result (the engine expects a descriptor). */
  build(): Uint8Array {
    // svm: the engine enters main with an EMPTY stack (no stack-bottom sentinel,
    // unlike the EVM Huff runtime), so a VOID main (net stack effect 0) must not
    // emit the result-MSTORE — it would pop the empty stack and abort the whole
    // transaction with StackUnderflow.
    if (this.ctx.isSvm && this.stackEffect <= 0) return this._bytes;

    if (!this.isDynamic && this._bytes.length > 0) {
      return concat(this._bytes, [OPS_V12.MSTORE]);
    }

    return this._bytes;
  }

  /** Helper body: prepend ALLOCATE_VALUE/ALLOCATE_HEAP for local slots (no MSTORE). */
  buildFunctionBody(): Uint8Array {
    const prefix = this.allocatePrefix();

    return prefix.length > 0 ? concat(new Uint8Array(prefix), this._bytes) : this._bytes;
  }

  /**
   * main body: prepend ALLOCATE_VALUE/ALLOCATE_HEAP (declaring main's own frame
   * stride) AND append the result-MSTORE — main needs BOTH, where a helper gets
   * only the ALLOCATE prefix (its result stays on the stack for FUNC_RETURN) and
   * the no-arg `build()` gets only the MSTORE.
   *
   * The ALLOCATE prefix declares main's frame stride to the Huff runtime, which
   * advances VALUES_BASE/HEAP_BASE per CALL_FUNCTION by the CALLER's declared slot
   * count. The runtime DEFAULTS that count to 0 (a frame must ALLOCATE to stride —
   * `engine-v12/v12/Runtime.huff` MAIN init; see the frame-isolation spec). So
   * EVERY slot-using function MUST emit ALLOCATE, unconditionally — exactly like a
   * helper (`buildFunctionBody`). Without it a main using N slots would leave the
   * stride at 0 and any helper call would alias main's slots (the callee's frame
   * starts at main's base, overwriting main's locals). This is emitted for main
   * regardless of whether it CALLs — a leaf main's prefix is harmless (it strides
   * no frame), and unconditional emission matches the default-0 contract (a missing
   * ALLOCATE is a latent aliasing bug, not a no-op). ALLOCATE is stack-neutral, so
   * SDUP depths are unchanged; only byte positions shift by `prefixLen` (returned so
   * the assembly can shift main's recorded call/ref sentinels).
   */
  buildMain(): { bytes: Uint8Array; prefixLen: number } {
    const body = this.build(); // result-MSTORE for a scalar result
    const prefix = this.allocatePrefix();

    return {
      bytes: prefix.length > 0 ? concat(new Uint8Array(prefix), body) : body,
      prefixLen: prefix.length,
    };
  }

  /** The ALLOCATE_VALUE/ALLOCATE_HEAP frame-declaration prefix for this function. */
  private allocatePrefix(): number[] {
    const valueSlots = this.ctx.valueSlotCount;
    const heapSlots = this.ctx.heapSlotCount;

    // Slot indices are a single byte — >255 live slots would wrap and corrupt an
    // earlier slot (e.g. a stack param's frame slot). Fail loud (mirrors Saucer.build).
    if (valueSlots > 0xff) {
      throw new Error(`too many scalar locals: ${valueSlots} (max 255); slot >=256 would wrap.`);
    }

    if (heapSlots > 0xff) {
      throw new Error(`too many heap (dynamic) locals: ${heapSlots} (max 255); slot >=256 would wrap.`);
    }

    const prefix: number[] = [];

    if (valueSlots > 0) prefix.push(OPS.ALLOCATE_VALUE, valueSlots);

    if (heapSlots > 0) prefix.push(OPS.ALLOCATE_HEAP, heapSlots);

    return prefix;
  }
}

// ── control-flow helper classes (mirror v1 SaucerIf/SaucerThen/SaucerLoop) ──

class V12If implements SaucerIfLike {
  constructor(
    private readonly parent: V12Saucer,
    private readonly condition: V12Saucer,
  ) {}

  then(thenBodyL: SaucerLike): SaucerThenLike {
    const thenBody = thenBodyL as V12Saucer;
    const parent = this.parent;
    const cond = this.condition;
    const thenLen = thenBody._bytes.length;
    const stackEffect = parent.stackEffect + cond.stackEffect - 1 + thenBody.stackEffect;

    const calls = [...parent.callPositions];
    const refs = [...parent.refPositions];

    if (thenLen > MAX_BYTE_1) {
      // IF_2 with a 2-byte skip.
      if (thenLen > MAX_BYTE_2) throw new Error(`body too large: ${thenLen} bytes exceeds ${MAX_BYTE_2}`);

      mergeSentinels(calls, refs, cond, parent._bytes.length, parent.stackEffect);
      const ifOpOffset = parent._bytes.length + cond._bytes.length;
      const bytes = concat(
        parent._bytes,
        cond._bytes,
        [OPS.IF_2, (thenLen >> 8) & 0xff, thenLen & 0xff],
        thenBody._bytes,
      );
      mergeSentinels(calls, refs, thenBody, ifOpOffset + 3, parent.stackEffect + cond.stackEffect - 1);

      return new V12Then(parent.ctx, bytes, stackEffect, thenBody.isDynamic, calls, refs, ifOpOffset, true);
    }

    mergeSentinels(calls, refs, cond, parent._bytes.length, parent.stackEffect);
    const ifOpOffset = parent._bytes.length + cond._bytes.length;
    const bytes = concat(parent._bytes, cond._bytes, [OPS.IF, thenLen], thenBody._bytes);
    mergeSentinels(calls, refs, thenBody, ifOpOffset + 2, parent.stackEffect + cond.stackEffect - 1);

    return new V12Then(parent.ctx, bytes, stackEffect, thenBody.isDynamic, calls, refs, ifOpOffset, false);
  }
}

class V12Then extends V12Saucer implements SaucerThenLike {
  constructor(
    ctx: CompilerContext,
    bytes: Uint8Array,
    stackEffect: number,
    isDynamic: boolean,
    calls: CallPlaceholder[],
    refs: RefPlaceholder[],
    private readonly ifOpOffset: number,
    private readonly wide: boolean,
  ) {
    super(ctx, bytes, stackEffect, isDynamic, calls, refs);
  }

  else(elseBodyL: SaucerLike): V12Saucer {
    const elseBody = elseBodyL as V12Saucer;
    const elseLen = elseBody._bytes.length;
    const skipOffset = this.ifOpOffset + 1;
    const calls = [...this.callPositions];
    const refs = [...this.refPositions];

    const jumpWide = elseLen > MAX_BYTE_1;

    if (jumpWide && elseLen > MAX_BYTE_2) throw new Error(`body too large: ${elseLen} bytes exceeds ${MAX_BYTE_2}`);

    const jumpHeader = jumpWide ? [OPS.JUMP_2, (elseLen >> 8) & 0xff, elseLen & 0xff] : [OPS.JUMP, elseLen];
    const bytes = new Uint8Array(concat(this._bytes, jumpHeader, elseBody._bytes));

    // Grow the IF skip so a false condition jumps past the then-body AND the JUMP.
    const cur = this.wide ? (this._bytes[skipOffset] << 8) | this._bytes[skipOffset + 1] : this._bytes[skipOffset];
    const next = cur + jumpHeader.length;

    if (this.wide) {
      bytes[skipOffset] = (next >> 8) & 0xff;
      bytes[skipOffset + 1] = next & 0xff;
    } else {
      if (next > MAX_BYTE_1) throw new Error(`body too large: ${next} bytes exceeds ${MAX_BYTE_1}`);

      bytes[skipOffset] = next & 0xff;
    }

    mergeSentinels(calls, refs, elseBody, this._bytes.length + jumpHeader.length, this.stackEffect);

    return new V12Saucer(this.ctx, bytes, this.stackEffect + elseBody.stackEffect, elseBody.isDynamic, calls, refs);
  }
}

class V12Loop implements SaucerLoopLike {
  constructor(
    private readonly parent: V12Saucer,
    private readonly condition?: V12Saucer,
    private readonly update?: V12Saucer,
  ) {}

  loop(bodyL: SaucerLike): V12Saucer {
    const body = bodyL as V12Saucer;
    const parent = this.parent;
    const ctx = parent.ctx;
    const empty = new V12Saucer(ctx);
    const condition = this.condition ?? empty;
    const update = this.update ?? empty;

    // FOR layout: [parent][JUMP incrLen][update][condition][IF skip][body][JUMP_BACK]
    const calls = [...parent.callPositions];
    const refs = [...parent.refPositions];

    const incrLen = update._bytes.length;
    const jumpHeader = incrLen > MAX_BYTE_1 ? [OPS.JUMP_2, (incrLen >> 8) & 0xff, incrLen & 0xff] : [OPS.JUMP, incrLen];

    let posOff = parent._bytes.length + jumpHeader.length;
    mergeSentinels(calls, refs, update, posOff, parent.stackEffect);
    posOff += update._bytes.length;
    mergeSentinels(calls, refs, condition, posOff, parent.stackEffect);
    posOff += condition._bytes.length;

    const head = concat(parent._bytes, jumpHeader, update._bytes, condition._bytes, [OPS.IF, 0]);
    const ifOffset = head.length - 2; // IF opcode position; skip byte at ifOffset+1
    // Back-jump span = [increment][condition][IF+skip] + body + JUMP_BACK. It lands
    // at the increment (AFTER the JUMP-over-increment header), so exclude that header.
    const loopPartsLen = incrLen + condition._bytes.length + 2;

    const bodyLen = body._bytes.length;

    if (bodyLen > MAX_BYTE_2) throw new Error(`loop body too large: ${bodyLen} bytes exceeds ${MAX_BYTE_2}`);

    const baseBackCount = loopPartsLen + bodyLen;

    let prefix: Uint8Array;
    let backHeader: number[];

    if (bodyLen > 253 || baseBackCount + 2 > MAX_BYTE_1) {
      const skipVal = bodyLen + 3; // body + JUMP_BACK_2(1) + count(2)

      if (skipVal > MAX_BYTE_1) {
        // Upgrade IF → IF_2 (2-byte skip), shifting body sentinels by +1.
        const before = head.slice(0, ifOffset);
        prefix = concat(before, [OPS.IF_2, (skipVal >> 8) & 0xff, skipVal & 0xff]);
        const backCount = loopPartsLen + 1 + bodyLen + 3;

        if (backCount > MAX_BYTE_2) throw new Error(`loop too large: ${backCount} exceeds ${MAX_BYTE_2}`);

        backHeader = [OPS.JUMP_BACK_2, (backCount >> 8) & 0xff, backCount & 0xff];
      } else {
        prefix = new Uint8Array(head);
        prefix[ifOffset + 1] = skipVal & 0xff;
        const backCount = baseBackCount + 3;

        if (backCount > MAX_BYTE_2) throw new Error(`loop too large: ${backCount} exceeds ${MAX_BYTE_2}`);

        backHeader = [OPS.JUMP_BACK_2, (backCount >> 8) & 0xff, backCount & 0xff];
      }
    } else {
      const skipVal = bodyLen + 2; // body + JUMP_BACK(2)
      prefix = new Uint8Array(head);
      prefix[ifOffset + 1] = skipVal & 0xff;
      const backCount = baseBackCount + 2;
      backHeader = [OPS.JUMP_BACK, backCount];
    }

    mergeSentinels(calls, refs, body, prefix.length, parent.stackEffect);

    return new V12Saucer(ctx, concat(prefix, body._bytes, backHeader), parent.stackEffect, false, calls, refs);
  }
}
