const ZERO_HEX32 = ("0x" + "00".repeat(32));
const HEX_RE = /^0x[0-9a-fA-F]*$/;
/**
 * Coerces an address into the eco-routes 32-byte `UniversalAddress` format:
 * a 20-byte EVM address is left-padded to 32 bytes; an already-32-byte value
 * passes through unchanged. Anything else throws.
 */
export function toUniversalAddress(input) {
    if (typeof input !== "string" || !HEX_RE.test(input)) {
        throw new Error(`Invalid address: expected 0x-hex, got ${String(input)}`);
    }
    const body = input.slice(2);
    if (body.length % 2 !== 0) {
        throw new Error(`Invalid address: odd hex length '${input}'`);
    }
    const byteLength = body.length / 2;
    if (byteLength === 32) {
        return input.toLowerCase();
    }
    if (byteLength === 20) {
        return (("0x" + "00".repeat(12) + body).toLowerCase());
    }
    throw new Error(`Invalid address: expected 20 or 32 bytes, got ${byteLength} bytes ('${input}')`);
}
/** Accepts `bigint | number | string`; rejects negative or non-integer values. */
export function toBigInt(value) {
    if (typeof value === "bigint") {
        if (value < 0n)
            throw new Error(`Expected a non-negative bigint, got ${value}`);
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`Expected a non-negative integer number, got ${value}`);
        }
        return BigInt(value);
    }
    if (typeof value === "string") {
        if (!/^-?\d+$/.test(value)) {
            throw new Error(`Expected an integer string, got '${value}'`);
        }
        const parsed = BigInt(value);
        if (parsed < 0n)
            throw new Error(`Expected a non-negative value, got '${value}'`);
        return parsed;
    }
    throw new Error(`Expected bigint | number | string, got ${typeof value}`);
}
function normalizeTokenAmount(input) {
    return {
        token: toUniversalAddress(input.token),
        amount: toBigInt(input.amount),
    };
}
function normalizeCall(input) {
    return {
        target: toUniversalAddress(input.target),
        data: input.data,
        value: input.value === undefined ? 0n : toBigInt(input.value),
    };
}
export function normalizeRoute(input) {
    return {
        salt: input.salt ?? ZERO_HEX32,
        deadline: toBigInt(input.deadline),
        portal: toUniversalAddress(input.portal),
        nativeAmount: input.nativeAmount === undefined ? 0n : toBigInt(input.nativeAmount),
        tokens: (input.tokens ?? []).map(normalizeTokenAmount),
        calls: (input.calls ?? []).map(normalizeCall),
    };
}
export function normalizeReward(input) {
    return {
        deadline: toBigInt(input.deadline),
        creator: toUniversalAddress(input.creator),
        prover: toUniversalAddress(input.prover),
        nativeAmount: input.nativeAmount === undefined ? 0n : toBigInt(input.nativeAmount),
        tokens: (input.tokens ?? []).map(normalizeTokenAmount),
    };
}
/**
 * The empty route synthesized for a TERMINAL `.<DestChain>()` close: `salt`
 * and `portal` stay zero (finalization's job — E3.2/E3.3), `deadline`
 * inherits the leg's own reward deadline so the shape isn't structurally
 * expired on arrival, and `tokens`/`calls` are empty. A valid SHAPE, not a
 * submittable intent.
 */
export function emptyRoute(deadline) {
    return {
        salt: ZERO_HEX32,
        deadline,
        portal: ZERO_HEX32,
        nativeAmount: 0n,
        tokens: [],
        calls: [],
    };
}
//# sourceMappingURL=normalize.js.map