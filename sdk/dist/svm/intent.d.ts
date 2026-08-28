import type { Address } from '@solana/kit';
import { type SvmSettleExecutionVerification } from './verify.js';
/** One attached account, as the Portal `SerializableAccountMeta` struct serializes it. */
export interface PortalAccountMeta {
    pubkey: Address;
    isSigner: boolean;
    isWritable: boolean;
}
/** The decoded Portal `CalldataWithAccounts` envelope: the wrapped CPI instruction data and its accounts. */
export interface PortalCalldataWithAccounts {
    /** The wrapped instruction data — for a Sauce call, the `execute_from_account` payload. */
    instructionData: Uint8Array;
    /** The `account_count` the envelope declares (Portal's own count of the wrapped accounts). */
    accountCount: number;
    /** The attached account metas, in order. */
    accounts: PortalAccountMeta[];
}
/** `Uint8Array` as-is; a `0x`-prefixed hex string (the viem `Hex` form `route.calls[].data` uses); or a
 *  base64 string (the Solana convention) for anything not 0x-prefixed. */
export type BytesInput = Uint8Array | string;
/**
 * Decodes a Portal `CalldataWithAccounts` envelope (the form of every SVM `route.calls[].data`) into the
 * wrapped instruction data and its account list. Accepts the envelope as raw bytes, `0x`-hex (the viem
 * `Hex` a call carries), or base64. Throws on a truncated / malformed envelope.
 */
export declare function decodePortalCalldataWithAccounts(data: BytesInput): PortalCalldataWithAccounts;
/** Input to {@link encodePortalCalldataWithAccounts} — the mirror of {@link PortalCalldataWithAccounts}. */
export interface PortalCalldataWithAccountsInput {
    /** The wrapped instruction data — for a Sauce call, the `execute_from_account` payload. */
    instructionData: Uint8Array;
    /** The attached account metas, in order. */
    accounts: readonly PortalAccountMeta[];
    /** The envelope's own `account_count` field. Defaults to `accounts.length` — see the decoder's own
     *  comment on why this is not asserted equal to `accounts.length` here either; a caller with a
     *  different convention (e.g. excluding a leading buffer account) can override it explicitly. */
    accountCount?: number;
}
/**
 * Encodes a Portal `CalldataWithAccounts` envelope — the exact inverse of
 * {@link decodePortalCalldataWithAccounts}, sharing its codec byte-for-byte (both are built from the
 * same field list above), so encoder and decoder cannot drift apart. This is what a route `Call.data`
 * for a staged SVM Sauce execution looks like on the wire.
 */
export declare function encodePortalCalldataWithAccounts(input: PortalCalldataWithAccountsInput): `0x${string}`;
/** An intent call, duck-typed to the one field this reads. Matches eco-solver's `Call` / persisted
 *  `IntentCall` (both carry `data` as viem `Hex`). */
export interface SvmIntentCallLike {
    data: BytesInput;
}
/** An intent, duck-typed to just the SVM route calls this reads. */
export interface SvmIntentLike {
    route: {
        calls: readonly SvmIntentCallLike[];
    };
}
export interface ExtractSvmSettleOptions {
    /** OPTIONAL. The staged settle bytecode (`sauceStage.buffers[settleIdx].bytecode`), as bytes / base64 /
     *  0x-hex. When supplied, genuineness is proven by a full byte-match; when omitted, it is still proven
     *  via the calldata pin vs the SDK's own recompiled canonical settle (a partner needs no bytecode). */
    bytecode?: BytesInput;
}
/** The extracted settle for a call: the full `verifySvmSettleExecution` verdict (args, resolved accounts,
 *  and the `genuine` / `verifiedBy` genuineness fields), extended with the call's index. */
export type ExtractedSvmSettle = SvmSettleExecutionVerification & {
    /** Index of the `route.calls[]` entry the genuine settle execution was found in. */
    callIndex: number;
};
/**
 * Scans SVM intent calls and returns the first call that is a GENUINE settle execution — the SVM twin of
 * `extractEvmSettleFromCalls`. Each call is a Portal envelope; the settle is found by VERIFYING it
 * (`verifySvmSettleExecution`), not by shape: the calldata pin must equal `sha256` of the SDK's own
 * recompiled canonical settle (or the supplied `bytecode` must byte-match it). A shape-only lookalike or
 * an adversarial decoy is REJECTED — the scan keeps going and never returns a non-genuine call — so this
 * cannot be tricked into reporting attacker-chosen params. Returns `null` if no call is a genuine settle.
 *
 * (To inspect a call's raw structural params without a genuineness proof — e.g. a decoy's claimed values —
 * decode the envelope with `decodePortalCalldataWithAccounts` and call `decodeSvmSettleExecution` directly.)
 */
export declare function extractSvmSettleFromCalls(calls: readonly SvmIntentCallLike[], options?: ExtractSvmSettleOptions): ExtractedSvmSettle | null;
/**
 * Extracts the GENUINE SVM settle params + resolved account identities from an intent object — the thin
 * intent-level wrapper over `extractSvmSettleFromCalls`, and the SVM twin of `extractEvmSettleFromIntent`.
 * Duck-typed on `{ route: { calls } }`, so it takes an eco-solver `Intent` (runtime or persisted) as-is.
 * Genuineness is proven from the intent alone (recompile + pin); pass `options.bytecode` (from the
 * intent's `fulfillmentMetadata.svm.sauceStage`) for the additional full byte-match. `null` if the intent
 * carries no genuine settle execution.
 */
export declare function extractSvmSettleFromIntent(intent: SvmIntentLike, options?: ExtractSvmSettleOptions): ExtractedSvmSettle | null;
//# sourceMappingURL=intent.d.ts.map