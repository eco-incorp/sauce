import { OPS } from './ops.js';
const MAX_LENGTH = 0xff;
export const encodeTuple = (elements) => {
    if (elements.length > MAX_LENGTH)
        throw new Error(`tuple too large: ${elements.length} exceeds ${MAX_LENGTH}`);
    return new Uint8Array([OPS.TUPLE, elements.length, ...elements.flatMap((e) => Array.from(e._bytes))]);
};
