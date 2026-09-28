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
 *  2. No viem overload ambiguity — `PORTAL_ABI` carries exactly one overload per name, so
 *     `encodeFunctionData({ abi, functionName })` can never resolve the wrong signature.
 *
 * `EVM_REWARD_PARAM` is IMPORTED from `encode.ts`, never re-declared, so the calldata's reward bytes
 * and the `rewardHash` `hashIntent` computed are the same bytes by construction. Same for the route:
 * the `bytes` argument below is `encodeRoute(intent.route, intent.destination)` — literally the
 * function `routeHash` calls.
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
 * `"evm"` — these are EVM Portal calldata, and the Solana Portal *program* is not in eco-routes on
 * `main` (zero `.rs` — design doc openQuestions 4/5). The DESTINATION may be `svm` and is fully
 * supported: an EVM-sourced reward with Borsh route bytes is exactly the
 * `DepositAddress_USDCTransfer_Solana.sol` shape.
 */
import { decodeAbiParameters, encodeFunctionData, type Hex } from "viem";

import { ERC20ABI } from "../protocols/erc20/abis.js";
import { denormalizeToEvm, encodeRoute, EVM_REWARD_PARAM, hashIntent, kindOf } from "./encode.js";
import type { IntentHashes } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import type { ContractsConfig } from "./compile-types.js";
import type { AddressInput, Intent } from "./types.js";

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

/** The `bytes`-route overload only — see the module doc for why. One overload per name, so
 *  `encodeFunctionData({ abi: PORTAL_ABI, functionName })` can never pick the wrong signature. */
export const PORTAL_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "vault", type: "address" },
    ],
  },
  {
    type: "function",
    name: "publishAndFund",
    stateMutability: "payable",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
      { name: "allowPartial", type: "bool" },
    ],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "vault", type: "address" },
    ],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "payable",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "routeHash", type: "bytes32" },
      EVM_REWARD_PARAM,
      { name: "allowPartial", type: "bool" },
    ],
    outputs: [{ name: "intentHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "intentVaultAddress",
    stateMutability: "view",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getIntentHash",
    stateMutability: "pure",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [
      { name: "intentHash", type: "bytes32" },
      { name: "routeHash", type: "bytes32" },
      { name: "rewardHash", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "isIntentFunded",
    stateMutability: "view",
    inputs: [
      { name: "destination", type: "uint64" },
      { name: "route", type: "bytes" },
      EVM_REWARD_PARAM,
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * `PORTAL_ABI` as a compiler BINDING, under the name a route body calls it by.
 *
 * `sauce-route.ts` layers this underneath every route compile, so a hand-written program can write
 * `IPortal.at(portal).publishAndFund(...)` with no import line and no caller configuration — the
 * same zero-setup posture `@sauce/token` and the protocol accessors already have. It is the BASE
 * layer, so a caller's own `IPortal` (or a synthesized protocol binding of that name) wins.
 *
 * An unused binding costs no bytecode: the compiler emits code for the calls a program makes, not
 * for the ABIs it was offered. `routes-portal-binding.test.ts` pins that.
 */
export const PORTAL_CONTRACTS: ContractsConfig = {
  // `PORTAL_ABI` is `as const`, so its tuple type is not assignable to viem's mutable `Abi` even
  // though the value is one. `rs-compile.ts` only ever `JSON.stringify`s it.
  IPortal: { abi: PORTAL_ABI as unknown as ContractsConfig[string]["abi"] },
};

function assertEvmSource(intent: Intent, helper: string): void {
  if (kindOf(intent.sourceChainId) !== "evm") {
    throw new Error(
      `portal.ts#${helper}: intent.sourceChainId (${intent.sourceChainId}) is not an EVM chain — ` +
        `these are EVM Portal calldata helpers, and eco-routes has no Solana Portal PROGRAM on ` +
        `\`main\` (zero .rs). The DESTINATION may be svm; only the SOURCE must be evm.`,
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
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PORTAL_ABI,
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
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PORTAL_ABI,
      functionName: "publishAndFund",
      args: [destinationArg(intent), routeBytesArg(intent), rewardTupleArg(intent), allowPartial],
    }),
    value: intent.reward.nativeAmount,
  };
}

/** `Portal.fund(destination, routeHash, reward, allowPartial)`. `value = reward.nativeAmount`. */
export function fundTx(intent: Intent, allowPartial: boolean, target: PortalTarget): PortalTx {
  assertEvmSource(intent, "fundTx");
  const rHash = hashIntent(intent).routeHash;
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PORTAL_ABI,
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

function readCall<T>(
  intent: Intent,
  target: PortalTarget,
  functionName: string,
  decode: (result: Hex) => T,
): PortalReadCall<T> {
  return {
    to: portalAddress(target),
    data: encodeFunctionData({
      abi: PORTAL_ABI,
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
