import { OPS } from './ops.js';
import { encodeInt } from './integer.js';
import { encodeReadByKind, encodeStoreByKind } from './memory.js';
import { encodeBytes, encodeString } from './bytes.js';
import { encodeArray, encodeIndex, encodeSetIndex, encodeNewArray } from './array.js';
import { encodeTuple } from './tuple.js';
import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { SaucerLike, SaucerIfLike, SaucerThenLike, SaucerLoopLike, OutputSpec } from './saucer-like.js';

export type { OutputSpec };

const MAX_BYTE_1 = 0xff;
const MAX_BYTE_2 = 0xffff;

const encodeSkip = (skipCount: number): number[] => {
  if (skipCount > MAX_BYTE_2) {
    throw new Error(`body too large: ${skipCount} bytes exceeds ${MAX_BYTE_2}`);
  }

  return skipCount > MAX_BYTE_1 ? [(skipCount >> 8) & 0xff, skipCount & 0xff] : [skipCount];
};

/**
 * LOOP IMPLEMENTATION
 *
 * Loops compile to this bytecode structure:
 *
 * CONDITIONAL LOOP (while/for with condition):
 *   [IF][backCount][condition]     ← skip entire loop if condition false
 *   [body...]                      ← loop body with break/continue as JUMP_2 placeholders
 *   [update...]                    ← for-loop update (i++)
 *   [IF][skipBottom][condition]    ← re-check condition
 *   [JUMP_BACK][count]             ← jump back to top if condition true
 *                                  ← loop exit (break lands here)
 *
 * INFINITE LOOP (while(true) or for(;;)):
 *   [body...]                      ← loop body
 *   [update...]                    ← update expression
 *   [JUMP_BACK][count]             ← always jump back
 *                                  ← break lands here
 *
 * BREAK/CONTINUE:
 *   Both emit [JUMP_2][0][0] placeholders. The 2-byte target is recorded in JumpOffsets.
 *   When the loop is assembled, patchBody() fills in the actual jump distances:
 *   - break: jumps forward past JUMP_BACK (exits loop)
 *   - continue: jumps forward to update section, then condition re-check loops back
 */

// Tracks byte positions of break/continue placeholders that need patching
interface JumpOffsets {
  breaks: number[]; // positions of break JUMP_2 targets
  continues: number[]; // positions of continue JUMP_2 targets
}

const emptyOffsets: JumpOffsets = { breaks: [], continues: [] };

// When concatenating bytecode, offsets from later code need adjustment
const shiftOffsets = (offsets: JumpOffsets, delta: number): JumpOffsets => ({
  breaks: offsets.breaks.map((o) => o + delta),
  continues: offsets.continues.map((o) => o + delta),
});

// Collect break/continues from multiple code paths (e.g., if/else inside loop)
const mergeOffsets = (a: JumpOffsets, b: JumpOffsets): JumpOffsets => ({
  breaks: [...a.breaks, ...b.breaks],
  continues: [...a.continues, ...b.continues],
});

export class Saucer implements SaucerLike {
  readonly _bytes: Uint8Array;
  readonly jumpOffsets: JumpOffsets;

  constructor(
    readonly ctx: CompilerContext,
    bytes: Uint8Array = new Uint8Array(),
    jumpOffsets: JumpOffsets = emptyOffsets,
  ) {
    this._bytes = bytes;
    this.jumpOffsets = jumpOffsets;
  }

  join(other: Saucer): Saucer {
    return new Saucer(
      this.ctx,
      new Uint8Array([...this._bytes, ...other._bytes]),
      mergeOffsets(this.jumpOffsets, shiftOffsets(other.jumpOffsets, this._bytes.length)),
    );
  }

  private with(bytes: number[] | Uint8Array, jumpOffsets?: JumpOffsets): Saucer {
    return new Saucer(
      this.ctx,
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      jumpOffsets ?? this.jumpOffsets,
    );
  }

  // Operand EMISSION ORDER for every op below (v1 prefix `[OP][a][b]…`) is stated once, verified
  // against real emission, and diffed against compiler-rs's `push_order.rs` in
  // `test/push-order.parity.test.ts` (§1.7). Change an operand order here → update that table.
  private binary(op: number, left: Saucer, right: Saucer): Saucer {
    return this.with([op, ...left._bytes, ...right._bytes]);
  }

  private unary(op: number, operand: Saucer): Saucer {
    return this.with([op, ...operand._bytes]);
  }

  private ternary(op: number, a: Saucer, b: Saucer, c: Saucer): Saucer {
    return this.with([op, ...a._bytes, ...b._bytes, ...c._bytes]);
  }

  // Emit a JUMP_2 placeholder for break/continue. The target bytes [0, 0] will be
  // patched later when the loop is assembled and we know the actual jump distance.
  private emitJump(keyword: string, field: keyof JumpOffsets): Saucer {
    this.ctx.assertInLoop(keyword);
    const offset = this._bytes.length + 1; // position of the 2-byte target after JUMP_2 opcode

    return this.with(
      [...this._bytes, OPS.JUMP_2, 0, 0],
      mergeOffsets(this.jumpOffsets, { ...emptyOffsets, [field]: [offset] }),
    );
  }

  msgSender(): Saucer {
    return this.with([OPS.MSG_SENDER]);
  }

  msgValue(): Saucer {
    return this.with([OPS.CALL_VALUE]);
  }

  msgData(): Saucer {
    return this.with([OPS.CALLDATA]);
  }

  blockNumber(): Saucer {
    return this.with([OPS.BLOCK_NUMBER]);
  }

  blockTimestamp(): Saucer {
    return this.with([OPS.TIMESTAMP]);
  }

  blockCoinbase(): Saucer {
    return this.with([OPS.COINBASE]);
  }

  blockPrevrandao(): Saucer {
    return this.with([OPS.PREVRANDAO]);
  }

  blockGasLimit(): Saucer {
    return this.with([OPS.GAS_LIMIT]);
  }

  blockBaseFee(): Saucer {
    return this.with([OPS.BASE_FEE]);
  }

  blockBlobBaseFee(): Saucer {
    return this.with([OPS.BLOB_BASE_FEE]);
  }

  blockChainId(): Saucer {
    return this.with([OPS.CHAIN_ID]);
  }

  txOrigin(): Saucer {
    return this.with([OPS.TX_ORIGIN]);
  }

  txGasPrice(): Saucer {
    return this.with([OPS.GAS_PRICE]);
  }

  addressSelf(): Saucer {
    return this.with([OPS.THIS_ADDRESS]);
  }

  addressBalance(): Saucer {
    return this.with([OPS.SELF_BALANCE]);
  }

  gasLeft(): Saucer {
    return this.with([OPS.GAS_LEFT]);
  }

  balanceOf(addr: Saucer): Saucer {
    return this.unary(OPS.BALANCE, addr);
  }

  blockHash(n: Saucer): Saucer {
    return this.unary(OPS.BLOCK_HASH, n);
  }

  codeSize(addr: Saucer): Saucer {
    return this.unary(OPS.EXT_CODE_SIZE, addr);
  }

  codeHash(addr: Saucer): Saucer {
    return this.unary(OPS.EXT_CODE_HASH, addr);
  }

  blobHash(n: Saucer): Saucer {
    return this.unary(OPS.BLOB_HASH, n);
  }

  isContract(addr: Saucer): Saucer {
    return this.unary(OPS.IS_CONTRACT, addr);
  }

  isEOA(addr: Saucer): Saucer {
    return this.unary(OPS.IS_EOA, addr);
  }

  int(value: bigint): Saucer {
    return this.with(encodeInt(value));
  }

  bytes(data: Uint8Array): Saucer {
    return this.with(encodeBytes(data));
  }

  string(value: string): Saucer {
    return this.with(encodeString(value));
  }

  array(elements: Saucer[], forcedWidth?: number): Saucer {
    return this.with(encodeArray(elements, forcedWidth));
  }

  tuple(elements: Saucer[]): Saucer {
    return this.with(encodeTuple(elements));
  }

  index(arr: Saucer, idx: Saucer): Saucer {
    return this.with(encodeIndex(idx, arr));
  }

  setIndex(arr: Saucer, idx: Saucer, value: Saucer): Saucer {
    return this.with(encodeSetIndex(value, idx, arr));
  }

  newArray(count: Saucer): Saucer {
    return this.with(encodeNewArray(count));
  }

  length(arr: Saucer): Saucer {
    return this.unary(OPS.LENGTH, arr);
  }

  concat(operands: Saucer[]): Saucer {
    if (operands.length === 0 || operands.length > 0xff) {
      throw new Error(`concat requires 1-255 operands, got ${operands.length}`);
    }

    return this.with([OPS.CONCAT, operands.length, ...operands.flatMap((o) => Array.from(o._bytes))]);
  }

  slice(data: Saucer, offset: Saucer, length: Saucer): Saucer {
    return this.with([OPS.SLICE, ...data._bytes, ...offset._bytes, ...length._bytes]);
  }

  abiEncode(tuple: Saucer): Saucer {
    return this.with([OPS.ABI_ENCODE, ...tuple._bytes]);
  }

  abiDecode(count: number, data: Saucer, typeSpecs: number[]): Saucer {
    return this.with([OPS.ABI_DECODE, count, ...data._bytes, ...typeSpecs]);
  }

  store(
    name: string,
    value: Saucer,
    kind: VariableKind = 'scalar',
    elementType?: ElementType,
    structType?: StructType,
  ): Saucer {
    const variable = this.ctx.getVar(name) ?? this.ctx.setVar(name, kind, elementType, structType);

    return this.with(encodeStoreByKind(this._bytes, variable.slot, value._bytes, variable.kind));
  }

  read(name: string): Saucer {
    const variable = this.ctx.getVar(name);

    if (!variable) {
      throw new Error(`undefined variable: ${name}`);
    }

    return this.with(encodeReadByKind(variable.slot, variable.kind));
  }

  add(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.ADD, left, right);
  }

  sub(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.SUB, left, right);
  }

  neg(operand: Saucer): Saucer {
    return this.unary(OPS.NEG, operand);
  }

  mul(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.MUL, left, right);
  }

  div(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.DIV, left, right);
  }

  mod(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.MOD, left, right);
  }

  exp(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.EXP, left, right);
  }

  sqrt(operand: Saucer): Saucer {
    return this.unary(OPS.SQRT, operand);
  }

  mulDiv(a: Saucer, b: Saucer, c: Saucer): Saucer {
    return this.ternary(OPS.MUL_DIV, a, b, c);
  }

  // extended / signed arithmetic — the v1 engine (runtime/Math.sol, runtime/Boolean.sol)
  // evaluates operands positionally in the order they are emitted after the op.
  addMod(a: Saucer, b: Saucer, n: Saucer): Saucer {
    return this.ternary(OPS.ADD_MOD, a, b, n);
  }

  mulMod(a: Saucer, b: Saucer, n: Saucer): Saucer {
    return this.ternary(OPS.MUL_MOD, a, b, n);
  }

  sDiv(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.S_DIV, a, b);
  }

  sMod(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.S_MOD, a, b);
  }

  sShr(value: Saucer, shift: Saucer): Saucer {
    return this.binary(OPS.S_AR, value, shift);
  }

  // SIGN_EXTEND reads the byte index (k) first, then the value (runtime/Math.sol:
  // `k = executeOP(...); x = executeOP(...); signextend(k, x)`), so the source-order
  // args (value, fromByte) are emitted reversed.
  signExtend(value: Saucer, fromByte: Saucer): Saucer {
    return this.binary(OPS.SIGN_EXTEND, fromByte, value);
  }

  sLt(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.BOOL_SLT, a, b);
  }

  sGt(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.BOOL_SGT, a, b);
  }

  sLte(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.BOOL_SLTE, a, b);
  }

  sGte(a: Saucer, b: Saucer): Saucer {
    return this.binary(OPS.BOOL_SGTE, a, b);
  }

  keccak256(data: Saucer): Saucer {
    return this.unary(OPS.KECCAK256, data);
  }

  ecdsaVerify(signer: Saucer, hash: Saucer, signature: Saucer): Saucer {
    return this.with([OPS.ECDSA_VERIFY, ...signer._bytes, ...hash._bytes, ...signature._bytes]);
  }

  sload(slot: Saucer): Saucer {
    return this.unary(OPS.SLOAD, slot);
  }

  sstore(slot: Saucer, value: Saucer): Saucer {
    return this.binary(OPS.SSTORE, slot, value);
  }

  tload(key: Saucer): Saucer {
    return this.unary(OPS.TLOAD, key);
  }

  tstore(key: Saucer, value: Saucer): Saucer {
    return this.binary(OPS.TSTORE, key, value);
  }

  create(value: Saucer, bytecode: Saucer): Saucer {
    return this.binary(OPS.CREATE, value, bytecode);
  }

  create2(value: Saucer, salt: Saucer, bytecode: Saucer): Saucer {
    return this.ternary(OPS.CREATE2, value, salt, bytecode);
  }

  create3(value: Saucer, salt: Saucer, bytecode: Saucer): Saucer {
    return this.ternary(OPS.CREATE3, value, salt, bytecode);
  }

  createAddress(deployer: Saucer, nonce: Saucer): Saucer {
    return this.binary(OPS.CREATE_ADDRESS, deployer, nonce);
  }

  create2Address(deployer: Saucer, salt: Saucer, bytecodeHash: Saucer): Saucer {
    return this.ternary(OPS.CREATE2_ADDRESS, deployer, salt, bytecodeHash);
  }

  create3Address(salt: Saucer): Saucer {
    return this.unary(OPS.CREATE3_ADDRESS, salt);
  }

  bitAnd(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.AND, left, right);
  }

  bitOr(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.OR, left, right);
  }

  bitXor(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.XOR, left, right);
  }

  bitNot(operand: Saucer): Saucer {
    return this.unary(OPS.NOT, operand);
  }

  shl(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.SHL, left, right);
  }

  shr(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.SHR, left, right);
  }

  eq(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_EQ, left, right);
  }

  neq(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_NEQ, left, right);
  }

  gt(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_GT, left, right);
  }

  lt(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_LT, left, right);
  }

  gte(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_GTE, left, right);
  }

  lte(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_LTE, left, right);
  }

  and(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_AND, left, right);
  }

  or(left: Saucer, right: Saucer): Saucer {
    return this.binary(OPS.BOOL_OR, left, right);
  }

  not(operand: Saucer): Saucer {
    return this.unary(OPS.BOOL_NOT, operand);
  }

  isZero(operand: Saucer): Saucer {
    return this.unary(OPS.BOOL_ZERO, operand);
  }

  isNotZero(operand: Saucer): Saucer {
    return this.unary(OPS.BOOL_NOT_ZERO, operand);
  }

  if(condition: Saucer): SaucerIf {
    return new SaucerIf(this, condition);
  }

  callFunction(functionName: string, args: Saucer[]): Saucer {
    const argsAsBytes = args.reduce(
      (result, saucer) => new Uint8Array([...result, ...saucer._bytes]),
      new Uint8Array(),
    );

    return this.with([OPS.CALL_FUNCTION, this.ctx.getFunc(functionName), args.length, ...argsAsBytes]);
  }

  externalCall(target: Saucer, value: Saucer, calldata: Saucer, output?: OutputSpec): Saucer {
    return this.call(OPS.CALL, target, calldata, output, value);
  }

  staticCall(target: Saucer, calldata: Saucer, output?: OutputSpec): Saucer {
    return this.call(OPS.STATIC, target, calldata, output);
  }

  delegateCall(target: Saucer, calldata: Saucer, output?: OutputSpec): Saucer {
    return this.call(OPS.DELEGATE, target, calldata, output);
  }

  private call(op: number, target: Saucer, calldata: Saucer, output?: OutputSpec, value?: Saucer): Saucer {
    const valueBytes = value ? [...value._bytes] : [];
    const rawCall = this.with([op, ...target._bytes, ...valueBytes, ...calldata._bytes]);

    if (!output?.count) {
      return rawCall;
    }

    const decoded = this.abiDecode(output.count, rawCall, output.typeSpecs);

    if (output.count > 1) {
      return decoded;
    }

    return this.index(decoded, this.int(0n));
  }

  catch(handler: Saucer): Saucer {
    if (handler._bytes.length > 255) {
      throw new Error(`catch handler too large: ${handler._bytes.length} bytes exceeds 255`);
    }

    return this.with([...this._bytes, OPS.CATCH, handler._bytes.length, ...handler._bytes]);
  }

  return(saucer?: Saucer): Saucer {
    return this.with(saucer ? [...this._bytes, ...saucer._bytes, OPS.STOP] : [...this._bytes, OPS.STOP]);
  }

  revert(data: Saucer): Saucer {
    return this.with([...this._bytes, OPS.REVERT, ...data._bytes]);
  }

  log(data: Saucer, topics: Saucer[]): Saucer {
    if (topics.length > 4) {
      throw new Error(`log supports 0-4 topics, got ${topics.length}`);
    }

    const topicBytes = topics.flatMap((t) => Array.from(t._bytes));

    return this.with([...this._bytes, OPS.LOG, topics.length, ...data._bytes, ...topicBytes]);
  }

  break(): Saucer {
    return this.emitJump('break', 'breaks');
  }

  continue(): Saucer {
    return this.emitJump('continue', 'continues');
  }

  for(init?: Saucer, condition?: Saucer, update?: Saucer): SaucerLoop {
    const parent = init ? this.with([...this._bytes, ...init._bytes]) : this;

    return new SaucerLoop(parent, condition, update);
  }

  while(condition: Saucer): SaucerLoop {
    return new SaucerLoop(this, condition);
  }

  eval(bytecode: Saucer): Saucer {
    return this.with([OPS.EVAL, ...bytecode._bytes]);
  }

  // The prefix-tree interpreter discards a statement's result implicitly, so there
  // is nothing to drop (see V12Saucer for the stack-based counterpart).
  dropIfUnused(): Saucer {
    return this;
  }

  build(): Uint8Array {
    const valueSlots = this.ctx.valueSlotCount;
    const heapSlots = this.ctx.heapSlotCount;

    // Value/heap slot indices are encoded as a SINGLE byte (READ_VALUE/WRITE_VALUE/
    // ALLOCATE_VALUE and the HEAP equivalents — see saucer/memory.ts). A program with
    // more than 256 scalar (or heap) locals would silently wrap slot index ≥256 to
    // index mod 256, aliasing an earlier slot (e.g. a function parameter) and
    // corrupting it at runtime. Fail loud at compile time instead of miscompiling.
    if (valueSlots > 0xff) {
      throw new Error(
        `too many scalar locals: ${valueSlots} (max 255). Value-slot indices are 1 byte; ` +
          `slot >=256 would wrap and corrupt an earlier slot. Split the function or reuse locals.`,
      );
    }

    if (heapSlots > 0xff) {
      throw new Error(
        `too many heap (dynamic) locals: ${heapSlots} (max 255). Heap-slot indices are 1 byte; ` +
          `slot >=256 would wrap and corrupt an earlier slot. Split the function or reuse locals.`,
      );
    }

    const prefix: number[] = [];

    if (valueSlots > 0) prefix.push(OPS.ALLOCATE_VALUE, valueSlots);

    if (heapSlots > 0) prefix.push(OPS.ALLOCATE_HEAP, heapSlots);

    return prefix.length > 0 ? new Uint8Array([...prefix, ...this._bytes]) : this._bytes;
  }
}

class SaucerIf implements SaucerIfLike {
  constructor(
    private readonly parent: Saucer,
    private readonly condition: Saucer,
  ) {}

  then(thenBody: Saucer): SaucerThen {
    const wide = thenBody._bytes.length > MAX_BYTE_1;
    const skipOffset = this.parent._bytes.length + 1;
    const op = wide ? OPS.IF_2 : OPS.IF;
    const skip = encodeSkip(thenBody._bytes.length);
    const prefix = this.parent._bytes.length + 1 + skip.length + this.condition._bytes.length;
    const offsets = mergeOffsets(this.parent.jumpOffsets, shiftOffsets(thenBody.jumpOffsets, prefix));

    return new SaucerThen(
      this.parent.ctx,
      new Uint8Array([...this.parent._bytes, op, ...skip, ...this.condition._bytes, ...thenBody._bytes]),
      skipOffset,
      thenBody._bytes.length,
      wide,
      offsets,
    );
  }
}

class SaucerThen extends Saucer implements SaucerThenLike {
  constructor(
    ctx: CompilerContext,
    bytes: Uint8Array,
    private readonly skipOffset: number,
    private readonly thenLength: number,
    private readonly wide: boolean,
    offsets: JumpOffsets,
  ) {
    super(ctx, bytes, offsets);
  }

  else(elseBody: Saucer): Saucer {
    const elseWide = elseBody._bytes.length > MAX_BYTE_1;
    const ifSkip = this.thenLength + (elseWide ? 3 : 2);
    const maxSkip = this.wide ? MAX_BYTE_2 : MAX_BYTE_1;

    if (ifSkip > maxSkip) {
      throw new Error(`body too large: ${ifSkip} bytes exceeds ${maxSkip}`);
    }

    const before = this._bytes.slice(0, this.skipOffset);
    const after = this._bytes.slice(this.skipOffset + (this.wide ? 2 : 1));
    const jump = [elseWide ? OPS.JUMP_2 : OPS.JUMP, ...encodeSkip(elseBody._bytes.length)];

    const elseStart = before.length + encodeSkip(ifSkip).length + after.length + jump.length;
    const offsets = mergeOffsets(this.jumpOffsets, shiftOffsets(elseBody.jumpOffsets, elseStart));

    return new Saucer(
      this.ctx,
      new Uint8Array([...before, ...encodeSkip(ifSkip), ...after, ...jump, ...elseBody._bytes]),
      offsets,
    );
  }
}

class SaucerLoop implements SaucerLoopLike {
  constructor(
    private readonly parent: Saucer,
    private readonly condition?: Saucer,
    private readonly update?: Saucer,
  ) {}

  loop(body: Saucer): Saucer {
    const condBytes = this.condition?._bytes ?? new Uint8Array();
    const bodyBytes = Array.from(body._bytes);
    const updateBytes = this.update?._bytes ?? new Uint8Array();
    const offsets = body.jumpOffsets;

    const loopBytes = this.condition
      ? assembleConditionalLoop(condBytes, bodyBytes, updateBytes, offsets)
      : assembleInfiniteLoop(bodyBytes, updateBytes, offsets);

    return new Saucer(this.parent.ctx, new Uint8Array([...this.parent._bytes, ...loopBytes]));
  }
}

// Calculate loop size including the JUMP_BACK instruction itself (+2 or +3 bytes)
const resolveLoopSize = (innerSize: number): number => (innerSize + 2 > MAX_BYTE_1 ? innerSize + 3 : innerSize + 2);

const encodeJumpBack = (count: number): number[] => {
  if (count > MAX_BYTE_2) throw new Error(`loop too large: ${count} bytes exceeds ${MAX_BYTE_2}`);

  return count > MAX_BYTE_1 ? [OPS.JUMP_BACK_2, (count >> 8) & 0xff, count & 0xff] : [OPS.JUMP_BACK, count];
};

// Fill in the actual jump distances for break/continue placeholders
const patchBody = (
  bodyBytes: readonly number[],
  offsets: readonly number[],
  distance: (offset: number) => number,
): number[] => {
  const result = [...bodyBytes];

  offsets.forEach((offset) => {
    const d = distance(offset);
    result[offset] = (d >> 8) & 0xff;
    result[offset + 1] = d & 0xff;
  });

  return result;
};

/**
 * Assembles: while (cond) { body; update; }
 *
 * Output structure:
 *   [IF/IF_2][backCount][cond]  ← top: skip loop if false
 *   [body...]                   ← patched break/continue
 *   [update...]
 *   [IF][skipBottom][cond]      ← bottom: skip JUMP_BACK if false (exit loop)
 *   [JUMP_BACK][count]          ← go back to top
 *                               ← exit point (break lands here)
 */
const assembleConditionalLoop = (
  condBytes: Uint8Array,
  bodyBytes: number[],
  updateBytes: Uint8Array,
  offsets: JumpOffsets,
): number[] => {
  const bottomIfOverhead = 2; // [IF][skipBottom]
  const innerSize = bodyBytes.length + updateBytes.length + bottomIfOverhead + condBytes.length;
  const loopSize = resolveLoopSize(innerSize);
  const jumpBack = encodeJumpBack(loopSize);
  const skipBottom = jumpBack.length; // skip past JUMP_BACK when condition is false

  const patched = patchBody(
    patchBody(bodyBytes, offsets.breaks, (offset) => loopSize - offset - 2), // break → past JUMP_BACK
    offsets.continues,
    (offset) => bodyBytes.length - offset - 2, // continue → update section
  );

  return [
    loopSize > MAX_BYTE_1 ? OPS.IF_2 : OPS.IF,
    ...encodeSkip(loopSize),
    ...condBytes,
    ...patched,
    ...updateBytes,
    OPS.IF,
    skipBottom,
    ...condBytes,
    ...jumpBack,
  ];
};

/**
 * Assembles: for (;;) { body; update; } or while (true) { ... }
 *
 * Output structure:
 *   [body...]                   ← patched break/continue
 *   [update...]
 *   [JUMP_BACK][count]          ← always go back
 *                               ← exit point (break lands here)
 */
const assembleInfiniteLoop = (bodyBytes: number[], updateBytes: Uint8Array, offsets: JumpOffsets): number[] => {
  const innerSize = bodyBytes.length + updateBytes.length;
  const loopSize = resolveLoopSize(innerSize);
  const jumpBack = encodeJumpBack(loopSize);

  const patched = patchBody(
    patchBody(
      bodyBytes,
      offsets.breaks,
      (offset) => bodyBytes.length - offset - 2 + updateBytes.length + jumpBack.length, // break → past JUMP_BACK
    ),
    offsets.continues,
    (offset) => bodyBytes.length - offset - 2, // continue → update section
  );

  return [...patched, ...updateBytes, ...jumpBack];
};
