/**
 * eco-routes Sauce-bytecode `route.calls[]` builders — E3.3.
 *
 * Turns compiled Sauce bytecode (the compiler's output) into the `CallInput`(s) that slot straight
 * into a `RouteInput.calls` (E3.1's fluent builder) and flow unchanged through `normalizeRoute` /
 * `encodeRouteEvm` / `encodeRouteSvm` (E3.2). This module does not re-implement either of those —
 * it only decides WHAT the `target`/`data`/`value` of a Sauce-executing call are, forking on chain
 * kind (`../chains/canonical.js` `isEvm`/`isSvm`, via `encode.js#kindOf` — bigint-aware, so a native
 * `Intent.destination` passes through with no silent evm mis-classification).
 *
 * EVM: `target = pot`, `data = v12Pot.encodeCook(ingredients)` (`../evm/engine.js`, reused verbatim
 * — no re-encoding), `value` defaults to `0n`. The Pot address is deliberately NOT defaulted: it is
 * a per-OWNER CREATE2 address (`v12Kitchen.deployPot(owner, salt)`) and `cook()` is `onlyOwner`, so
 * only the caller (who knows the fulfilling executor) can supply it — see
 * `sauceEvmDeployPotCall`/`v12Kitchen.encodePredictPot` for how to derive one.
 *
 * SVM: multi-KB Sauce bytecode cannot fit in a single ~1,232-byte transaction, so it must already
 * be STAGED in a buffer PDA before any route call can reference it. **This module never stages
 * anything** — see the "SVM STAGING IS A PREREQUISITE" section below. Given an already-staged
 * buffer address, it builds an `execute_from_account` instruction
 * (`../svm/instructions.js#buildExecuteFromAccountInstruction`, the `/svm/engine` kit surface) and
 * wraps it in the Portal `CalldataWithAccounts` Borsh envelope (`../svm/intent.js
 * #encodePortalCalldataWithAccounts`) — that envelope IS the SVM route call's `data`.
 *
 * WHY THIS FILE IMPORTS `@solana/kit` BUT NEVER `@solana/web3.js`: `sdk/src/index.ts` re-exports
 * `routes` from the main SDK barrel, and `@solana/web3.js` is an OPTIONAL peer dependency
 * (`svm/engine-web3js.ts`'s own module doc). Hard-requiring it here would make the main barrel fail
 * to load for any consumer who did not install it. So every SVM address parameter accepts a plain
 * base58 string, a kit `Address`, or anything duck-typed like a web3.js `PublicKey`
 * (`{ toBase58(): string }`) — see `SvmAddressInput`/`toSvmAddress` — never an imported `PublicKey`
 * type. A web3.js consumer passes its `PublicKey`s straight in; nothing here imports the package.
 *
 * ── SVM STAGING IS A PREREQUISITE (solver-side, NOT performed here) ──
 *
 * Before any `buildSauceSvmCall`/`buildSauceSvmCalls` output is submittable, the referenced buffer
 * must already be init'd, written, and FINALIZED:
 *   1. `deriveBufferPda(programId, authority, seed)` (`../svm/pda.js`, kit — async — or the sync
 *      web3.js twin in `../svm/engine-web3js.js`) to get the buffer address.
 *   2. `buildInitBufferInstructions` / `buildWriteBufferInstruction` / `buildFinalizeBufferInstruction`
 *      (`@eco-incorp/sauce-sdk/svm/engine`, or `/svm/engine/web3js` for the web3.js-typed twins) to
 *      create, fill, and finalize it — `bytecodeSha256(bytecode)` (both subpaths export it) or an
 *      equivalent sha256 supplies the finalize/pin hash.
 *   3. Only THEN does a `StagedBufferRef.buffer` naming that address produce a call that will
 *      actually execute — an unstaged, half-written, or unfinalized buffer fails at FULFILL time
 *      (the engine dispatches on the account's own header, not on anything this module can see), not
 *      at build time here.
 * `sauceSvmStagingPlan` (a verbatim re-export of `buildStagingPlan`) is provided for a caller sizing
 * that staging sequence — it emits zero instructions, advisory only.
 *
 * `StagedBufferRef` deliberately carries no `bytecode`/`seed`/`authority`/`payer` field: accepting
 * any of those would imply this module can perform the staging above. It cannot — it only accepts
 * the RESOLVED buffer address a solver-side process already produced.
 *
 * `buildExecuteAndCloseInstruction` (the buffer-reaping variant) is deliberately never used here: it
 * needs the buffer WRITABLE and drains its rent, a lifecycle action; a route call only ever executes
 * a staged program (buffer READONLY) via `execute_from_account`. Writability is a transaction-level
 * property, so the two can never share a transaction anyway.
 */
import { AccountRole, address, getAddressEncoder, isSignerRole, isWritableRole } from "@solana/kit";
import type { Address } from "@solana/kit";
import { bytesToHex, type Hex } from "viem";

import { v12Kitchen, v12Pot } from "../evm/engine.js";
import {
  requireV12Deployment,
  v12SvmProgramId,
  V12_EVM_CONTRACTS,
  type V12Deployment,
} from "../deployments/index.js";
import { encodePortalCalldataWithAccounts, type PortalAccountMeta } from "../svm/intent.js";
import {
  buildExecuteFromAccountInstruction,
  buildStagingPlan,
  type ExecuteBytecodeSlice,
} from "../svm/instructions.js";
import type { ResolvedAccountMeta } from "../svm/resolve.js";

import { kindOf, denormalizeToEvm, type ChainKindRef } from "./encode.js";
import { toBigInt, toUniversalAddress } from "./normalize.js";
import type { AddressInput, CallInput } from "./types.js";

/** Verbatim re-export — sizing advice only, emits zero instructions. See the module doc above. */
export { buildStagingPlan as sauceSvmStagingPlan };

// ---------------------------------------------------------------------------
// EVM
// ---------------------------------------------------------------------------

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
export function buildSauceEvmCall(params: SauceEvmCallParams): CallInput {
  return {
    target: toUniversalAddress(params.pot),
    data: v12Pot.encodeCook(params.ingredients),
    value: params.value ?? 0n,
  };
}

export interface SauceEvmCallsParams {
  pot: AddressInput;
  /** One `cook()` per element, execution order preserved (e.g. the swap half then the settle half —
   *  the shape a Pot-based solver leg uses: two `cook()`s on the SAME Pot). */
  cooks: readonly (readonly Hex[])[];
  value?: bigint | number | string;
}

/** One `Call` per element of `cooks`, in the given order, all targeting the same `pot`. */
export function buildSauceEvmCalls(params: SauceEvmCallsParams): CallInput[] {
  return params.cooks.map((ingredients) =>
    buildSauceEvmCall({ pot: params.pot, ingredients, value: params.value }),
  );
}

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
export function sauceEvmDeployPotCall(params: SauceEvmDeployPotCallParams): CallInput {
  const kitchen: AddressInput =
    params.kitchen ??
    ((params.chainId !== undefined
      ? requireV12Deployment(params.chainId).v12Kitchen
      : V12_EVM_CONTRACTS.v12Kitchen) as Hex);
  const ownerAddress = denormalizeToEvm(toUniversalAddress(params.owner));
  return {
    target: kitchen,
    data: v12Kitchen.encodeDeployPot(ownerAddress, params.salt),
    value: 0n,
  };
}

/** Thin delegate to `requireV12Deployment` — throws with the reason when the v12 stack is not live
 *  on `chainId` (e.g. ronin/2020, whose deploy did not land). */
export function assertSauceEvmLive(chainId: number): V12Deployment {
  return requireV12Deployment(chainId);
}

// ---------------------------------------------------------------------------
// SVM
// ---------------------------------------------------------------------------

/** A base58 string, a kit `Address`, or anything duck-typed like a web3.js `PublicKey` — see the
 *  module doc's "WHY THIS FILE ... NEVER `@solana/web3.js`" note. */
export type SvmAddressInput = string | Address | { toBase58(): string };

function toSvmAddress(input: SvmAddressInput, label: string): Address {
  if (typeof input === "string") return address(input);
  if (input !== null && typeof input === "object" && typeof (input as { toBase58?: unknown }).toBase58 === "function") {
    return address((input as { toBase58(): string }).toBase58());
  }
  throw new Error(
    `${label}: expected a base58 string, an Address, or a { toBase58() } (e.g. a web3.js PublicKey), got ${String(input)}`,
  );
}

/** Canonical string key for de-duplicating/matching an `SvmAddressInput` (its resolved base58 form). */
function svmAddressKey(input: SvmAddressInput, label: string): string {
  return String(toSvmAddress(input, label));
}

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

function toRole(isSigner: boolean, isWritable: boolean): AccountRole {
  return isWritable
    ? isSigner
      ? AccountRole.WRITABLE_SIGNER
      : AccountRole.WRITABLE
    : isSigner
      ? AccountRole.READONLY_SIGNER
      : AccountRole.READONLY;
}

/**
 * Cross-call OR-merge of `isSigner`/`isWritable` per pubkey across every given instruction's
 * accounts — the Solana runtime dedupes a repeated pubkey in one transaction to the union of its
 * flags, so a leg's own two staged calls (e.g. swap half + settle half) sharing an account must
 * agree on the more-permissive flags before either is built, not just within itself.
 */
export function mergeSvmAccountFlags(
  instructions: readonly { accounts: readonly SauceSvmAccountMeta[] }[],
): Map<string, { isSigner: boolean; isWritable: boolean }> {
  const merged = new Map<string, { isSigner: boolean; isWritable: boolean }>();
  for (const ix of instructions) {
    for (const acc of ix.accounts) {
      const key = svmAddressKey(acc.pubkey, "account.pubkey");
      const prev = merged.get(key) ?? { isSigner: false, isWritable: false };
      merged.set(key, {
        isSigner: prev.isSigner || acc.isSigner,
        isWritable: prev.isWritable || acc.isWritable,
      });
    }
  }
  return merged;
}

function applyMergedFlags(
  accounts: readonly SauceSvmAccountMeta[],
  merged: Map<string, { isSigner: boolean; isWritable: boolean }>,
): SauceSvmAccountMeta[] {
  return accounts.map((a) => {
    const flags = merged.get(svmAddressKey(a.pubkey, "account.pubkey"));
    return flags === undefined ? a : { ...a, isSigner: flags.isSigner, isWritable: flags.isWritable };
  });
}

function forceExecutorNonSigner(
  accounts: readonly SauceSvmAccountMeta[],
  executor: SvmAddressInput | undefined,
): SauceSvmAccountMeta[] {
  if (executor === undefined) return accounts.slice();
  const key = svmAddressKey(executor, "executor");
  return accounts.map((a) =>
    svmAddressKey(a.pubkey, "account.pubkey") === key ? { ...a, isSigner: false } : a,
  );
}

function assertSvmValue(value: bigint | number | string | undefined): void {
  if (value !== undefined && toBigInt(value) !== 0n) {
    throw new Error("buildSauceSvmCall: SVM Call has no value field (nonzero value cannot be encoded)");
  }
}

/** Builds one `execute_from_account` CPI, wrapped in the Portal `CalldataWithAccounts` envelope, for
 *  an ALREADY-staged buffer. `merged`, when given, overrides each account's flags per the cross-call
 *  merge (`mergeSvmAccountFlags`); executor-flattening always runs after the merge, so it wins. */
function buildOneSauceSvmCall(
  programId: Address,
  execution: SauceSvmExecution,
  executor: SvmAddressInput | undefined,
  merged: Map<string, { isSigner: boolean; isWritable: boolean }> | undefined,
): CallInput {
  assertSvmValue(execution.value);

  let accounts = execution.accounts;
  if (merged !== undefined) accounts = applyMergedFlags(accounts, merged);
  accounts = forceExecutorNonSigner(accounts, executor);

  const resolvedAccounts: ResolvedAccountMeta[] = accounts.map((a) => ({
    address: toSvmAddress(a.pubkey, "account.pubkey"),
    role: toRole(a.isSigner, a.isWritable),
  }));

  const ix = buildExecuteFromAccountInstruction({
    programId,
    buffer: toSvmAddress(execution.buffer, "buffer"),
    accounts: resolvedAccounts,
    expectedSha256: execution.expectedSha256,
    slice: execution.slice,
    args: execution.args,
  });

  // Buffer rides FIRST (READONLY) — buildExecuteFromAccountInstruction already puts it there; this
  // just re-derives isSigner/isWritable from the role kit's own way (isSignerRole/isWritableRole),
  // mirroring engine-web3js.ts#toWeb3JsInstruction, so the envelope's account metas track kit's
  // AccountRole encoding rather than assuming a bit layout.
  const envelopeAccounts: PortalAccountMeta[] = (ix.accounts ?? []).map((a) => ({
    pubkey: a.address,
    isSigner: isSignerRole(a.role),
    isWritable: isWritableRole(a.role),
  }));

  const data = encodePortalCalldataWithAccounts({
    instructionData: (ix.data ?? new Uint8Array()) as Uint8Array,
    accounts: envelopeAccounts,
  });

  const target = bytesToHex(getAddressEncoder().encode(programId) as unknown as Uint8Array) as Hex;

  return { target, data, value: 0n };
}

/** Builds ONE staged SVM route call. Merges account flags within its own instruction only — use
 *  `buildSauceSvmCalls` for the cross-call merge over a whole leg. */
export function buildSauceSvmCall(params: SauceSvmCallParams): CallInput {
  const programId = toSvmAddress(params.programId ?? v12SvmProgramId, "programId");
  const merged = mergeSvmAccountFlags([params]);
  return buildOneSauceSvmCall(programId, params, params.executor, merged);
}

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
export function buildSauceSvmCalls(params: SauceSvmCallsParams): CallInput[] {
  const programId = toSvmAddress(params.programId ?? v12SvmProgramId, "programId");
  const merged =
    params.mergeAccountFlags ?? true ? mergeSvmAccountFlags(params.executions) : undefined;
  return params.executions.map((execution) =>
    buildOneSauceSvmCall(programId, execution, params.executor, merged),
  );
}

// ---------------------------------------------------------------------------
// Chain-kind fork
// ---------------------------------------------------------------------------

/** Forks on `kindOf(chain)` (bigint-aware; throws for an unregistered chain id rather than
 *  defaulting to evm) to build one Sauce-executing `Call` for either engine. */
export function buildSauceCall(
  chain: ChainKindRef,
  params: SauceEvmCallParams | SauceSvmCallParams,
): CallInput {
  return kindOf(chain) === "svm"
    ? buildSauceSvmCall(params as SauceSvmCallParams)
    : buildSauceEvmCall(params as SauceEvmCallParams);
}

/** Plural fork of {@link buildSauceCall}. */
export function buildSauceCalls(
  chain: ChainKindRef,
  params: SauceEvmCallsParams | SauceSvmCallsParams,
): CallInput[] {
  return kindOf(chain) === "svm"
    ? buildSauceSvmCalls(params as SauceSvmCallsParams)
    : buildSauceEvmCalls(params as SauceEvmCallsParams);
}
