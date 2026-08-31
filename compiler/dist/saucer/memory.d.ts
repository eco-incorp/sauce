import type { VariableKind } from '../context.js';
export declare const encodeRead: (slotIndex: number) => Uint8Array;
export declare const encodeStore: (currentBytes: Uint8Array, slotIndex: number, valueBytes: Uint8Array) => Uint8Array;
export declare const encodeHeapRead: (slotIndex: number) => Uint8Array;
export declare const encodeHeapStore: (currentBytes: Uint8Array, slotIndex: number, valueBytes: Uint8Array) => Uint8Array;
export declare const encodeReadByKind: (slotIndex: number, kind: VariableKind) => Uint8Array;
export declare const encodeStoreByKind: (currentBytes: Uint8Array, slotIndex: number, valueBytes: Uint8Array, kind: VariableKind) => Uint8Array;
//# sourceMappingURL=memory.d.ts.map