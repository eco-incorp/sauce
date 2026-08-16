import type { Address } from '@solana/kit';
import type { ArgsLayout } from '@eco-incorp/sauce-compiler';
export { decodePortalCalldataWithAccounts, encodePortalCalldataWithAccounts, extractSvmSettleFromCalls, extractSvmSettleFromIntent, type PortalAccountMeta, type PortalCalldataWithAccounts, type PortalCalldataWithAccountsInput, type BytesInput, type SvmIntentCallLike, type SvmIntentLike, type ExtractSvmSettleOptions, type ExtractedSvmSettle, } from './intent.js';
export interface DecodedSvmSettleArgs {
    /** The floor applied to escrow 0 (0 disables the floor). */
    minOut: bigint;
    /** Escrows i < splCount sweep via tokenProgram0, the rest via tokenProgram1. */
    splCount: bigint;
    tokenProgram0: Address;
    tokenProgram1: Address;
}
/** Byte length of the settle args tail: 4 scalar slots × 32 bytes. */
export declare const SVM_SETTLE_ARGS_BYTES: number;
/**
 * Decodes the settle program's per-execution args from the CALLDATA tail — the exact inverse of the
 * SDK's `encodePayloadArgs` for `main(minOut, splCount, tokenProgram0, tokenProgram1)` (four 32-byte
 * big-endian scalar slots). Pass the ARGS bytes only (strip the execute payload's flags byte + any
 * hash pin / slice first). `argsLayout` is optional: when supplied it is checked to be the settle
 * shape; the decode itself uses the fixed 0/32/64/96 offsets either way.
 *
 * A token-program slot is a 32-byte pubkey; minOut/splCount are big-endian scalars. Nothing about
 * these values is trusted — a caller compares them against what it expects, exactly as with the EVM
 * decoder.
 */
export declare function decodeSvmSettleArgs(payloadArgs: Uint8Array, argsLayout?: ArgsLayout): DecodedSvmSettleArgs;
export interface AccountPlanLike {
    metas: readonly {
        ref: string;
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
 * Verifies a compiled SVM settle program is genuine — the SVM analogue of the EVM decoder's body-hash
 * check, done by recompile rather than prologue-decode (the staged blob has no prologue). It:
 *   1. infers the escrow count N from the account plan's ref count (3N + 3),
 *   2. recompiles `svmSettleSource(N)` with the exact shipped options (`target: svm, staged, treeshake`;
 *      placeholder args, whose VALUES cannot affect a staged blob), and
 *   3. byte-compares the blob AND asserts the plan's refs equal `svmSettleRefs(N)`.
 *
 * A genuine result means the bytecode IS the reusable settle logic for N escrows and the account slots
 * are the ones that logic addresses — the params (from `decodeSvmSettleArgs`) and the resolved account
 * identities (from the executed instruction) are then checkable against expectation. Never throws for a
 * non-genuine program; returns `{ genuine: false, mismatch }`.
 */
export declare function verifySvmSettleProgram(bytecode: Uint8Array, accountPlan: AccountPlanLike): SvmSettleVerification;
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
     * (`[disc][flags][pin?][slice?][args:128]`). From the recipes split response this is
     * base64-decode(`execution.instructionData`); from an executed instruction it is the raw ix data.
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
    /** The decoded per-execution args `(minOut, splCount, tokenProgram0, tokenProgram1)`. */
    args: DecodedSvmSettleArgs;
    /** The escrow count inferred from the account-list length. */
    escrowCount: number;
    /** The canonical ref order for `escrowCount` — `svmSettleRefs(escrowCount)`. */
    refs: string[];
    /** Each settle account ref → the pubkey attached at that slot, positionally against `refs`. */
    accounts: Record<string, Address>;
    /** True iff a leading bytecode-buffer account was detected in `accounts` and skipped. */
    hadBufferAccount: boolean;
    /** True iff `args.tokenProgram0/1` (calldata) equal the `tokenProgram0/1` accounts (account list) —
     *  the settle recipe binds each from ONE value, so a mismatch is a malformed/adversarial program. */
    tokenProgramsConsistent: boolean;
    /** Whether the provided account labels matched the canonical refs, or null if entries carried no
     *  `ref` (a bare address list). Identities are resolved positionally regardless — this only reports
     *  whether a caller-supplied label agreed with the slot it landed in. */
    labeledRefsConsistent: boolean | null;
}
/**
 * Decodes a full settle execution — the calldata AND the account list — into its params and resolved
 * account identities in one call. It parses the execute payload grammar off `instructionData`, decodes
 * the four settle args from the tail, infers the escrow count from the account-list length, and resolves
 * each `svmSettleRefs(N)` slot to the attached pubkey. Consumes the sauce-recipes `split=1` settle sauce
 * (`execution.instructionData` + `execution.accounts[]`) directly, and equally an executed engine
 * instruction (full data + `[buffer, …user]` account list).
 *
 * Nothing is trusted: the args are re-derived from the raw calldata (not read from a receipt), the
 * account identities are resolved positionally against the canonical refs (not from caller-supplied
 * labels), and `tokenProgramsConsistent` cross-checks the two independent bindings of each token program
 * — exactly the "decode from the bytes, then compare against expectation" contract of the EVM decoder.
 *
 * IMPORTANT — this is a STRUCTURAL decode, NOT a genuineness proof. Unlike the EVM `decodeSettleProgram`
 * (whose prologue grammar is a settle-specific signature), a STAGED settle's args carry no structural
 * signature: any staged Sauce execute with a 128-byte args tail and a `3N+3`/`3N+4` account count has
 * this exact shape. So a non-settle execution (or an adversarial decoy) decodes here without error into
 * arbitrary `(minOut, splCount, …)`. To prove the execution actually runs the genuine settle program,
 * use `verifySvmSettleExecution` (or `extractSvmSettleFromIntent`), which ties the calldata to the SDK's
 * own recompiled canonical settle bytecode.
 */
export declare function decodeSvmSettleExecution(input: SvmSettleExecutionInput): DecodedSvmSettleExecution;
export interface SvmSettleExecutionVerifyInput extends SvmSettleExecutionInput {
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
 * whose structural decode alone CANNOT tell a settle from any other staged Sauce execute (staged args
 * carry no signature). This ties the calldata to the SDK's own recompiled canonical settle bytecode, in
 * one of two ways, no partner bytecode required for either verdict:
 *
 *   - `bytecode` supplied → byte-compare it to `compileCanonicalSettle(escrowCount)` AND check the pin
 *     ties to it (`sha256(bytecode) === pin`). Proves the exact staged bytes ARE the settle and WILL run.
 *   - no bytecode, but the calldata carries a pin → check `pin === sha256(canonical settle)`. The pin is
 *     the buffer's content hash the engine enforces on-chain, so a match proves the committed program is
 *     the genuine settle (or the execution reverts on the pin gate) — a decoy's pin cannot match.
 *   - neither → `genuine: false`, `verifiedBy: 'none'` (structure alone is not proof).
 *
 * A `genuine` result leaves only `(minOut, splCount, tokenPrograms)` + the resolved account identities to
 * check against expectation. Never throws beyond the shared structural decode; reports failures in
 * `mismatch`.
 */
export declare function verifySvmSettleExecution(input: SvmSettleExecutionVerifyInput): SvmSettleExecutionVerification;
//# sourceMappingURL=verify.d.ts.map