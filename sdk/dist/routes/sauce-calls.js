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
 *      create, fill, and finalize it — `bytecodeSha256(bytecode)` (web3js subpath) or an equivalent
 *      sha256 supplies the finalize/pin hash.
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
import { bytesToHex } from "viem";
import { v12Kitchen, v12Pot } from "../evm/engine.js";
import { requireV12Deployment, v12SvmProgramId, V12_EVM_CONTRACTS, } from "../deployments/index.js";
import { encodePortalCalldataWithAccounts } from "../svm/intent.js";
import { buildExecuteFromAccountInstruction, buildStagingPlan, } from "../svm/instructions.js";
import { kindOf, denormalizeToEvm } from "./encode.js";
import { toBigInt, toUniversalAddress } from "./normalize.js";
/** Verbatim re-export — sizing advice only, emits zero instructions. See the module doc above. */
export { buildStagingPlan as sauceSvmStagingPlan };
/** One `cook(ingredients)` call on `pot`. `data` is produced by `v12Pot.encodeCook` — the exact
 *  E3.2-adjacent EVM engine encoder, not re-implemented here. */
export function buildSauceEvmCall(params) {
    return {
        target: toUniversalAddress(params.pot),
        data: v12Pot.encodeCook(params.ingredients),
        value: params.value ?? 0n,
    };
}
/** One `Call` per element of `cooks`, in the given order, all targeting the same `pot`. */
export function buildSauceEvmCalls(params) {
    return params.cooks.map((ingredients) => buildSauceEvmCall({ pot: params.pot, ingredients, value: params.value }));
}
/** The leading `deployPot(owner, salt)` call a solver issues before its first `cook()` on a Pot
 *  that may not exist yet. */
export function sauceEvmDeployPotCall(params) {
    const kitchen = params.kitchen ??
        (params.chainId !== undefined
            ? requireV12Deployment(params.chainId).v12Kitchen
            : V12_EVM_CONTRACTS.v12Kitchen);
    const ownerAddress = denormalizeToEvm(toUniversalAddress(params.owner));
    return {
        target: kitchen,
        data: v12Kitchen.encodeDeployPot(ownerAddress, params.salt),
        value: 0n,
    };
}
/** Thin delegate to `requireV12Deployment` — throws with the reason when the v12 stack is not live
 *  on `chainId` (e.g. ronin/2020, whose deploy did not land). */
export function assertSauceEvmLive(chainId) {
    return requireV12Deployment(chainId);
}
function toSvmAddress(input, label) {
    if (typeof input === "string")
        return address(input);
    if (input !== null && typeof input === "object" && typeof input.toBase58 === "function") {
        return address(input.toBase58());
    }
    throw new Error(`${label}: expected a base58 string, an Address, or a { toBase58() } (e.g. a web3.js PublicKey), got ${String(input)}`);
}
/** Canonical string key for de-duplicating/matching an `SvmAddressInput` (its resolved base58 form). */
function svmAddressKey(input, label) {
    return String(toSvmAddress(input, label));
}
function toRole(isSigner, isWritable) {
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
export function mergeSvmAccountFlags(instructions) {
    const merged = new Map();
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
function applyMergedFlags(accounts, merged) {
    return accounts.map((a) => {
        const flags = merged.get(svmAddressKey(a.pubkey, "account.pubkey"));
        return flags === undefined ? a : { ...a, isSigner: flags.isSigner, isWritable: flags.isWritable };
    });
}
function forceExecutorNonSigner(accounts, executor) {
    if (executor === undefined)
        return accounts.slice();
    const key = svmAddressKey(executor, "executor");
    return accounts.map((a) => svmAddressKey(a.pubkey, "account.pubkey") === key ? { ...a, isSigner: false } : a);
}
function assertSvmValue(value) {
    if (value !== undefined && toBigInt(value) !== 0n) {
        throw new Error("buildSauceSvmCall: SVM Call has no value field (nonzero value cannot be encoded)");
    }
}
/** Builds one `execute_from_account` CPI, wrapped in the Portal `CalldataWithAccounts` envelope, for
 *  an ALREADY-staged buffer. `merged`, when given, overrides each account's flags per the cross-call
 *  merge (`mergeSvmAccountFlags`); executor-flattening always runs after the merge, so it wins. */
function buildOneSauceSvmCall(programId, execution, executor, merged) {
    assertSvmValue(execution.value);
    let accounts = execution.accounts;
    if (merged !== undefined)
        accounts = applyMergedFlags(accounts, merged);
    accounts = forceExecutorNonSigner(accounts, executor);
    const resolvedAccounts = accounts.map((a) => ({
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
    const envelopeAccounts = (ix.accounts ?? []).map((a) => ({
        pubkey: a.address,
        isSigner: isSignerRole(a.role),
        isWritable: isWritableRole(a.role),
    }));
    const data = encodePortalCalldataWithAccounts({
        instructionData: (ix.data ?? new Uint8Array()),
        accounts: envelopeAccounts,
    });
    const target = bytesToHex(getAddressEncoder().encode(programId));
    return { target, data, value: 0n };
}
/** Builds ONE staged SVM route call. Merges account flags within its own instruction only — use
 *  `buildSauceSvmCalls` for the cross-call merge over a whole leg. */
export function buildSauceSvmCall(params) {
    const programId = toSvmAddress(params.programId ?? v12SvmProgramId, "programId");
    const merged = mergeSvmAccountFlags([params]);
    return buildOneSauceSvmCall(programId, params, params.executor, merged);
}
/** RECOMMENDED entry point: builds one staged route call per `executions` element, with account
 *  flags OR-merged across the whole leg by default. */
export function buildSauceSvmCalls(params) {
    const programId = toSvmAddress(params.programId ?? v12SvmProgramId, "programId");
    const merged = params.mergeAccountFlags ?? true ? mergeSvmAccountFlags(params.executions) : undefined;
    return params.executions.map((execution) => buildOneSauceSvmCall(programId, execution, params.executor, merged));
}
// ---------------------------------------------------------------------------
// Chain-kind fork
// ---------------------------------------------------------------------------
/** Forks on `kindOf(chain)` (bigint-aware; throws for an unregistered chain id rather than
 *  defaulting to evm) to build one Sauce-executing `Call` for either engine. */
export function buildSauceCall(chain, params) {
    return kindOf(chain) === "svm"
        ? buildSauceSvmCall(params)
        : buildSauceEvmCall(params);
}
/** Plural fork of {@link buildSauceCall}. */
export function buildSauceCalls(chain, params) {
    return kindOf(chain) === "svm"
        ? buildSauceSvmCalls(params)
        : buildSauceEvmCalls(params);
}
//# sourceMappingURL=sauce-calls.js.map