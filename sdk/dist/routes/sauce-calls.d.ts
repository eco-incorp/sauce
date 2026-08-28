import type { Address } from "@solana/kit";
import { type Hex } from "viem";
import { type V12Deployment } from "../deployments/index.js";
import { buildStagingPlan, type ExecuteBytecodeSlice } from "../svm/instructions.js";
import { type ChainKindRef } from "./encode.js";
import type { AddressInput, CallInput } from "./types.js";
/** Verbatim re-export — sizing advice only, emits zero instructions. See the module doc above. */
export { buildStagingPlan as sauceSvmStagingPlan };
export interface SauceEvmCallParams {
    /** The Pot contract to `cook()` on — a per-owner CREATE2 address, always caller-supplied (never
     *  defaulted). Derive it with `v12Kitchen.encodePredictPot(owner, salt)` if you only know the
     *  owner + salt. */
    pot: AddressInput;
    /** Compiled Sauce bytecode blob(s) — `cook(bytes[] ingredients)`'s argument. */
    ingredients: readonly Hex[];
    value?: bigint | number | string;
}
/** One `cook(ingredients)` call on `pot`. `data` is produced by `v12Pot.encodeCook` — the exact
 *  E3.2-adjacent EVM engine encoder, not re-implemented here. */
export declare function buildSauceEvmCall(params: SauceEvmCallParams): CallInput;
export interface SauceEvmCallsParams {
    pot: AddressInput;
    /** One `cook()` per element, execution order preserved (e.g. the swap half then the settle half —
     *  the shape a Pot-based solver leg uses: two `cook()`s on the SAME Pot). */
    cooks: readonly (readonly Hex[])[];
    value?: bigint | number | string;
}
/** One `Call` per element of `cooks`, in the given order, all targeting the same `pot`. */
export declare function buildSauceEvmCalls(params: SauceEvmCallsParams): CallInput[];
export interface SauceEvmDeployPotCallParams {
    /** Bakes into the Pot's CREATE2 address; `cook()` on the resulting Pot is `onlyOwner`. */
    owner: AddressInput;
    salt: Hex;
    /** Overrides the Kitchen address. Defaults to `V12_EVM_CONTRACTS.v12Kitchen` (chain-invariant),
     *  or — if `chainId` is given instead — the deployment gated on that chain being LIVE. */
    kitchen?: AddressInput;
    /** When given (and `kitchen` is not), gates the default Kitchen address on `isV12Live(chainId)`
     *  via `requireV12Deployment` — so a call is never built against a chain with no deployment. */
    chainId?: number;
}
/** The leading `deployPot(owner, salt)` call a solver issues before its first `cook()` on a Pot
 *  that may not exist yet. */
export declare function sauceEvmDeployPotCall(params: SauceEvmDeployPotCallParams): CallInput;
/** Thin delegate to `requireV12Deployment` — throws with the reason when the v12 stack is not live
 *  on `chainId` (e.g. ronin/2020, whose deploy did not land). */
export declare function assertSauceEvmLive(chainId: number): V12Deployment;
/** A base58 string, a kit `Address`, or anything duck-typed like a web3.js `PublicKey` — see the
 *  module doc's "WHY THIS FILE ... NEVER `@solana/web3.js`" note. */
export type SvmAddressInput = string | Address | {
    toBase58(): string;
};
/** One account meta as the caller supplies it — pre-merge, pre-executor-flattening. */
export interface SauceSvmAccountMeta {
    pubkey: SvmAddressInput;
    isSigner: boolean;
    isWritable: boolean;
}
/**
 * A buffer this module did NOT stage — only the RESOLVED facts about it. Deliberately carries no
 * `bytecode`/`seed`/`authority`/`payer`: see the module doc's "SVM STAGING IS A PREREQUISITE"
 * section for why, and where those pieces actually come from.
 */
export interface StagedBufferRef {
    /** Buffer PDA address, already init'd + written + FINALIZED by the solver. */
    buffer: SvmAddressInput;
    /** Optional 32-byte content pin (e.g. `bytecodeSha256(bytecode)`), engine-verified against the
     *  buffer's stored hash. Always pass this for a buffer this process did not stage itself — it is
     *  the only cross-lifecycle trust anchor. Mutually exclusive in practice with `slice` (pin = the
     *  managed path; slice = the foreign path) — the underlying builder does not reject the
     *  combination outright, but only one is ever meaningful for a given buffer kind. */
    expectedSha256?: Uint8Array;
    /** Optional FOREIGN-path bytecode extent; omit for a managed engine buffer. */
    slice?: ExecuteBytecodeSlice;
    /** Per-execution payload args, already encoded. */
    args?: Uint8Array;
}
export interface SauceSvmExecution extends StagedBufferRef {
    accounts: readonly SauceSvmAccountMeta[];
    /** Must be omitted or zero — the on-chain SVM `Call` has no `value` field. Present only so a
     *  caller who reused an EVM-shaped params object gets a clear build-time rejection here instead of
     *  a confusing later encode-time failure inside `encodeRouteSvm`. */
    value?: bigint | number | string;
}
export interface SauceSvmCallParams extends SauceSvmExecution {
    /** Defaults to `v12SvmProgramId` (`../deployments/index.js`). */
    programId?: SvmAddressInput;
    /** Every account meta equal to `executor` is forced `isSigner: false` regardless of what its own
     *  meta said — the Portal executor PDA signs via `invoke_signed` INSIDE the fulfill CPI, never as
     *  a transaction-level signer, and Portal reconstructs+hashes this account metadata on-chain, so a
     *  mismatch here breaks fulfill. This is solver POLICY (the SDK cannot derive the executor PDA),
     *  mirrored, not enforced by the engine. */
    executor?: SvmAddressInput;
}
/**
 * Cross-call OR-merge of `isSigner`/`isWritable` per pubkey across every given instruction's
 * accounts — the Solana runtime dedupes a repeated pubkey in one transaction to the union of its
 * flags, so a leg's own two staged calls (e.g. swap half + settle half) sharing an account must
 * agree on the more-permissive flags before either is built, not just within itself.
 */
export declare function mergeSvmAccountFlags(instructions: readonly {
    accounts: readonly SauceSvmAccountMeta[];
}[]): Map<string, {
    isSigner: boolean;
    isWritable: boolean;
}>;
/** Builds ONE staged SVM route call. Merges account flags within its own instruction only — use
 *  `buildSauceSvmCalls` for the cross-call merge over a whole leg. */
export declare function buildSauceSvmCall(params: SauceSvmCallParams): CallInput;
export interface SauceSvmCallsParams {
    /** Defaults to `v12SvmProgramId`. */
    programId?: SvmAddressInput;
    /** One staged execution per element, execution order preserved (e.g. the swap half then the
     *  settle half, one staged buffer each). */
    executions: readonly SauceSvmExecution[];
    executor?: SvmAddressInput;
    /** Cross-call OR-merge of account flags over the WHOLE leg (`mergeSvmAccountFlags`). Defaults to
     *  `true` — this is the recommended entry point precisely because of that merge. */
    mergeAccountFlags?: boolean;
}
/** RECOMMENDED entry point: builds one staged route call per `executions` element, with account
 *  flags OR-merged across the whole leg by default. */
export declare function buildSauceSvmCalls(params: SauceSvmCallsParams): CallInput[];
/** Forks on `kindOf(chain)` (bigint-aware; throws for an unregistered chain id rather than
 *  defaulting to evm) to build one Sauce-executing `Call` for either engine. */
export declare function buildSauceCall(chain: ChainKindRef, params: SauceEvmCallParams | SauceSvmCallParams): CallInput;
/** Plural fork of {@link buildSauceCall}. */
export declare function buildSauceCalls(chain: ChainKindRef, params: SauceEvmCallsParams | SauceSvmCallsParams): CallInput[];
//# sourceMappingURL=sauce-calls.d.ts.map