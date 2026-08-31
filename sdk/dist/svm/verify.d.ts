import type { Address } from '@solana/kit';
export { decodePortalCalldataWithAccounts, encodePortalCalldataWithAccounts, extractSvmSettleFromCalls, extractSvmSettleFromIntent, type PortalAccountMeta, type PortalCalldataWithAccounts, type PortalCalldataWithAccountsInput, type BytesInput, type SvmIntentCallLike, type SvmIntentLike, type ExtractSvmSettleOptions, type ExtractedSvmSettle, } from './intent.js';
/**
 * The values a settle program was compiled with. Both are folded into the bytecode, so they are what
 * a recompile pins: naming them is how a caller says "prove the program enforces THIS floor and THIS
 * split", rather than reading them back out of an execution and trusting them.
 */
export interface SvmSettleExpectation {
    /** The floor applied to escrow 0 (0 disables the floor). */
    minOut: bigint;
    /** Escrows i < splCount sweep via tokenProgram0, the rest via tokenProgram1. */
    splCount: bigint;
}
/** Just enough of an account manifest to count and name its slots. */
export interface SettleManifestLike {
    accounts: readonly {
        kind: string;
        name?: string;
    }[];
}
export interface SvmSettleVerification {
    /** True iff the bytecode byte-matches svmSettleSource(escrowCount) AND the plan's refs match svmSettleRefs. */
    genuine: boolean;
    /** The inferred escrow count, or null when the account plan does not fit any settle shape. */
    escrowCount: number | null;
    /** The canonical ref order for `escrowCount` (svmSettleRefs) — empty when escrowCount is null. */
    refs: string[];
    /** Present iff not genuine: what failed (unrecognized shape / bytecode mismatch / ref mismatch). */
    mismatch?: string;
}
/**
 * Verifies a compiled SVM settle program is genuine AND enforces `expected` — the SVM analogue of the
 * EVM check, done by recompile. It:
 *   1. takes the escrow count N (or infers it from the manifest's `3N + 3` slots),
 *   2. recompiles `svmSettleSource(N)` with `expected` as defines, and
 *   3. byte-compares the result, and asserts the manifest's slot names equal `svmSettleRefs(N)`.
 *
 * A genuine result means the bytecode IS the reusable settle logic for N escrows, compiled for
 * exactly this floor and this split — all three are the same bytes, so one comparison pins them all.
 * The resolved account identities (from the executed instruction) remain the caller's own check.
 * Never throws for a non-genuine program; returns `{ genuine: false, mismatch }`.
 */
export declare function verifySvmSettleProgram(bytecode: Uint8Array, manifest: SettleManifestLike, expected: SvmSettleExpectation): SvmSettleVerification;
/** The execute payload grammar: `[disc:8][flags:1][pin:32 iff 0x01][slice:8 iff 0x02][args…]`. */
export interface ParsedExecutePayload {
    /** Which staged execute instruction the discriminator names. */
    instruction: 'execute_from_account' | 'execute_and_close';
    /** The 32-byte content-hash pin, iff the flags byte set HAS_PIN. */
    pin?: Uint8Array;
    /** The explicit foreign-path bytecode slice, iff the flags byte set HAS_SLICE. */
    slice?: {
        offset: number;
        len: number;
    };
    /** The args tail — everything after the flags/pin/slice header. */
    args: Uint8Array;
}
/**
 * Parses the shared `execute_from_account` / `execute_and_close` instruction data into its
 * `[disc][flags][pin?][slice?][args]` parts. Throws on a non-staged-execute discriminator (an inline
 * `execute` payload carries BYTECODE, not an args tail — a different grammar), a missing flags byte, or
 * a header that runs past the end of the buffer. The exact inverse of `encodeExecutePayload`
 * (instructions.ts).
 */
export declare function parseExecutePayload(instructionData: Uint8Array): ParsedExecutePayload;
/** An account entry as either the base58 address itself or an object carrying it (the recipes split
 *  response uses `{ pubkey, isSigner, isWritable, ref }`; a resolved instruction meta uses `{ address }`). */
export type SvmSettleAccountLike = string | {
    address?: string;
    pubkey?: string;
    ref?: string;
};
export interface SvmSettleExecutionInput {
    /**
     * The full `execute_from_account` / `execute_and_close` instruction data
     * (`[disc][flags][pin?][slice?]`, and no args tail — a settle's params are defines folded into the
     * bytecode). From the recipes split response this is base64-decode(`execution.instructionData`);
     * from an executed instruction it is the raw ix data.
     */
    instructionData: Uint8Array;
    /**
     * The instruction's account list — EITHER the user tail alone (`3N+3`, the recipes
     * `execution.accounts[]`) OR the full list with the leading buffer (`3N+4`, a raw instruction). The
     * leading buffer is detected by length and stripped; each entry is a base58 address or an object
     * with `.address`/`.pubkey`.
     */
    accounts: readonly SvmSettleAccountLike[];
}
export interface DecodedSvmSettleExecution {
    /** Which staged execute instruction the calldata is. */
    instruction: 'execute_from_account' | 'execute_and_close';
    /** The 32-byte content-hash pin the calldata carried, if any (commits to the staged bytecode). */
    pin?: Uint8Array;
    /** The explicit bytecode slice the calldata carried, if any (foreign path only). */
    slice?: {
        offset: number;
        len: number;
    };
    /** The escrow count inferred from the account-list length. */
    escrowCount: number;
    /** The canonical ref order for `escrowCount` — `svmSettleRefs(escrowCount)`. */
    refs: string[];
    /** Each settle account ref → the pubkey attached at that slot, positionally against `refs`. */
    accounts: Record<string, Address>;
    /** True iff a leading bytecode-buffer account was detected in `accounts` and skipped. */
    hadBufferAccount: boolean;
    /** Whether the provided account labels matched the canonical refs, or null if entries carried no
     *  `ref` (a bare address list). Identities are resolved positionally regardless — this only reports
     *  whether a caller-supplied label agreed with the slot it landed in. */
    labeledRefsConsistent: boolean | null;
}
/**
 * Decodes a full settle execution — the calldata AND the account list — into its staged-execute header
 * and resolved account identities in one call. It parses the execute payload grammar off
 * `instructionData`, infers the escrow count from the account-list length, and resolves each
 * `svmSettleRefs(N)` slot to the attached pubkey. Consumes the sauce-recipes `split=1` settle sauce
 * (`execution.instructionData` + `execution.accounts[]`) directly, and equally an executed engine
 * instruction (full data + `[buffer, …user]` account list).
 *
 * `minOut`/`splCount` are NOT among the results, and cannot be: they are defines folded into the
 * bytecode, so no amount of reading the calldata recovers them. `verifySvmSettleExecution` establishes
 * them the only way available — by recompiling with the values a caller expects and byte-comparing.
 *
 * What IS here is not trusted either: the header comes from the raw calldata (not from a receipt), and
 * the account identities are resolved positionally against the canonical refs, never from
 * caller-supplied labels — `labeledRefsConsistent` only reports whether a label the caller happened to
 * attach agreed with the slot it landed in.
 *
 * IMPORTANT — this is a STRUCTURAL decode, NOT a genuineness proof. Unlike the EVM `decodeSettleProgram`
 * (whose prologue grammar is a settle-specific signature), a staged settle's calldata carries no
 * structural signature at all: any staged Sauce execute with a `3N+3`/`3N+4` account count has this
 * exact shape. So a non-settle execution (or an adversarial decoy) decodes here without error into any
 * staged program at all. To prove the execution actually runs the genuine settle program, use
 * `verifySvmSettleExecution` (or `extractSvmSettleFromIntent`), which ties the calldata to the SDK's
 * own recompiled canonical settle bytecode.
 */
export declare function decodeSvmSettleExecution(input: SvmSettleExecutionInput): DecodedSvmSettleExecution;
export interface SvmSettleExecutionVerifyInput extends SvmSettleExecutionInput, SvmSettleExpectation {
    /**
     * OPTIONAL. The compiled settle bytecode this execution runs (from the recipes split response this is
     * base64-decode(`sauces[settleIdx].program.bytecode`); from an eco-solver intent it is
     * base64-decode(`fulfillmentMetadata.svm.sauceStage.buffers[settleIdx].bytecode`)). When supplied, the
     * actual staged bytes are byte-compared to the canonical settle and tied to the pin.
     *
     * A partner usually does NOT have this (only the on-chain `route.calls`), and does not need it: the SDK
     * recompiles the canonical settle itself and proves genuineness via the calldata pin (see below).
     */
    bytecode?: Uint8Array;
}
/** How genuineness was established. `bytecode`: the supplied bytes byte-match the canonical settle (and
 *  tie to the pin). `pin`: no bytecode, but the calldata pin equals `sha256(canonical settle)` — proof
 *  that the program committed by this calldata IS the genuine settle (or the on-chain execution reverts
 *  on the pin gate; it can never run a different program). `none`: no pin and no bytecode — genuineness
 *  cannot be established from structure alone, so `genuine` is false. */
export type SvmSettleVerifiedBy = 'bytecode' | 'pin' | 'none';
export interface SvmSettleExecutionVerification extends DecodedSvmSettleExecution {
    /** True iff the execution provably runs the genuine `svmSettleSource(escrowCount)` program. */
    genuine: boolean;
    /** How `genuine` was established (or why it could not be). */
    verifiedBy: SvmSettleVerifiedBy;
    /** `sha256(canonical recompiled settle)` === the calldata pin. null iff the calldata carried no pin. */
    pinMatchesCanonical: boolean | null;
    /** Only when `bytecode` was supplied: `sha256(bytecode)` === the calldata pin. null otherwise. */
    pinMatchesBytecode: boolean | null;
    /** Only when `bytecode` was supplied: the bytes byte-match the canonical settle. null otherwise. */
    bytecodeMatchesCanonical: boolean | null;
    /** Present iff not genuine: what failed. */
    mismatch?: string;
}
/**
 * The genuineness check for a settle execution — the crucial companion to `decodeSvmSettleExecution`,
 * whose structural decode alone CANNOT tell a settle from any other staged Sauce execute (an account
 * count is not a signature). This ties the calldata to the SDK's own recompiled canonical settle
 * bytecode, in one of two ways, no partner bytecode required for either verdict:
 *
 *   - `bytecode` supplied → byte-compare it to `compileCanonicalSettle(escrowCount)` AND check the pin
 *     ties to it (`sha256(bytecode) === pin`). Proves the exact staged bytes ARE the settle and WILL run.
 *   - no bytecode, but the calldata carries a pin → check `pin === sha256(canonical settle)`. The pin is
 *     the buffer's content hash the engine enforces on-chain, so a match proves the committed program is
 *     the genuine settle (or the execution reverts on the pin gate) — a decoy's pin cannot match.
 *   - neither → `genuine: false`, `verifiedBy: 'none'` (structure alone is not proof).
 *
 * Because `minOut`/`splCount` are folded into the bytecode, a `genuine` result also proves the program
 * enforces the `minOut`/`splCount` passed in — leaving only the resolved account identities for the
 * caller to check. Never throws beyond the shared structural decode; reports failures in `mismatch`.
 */
export declare function verifySvmSettleExecution(input: SvmSettleExecutionVerifyInput): SvmSettleExecutionVerification;
//# sourceMappingURL=verify.d.ts.map