import { OPS } from './ops.js';
export const encodeRead = (slotIndex) => new Uint8Array([OPS.READ_VALUE, slotIndex]);
export const encodeStore = (currentBytes, slotIndex, valueBytes) => new Uint8Array([...currentBytes, OPS.WRITE_VALUE, slotIndex, ...valueBytes]);
export const encodeHeapRead = (slotIndex) => new Uint8Array([OPS.READ_HEAP, slotIndex]);
export const encodeHeapStore = (currentBytes, slotIndex, valueBytes) => new Uint8Array([...currentBytes, OPS.WRITE_HEAP, slotIndex, ...valueBytes]);
export const encodeReadByKind = (slotIndex, kind) => kind === 'scalar' ? encodeRead(slotIndex) : encodeHeapRead(slotIndex);
export const encodeStoreByKind = (currentBytes, slotIndex, valueBytes, kind) => kind === 'scalar'
    ? encodeStore(currentBytes, slotIndex, valueBytes)
    : encodeHeapStore(currentBytes, slotIndex, valueBytes);
