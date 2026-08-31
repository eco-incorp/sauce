import { keccak256, toBytes } from 'viem';
function formatType(param) {
    if (param.type === 'tuple' || param.type === 'tuple[]') {
        const inner = (param.components ?? []).map(formatType).join(',');
        return param.type === 'tuple' ? `(${inner})` : `(${inner})[]`;
    }
    return param.type;
}
function computeSelector(fn) {
    const sig = `${fn.name}(${fn.inputs.map(formatType).join(',')})`;
    const hash = keccak256(toBytes(sig));
    return hash.slice(0, 10); // "0x" + 4 bytes
}
export function parseAbiMethods(abi) {
    const methods = new Map();
    for (const item of abi) {
        if (item.type !== 'function')
            continue;
        const fn = item;
        methods.set(fn.name, {
            name: fn.name,
            selector: computeSelector(fn),
            inputs: fn.inputs,
            outputs: fn.outputs,
            stateMutability: fn.stateMutability ?? 'nonpayable',
        });
    }
    return methods;
}
export function hexToBytes(hex) {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(h.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
