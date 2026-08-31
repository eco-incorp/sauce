import type { CompilerContext, VariableKind, ElementType, StructType } from '../context.js';
import type { SaucerLike, SaucerIfLike, SaucerLoopLike, OutputSpec } from './saucer-like.js';
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
/** Flatten byte chunks (Uint8Arrays or number[]) into one Uint8Array. */
export declare const concatBytes: (parts: (Uint8Array | number[])[]) => Uint8Array;
export declare class V12Saucer implements SaucerLike {
    readonly ctx: CompilerContext;
    readonly _bytes: Uint8Array;
    readonly stackEffect: number;
    readonly isDynamic: boolean;
    readonly callPositions: CallPlaceholder[];
    readonly refPositions: RefPlaceholder[];
    constructor(ctx: CompilerContext, _bytes?: Uint8Array, stackEffect?: number, isDynamic?: boolean, callPositions?: CallPlaceholder[], refPositions?: RefPlaceholder[]);
    /**
     * Append a run of operands, threading the running byte/stack offsets through
     * `mergeSentinels` once. Operands are emitted forward by default, or reversed
     * (ARRAY/TUPLE/CONCAT want elements in reverse); `wrap` MSTORE-wraps each scalar
     * into a heap descriptor (for CONCAT). The single accumulator behind `nary`,
     * `concat`, `callFunction` and `log`. Returns the parts plus the final offsets so
     * callers can append their own header (and a CALL_FUNCTION sentinel).
     */
    private appendOperands;
    /** Append literal bytes (a constant/context op) to this builder. */
    private withBytes;
    join(other: SaucerLike): V12Saucer;
    private binary;
    private unary;
    private ternary;
    /** Append a sequence of operands (reverse order) followed by a header. */
    private nary;
    msgSender(): V12Saucer;
    msgValue(): V12Saucer;
    msgData(): V12Saucer;
    blockNumber(): V12Saucer;
    blockTimestamp(): V12Saucer;
    blockCoinbase(): V12Saucer;
    blockPrevrandao(): V12Saucer;
    blockGasLimit(): V12Saucer;
    blockBaseFee(): V12Saucer;
    blockBlobBaseFee(): V12Saucer;
    blockChainId(): V12Saucer;
    txOrigin(): V12Saucer;
    txGasPrice(): V12Saucer;
    addressSelf(): V12Saucer;
    addressBalance(): V12Saucer;
    gasLeft(): V12Saucer;
    balanceOf(addr: SaucerLike): V12Saucer;
    blockHash(n: SaucerLike): V12Saucer;
    codeSize(addr: SaucerLike): V12Saucer;
    codeHash(addr: SaucerLike): V12Saucer;
    blobHash(n: SaucerLike): V12Saucer;
    isContract(addr: SaucerLike): V12Saucer;
    isEOA(addr: SaucerLike): V12Saucer;
    int(value: bigint): V12Saucer;
    bytes(data: Uint8Array): V12Saucer;
    string(value: string): V12Saucer;
    tuple(elements: SaucerLike[]): V12Saucer;
    array(elements: SaucerLike[], forcedWidth?: number): V12Saucer;
    private naryEffect;
    index(arr: SaucerLike, idx: SaucerLike): V12Saucer;
    length(arr: SaucerLike): V12Saucer;
    setIndex(arrL: SaucerLike, idxL: SaucerLike, valueL: SaucerLike): V12Saucer;
    newArray(count: SaucerLike): V12Saucer;
    /** Wrap a scalar operand as a heap descriptor (append MSTORE) for ops that consume dynamic data. */
    private static wrapDescriptor;
    concat(operands: SaucerLike[]): V12Saucer;
    slice(dataL: SaucerLike, offsetL: SaucerLike, lengthL: SaucerLike): V12Saucer;
    abiEncode(tuple: SaucerLike): V12Saucer;
    abiDecode(count: number, dataL: SaucerLike, typeSpecs: number[]): V12Saucer;
    /** v12-only: CAST_BE — cast a dynamic value to a scalar word, big-endian. */
    castBe(data: SaucerLike): V12Saucer;
    /** v12-only: CAST_LE — CAST_BE with the dereferenced bytes read little-endian (byte 0 least significant). The svm-native cast: uint() lowers to it on target 'svm'. */
    castLe(data: SaucerLike): V12Saucer;
    store(name: string, valueL: SaucerLike, _kind?: VariableKind, elementType?: ElementType, structType?: StructType): V12Saucer;
    read(name: string): V12Saucer;
    add(l: SaucerLike, r: SaucerLike): V12Saucer;
    sub(l: SaucerLike, r: SaucerLike): V12Saucer;
    neg(o: SaucerLike): V12Saucer;
    mul(l: SaucerLike, r: SaucerLike): V12Saucer;
    div(l: SaucerLike, r: SaucerLike): V12Saucer;
    mod(l: SaucerLike, r: SaucerLike): V12Saucer;
    exp(l: SaucerLike, r: SaucerLike): V12Saucer;
    sqrt(o: SaucerLike): V12Saucer;
    mulDiv(a: SaucerLike, b: SaucerLike, c: SaucerLike): V12Saucer;
    addMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): V12Saucer;
    mulMod(a: SaucerLike, b: SaucerLike, n: SaucerLike): V12Saucer;
    sDiv(a: SaucerLike, b: SaucerLike): V12Saucer;
    sMod(a: SaucerLike, b: SaucerLike): V12Saucer;
    sAr(value: SaucerLike, shift: SaucerLike): V12Saucer;
    signExtend(k: SaucerLike, value: SaucerLike): V12Saucer;
    sgt(l: SaucerLike, r: SaucerLike): V12Saucer;
    slt(l: SaucerLike, r: SaucerLike): V12Saucer;
    sgte(l: SaucerLike, r: SaucerLike): V12Saucer;
    slte(l: SaucerLike, r: SaucerLike): V12Saucer;
    keccak256(dataL: SaucerLike): V12Saucer;
    ecdsaVerify(signer: SaucerLike, hash: SaucerLike, signature: SaucerLike): V12Saucer;
    sload(slot: SaucerLike): V12Saucer;
    sstore(slot: SaucerLike, value: SaucerLike): V12Saucer;
    tload(key: SaucerLike): V12Saucer;
    tstore(key: SaucerLike, value: SaucerLike): V12Saucer;
    /**
     * Binary op with explicit (no-swap) operand order: [first][second][OP].
     * `opStackEffect` is the opcode's own net stack delta: -2 for ops that consume
     * both operands and push nothing (SSTORE/TSTORE), -1 for ops that leave a result
     * (STATIC/DELEGATE push a descriptor). Mirrors `../sauce/engine-v12/src/V12Saucer.sol`
     * (`_propagate2(..., -2)` for the stores vs `_binaryOp(..., -1)` for the calls).
     */
    private binaryRaw;
    /**
     * Ternary op with explicit (no-swap) operand order: [first][second][third][OP].
     * `opStackEffect` is the opcode's own net stack delta: -2 for ops that consume
     * three operands and push a result (svm SLOAD), -3 for ops that push nothing
     * (svm SSTORE). The 3-operand sibling of `binaryRaw`.
     */
    private ternaryRaw;
    create(value: SaucerLike, bytecode: SaucerLike): V12Saucer;
    create2(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): V12Saucer;
    create3(value: SaucerLike, salt: SaucerLike, bytecode: SaucerLike): V12Saucer;
    createAddress(deployer: SaucerLike, nonce: SaucerLike): V12Saucer;
    create2Address(deployer: SaucerLike, salt: SaucerLike, bytecodeHash: SaucerLike): V12Saucer;
    create3Address(salt: SaucerLike): V12Saucer;
    bitAnd(l: SaucerLike, r: SaucerLike): V12Saucer;
    bitOr(l: SaucerLike, r: SaucerLike): V12Saucer;
    bitXor(l: SaucerLike, r: SaucerLike): V12Saucer;
    bitNot(o: SaucerLike): V12Saucer;
    shl(l: SaucerLike, r: SaucerLike): V12Saucer;
    shr(l: SaucerLike, r: SaucerLike): V12Saucer;
    eq(l: SaucerLike, r: SaucerLike): V12Saucer;
    neq(l: SaucerLike, r: SaucerLike): V12Saucer;
    gt(l: SaucerLike, r: SaucerLike): V12Saucer;
    lt(l: SaucerLike, r: SaucerLike): V12Saucer;
    gte(l: SaucerLike, r: SaucerLike): V12Saucer;
    lte(l: SaucerLike, r: SaucerLike): V12Saucer;
    and(l: SaucerLike, r: SaucerLike): V12Saucer;
    or(l: SaucerLike, r: SaucerLike): V12Saucer;
    not(o: SaucerLike): V12Saucer;
    isZero(o: SaucerLike): V12Saucer;
    isNotZero(o: SaucerLike): V12Saucer;
    if(condition: SaucerLike): SaucerIfLike;
    for(init?: SaucerLike, condition?: SaucerLike, update?: SaucerLike): SaucerLoopLike;
    while(condition: SaucerLike): SaucerLoopLike;
    break(): V12Saucer;
    continue(): V12Saucer;
    callFunction(functionName: string, args: SaucerLike[]): V12Saucer;
    externalCall(target: SaucerLike, value: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer;
    staticCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer;
    delegateCall(target: SaucerLike, calldata: SaucerLike, output?: OutputSpec): V12Saucer;
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
    svmCall(target: SaucerLike, calldata: SaucerLike, accountsArray: SaucerLike): V12Saucer;
    /** svm STATIC (0xA3): exact alias of svm CALL — identical operands and result. */
    svmStaticCall(target: SaucerLike, calldata: SaucerLike, accountsArray: SaucerLike): V12Saucer;
    /**
     * svm SLOAD (0x81): [len][offset][index][SLOAD] — account index on top, then
     * offset, then len. Reads accounts[index].data[offset..offset+len] and pushes
     * a Bytes descriptor (net -2). Surface: accountData(ref, offset, len).
     */
    svmAccountData(index: SaucerLike, offset: SaucerLike, len: SaucerLike): V12Saucer;
    /**
     * svm SSTORE (0xC5): [value][offset][index][SSTORE] — account index on top,
     * then offset, then the value Bytes descriptor. Writes the bytes into the
     * (writable) account's data; pushes nothing (net -3, so a bare statement's
     * dropIfUnused is a no-op). Surface: writeAccountData(ref, offset, value).
     * The engine REQUIRES a Bytes descriptor for the value, so a scalar operand
     * is MSTORE-wrapped into a 32-byte heap word first (the CONCAT wrap idiom).
     */
    svmWriteAccountData(index: SaucerLike, offset: SaucerLike, value: SaucerLike): V12Saucer;
    private decodeOutput;
    catch(handlerL: SaucerLike): V12Saucer;
    return(saucer?: SaucerLike): V12Saucer;
    revert(dataL: SaucerLike): V12Saucer;
    log(dataL: SaucerLike, topics: SaucerLike[]): V12Saucer;
    eval(bytecode: SaucerLike): V12Saucer;
    dropIfUnused(): V12Saucer;
    sswap(n: number): V12Saucer;
    sdrop(): V12Saucer;
    srot(): V12Saucer;
    /** Main body: append MSTORE for a scalar result (the engine expects a descriptor). */
    build(): Uint8Array;
    /** Helper body: prepend ALLOCATE_VALUE/ALLOCATE_HEAP for local slots (no MSTORE). */
    buildFunctionBody(): Uint8Array;
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
    buildMain(): {
        bytes: Uint8Array;
        prefixLen: number;
    };
    /** The ALLOCATE_VALUE/ALLOCATE_HEAP frame-declaration prefix for this function. */
    private allocatePrefix;
}
//# sourceMappingURL=saucer-v12.d.ts.map