/**
 * SAUCE SWEEP PROGRAM WIRE FORMAT v1 — `recipes/settle.sauce.ts` on engine target v12.
 *
 * `program := PROLOGUE || BODY`. Byte 0 is the first prologue byte — there is NO header, magic,
 * version byte, or length prefix.
 *
 * ```
 * program        := token_push{N} , TUPLE , arity , minout_push , recipient_push , body
 * token_push{N}  := N PUSHes (see wire.ts) carrying tokens REVERSED: tokens[N-1], …, tokens[0]
 * TUPLE          := 0x94              ; not a legal PUSH length (0x94 > 0x20) — the array terminator
 * arity          := one RAW byte, unsigned, MUST equal N
 * minout_push    := PUSH, uint256, value = minOut          (0 = floor disabled)
 * recipient_push := PUSH, uint160,  value = recipient      (MUST be nonzero)
 * body           := remaining bytes (must be non-empty); `keccak256(body)` is reported as
 *                    `bodyHash` for the caller to compare against, but this file pins no value
 * ```
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. The prologue grammar is independent of the body, so
 * decoding tells you which `(tokens, minOut, recipient)` a program carries and nothing more. It
 * cannot exclude an appended transfer, branch, or unbounded call after the prologue — a
 * prologue-shaped program may do anything in its body.
 *
 * "This is the program I audited" is answerable by recompiling the shipped source and byte-comparing,
 * but against ONE compiler: `@eco-incorp/sauce-sdk/compiler`, the TypeScript compiler this package
 * ships. It bakes the params into this prologue and leaves a body that is byte-identical for every
 * token count, minOut and recipient — so one `bodyHash` covers every argument set, which is what
 * makes the comparison meaningful. Neither half holds for the published RUST compiler: it folds each
 * value at its use site, which puts the arguments INSIDE the body (measured: `minOut` at byte 48,
 * `recipient` at 104) and leaves no prologue at all, so this decoder refuses its output outright.
 *
 * This decoder therefore describes the `/compiler` wire format. `SETTLE_VECTORS` are its committed
 * golden bytes and the conformance corpus; `test/verify.compile.test.ts` recompiles them on every
 * run, so the grammar below and the compiler that emits it cannot drift apart silently.
 *
 * THIS decoder is CANONICAL/STRICT: unlike the recipes package's original in-repo decoder (which
 * predates this package and accepted three malformed shapes — see the `SettleFailureCode` docs
 * below), every PUSH is required to be minimal-length, token/recipient pushes are capped at 20
 * bytes, and a zero recipient is rejected. A program this decoder accepts is the UNIQUE byte
 * encoding of its `(tokens, minOut, recipient)` — which is exactly what makes §5 (re-encode and
 * compare, `encodeSettleProgram`) an equivalent, cheaper alternative to this scan.
 */
import { keccak256, type Hex } from "viem";
/** Stable failure codes — safe to `switch` on. Every one of these is a REAL rejection this
 *  decoder makes; `NON_MINIMAL_PUSH`, `OVERSIZE_ADDRESS`, and `ZERO_RECIPIENT` are the three
 *  gaps the recipes package's original decoder did NOT check (all three independently confirmed
 *  to validate `ok:true` against it). */
export type SettleFailureCode = "EMPTY" | "TRUNCATED_PUSH" | "NON_MINIMAL_PUSH" | "OVERSIZE_ADDRESS" | "NOT_SETTLE_SHAPED" | "ARITY_MISMATCH" | "TRUNCATED_MINOUT" | "TRUNCATED_RECIPIENT" | "ZERO_RECIPIENT" | "BODY_LENGTH";
export declare class SettleDecodeError extends Error {
    readonly code: SettleFailureCode;
    constructor(code: SettleFailureCode, message: string);
}
export interface DecodedSettleProgram {
    /** The swept token list, in wire order (index 0 is the FLOOR token). */
    tokens: Address20[];
    minOut: bigint;
    recipient: Address20;
    /** `tokens[0]` — the floor token, named for readability at call sites. */
    floorToken: Address20;
    /** The constant suffix — everything after the (tokens, minOut, recipient) prologue. */
    body: Hex;
    bodyHash: Hex;
    /** Byte length of the prologue (0 .. body offset). */
    prologueSize: number;
    bodySize: number;
    programSize: number;
}
/** A 20-byte address rendered as lowercase 0x-hex — deliberately NOT `viem`'s `Address` branded
 *  type: a decoded word is not proven to be a valid address until it is range-checked (which this
 *  decoder does — `OVERSIZE_ADDRESS`), and callers that want an EIP-55 checksum should
 *  `getAddress()` it themselves. */
export type Address20 = `0x${string}`;
/** Internal parse result — used by both the throwing `decodeSettleProgram` and the
 *  non-throwing `bestEffortDecode`, which keeps partial state past a failure. */
export interface SettleParse {
    bytes: Uint8Array;
    /** Leading token pushes, in WIRE order (forward, not yet reversed) — empty if the very first
     *  byte wasn't a push. */
    tokenPushes: {
        value: bigint;
        offset: number;
        width: number;
    }[];
    /** First hard failure encountered scanning the leading token-push run, if any. */
    tokenScanError: {
        code: SettleFailureCode;
        offset: number;
        message: string;
    } | null;
    tupleOffset: number | null;
    tupleOk: boolean;
    arityOffset: number | null;
    arityByte: number | null;
    arityOk: boolean;
    minOutPush: {
        value: bigint;
        offset: number;
        width: number;
    } | null;
    minOutError: {
        code: SettleFailureCode;
        offset: number;
        message: string;
    } | null;
    recipientPush: {
        value: bigint;
        offset: number;
        width: number;
    } | null;
    recipientError: {
        code: SettleFailureCode;
        offset: number;
        message: string;
    } | null;
    recipientNonZero: boolean;
    bodyOffset: number | null;
    body: Uint8Array | null;
    bodyHash: Hex | null;
    /** The first fatal failure, in scan order — null iff the prologue is fully well-formed. */
    fatal: {
        code: SettleFailureCode;
        message: string;
    } | null;
}
/** Best-effort single left-to-right pass — never throws. This is the shared engine both
 *  `decodeSettleProgram` (throws on `parse.fatal`) and `bestEffortDecode` (keeps
 *  whatever DID parse even when a later stage failed) run on top of. */
export declare function parseSettleProgram(program: Hex): SettleParse;
/** Decode whenever the shape is well-formed enough to name a full `(tokens, minOut, recipient)`
 *  — even when a later, non-structural check (a nonzero-but-wrong-length body, a zero recipient)
 *  would make `decodeSettleProgram` throw — so a rejected program's decoded intent is still
 *  visible to a caller debugging the rejection. */
export declare function bestEffortDecode(parse: SettleParse): DecodedSettleProgram | null;
/**
 * Decode a settle-shaped program back into `(tokens, minOut, recipient)`. STRICT: rejects a
 * non-minimal-length push, an oversize (>20 byte) token/recipient word, and a zero recipient —
 * see this module's docstring for why. Throws `SettleDecodeError` (carrying a stable `.code`) on
 * any of the failures in `SettleFailureCode`.
 *
 * This is a STRUCTURAL decode only — it proves the program STARTS with the sweep shape and has a
 * non-empty suffix. It does NOT prove that suffix is a program you audited: compile the source and
 * byte-compare for that (`@eco-incorp/sauce-sdk/recipes`), and compare `decoded.bodyHash` against
 * the body you get, before treating the decoded values as "this is my sweep program".
 */
export declare function decodeSettleProgram(program: Hex): DecodedSettleProgram;
/**
 * §5 of the wire spec — the cheaper, EQUIVALENT alternative to scan-and-check: when the caller
 * already knows the intended `(tokens, minOut, recipient)` (the normal case — they asked for the
 * swap), encode it directly and `memcmp`/hash-compare the whole program rather than decoding.
 * Given the minimality rule this produces the UNIQUE canonical encoding, so
 * `encodeSettleProgram(...) === program` is exactly equivalent to
 * `decodeSettleProgram(program)` succeeding with those values AND the body matching the pinned
 * hash — in one comparison, with no parser exposed to a hostile input at all. This is the
 * recommended non-TypeScript (Solidity/Go/Python) implementation — see `onChainVerdict` guidance
 * in this package's docs for why an on-chain form should implement §5, not §4.
 *
 * `bodyHex` is supplied by the caller — pass the body of a program you compiled yourself (there is
 * no pinned table here to default to, deliberately: the body you compare against should be one you
 * derived, not one shipped alongside the claim).
 */
export declare function encodeSettleProgram(tokens: readonly (bigint | `0x${string}`)[], minOut: bigint, recipient: bigint | `0x${string}`, bodyHex: Hex): Hex;
export { keccak256 };
//# sourceMappingURL=decode.d.ts.map