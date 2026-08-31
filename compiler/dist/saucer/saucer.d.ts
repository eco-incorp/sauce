import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { SaucerLike, SaucerIfLike, SaucerThenLike, SaucerLoopLike, OutputSpec } from './saucer-like.js';
export type { OutputSpec };
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
interface JumpOffsets {
    breaks: number[];
    continues: number[];
}
export declare class Saucer implements SaucerLike {
    readonly ctx: CompilerContext;
    readonly _bytes: Uint8Array;
    readonly jumpOffsets: JumpOffsets;
    constructor(ctx: CompilerContext, bytes?: Uint8Array, jumpOffsets?: JumpOffsets);
    join(other: Saucer): Saucer;
    private with;
    private binary;
    private unary;
    private ternary;
    private emitJump;
    msgSender(): Saucer;
    msgValue(): Saucer;
    msgData(): Saucer;
    blockNumber(): Saucer;
    blockTimestamp(): Saucer;
    blockCoinbase(): Saucer;
    blockPrevrandao(): Saucer;
    blockGasLimit(): Saucer;
    blockBaseFee(): Saucer;
    blockBlobBaseFee(): Saucer;
    blockChainId(): Saucer;
    txOrigin(): Saucer;
    txGasPrice(): Saucer;
    addressSelf(): Saucer;
    addressBalance(): Saucer;
    gasLeft(): Saucer;
    balanceOf(addr: Saucer): Saucer;
    blockHash(n: Saucer): Saucer;
    codeSize(addr: Saucer): Saucer;
    codeHash(addr: Saucer): Saucer;
    blobHash(n: Saucer): Saucer;
    isContract(addr: Saucer): Saucer;
    isEOA(addr: Saucer): Saucer;
    int(value: bigint): Saucer;
    bytes(data: Uint8Array): Saucer;
    string(value: string): Saucer;
    array(elements: Saucer[], forcedWidth?: number): Saucer;
    tuple(elements: Saucer[]): Saucer;
    index(arr: Saucer, idx: Saucer): Saucer;
    setIndex(arr: Saucer, idx: Saucer, value: Saucer): Saucer;
    newArray(count: Saucer): Saucer;
    length(arr: Saucer): Saucer;
    concat(operands: Saucer[]): Saucer;
    slice(data: Saucer, offset: Saucer, length: Saucer): Saucer;
    abiEncode(tuple: Saucer): Saucer;
    abiDecode(count: number, data: Saucer, typeSpecs: number[]): Saucer;
    store(name: string, value: Saucer, kind?: VariableKind, elementType?: ElementType, structType?: StructType): Saucer;
    read(name: string): Saucer;
    add(left: Saucer, right: Saucer): Saucer;
    sub(left: Saucer, right: Saucer): Saucer;
    neg(operand: Saucer): Saucer;
    mul(left: Saucer, right: Saucer): Saucer;
    div(left: Saucer, right: Saucer): Saucer;
    mod(left: Saucer, right: Saucer): Saucer;
    exp(left: Saucer, right: Saucer): Saucer;
    sqrt(operand: Saucer): Saucer;
    mulDiv(a: Saucer, b: Saucer, c: Saucer): Saucer;
    keccak256(data: Saucer): Saucer;
    ecdsaVerify(signer: Saucer, hash: Saucer, signature: Saucer): Saucer;
    sload(slot: Saucer): Saucer;
    sstore(slot: Saucer, value: Saucer): Saucer;
    tload(key: Saucer): Saucer;
    tstore(key: Saucer, value: Saucer): Saucer;
    create(value: Saucer, bytecode: Saucer): Saucer;
    create2(value: Saucer, salt: Saucer, bytecode: Saucer): Saucer;
    create3(value: Saucer, salt: Saucer, bytecode: Saucer): Saucer;
    createAddress(deployer: Saucer, nonce: Saucer): Saucer;
    create2Address(deployer: Saucer, salt: Saucer, bytecodeHash: Saucer): Saucer;
    create3Address(salt: Saucer): Saucer;
    bitAnd(left: Saucer, right: Saucer): Saucer;
    bitOr(left: Saucer, right: Saucer): Saucer;
    bitXor(left: Saucer, right: Saucer): Saucer;
    bitNot(operand: Saucer): Saucer;
    shl(left: Saucer, right: Saucer): Saucer;
    shr(left: Saucer, right: Saucer): Saucer;
    eq(left: Saucer, right: Saucer): Saucer;
    neq(left: Saucer, right: Saucer): Saucer;
    gt(left: Saucer, right: Saucer): Saucer;
    lt(left: Saucer, right: Saucer): Saucer;
    gte(left: Saucer, right: Saucer): Saucer;
    lte(left: Saucer, right: Saucer): Saucer;
    and(left: Saucer, right: Saucer): Saucer;
    or(left: Saucer, right: Saucer): Saucer;
    not(operand: Saucer): Saucer;
    isZero(operand: Saucer): Saucer;
    isNotZero(operand: Saucer): Saucer;
    if(condition: Saucer): SaucerIf;
    callFunction(functionName: string, args: Saucer[]): Saucer;
    externalCall(target: Saucer, value: Saucer, calldata: Saucer, output?: OutputSpec): Saucer;
    staticCall(target: Saucer, calldata: Saucer, output?: OutputSpec): Saucer;
    delegateCall(target: Saucer, calldata: Saucer, output?: OutputSpec): Saucer;
    private call;
    catch(handler: Saucer): Saucer;
    return(saucer?: Saucer): Saucer;
    revert(data: Saucer): Saucer;
    log(data: Saucer, topics: Saucer[]): Saucer;
    break(): Saucer;
    continue(): Saucer;
    for(init?: Saucer, condition?: Saucer, update?: Saucer): SaucerLoop;
    while(condition: Saucer): SaucerLoop;
    eval(bytecode: Saucer): Saucer;
    dropIfUnused(): Saucer;
    build(): Uint8Array;
}
declare class SaucerIf implements SaucerIfLike {
    private readonly parent;
    private readonly condition;
    constructor(parent: Saucer, condition: Saucer);
    then(thenBody: Saucer): SaucerThen;
}
declare class SaucerThen extends Saucer implements SaucerThenLike {
    private readonly skipOffset;
    private readonly thenLength;
    private readonly wide;
    constructor(ctx: CompilerContext, bytes: Uint8Array, skipOffset: number, thenLength: number, wide: boolean, offsets: JumpOffsets);
    else(elseBody: Saucer): Saucer;
}
declare class SaucerLoop implements SaucerLoopLike {
    private readonly parent;
    private readonly condition?;
    private readonly update?;
    constructor(parent: Saucer, condition?: Saucer | undefined, update?: Saucer | undefined);
    loop(body: Saucer): Saucer;
}
//# sourceMappingURL=saucer.d.ts.map