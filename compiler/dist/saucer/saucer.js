import { OPS } from './ops.js';
import { encodeInt } from './integer.js';
import { encodeReadByKind, encodeStoreByKind } from './memory.js';
import { encodeBytes, encodeString } from './bytes.js';
import { encodeArray, encodeIndex, encodeSetIndex, encodeNewArray } from './array.js';
import { encodeTuple } from './tuple.js';
const MAX_BYTE_1 = 0xff;
const MAX_BYTE_2 = 0xffff;
const encodeSkip = (skipCount) => {
    if (skipCount > MAX_BYTE_2) {
        throw new Error(`body too large: ${skipCount} bytes exceeds ${MAX_BYTE_2}`);
    }
    return skipCount > MAX_BYTE_1 ? [(skipCount >> 8) & 0xff, skipCount & 0xff] : [skipCount];
};
const emptyOffsets = { breaks: [], continues: [] };
// When concatenating bytecode, offsets from later code need adjustment
const shiftOffsets = (offsets, delta) => ({
    breaks: offsets.breaks.map((o) => o + delta),
    continues: offsets.continues.map((o) => o + delta),
});
// Collect break/continues from multiple code paths (e.g., if/else inside loop)
const mergeOffsets = (a, b) => ({
    breaks: [...a.breaks, ...b.breaks],
    continues: [...a.continues, ...b.continues],
});
export class Saucer {
    ctx;
    _bytes;
    jumpOffsets;
    constructor(ctx, bytes = new Uint8Array(), jumpOffsets = emptyOffsets) {
        this.ctx = ctx;
        this._bytes = bytes;
        this.jumpOffsets = jumpOffsets;
    }
    join(other) {
        return new Saucer(this.ctx, new Uint8Array([...this._bytes, ...other._bytes]), mergeOffsets(this.jumpOffsets, shiftOffsets(other.jumpOffsets, this._bytes.length)));
    }
    with(bytes, jumpOffsets) {
        return new Saucer(this.ctx, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), jumpOffsets ?? this.jumpOffsets);
    }
    binary(op, left, right) {
        return this.with([op, ...left._bytes, ...right._bytes]);
    }
    unary(op, operand) {
        return this.with([op, ...operand._bytes]);
    }
    ternary(op, a, b, c) {
        return this.with([op, ...a._bytes, ...b._bytes, ...c._bytes]);
    }
    // Emit a JUMP_2 placeholder for break/continue. The target bytes [0, 0] will be
    // patched later when the loop is assembled and we know the actual jump distance.
    emitJump(keyword, field) {
        this.ctx.assertInLoop(keyword);
        const offset = this._bytes.length + 1; // position of the 2-byte target after JUMP_2 opcode
        return this.with([...this._bytes, OPS.JUMP_2, 0, 0], mergeOffsets(this.jumpOffsets, { ...emptyOffsets, [field]: [offset] }));
    }
    msgSender() {
        return this.with([OPS.MSG_SENDER]);
    }
    msgValue() {
        return this.with([OPS.CALL_VALUE]);
    }
    msgData() {
        return this.with([OPS.CALLDATA]);
    }
    blockNumber() {
        return this.with([OPS.BLOCK_NUMBER]);
    }
    blockTimestamp() {
        return this.with([OPS.TIMESTAMP]);
    }
    blockCoinbase() {
        return this.with([OPS.COINBASE]);
    }
    blockPrevrandao() {
        return this.with([OPS.PREVRANDAO]);
    }
    blockGasLimit() {
        return this.with([OPS.GAS_LIMIT]);
    }
    blockBaseFee() {
        return this.with([OPS.BASE_FEE]);
    }
    blockBlobBaseFee() {
        return this.with([OPS.BLOB_BASE_FEE]);
    }
    blockChainId() {
        return this.with([OPS.CHAIN_ID]);
    }
    txOrigin() {
        return this.with([OPS.TX_ORIGIN]);
    }
    txGasPrice() {
        return this.with([OPS.GAS_PRICE]);
    }
    addressSelf() {
        return this.with([OPS.THIS_ADDRESS]);
    }
    addressBalance() {
        return this.with([OPS.SELF_BALANCE]);
    }
    gasLeft() {
        return this.with([OPS.GAS_LEFT]);
    }
    balanceOf(addr) {
        return this.unary(OPS.BALANCE, addr);
    }
    blockHash(n) {
        return this.unary(OPS.BLOCK_HASH, n);
    }
    codeSize(addr) {
        return this.unary(OPS.EXT_CODE_SIZE, addr);
    }
    codeHash(addr) {
        return this.unary(OPS.EXT_CODE_HASH, addr);
    }
    blobHash(n) {
        return this.unary(OPS.BLOB_HASH, n);
    }
    isContract(addr) {
        return this.unary(OPS.IS_CONTRACT, addr);
    }
    isEOA(addr) {
        return this.unary(OPS.IS_EOA, addr);
    }
    int(value) {
        return this.with(encodeInt(value));
    }
    bytes(data) {
        return this.with(encodeBytes(data));
    }
    string(value) {
        return this.with(encodeString(value));
    }
    array(elements, forcedWidth) {
        return this.with(encodeArray(elements, forcedWidth));
    }
    tuple(elements) {
        return this.with(encodeTuple(elements));
    }
    index(arr, idx) {
        return this.with(encodeIndex(idx, arr));
    }
    setIndex(arr, idx, value) {
        return this.with(encodeSetIndex(value, idx, arr));
    }
    newArray(count) {
        return this.with(encodeNewArray(count));
    }
    length(arr) {
        return this.unary(OPS.LENGTH, arr);
    }
    concat(operands) {
        if (operands.length === 0 || operands.length > 0xff) {
            throw new Error(`concat requires 1-255 operands, got ${operands.length}`);
        }
        return this.with([OPS.CONCAT, operands.length, ...operands.flatMap((o) => Array.from(o._bytes))]);
    }
    slice(data, offset, length) {
        return this.with([OPS.SLICE, ...data._bytes, ...offset._bytes, ...length._bytes]);
    }
    abiEncode(tuple) {
        return this.with([OPS.ABI_ENCODE, ...tuple._bytes]);
    }
    abiDecode(count, data, typeSpecs) {
        return this.with([OPS.ABI_DECODE, count, ...data._bytes, ...typeSpecs]);
    }
    store(name, value, kind = 'scalar', elementType, structType) {
        const variable = this.ctx.getVar(name) ?? this.ctx.setVar(name, kind, elementType, structType);
        return this.with(encodeStoreByKind(this._bytes, variable.slot, value._bytes, variable.kind));
    }
    read(name) {
        const variable = this.ctx.getVar(name);
        if (!variable) {
            throw new Error(`undefined variable: ${name}`);
        }
        return this.with(encodeReadByKind(variable.slot, variable.kind));
    }
    add(left, right) {
        return this.binary(OPS.ADD, left, right);
    }
    sub(left, right) {
        return this.binary(OPS.SUB, left, right);
    }
    neg(operand) {
        return this.unary(OPS.NEG, operand);
    }
    mul(left, right) {
        return this.binary(OPS.MUL, left, right);
    }
    div(left, right) {
        return this.binary(OPS.DIV, left, right);
    }
    mod(left, right) {
        return this.binary(OPS.MOD, left, right);
    }
    exp(left, right) {
        return this.binary(OPS.EXP, left, right);
    }
    sqrt(operand) {
        return this.unary(OPS.SQRT, operand);
    }
    mulDiv(a, b, c) {
        return this.ternary(OPS.MUL_DIV, a, b, c);
    }
    keccak256(data) {
        return this.unary(OPS.KECCAK256, data);
    }
    ecdsaVerify(signer, hash, signature) {
        return this.with([OPS.ECDSA_VERIFY, ...signer._bytes, ...hash._bytes, ...signature._bytes]);
    }
    sload(slot) {
        return this.unary(OPS.SLOAD, slot);
    }
    sstore(slot, value) {
        return this.binary(OPS.SSTORE, slot, value);
    }
    tload(key) {
        return this.unary(OPS.TLOAD, key);
    }
    tstore(key, value) {
        return this.binary(OPS.TSTORE, key, value);
    }
    create(value, bytecode) {
        return this.binary(OPS.CREATE, value, bytecode);
    }
    create2(value, salt, bytecode) {
        return this.ternary(OPS.CREATE2, value, salt, bytecode);
    }
    create3(value, salt, bytecode) {
        return this.ternary(OPS.CREATE3, value, salt, bytecode);
    }
    createAddress(deployer, nonce) {
        return this.binary(OPS.CREATE_ADDRESS, deployer, nonce);
    }
    create2Address(deployer, salt, bytecodeHash) {
        return this.ternary(OPS.CREATE2_ADDRESS, deployer, salt, bytecodeHash);
    }
    create3Address(salt) {
        return this.unary(OPS.CREATE3_ADDRESS, salt);
    }
    bitAnd(left, right) {
        return this.binary(OPS.AND, left, right);
    }
    bitOr(left, right) {
        return this.binary(OPS.OR, left, right);
    }
    bitXor(left, right) {
        return this.binary(OPS.XOR, left, right);
    }
    bitNot(operand) {
        return this.unary(OPS.NOT, operand);
    }
    shl(left, right) {
        return this.binary(OPS.SHL, left, right);
    }
    shr(left, right) {
        return this.binary(OPS.SHR, left, right);
    }
    eq(left, right) {
        return this.binary(OPS.BOOL_EQ, left, right);
    }
    neq(left, right) {
        return this.binary(OPS.BOOL_NEQ, left, right);
    }
    gt(left, right) {
        return this.binary(OPS.BOOL_GT, left, right);
    }
    lt(left, right) {
        return this.binary(OPS.BOOL_LT, left, right);
    }
    gte(left, right) {
        return this.binary(OPS.BOOL_GTE, left, right);
    }
    lte(left, right) {
        return this.binary(OPS.BOOL_LTE, left, right);
    }
    and(left, right) {
        return this.binary(OPS.BOOL_AND, left, right);
    }
    or(left, right) {
        return this.binary(OPS.BOOL_OR, left, right);
    }
    not(operand) {
        return this.unary(OPS.BOOL_NOT, operand);
    }
    isZero(operand) {
        return this.unary(OPS.BOOL_ZERO, operand);
    }
    isNotZero(operand) {
        return this.unary(OPS.BOOL_NOT_ZERO, operand);
    }
    if(condition) {
        return new SaucerIf(this, condition);
    }
    callFunction(functionName, args) {
        const argsAsBytes = args.reduce((result, saucer) => new Uint8Array([...result, ...saucer._bytes]), new Uint8Array());
        return this.with([OPS.CALL_FUNCTION, this.ctx.getFunc(functionName), args.length, ...argsAsBytes]);
    }
    externalCall(target, value, calldata, output) {
        return this.call(OPS.CALL, target, calldata, output, value);
    }
    staticCall(target, calldata, output) {
        return this.call(OPS.STATIC, target, calldata, output);
    }
    delegateCall(target, calldata, output) {
        return this.call(OPS.DELEGATE, target, calldata, output);
    }
    call(op, target, calldata, output, value) {
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
    catch(handler) {
        if (handler._bytes.length > 255) {
            throw new Error(`catch handler too large: ${handler._bytes.length} bytes exceeds 255`);
        }
        return this.with([...this._bytes, OPS.CATCH, handler._bytes.length, ...handler._bytes]);
    }
    return(saucer) {
        return this.with(saucer ? [...this._bytes, ...saucer._bytes, OPS.STOP] : [...this._bytes, OPS.STOP]);
    }
    revert(data) {
        return this.with([...this._bytes, OPS.REVERT, ...data._bytes]);
    }
    log(data, topics) {
        if (topics.length > 4) {
            throw new Error(`log supports 0-4 topics, got ${topics.length}`);
        }
        const topicBytes = topics.flatMap((t) => Array.from(t._bytes));
        return this.with([...this._bytes, OPS.LOG, topics.length, ...data._bytes, ...topicBytes]);
    }
    break() {
        return this.emitJump('break', 'breaks');
    }
    continue() {
        return this.emitJump('continue', 'continues');
    }
    for(init, condition, update) {
        const parent = init ? this.with([...this._bytes, ...init._bytes]) : this;
        return new SaucerLoop(parent, condition, update);
    }
    while(condition) {
        return new SaucerLoop(this, condition);
    }
    eval(bytecode) {
        return this.with([OPS.EVAL, ...bytecode._bytes]);
    }
    // The prefix-tree interpreter discards a statement's result implicitly, so there
    // is nothing to drop (see V12Saucer for the stack-based counterpart).
    dropIfUnused() {
        return this;
    }
    build() {
        const valueSlots = this.ctx.valueSlotCount;
        const heapSlots = this.ctx.heapSlotCount;
        // Value/heap slot indices are encoded as a SINGLE byte (READ_VALUE/WRITE_VALUE/
        // ALLOCATE_VALUE and the HEAP equivalents — see saucer/memory.ts). A program with
        // more than 256 scalar (or heap) locals would silently wrap slot index ≥256 to
        // index mod 256, aliasing an earlier slot (e.g. a function parameter) and
        // corrupting it at runtime. Fail loud at compile time instead of miscompiling.
        if (valueSlots > 0xff) {
            throw new Error(`too many scalar locals: ${valueSlots} (max 255). Value-slot indices are 1 byte; ` +
                `slot >=256 would wrap and corrupt an earlier slot. Split the function or reuse locals.`);
        }
        if (heapSlots > 0xff) {
            throw new Error(`too many heap (dynamic) locals: ${heapSlots} (max 255). Heap-slot indices are 1 byte; ` +
                `slot >=256 would wrap and corrupt an earlier slot. Split the function or reuse locals.`);
        }
        const prefix = [];
        if (valueSlots > 0)
            prefix.push(OPS.ALLOCATE_VALUE, valueSlots);
        if (heapSlots > 0)
            prefix.push(OPS.ALLOCATE_HEAP, heapSlots);
        return prefix.length > 0 ? new Uint8Array([...prefix, ...this._bytes]) : this._bytes;
    }
}
class SaucerIf {
    parent;
    condition;
    constructor(parent, condition) {
        this.parent = parent;
        this.condition = condition;
    }
    then(thenBody) {
        const wide = thenBody._bytes.length > MAX_BYTE_1;
        const skipOffset = this.parent._bytes.length + 1;
        const op = wide ? OPS.IF_2 : OPS.IF;
        const skip = encodeSkip(thenBody._bytes.length);
        const prefix = this.parent._bytes.length + 1 + skip.length + this.condition._bytes.length;
        const offsets = mergeOffsets(this.parent.jumpOffsets, shiftOffsets(thenBody.jumpOffsets, prefix));
        return new SaucerThen(this.parent.ctx, new Uint8Array([...this.parent._bytes, op, ...skip, ...this.condition._bytes, ...thenBody._bytes]), skipOffset, thenBody._bytes.length, wide, offsets);
    }
}
class SaucerThen extends Saucer {
    skipOffset;
    thenLength;
    wide;
    constructor(ctx, bytes, skipOffset, thenLength, wide, offsets) {
        super(ctx, bytes, offsets);
        this.skipOffset = skipOffset;
        this.thenLength = thenLength;
        this.wide = wide;
    }
    else(elseBody) {
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
        return new Saucer(this.ctx, new Uint8Array([...before, ...encodeSkip(ifSkip), ...after, ...jump, ...elseBody._bytes]), offsets);
    }
}
class SaucerLoop {
    parent;
    condition;
    update;
    constructor(parent, condition, update) {
        this.parent = parent;
        this.condition = condition;
        this.update = update;
    }
    loop(body) {
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
const resolveLoopSize = (innerSize) => (innerSize + 2 > MAX_BYTE_1 ? innerSize + 3 : innerSize + 2);
const encodeJumpBack = (count) => {
    if (count > MAX_BYTE_2)
        throw new Error(`loop too large: ${count} bytes exceeds ${MAX_BYTE_2}`);
    return count > MAX_BYTE_1 ? [OPS.JUMP_BACK_2, (count >> 8) & 0xff, count & 0xff] : [OPS.JUMP_BACK, count];
};
// Fill in the actual jump distances for break/continue placeholders
const patchBody = (bodyBytes, offsets, distance) => {
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
const assembleConditionalLoop = (condBytes, bodyBytes, updateBytes, offsets) => {
    const bottomIfOverhead = 2; // [IF][skipBottom]
    const innerSize = bodyBytes.length + updateBytes.length + bottomIfOverhead + condBytes.length;
    const loopSize = resolveLoopSize(innerSize);
    const jumpBack = encodeJumpBack(loopSize);
    const skipBottom = jumpBack.length; // skip past JUMP_BACK when condition is false
    const patched = patchBody(patchBody(bodyBytes, offsets.breaks, (offset) => loopSize - offset - 2), // break → past JUMP_BACK
    offsets.continues, (offset) => bodyBytes.length - offset - 2);
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
const assembleInfiniteLoop = (bodyBytes, updateBytes, offsets) => {
    const innerSize = bodyBytes.length + updateBytes.length;
    const loopSize = resolveLoopSize(innerSize);
    const jumpBack = encodeJumpBack(loopSize);
    const patched = patchBody(patchBody(bodyBytes, offsets.breaks, (offset) => bodyBytes.length - offset - 2 + updateBytes.length + jumpBack.length), offsets.continues, (offset) => bodyBytes.length - offset - 2);
    return [...patched, ...updateBytes, ...jumpBack];
};
