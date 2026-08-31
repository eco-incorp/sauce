import { OPS } from './ops.js';

const MAX_BYTE_1 = 0xff;
const MAX_BYTE_2 = 0xffff;

const encodeLengthPrefix = (length: number): number[] =>
  length <= MAX_BYTE_1 ? [OPS.BYTES, length] : [OPS.BYTES_2, (length >> 8) & 0xff, length & 0xff];

export const encodeBytes = (data: Uint8Array): Uint8Array => {
  if (data.length > MAX_BYTE_2) throw new Error(`bytes too large: ${data.length} exceeds ${MAX_BYTE_2}`);

  return new Uint8Array([...encodeLengthPrefix(data.length), ...data]);
};

export const encodeString = (value: string): Uint8Array => encodeBytes(new TextEncoder().encode(value));
