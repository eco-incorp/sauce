/**
 * eco-routes V2 Portal submission calldata — pure, `Intent`-only, no `BuiltIntent` knowledge.
 *
 * Grounded on `IntentSource.sol` (`git -C ../eco-routes show main:contracts/IntentSource.sol`) and
 * `Inbox.sol`/`Executor.sol` for the funding mechanics. Every helper here uses the `bytes`-route
 * Portal overload EXCLUSIVELY (`publish(uint64,bytes,Reward)` etc, never the `Intent`-tuple form):
 *
 *  1. Correctness across VMs — for an SVM destination the route crosses `publish` as hand-rolled
 *     Borsh (`encode.ts`'s `encodeRouteSvm`), not `abi.encode`d. The `Intent`-tuple overload would
 *     make the Portal `abi.encode(intent.route)` ITSELF, producing a different `routeHash` than the
 *     one `hashIntent` computed — a silently unfulfillable intent. The `bytes` overload lets us hand
 *     over exactly the blob we already hashed, one code path for both destination kinds.
 *  2. No viem overload ambiguity — the registered `PortalABI` (`protocols/eco-routes/abis.ts`, the
 *     SDK's only declaration of the Portal) carries exactly one overload per name, so
 *     `encodeFunctionData({ abi, functionName })` can never resolve the wrong signature.
 *
 * The calldata's reward tuple and the `rewardHash` `hashIntent` computes must be the same bytes.
 * `eco-routes-abi-drift.test.ts` pins every reward parameter of that ABI to `encode.ts`'s
 * `EVM_REWARD_PARAM`, the one the hash is taken over. The route needs no such pin: the `bytes`
 * argument below is `encodeRoute(intent.route, intent.destination)` — literally the function
 * `routeHash` calls.
 *
 * THE DESTINATION SIDE (`fulfillTx`, `fulfillApprovalTxs`) is the one exception to the `bytes`
 * rule, because the deployed `Inbox.fulfill(bytes32,Route,bytes32,bytes32)` has no `bytes` form:
 * it takes the `Route` tuple and hashes `abi.encode(route)` itself. That is safe exactly where it
 * applies — an EVM destination, whose route IS ABI-encoded — and the tuple handed over is
 * `encode.ts`'s `evmRouteTuple`, the value `encodeRouteEvm` (and so `routeHash`) encodes. Verified
 * against eco-routes `Inbox.sol` on `main` and the Base Portal (2.6), whose code carries the
 * `fulfill` selector this ABI entry encodes.
 *
 * FUNDING MECHANICS (`IntentSource._fundIntent`/`_fundToken`/`_fundNative`, read verbatim):
 *   - the funder is `msg.sender` of `publishAndFund`/`fund` (a separate `funder` address exists only
 *     on the `*For` permit variants — out of scope here);
 *   - a reward token's ALLOWANCE IS TO THE PORTAL ITSELF (`token.allowance(funder, address(this))`,
 *     and `address(this)` IS the Portal — `Portal is IntentSource, Inbox, Semver`), NOT the vault;
 *     tokens then move funder -> vault via `safeTransferFrom`, pulled BY the Portal. A plain ERC20
 *     `approve` is sufficient (`SafeERC20.safeTransferFrom`, no Permit2, no signature);
 *   - native funding uses `msg.value`; `_fundNative` only pulls the shortfall
 *     (`rewardAmount - vault.balance`), and `Refund.excessNative()` returns any leftover Portal
 *     balance to `msg.sender` — so `value = reward.nativeAmount` exactly is correct, and over-sending
 *     is safe;
 *   - both `_fundToken`/`_fundNative` short-circuit once the vault already holds enough, so an
 *     approval is SUFFICIENT but not always CONSUMED — approving the full amount is never wrong.
 *
 * EVM-SOURCE GUARD: every helper here throws a named error when `intent.sourceChainId`'s kind isn't
 * `"evm"` — these are EVM Portal calldata. The Solana Portal is a separate Anchor program, in
 * `eco/eco-routes-svm`, with its own instructions and accounts, which these helpers do not build.
 * The DESTINATION may be `svm` and is fully supported: an EVM-sourced reward with Borsh route bytes
 * is exactly the `DepositAddress_USDCTransfer_Solana.sol` shape.
 *
 * FUNDING BY TRANSFER — the default `intentSourceTxs` builds (`fundVia: "transfer"`). An intent is
 * funded when its vault HOLDS the reward, however it got there: `IntentSource.isIntentFunded` is
 * `rewardStatuses[hash] == Funded || _isRewardFunded(reward, vault)`, the latter a balance check per
 * leg, and the solver validates funding with exactly that call after picking the intent up from
 * `IntentPublished`. `withdraw` accepts an `Initial` intent and `refund` returns whatever the vault
 * holds, so a vault paid directly pays out like one the Portal pulled into. So the funder transfers
 * each reward token to the vault (and sends the native amount) and then calls `publish`: no approval
 * at all, so nothing to reset for USDT and no allowance left standing. Transfer FIRST: the solver
 * sees `IntentPublished` with the vault already funded, and a `publish` that fails leaves the funds
 * in the vault, to be published later or refunded after the reward deadline.
 *
 * The vault is not read from anything the funder controls: {@link predictIntentVault} derives it
 * offline (`vault.ts#ecoRoutesVaultConfig`, held to every deployed registry Portal), and a vault a
 * caller read on chain (`intentVaultAddressCall`) is cross-checked against it —
 * {@link assertIntentVault} — so a lying endpoint cannot redirect the reward. `fundVia:
 * "publishAndFund"` keeps the approvals and `publishAndFund`: the Portal emits `IntentFunded` and
 * records the intent `Funded`, which the solver's quote flow reads to promote quotes.
 */
import { decodeAbiParameters, encodeFunctionData, getAddress, type Hex } from "viem";

import { PortalABI } from "../protocols/eco-routes/abis.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import { denormalizeToEvm, encodeRoute, evmRouteTuple, hashIntent, kindOf } from "./encode.js";
import type { IntentHashes } from "./encode.js";
import { assertRewardAssetsDistinct } from "./intent.js";
import { toUniversalAddress } from "./normalize.js";
import type { AddressInput, Intent } from "./types.js";
import { ecoRoutesVaultConfig, predictVaultAddress } from "./vault.js";

/** A submittable transaction request. `value` is always explicit, never omitted. */
export interface PortalTx {
  readonly to: Hex;
  readonly data: Hex;
  readonly value: bigint;
}

/** An `eth_call` request plus its own decoder — the caller performs the RPC, this module never does. */
export interface PortalReadCall<T> {
  readonly to: Hex;
  readonly data: Hex;
  decode(result: Hex): T;
}

/** Where to submit. `portal` is the SOURCE-chain Portal — never defaulted, never invented. */
export interface PortalTarget {
  readonly portal: AddressInput;
}

function assertEvmSource(intent: Intent, helper: string): void {
  if (kindOf(intent.sourceChainId) !== "evm") {
    throw new Error(
      `portal.ts#${helper}: intent.sourceChainId (${intent.sourceChainId}) is not an EVM chain — ` +
        `these are EVM Portal calldata helpers, and the Solana Portal is a separate program ` +
        `(eco/eco-routes-svm) whose instructions they do not build. The DESTINATION may be svm; ` +
        `only the SOURCE must be evm.`,
    );
  }
}

function destinationArg(intent: Intent): bigint {
  return intent.destination;
}

function routeBytesArg(intent: Intent): Hex {
  return encodeRoute(intent.route, intent.destination);
}

function rewardTupleArg(intent: Intent) {
  const r = intent.reward;
  return {
    deadline: r.deadline,
    creator: denormalizeToEvm(r.creator),
    prover: denormalizeToEvm(r.prover),
    nativeAmount: r.nativeAmount,
    tokens: r.tokens.map((t) => ({ token: denormalizeToEvm(t.token), amount: t.amount })),
  };
}

function portalAddress(target: PortalTarget): Hex {
  return denormalizeToEvm(toUniversalAddress(target.portal));
}

/** `Portal.publish(destination, routeBytes, reward)`. `value` is always `0n`. */
export function publishTx(intent: Intent, target: PortalTarget): PortalTx {
  assertEvmSource(intent, "publishTx");
  assertRewardAssetsDistinct(intent.sourceChainId, intent.reward);
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: "publish",
      args: [destinationArg(intent), routeBytesArg(intent), rewardTupleArg(intent)],
    }),
    value: 0n,
  };
}

/** `Portal.publishAndFund(destination, routeBytes, reward, allowPartial)`. `value = reward.nativeAmount`. */
export function publishAndFundTx(
  intent: Intent,
  allowPartial: boolean,
  target: PortalTarget,
): PortalTx {
  assertEvmSource(intent, "publishAndFundTx");
  assertRewardAssetsDistinct(intent.sourceChainId, intent.reward);
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: "publishAndFund",
      args: [destinationArg(intent), routeBytesArg(intent), rewardTupleArg(intent), allowPartial],
    }),
    value: intent.reward.nativeAmount,
  };
}

/** `Portal.fund(destination, routeHash, reward, allowPartial)`. `value = reward.nativeAmount`. */
export function fundTx(intent: Intent, allowPartial: boolean, target: PortalTarget): PortalTx {
  assertEvmSource(intent, "fundTx");
  assertRewardAssetsDistinct(intent.sourceChainId, intent.reward);
  const rHash = hashIntent(intent).routeHash;
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: "fund",
      args: [destinationArg(intent), rHash, rewardTupleArg(intent), allowPartial],
    }),
    value: intent.reward.nativeAmount,
  };
}

/**
 * One `approve(portal, amount)` per DISTINCT reward token, in first-seen order — see the module
 * doc's funding-mechanics table: the allowance is to the PORTAL, never the vault. Several reward
 * entries naming the same token collapse into ONE approve for the LARGEST of their amounts, never
 * their sum: `IntentSource._fundToken` compares each leg against the vault's TOTAL balance and
 * short-circuits, so the largest leg is the binding allowance. Emits nothing for
 * `reward.nativeAmount` (that needs `value`, not an approval); a token whose largest entry is zero
 * is emitted as `approve(portal, 0)` rather than filtered. Does NOT emit `allowance`/`balanceOf`
 * read-calls to let a caller skip a redundant approve — see `isIntentFundedCall` for the "is this
 * already funded?" question.
 */
export function approvalTxs(intent: Intent, target: PortalTarget): readonly PortalTx[] {
  assertEvmSource(intent, "approvalTxs");
  assertRewardAssetsDistinct(intent.sourceChainId, intent.reward);
  const portal = portalAddress(target);
  const maxByToken = new Map<Hex, bigint>();
  for (const { token, amount } of intent.reward.tokens) {
    const evmToken = denormalizeToEvm(token);
    const previous = maxByToken.get(evmToken);
    if (previous === undefined || amount > previous) maxByToken.set(evmToken, amount);
  }
  return [...maxByToken].map(([token, amount]) => ({
    to: token,
    data: encodeFunctionData({ abi: ERC20ABI, functionName: "approve", args: [portal, amount] }),
    value: 0n,
  }));
}

// ---------------------------------------------------------------------------
// The destination side: what a solver sends to fulfil an intent
// ---------------------------------------------------------------------------

/** What `fulfill` takes besides the intent. */
export interface FulfillOptions {
  /**
   * Who claims the reward on the source chain once the fulfilment is proven, as the Portal
   * records it: a 20-byte EVM address (left-padded to 32 bytes) or the 32 bytes another VM's
   * address is. Never zero: `Inbox._fulfill` refuses that with `ZeroClaimant()`.
   */
  readonly claimant: AddressInput;
}

function assertEvmDestination(intent: Intent, helper: string): void {
  if (kindOf(intent.destination) !== "evm") {
    throw new Error(
      `portal.ts#${helper}: intent.destination (${intent.destination}) is not an EVM chain — this ` +
        "is the EVM Portal's fulfill calldata; a Solana destination is fulfilled through the " +
        "Solana Portal program.",
    );
  }
}

/** The destination Portal: the one the route records, which `Inbox._fulfill` requires it to be
 *  (`route.portal != address(this)` reverts `InvalidPortal`). */
function destinationPortalOf(intent: Intent): Hex {
  return denormalizeToEvm(intent.route.portal);
}

/**
 * `Portal.fulfill(intentHash, route, rewardHash, claimant)` on the DESTINATION chain: what a solver
 * sends to run an intent's route (`Inbox.fulfill`, read verbatim).
 *
 *  - `to` is the Portal the route records — never a parameter, since any other Portal refuses it;
 *  - `route` is {@link evmRouteTuple}, the exact value `routeHash` is taken over, and `intentHash`
 *    and `rewardHash` are {@link hashIntent}'s: the Portal recomputes
 *    `keccak256(abi.encodePacked(uint64 chainid, keccak256(abi.encode(route)), rewardHash))` and
 *    refuses a mismatch with `InvalidHash`;
 *  - `value` is `route.nativeAmount` — what the route's calls spend, the Kitchen's fee for each cook
 *    among them. `_fulfill` refuses less (`InsufficientNativeAmount`) and refunds any excess.
 *
 * The Portal pulls each `route.tokens` entry from the solver (`safeTransferFrom(msg.sender,
 * executor, amount)`), so the solver approves the Portal first: {@link fulfillApprovalTxs}.
 */
export function fulfillTx(intent: Intent, options: FulfillOptions): PortalTx {
  assertEvmDestination(intent, "fulfillTx");
  const claimant = toUniversalAddress(options.claimant);
  if (/^0x0{64}$/.test(claimant)) {
    throw new Error("portal.ts#fulfillTx: the claimant is zero, which the Portal refuses");
  }
  const { intentHash, rewardHash } = hashIntent(intent);

  return {
    to: destinationPortalOf(intent),
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: "fulfill",
      args: [intentHash, evmRouteTuple(intent.route), rewardHash, claimant],
    }),
    value: intent.route.nativeAmount,
  };
}

/**
 * The solver's approvals `fulfill` spends: one `approve(portal, amount)` per DISTINCT route token,
 * in first-seen order, to the Portal the route records. Entries naming the same token SUM — unlike
 * the reward's approvals ({@link approvalTxs}), which take the largest — because `_fulfill`
 * `safeTransferFrom`s every `route.tokens` entry in turn, each spending its own share of the one
 * allowance. A standing allowance is the caller's to read: a token like USDT refuses to move a
 * nonzero allowance to another nonzero value, which takes an `approve(portal, 0)` first.
 */
export function fulfillApprovalTxs(intent: Intent): readonly PortalTx[] {
  assertEvmDestination(intent, "fulfillApprovalTxs");
  const portal = destinationPortalOf(intent);
  const sumByToken = new Map<Hex, bigint>();
  for (const { token, amount } of intent.route.tokens) {
    const evmToken = denormalizeToEvm(token);
    sumByToken.set(evmToken, (sumByToken.get(evmToken) ?? 0n) + amount);
  }
  return [...sumByToken].map(([token, amount]) => ({
    to: token,
    data: encodeFunctionData({ abi: ERC20ABI, functionName: "approve", args: [portal, amount] }),
    value: 0n,
  }));
}

function readCall<T>(
  intent: Intent,
  target: PortalTarget,
  functionName: string,
  decode: (result: Hex) => T,
): PortalReadCall<T> {
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PortalABI,
      functionName: functionName as never,
      args: [destinationArg(intent), routeBytesArg(intent), rewardTupleArg(intent)] as never,
    }),
    decode,
  };
}

/** `Portal.intentVaultAddress(destination, routeBytes, reward)` — the PRIMARY vault path (an `eth_call`
 *  the caller performs; see `vault.ts#predictVaultAddress` for the zero-RPC offline option). */
export function intentVaultAddressCall(intent: Intent, target: PortalTarget): PortalReadCall<Hex> {
  assertEvmSource(intent, "intentVaultAddressCall");
  return readCall(intent, target, "intentVaultAddress", (result) => {
    const [addr] = decodeAbiParameters([{ type: "address" }], result);
    return addr as Hex;
  });
}

/** `Portal.getIntentHash(destination, routeBytes, reward)` — the on-chain cross-check for our
 *  off-chain `hashIntent`. */
export function intentHashCall(intent: Intent, target: PortalTarget): PortalReadCall<IntentHashes> {
  assertEvmSource(intent, "intentHashCall");
  return readCall(intent, target, "getIntentHash", (result) => {
    const [intentHash, rHash, wHash] = decodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      result,
    );
    return { intentHash, routeHash: rHash, rewardHash: wHash } as IntentHashes;
  });
}

/** `Portal.isIntentFunded(destination, routeBytes, reward)`. */
export function isIntentFundedCall(intent: Intent, target: PortalTarget): PortalReadCall<boolean> {
  assertEvmSource(intent, "isIntentFundedCall");
  return readCall(intent, target, "isIntentFunded", (result) => {
    const [funded] = decodeAbiParameters([{ type: "bool" }], result);
    return funded as boolean;
  });
}

// ---------------------------------------------------------------------------
// Funding: by transfer to the vault (the default), or approve + publishAndFund
// ---------------------------------------------------------------------------

/**
 * How an intent's reward reaches its vault, everywhere the SDK funds one — this builder, the
 * program a Pot runs for an intent it opens, `sauce publish` (`--intent-fund-via`) and the MCP
 * `sauce_publish` tool (`intentFundVia`). The same two words, with the same meanings, as `.nest()`'s
 * `via`:
 *
 *  - `"transfer"` (the default): each reward token transferred to the vault, and the native amount
 *    sent to it, then `Portal.publish`. No approval. See the module doc.
 *  - `"publishAndFund"`: each reward token approved to the Portal, then `Portal.publishAndFund`,
 *    which pulls the reward into the vault, records the intent `Funded` and emits `IntentFunded`.
 */
export type IntentFundVia = "transfer" | "publishAndFund";

/** Every {@link IntentFundVia}, in the order a message lists them. */
export const INTENT_FUND_VIA: readonly IntentFundVia[] = ["transfer", "publishAndFund"];

/** One thing the vault must hold for the intent to count as funded: a token's amount, or (with no
 *  `token`) the native amount. */
export interface VaultLeg {
  /** The reward token, checksummed; absent for the native amount. */
  readonly token?: Hex;
  readonly amount: bigint;
}

/**
 * What the vault must hold: one leg per DISTINCT reward token, in first-seen order, for the largest
 * of its amounts, then the native amount. Largest and not the sum, because
 * `IntentSource._isRewardFunded` compares each entry against the vault's whole balance of that
 * token — the same reason {@link approvalTxs} approves the largest. A zero leg needs nothing and is
 * left out.
 */
export function rewardVaultLegs(intent: Intent): readonly VaultLeg[] {
  const largest = new Map<Hex, bigint>();
  for (const { token, amount } of intent.reward.tokens) {
    const address = getAddress(denormalizeToEvm(token)) as Hex;
    const previous = largest.get(address);
    if (previous === undefined || amount > previous) largest.set(address, amount);
  }
  const legs: VaultLeg[] = [...largest]
    .filter(([, amount]) => amount > 0n)
    .map(([token, amount]) => ({ token, amount }));
  if (intent.reward.nativeAmount > 0n) legs.push({ amount: intent.reward.nativeAmount });

  return legs;
}

/**
 * One leg paid into `vault`: `token.transfer(vault, amount)`, or `amount` wei sent with no data.
 *
 * A wallet's transaction, not a program's call, so there is no `SafeERC20` check to run on the
 * return: a token that returns nothing (USDT) lands like any other, and one that returns `false`
 * lands having moved nothing. What catches that is the vault's balance, not the receipt — ask
 * `isIntentFundedCall` once the transfers have landed and before `publish` is sent, as
 * `sauce publish` does. (A Pot's transfer into the vault is a program's, and is `SafeERC20`'s:
 * `intent-sugar.ts#vaultFundingStatements`.)
 */
export function vaultTransferTx(vault: AddressInput, leg: VaultLeg): PortalTx {
  const to = getAddress(denormalizeToEvm(toUniversalAddress(vault))) as Hex;
  if (leg.token === undefined) return { to, data: "0x", value: leg.amount };

  return {
    to: leg.token,
    data: encodeFunctionData({ abi: ERC20ABI, functionName: "transfer", args: [to, leg.amount] }),
    value: 0n,
  };
}

/** Every leg of {@link rewardVaultLegs} paid into `vault`, in order. */
export function vaultTransferTxs(intent: Intent, vault: AddressInput): readonly PortalTx[] {
  assertEvmSource(intent, "vaultTransferTxs");

  return rewardVaultLegs(intent).map((leg) => vaultTransferTx(vault, leg));
}

/**
 * The intent's vault on `target.portal`, derived offline (`vault.ts#ecoRoutesVaultConfig`): what
 * `Portal.intentVaultAddress` returns for an eco-routes Portal, with nothing read from a chain.
 */
export function predictIntentVault(intent: Intent, target: PortalTarget): Hex {
  assertEvmSource(intent, "predictIntentVault");

  return predictVaultAddress(hashIntent(intent).intentHash, ecoRoutesVaultConfig(target.portal));
}

/** A vault read from a chain that is not the one the SDK derives for the intent. */
export class IntentVaultMismatchError extends Error {
  constructor(
    readonly reported: Hex,
    readonly predicted: Hex,
  ) {
    super(
      `the Portal reports the intent's vault as ${reported}, but the SDK derives ${predicted} — ` +
        "refusing to send the reward to either. The endpoint may be answering for another chain " +
        "or Portal, or this Portal derives its vaults some other way; fund it with fundVia " +
        "publishAndFund instead, where the Portal moves the reward itself.",
    );
    this.name = "IntentVaultMismatchError";
  }
}

/**
 * `vault` — read with `intentVaultAddressCall` — checked against {@link predictIntentVault}, and
 * returned checksummed. Throws {@link IntentVaultMismatchError} when they differ: a transfer is
 * final, so an address two sources disagree on is not paid.
 */
export function assertIntentVault(intent: Intent, target: PortalTarget, vault: AddressInput): Hex {
  const predicted = predictIntentVault(intent, target);
  const reported = getAddress(denormalizeToEvm(toUniversalAddress(vault))) as Hex;
  if (reported !== predicted) throw new IntentVaultMismatchError(reported, predicted);

  return reported;
}

/** What {@link intentSourceTxs} builds. */
export interface IntentSourceTxsOptions {
  /** Default `"transfer"`. */
  readonly fundVia?: IntentFundVia;
  /** `"transfer"` only: the vault as the Portal reports it (`intentVaultAddressCall`), checked
   *  against the SDK's derivation before anything is paid to it. Omitted, the derivation is used. */
  readonly vault?: AddressInput;
  /** `"publishAndFund"`: passed to `publishAndFund`. Default `false`, the only value `"transfer"`
   *  takes — it pays the whole reward. */
  readonly allowPartial?: boolean;
}

/**
 * The source-chain transactions that fund and publish `intent` from one wallet, in the order to
 * send them:
 *
 *  - `fundVia: "transfer"` (default): {@link vaultTransferTxs} into the vault, then
 *    {@link publishTx};
 *  - `fundVia: "publishAndFund"`: {@link approvalTxs}, then {@link publishAndFundTx}.
 *
 * Pure: the caller performs any read and sends the transactions. An option the mode cannot honour
 * (`vault` under `"publishAndFund"`, `allowPartial: true` under `"transfer"`) throws rather than
 * being ignored.
 */
export function intentSourceTxs(
  intent: Intent,
  target: PortalTarget,
  options: IntentSourceTxsOptions = {},
): readonly PortalTx[] {
  const fundVia = options.fundVia ?? "transfer";
  if (!INTENT_FUND_VIA.includes(fundVia)) {
    throw new Error(
      `portal.ts#intentSourceTxs: fundVia '${String(fundVia)}' is not ` +
        `${INTENT_FUND_VIA.map((via) => `"${via}"`).join(" or ")}`,
    );
  }
  if (fundVia === "publishAndFund") {
    if (options.vault !== undefined) {
      throw new Error(
        'portal.ts#intentSourceTxs: `vault` goes with fundVia "transfer" — under ' +
          '"publishAndFund" the Portal finds the vault itself',
      );
    }

    return [
      ...approvalTxs(intent, target),
      publishAndFundTx(intent, options.allowPartial ?? false, target),
    ];
  }
  if (options.allowPartial === true) {
    throw new Error(
      'portal.ts#intentSourceTxs: `allowPartial` goes with fundVia "publishAndFund" — a transfer ' +
        "pays the whole reward, and `publish` takes no such flag",
    );
  }
  const vault =
    options.vault === undefined
      ? predictIntentVault(intent, target)
      : assertIntentVault(intent, target, options.vault);

  return [...vaultTransferTxs(intent, vault), publishTx(intent, target)];
}
