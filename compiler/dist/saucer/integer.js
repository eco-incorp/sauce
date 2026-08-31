import { OPS } from './ops.js';
const MAX_UINT256 = (1n << 256n) - 1n;
export const BYTE_OPS = {
    1: OPS.BYTE_1,
    2: OPS.BYTE_2,
    3: OPS.BYTE_3,
    4: OPS.BYTE_4,
    5: OPS.BYTE_5,
    6: OPS.BYTE_6,
    7: OPS.BYTE_7,
    8: OPS.BYTE_8,
    9: OPS.BYTE_9,
    10: OPS.BYTE_10,
    11: OPS.BYTE_11,
    12: OPS.BYTE_12,
    13: OPS.BYTE_13,
    14: OPS.BYTE_14,
    15: OPS.BYTE_15,
    16: OPS.BYTE_16,
    17: OPS.BYTE_17,
    18: OPS.BYTE_18,
    19: OPS.BYTE_19,
    20: OPS.BYTE_20,
    21: OPS.BYTE_21,
    22: OPS.BYTE_22,
    23: OPS.BYTE_23,
    24: OPS.BYTE_24,
    25: OPS.BYTE_25,
    26: OPS.BYTE_26,
    27: OPS.BYTE_27,
    28: OPS.BYTE_28,
    29: OPS.BYTE_29,
    30: OPS.BYTE_30,
    31: OPS.BYTE_31,
    32: OPS.BYTE_32,
};
export const BYTE_WIDTH = Object.fromEntries(Object.entries(BYTE_OPS).map(([width, op]) => [op, Number(width)]));
const minBytesNeeded = (value) => Math.ceil(value.toString(16).length / 2);
export function encodeInt(value) {
    const abs = value < 0n ? -value : value;
    if (abs > MAX_UINT256) {
        throw new Error('value exceeds 32 bytes (uint256 max)');
    }
    const byteCount = minBytesNeeded(abs);
    const opcode = BYTE_OPS[byteCount];
    const valueBytes = Array.from({ length: byteCount }, (_, i) => Number((abs >> BigInt((byteCount - 1 - i) * 8)) & 0xffn));
    return value < 0n ? new Uint8Array([OPS.NEG, opcode, ...valueBytes]) : new Uint8Array([opcode, ...valueBytes]);
}
