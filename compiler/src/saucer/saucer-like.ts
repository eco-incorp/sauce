import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';

export interface OutputSpec {
  count: number;
  typeSpecs: number[];
}

/**
 * The builder surface the processor depends on. Both the v1 prefix `Saucer` and
 * the v12 postfix `V12Saucer` implement it, so the processor stays target-agnostic:
 * it calls `ctx.newSaucer()` and these methods, and the concrete builder decides
 * prefix-vs-postfix emission (and slot-vs-stack variable access).
 *
 * Methods return `SaucerLike` so both builders satisfy the contract via covariant
 * returns (`Saucer`/`V12Saucer` are each assignable to `SaucerLike`).
 */
export interface SaucerLike {
  readonly _bytes: Uint8Array;
  readonly ctx: CompilerContext;

  join(other: SaucerLike): SaucerLike;

  // context — nullary
  msgSender(): SaucerLike;
  msgValue(): SaucerLike;
  msgData(): SaucerLike;
  blockNumber(): SaucerLike;
  blockTimestamp(): SaucerLike;
  blockCoinbase(): SaucerLike;
  blockPrevrandao(): SaucerLike;
  blockGasLimit(): SaucerLike;
  blockBaseFee(): SaucerLike;
  blockBlobBaseFee(): SaucerLike;
  blockChainId(): SaucerLike;
  txOrigin(): SaucerLike;
  txGasPrice(): SaucerLike;
  addressSelf(): SaucerLike;
  addressBalance(): SaucerLike;
  gasLeft(): SaucerLike;

  // context — unary
  balanceOf(addr: SaucerLike): SaucerLike;
  blockHash(n: SaucerLike): SaucerLike;
  codeSize(addr: SaucerLike): SaucerLike;
  codeHash(addr: SaucerLike): SaucerLike;
  blobHash(n: SaucerLike): SaucerLike;
  isContract(addr: SaucerLike): SaucerLike;
  isEOA(addr: SaucerLike): SaucerLike;

  // values
  int(value: bigint): SaucerLike;
  bytes(data: Uint8Array): SaucerLike;
  string(value: string): SaucerLike;
  array(elements: SaucerLike[], forcedWidth?: number): SaucerLike;
  tuple(elements: SaucerLike[]): SaucerLike;
  index(arr: SaucerLike, idx: SaucerLike): SaucerLike;
  setIndex(arr: SaucerLike, idx: SaucerLike, value: SaucerLike): SaucerLike;
  newArray(count: SaucerLike): SaucerLike;
  length(arr: SaucerLike): SaucerLike;
  concat(operands: SaucerLike[]): SaucerLike;
  slice(data: SaucerLike, offset: SaucerLike, length: SaucerLike): SaucerLike;
  abiEncode(tuple: SaucerLike): SaucerLike;
  abiDecode(count: number, data: SaucerLike, typeSpecs: number[]): SaucerLike;

  // variables
  store(
    name: string,
    value: SaucerLike,
    kind?: VariableKind,
    elementType?: ElementType,
    structType?: StructType,
  ): SaucerLike;
  read(name: string): SaucerLike;

  // arithmetic
  add(left: SaucerLike, right: SaucerLike): SaucerLike;
  sub(left: SaucerLike, right: SaucerLike): SaucerLike;
  neg(operand: SaucerLike): SaucerLike;
  mul(left: SaucerLike, right: SaucerLike): SaucerLike;
  div(left: SaucerLike, right: SaucerLike): SaucerLike;
  mod(left: SaucerLike, right: SaucerLike): SaucerLike;
  exp(left: SaucerLike, right: SaucerLike): SaucerLike;
  sqrt(operand: SaucerLike): SaucerLike;
  mulDiv(a: SaucerLike, b: SaucerLike, c: SaucerLike): SaucerLike;

  // extended / signed arithmetic
  addMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): SaucerLike;
  mulMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): SaucerLike;
  sDiv(a: SaucerLike, b: SaucerLike): SaucerLike;
  sMod(a: SaucerLike, b: SaucerLike): SaucerLike;
  sShr(value: SaucerLike, shift: SaucerLike): SaucerLike;
  signExtend(value: SaucerLike, fromByte: SaucerLike): SaucerLike;
  sLt(a: SaucerLike, b: SaucerLike): SaucerLike;
  sGt(a: SaucerLike, b: SaucerLike): SaucerLike;
  sLte(a: SaucerLike, b: SaucerLike): SaucerLike;
  sGte(a: SaucerLike, b: SaucerLike): SaucerLike;

  // crypto
  keccak256(data: SaucerLike): SaucerLike;
  ecdsaVerify(signer: SaucerLike, hash: SaucerLike, signature: SaucerLike): SaucerLike;

  // storage
  sload(slot: SaucerLike): SaucerLike;
  sstore(slot: SaucerLike, value: SaucerLike): SaucerLike;
  tload(key: SaucerLike): SaucerLike;
  tstore(key: SaucerLike, value: SaucerLike): SaucerLike;

  // create
  create(value: SaucerLike, bytecode: SaucerLike): SaucerLike;
  create2(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): SaucerLike;
  create3(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): SaucerLike;
  createAddress(deployer: SaucerLike, nonce: SaucerLike): SaucerLike;
  create2Address(deployer: SaucerLike, salt: SaucerLike, bytecodeHash: SaucerLike): SaucerLike;
  create3Address(salt: SaucerLike): SaucerLike;

  // bitwise
  bitAnd(left: SaucerLike, right: SaucerLike): SaucerLike;
  bitOr(left: SaucerLike, right: SaucerLike): SaucerLike;
  bitXor(left: SaucerLike, right: SaucerLike): SaucerLike;
  bitNot(operand: SaucerLike): SaucerLike;
  shl(left: SaucerLike, right: SaucerLike): SaucerLike;
  shr(left: SaucerLike, right: SaucerLike): SaucerLike;

  // comparison / boolean
  eq(left: SaucerLike, right: SaucerLike): SaucerLike;
  neq(left: SaucerLike, right: SaucerLike): SaucerLike;
  gt(left: SaucerLike, right: SaucerLike): SaucerLike;
  lt(left: SaucerLike, right: SaucerLike): SaucerLike;
  gte(left: SaucerLike, right: SaucerLike): SaucerLike;
  lte(left: SaucerLike, right: SaucerLike): SaucerLike;
  and(left: SaucerLike, right: SaucerLike): SaucerLike;
  or(left: SaucerLike, right: SaucerLike): SaucerLike;
  not(operand: SaucerLike): SaucerLike;
  isZero(operand: SaucerLike): SaucerLike;
  isNotZero(operand: SaucerLike): SaucerLike;

  // control flow
  if(condition: SaucerLike): SaucerIfLike;
  for(init?: SaucerLike, condition?: SaucerLike, update?: SaucerLike): SaucerLoopLike;
  while(condition: SaucerLike): SaucerLoopLike;
  break(): SaucerLike;
  continue(): SaucerLike;

  // calls
  callFunction(functionName: string, args: SaucerLike[]): SaucerLike;
  externalCall(target: SaucerLike, value: SaucerLike, calldata: SaucerLike, output?: OutputSpec): SaucerLike;
  staticCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): SaucerLike;
  delegateCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): SaucerLike;
  catch(handler: SaucerLike): SaucerLike;

  // statements
  return(saucer?: SaucerLike): SaucerLike;
  revert(data: SaucerLike): SaucerLike;
  log(data: SaucerLike, topics: SaucerLike[]): SaucerLike;
  eval(bytecode: SaucerLike): SaucerLike;

  /**
   * Discard this expression's result when it is used as a bare statement. No-op on
   * the v1 tree interpreter (it discards intermediates implicitly); on v12 it pops
   * any value the expression leaves on the stack so it does not leak.
   */
  dropIfUnused(): SaucerLike;

  build(): Uint8Array;
}

export interface SaucerIfLike {
  then(thenBody: SaucerLike): SaucerThenLike;
}

export interface SaucerThenLike extends SaucerLike {
  else(elseBody: SaucerLike): SaucerLike;
}

export interface SaucerLoopLike {
  loop(body: SaucerLike): SaucerLike;
}
