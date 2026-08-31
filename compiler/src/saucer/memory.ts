import { OPS } from './ops.js';
import type { VariableKind } from '../context.js';

export const encodeRead = (slotIndex: number): Uint8Array => new Uint8Array([OPS.READ_VALUE, slotIndex]);

export const encodeStore = (currentBytes: Uint8Array, slotIndex: number, valueBytes: Uint8Array): Uint8Array =>
  new Uint8Array([...currentBytes, OPS.WRITE_VALUE, slotIndex, ...valueBytes]);

export const encodeHeapRead = (slotIndex: number): Uint8Array => new Uint8Array([OPS.READ_HEAP, slotIndex]);

export const encodeHeapStore = (currentBytes: Uint8Array, slotIndex: number, valueBytes: Uint8Array): Uint8Array =>
  new Uint8Array([...currentBytes, OPS.WRITE_HEAP, slotIndex, ...valueBytes]);

export const encodeReadByKind = (slotIndex: number, kind: VariableKind): Uint8Array =>
  kind === 'scalar' ? encodeRead(slotIndex) : encodeHeapRead(slotIndex);

export const encodeStoreByKind = (
  currentBytes: Uint8Array,
  slotIndex: number,
  valueBytes: Uint8Array,
  kind: VariableKind,
): Uint8Array =>
  kind === 'scalar'
    ? encodeStore(currentBytes, slotIndex, valueBytes)
    : encodeHeapStore(currentBytes, slotIndex, valueBytes);
