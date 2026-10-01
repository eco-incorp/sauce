/**
 * `sauce intent fill`: a solver's fill of the intents a file opens (or the store holds), on each intent's
 * DESTINATION chain — rehearsed with no key and nothing sent, the other half of
 * `publish --dry-run`, which rehearses only the source chain's funding of the vault and `publish`;
 * or, with `--send` and a signer, rehearsed and then SENT, the signer being the solver. The route's
 * body is where an intent fails (a swap, a minimum, a refund), and it runs only on the destination,
 * inside `Portal.fulfill`.
 *
 * The transactions are `lifecycle.ts#planFill`'s, the same ones `sauce mcp` returns unsigned:
 *
 *   1. `Kitchen.deployPot(executor, 0)`, when the route cooks on the destination's shared intent
 *      Pot and it is not deployed yet. Any account may send it; the Pot is the Executor's either way.
 *   2. The solver's approval of the Portal for each route token (`fulfillApprovalTxs`), reset to
 *      zero first where a smaller allowance stands. The Portal pulls the tokens from the solver.
 *   3. `Portal.fulfillAndProve(…)` with the route's `nativeAmount` (the Kitchen's fee for each cook)
 *      plus the prover's quoted fee as its value, when the reward's prover is a Hyperlane one this
 *      command drives — else, or with `--no-prove`, `Portal.fulfill(intentHash, route, rewardHash,
 *      claimant)` with the native amount alone, to be proven later (`sauce intent prove`).
 *
 * They are rehearsed in one `eth_simulateV1` block, every call from the solver, state carried from
 * one to the next. A rehearsal with nothing to send gives the solver what it delivers by state
 * override: each route token's balance, where the token keeps it found as `simulate
 * --assume-balance` finds it (`assume.ts`), and the value. With `--send` nothing is assumed: the
 * rehearsal runs on the solver's real balances, and a fill that would revert is not sent. What the
 * fill moved is read back from the fulfill's logs (`effects.ts`), and what it left in the shared Pot
 * and the Executor — shared by every intent through that Portal, so anything left there is
 * anyone's — from their balances before it plus what it moved.
 *
 * Every address is the registry's or read from the chain: the Portal is the one the route records,
 * the Executor its `executor()`, the Pot derived from that Executor and the zero salt, the prover
 * the registry's counterpart of the reward's (`lifecycle.ts#proverPlan`).
 */
import {
  decodeErrorResult,
  formatUnits,
  getAbiItem,
  getAddress,
  keccak256,
  numberToHex,
  parseAbi,
  toFunctionSelector,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/index.js";
import { v12PotAbi } from "../evm/engine.js";
import { PortalABI, ProverABI } from "../protocols/eco-routes/abis.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../routes/encode.js";
import type { Intent } from "../routes/types.js";
import { CliError, UsageError } from "./args.js";
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { connect, revertReason, sendAndWait, type Sent } from "./chain.js";
import {
  compileProgram,
  kitchenAddress,
  type CliFiles,
  unapproved,
  type Approver,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import {
  addressLabels,
  effectLines,
  effectsJson,
  effectsOf,
  formatAmount,
  labelled,
  nativeSymbol,
  type Effects,
} from "./effects.js";
import {
  dispatchedMessages,
  intentRecord,
  planFill,
  type FillPlan,
  type FillStep,
  type IntentRecord,
} from "./lifecycle.js";
import { costJson, costLine, costOf } from "./receipt.js";
import type { IntentStore } from "./store.js";

/** The solver a rehearsal fills from when none is named: an address nobody holds the key of. */
export const DEFAULT_SOLVER: Address = getAddress("0x5a0ce0000000000000000000000000000000f111");

/** One intent to fill: what it is, and where it was published. */
export interface FillTarget {
  readonly intent: Intent;
  readonly source: CanonicalChain;
  readonly destination: CanonicalChain;
  /** The source chain's Portal, which holds its reward. */
  readonly sourcePortal: Hex;
}

export interface FillInput {
  readonly intents: readonly FillTarget[];
  /** Where they came from, for messages: the file, or the store. */
  readonly from: string;
  /** Names for addresses the program's defines hold (`RECIPIENT`). */
  readonly labels: ReadonlyArray<readonly [Address, string]>;
  /** The endpoint of `chain`, an intent's destination; throws when none was given for it. */
  readonly endpointOf: (chain: CanonicalChain) => string;
  /** The endpoint of `chain`, an intent's source, when one was given: it checks the prover. */
  readonly sourceEndpointOf?: (chain: CanonicalChain) => string | undefined;
  /** Whether that endpoint came from `--rpc-url` (one URL), for a message that names it. */
  readonly endpointFlag: "--rpc-url" | "--config";
  /** Who fills: the account the calls come from, given what it delivers. */
  readonly solver?: Address;
  /** Who claims the reward, 20 or 32 bytes; the solver when absent. */
  readonly claimant?: Hex;
  /** `false` with `--no-prove`: fill with `fulfill`, and prove later. */
  readonly prove?: boolean;
  /** `--send`: the signer, which is the solver, and who approves what it spends. */
  readonly send?: {
    readonly account: PrivateKeyAccount;
    /** Who approves what the fill spends: `--auto-approve`, or the person asked. */
    readonly approver: Approver;
    readonly store?: IntentStore;
  };
}

/** The Executor's refusals (`IExecutor.sol`, eco-routes `main`), which a failed route call reverts
 *  `fulfill` with: the Executor is a contract of its own, so the Portal's ABI does not declare them. */
const EXECUTOR_ERRORS = parseAbi([
  "error CallFailed((address target, bytes data, uint256 value) call, bytes reason)",
  "error CallToEOA(address target)",
  "error NonPortalCaller(address caller)",
]);

/** What `fulfill` reverts with by name: the Portal's own errors (the Inbox's refusals among them,
 *  and SafeERC20's on a route token pull), the Executor's, and a message-bridge prover's fee. */
const FULFILL_ERRORS = [
  ...PortalABI.filter((item) => item.type === "error"),
  ...ProverABI.filter((item) => item.type === "error"),
  ...EXECUTOR_ERRORS,
] as const;

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const COOK = toFunctionSelector(getAbiItem({ abi: v12PotAbi, name: "cook" }));

/** A balance the rehearsal gives the solver. */
interface Assumed {
  readonly token: Address | "native";
  readonly symbol: string;
  readonly decimals?: number;
  readonly amount: bigint;
  readonly slot?: { readonly slot: Hex; readonly layout: string };
  readonly because: string;
}

/** What the shared Pot or the Executor held of a token before the fill, and after it. */
interface Left {
  readonly holder: Address;
  readonly token: Address | "native";
  readonly before: bigint;
  readonly after: bigint;
}

interface Fill {
  readonly target: FillTarget;
  readonly plan: FillPlan;
  readonly results: ReadonlyArray<{ readonly status: string; readonly gasUsed?: bigint }>;
  readonly assumed: readonly Assumed[];
  readonly labels: ReadonlyMap<string, string>;
  readonly notes: readonly string[];
  readonly client: PublicClient;
  readonly outcome:
    | {
        readonly ok: true;
        readonly gas: bigint;
        readonly effects: Effects;
        readonly left: readonly Left[];
        /** The claimant the Portal's `IntentFulfilled` log records, when it logged one. */
        readonly recordedClaimant?: Hex;
      }
    | { readonly ok: false; readonly stage: FillStep["kind"]; readonly reason: string };
}

const read = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    throw new CliError(
      `reading ${what} failed: ${(error as { shortMessage?: string }).shortMessage ?? "the call reverted"}`,
    );
  }
};

/** The intents the file opens, each one a solver could fill from what the file says. */
export function fillTargets(input: ProgramInput, files: CliFiles): readonly FillTarget[] {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce intent fill rehearses intents an EVM chain opens, and ${input.chain.slug} is not one: ` +
        "the eco-routes Portal this SDK publishes through is EVM only",
    );
  }
  const intents = compileProgram(input, files).intents;
  if (intents.length === 0) {
    throw new UsageError(`${input.file} opens no intent: there is nothing for a solver to fill`);
  }
  for (const intent of intents) {
    if (intent.captures.length > 0) {
      throw new CliError(
        `the intent to ${intent.destination.slug} uses ` +
          `${intent.captures.map((name) => `\`${name}\``).join(", ")}, which the program measures ` +
          "or computes while it runs: its route exists only once the program has run, so it " +
          "cannot be rehearsed from the file. Name it by its hash once `sauce run` has published " +
          "it, or make the value a literal, a define or a top-level `const` of a literal",
      );
    }
  }

  return intents.map((intent) => ({
    intent: intent.intent,
    source: input.chain,
    destination: intent.destination,
    sourcePortal: ecoRoutesPortal(input.chain),
  }));
}

/** Names for the addresses a define holds: `RECIPIENT`, `REFUND_TO`. A define of an address-sized
 *  integer that is not one names nothing a fill touches. */
export function defineLabels(input: ProgramInput): Array<readonly [Address, string]> {
  const names = new Map<string, string[]>();
  for (const [name, value] of Object.entries(input.defines)) {
    if (typeof value !== "bigint" || value < 1n << 64n || value >= 1n << 160n) continue;
    const address = getAddress(numberToHex(value, { size: 20 }));
    names.set(address, [...(names.get(address) ?? []), name]);
  }

  return [...names].map(([address, list]) => [address as Address, list.join(", ")] as const);
}

/** Why the fulfill reverted, unwrapping a failed route call to the reason it failed with. */
function fulfillReason(data: Hex | undefined, intent: Intent, pot: Address): string {
  if (data === undefined || data === "0x") {
    return "it reverted with no data (out of gas, or a revert with no reason)";
  }
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: FULFILL_ERRORS, data });
  } catch {
    return revertReason({ data });
  }
  const route = intent.route;
  switch (decoded.errorName) {
    case "CallFailed": {
      const [call, reason] = decoded.args;
      const index = route.calls.findIndex(
        (entry) =>
          getAddress(denormalizeToEvm(entry.target)) === getAddress(call.target) &&
          entry.data.toLowerCase() === call.data.toLowerCase() &&
          entry.value === call.value,
      );
      const target = getAddress(call.target);
      const what =
        target === pot && call.data.startsWith(COOK)
          ? `the cook on the shared Pot ${target}`
          : `the call to ${target}`;
      const which = index < 0 ? "a route call" : `route call ${index + 1} of ${route.calls.length}`;

      return `${which} (${what}) reverted: ${fulfillReason(reason, intent, pot)}`;
    }
    case "CallToEOA": {
      const [target] = decoded.args;

      return getAddress(target) === pot
        ? `CallToEOA(${target}): the shared Pot is not deployed, so the route's cook calls an ` +
            "address with no code"
        : `CallToEOA(${target}): a route call has data for an address with no code`;
    }
    case "IntentExpired":
      return (
        `IntentExpired(): the route's deadline, ${route.deadline} ` +
        `(${new Date(Number(route.deadline) * 1000).toISOString()}), has passed`
      );
    case "InvalidHash":
      return (
        `InvalidHash(${decoded.args[0]}): the Portal hashes this route and reward to something ` +
        "else"
      );
    case "IntentAlreadyFulfilled":
      return `IntentAlreadyFulfilled(${decoded.args[0]}): a solver has already filled this intent`;
    case "InsufficientFee":
      return `InsufficientFee(${decoded.args[0]}): the prover's fee rose above the one quoted`;
    default: {
      const args = (decoded.args ?? []).map((arg) => String(arg));

      return `${decoded.errorName}(${args.join(", ")})`;
    }
  }
}

/** Why a call before the fulfill failed. */
const stepReason = (data: Hex | undefined): string =>
  data === undefined || data === "0x"
    ? "it reverted with no data (out of gas, or a revert with no reason)"
    : revertReason({ data });

/** The destination's client, naming `--rpc-url` when it serves the wrong chain. */
async function destinationClient(input: FillInput, target: FillTarget): Promise<PublicClient> {
  try {
    return await connect(input.endpointOf(target.destination), target.destination);
  } catch (error) {
    if (error instanceof CliError && input.endpointFlag === "--rpc-url") {
      throw new CliError(
        `${error.message}. sauce intent fill rehearses on the intent's destination, so --rpc-url is ` +
          `${target.destination.slug}'s endpoint, not ${target.source.slug}'s`,
      );
    }
    throw error;
  }
}

/** Rehearses the fill of one intent on its destination: with what it delivers assumed, unless it
 *  is about to be sent from `send`'s account. */
async function rehearseFill(input: FillInput, target: FillTarget): Promise<Fill> {
  const chain = target.destination;
  const client = await destinationClient(input, target);
  const sourceUrl = input.sourceEndpointOf?.(target.source);
  const source = sourceUrl === undefined ? undefined : await connect(sourceUrl, target.source);
  const sending = input.send !== undefined;
  const solver = input.send?.account.address ?? input.solver ?? DEFAULT_SOLVER;
  const plan = await planFill(client, target.intent, {
    solver,
    ...(input.claimant === undefined ? {} : { claimant: input.claimant }),
    ...(input.prove === undefined ? {} : { prove: input.prove }),
    ...(source === undefined ? {} : { source }),
  });
  const notes = [...plan.notes];
  const overrides: StateOverride[number][] = [];
  const assumed: Assumed[] = [];
  if (!sending) {
    // What the solver holds too little of, given it by state override: found for every token at
    // once, each one's balance word.
    const found = await Promise.all(
      plan.tokens.map(async (token) => {
        if (token.held >= token.amount) return undefined;
        const symbol = token.info.symbol ?? token.token;
        const slot = await assumeTokenBalance(
          client,
          token.token,
          solver,
          token.amount,
          symbol,
        ).catch((error: unknown) => {
          if (!(error instanceof CliError)) throw error;
          // `assume.ts` words its refusals for `--assume-balance`; here the balance is the solver's.
          const why = error.message
            .replace(/^--assume-balance [^:]+: /, "")
            .replace(/ Fund the Pot instead\.$/, "")
            .replace(/\.$/, "");
          throw new CliError(
            `the solver delivers ${symbol}, and the rehearsal cannot give it a balance: ` +
              `${why}. Pass --solver <an address that holds it>.`,
          );
        });

        return { token, symbol, slot };
      }),
    );
    for (const entry of found) {
      if (entry === undefined) continue;
      overrides.push(entry.slot.override);
      assumed.push({
        token: entry.token.token,
        symbol: entry.symbol,
        ...(entry.token.info.decimals === undefined ? {} : { decimals: entry.token.info.decimals }),
        amount: entry.token.amount,
        slot: { slot: entry.slot.slot, layout: entry.slot.layout },
        because: "the route's tokens, which the solver delivers",
      });
    }
    const balance = await read("the solver's balance", () =>
      client.getBalance({ address: solver }),
    );
    if (balance < plan.value) {
      overrides.push({ address: solver, balance: plan.value });
      assumed.push({
        token: "native",
        symbol: nativeSymbol(chain),
        decimals: 18,
        amount: plan.value,
        because: plan.proves ? "fulfillAndProve's value" : "fulfill's value",
      });
    }
  }

  let calls;
  try {
    const merged = mergeOverrides(overrides);
    [{ calls } = { calls: [] }] = await client.simulateBlocks({
      blocks: [
        {
          calls: plan.steps.map(({ to, data, value }) => ({ account: solver, to, data, value })),
          ...(merged.length === 0 ? {} : { stateOverrides: merged }),
        },
      ],
      traceTransfers: true,
      validation: false,
    });
  } catch (error) {
    throw new CliError(
      `rehearsing a fill needs eth_simulateV1 — the deploy, the approvals and the fulfill in one ` +
        `block — and the ${chain.slug} endpoint did not run it: ` +
        ((error as { shortMessage?: string }).shortMessage ?? "the request failed").replace(
          /\.$/,
          "",
        ),
    );
  }
  const labels = addressLabels(chain, [
    ...input.labels,
    [kitchenAddress(), "Kitchen"],
    [getAddress(v12EngineAddress()), "engine"],
    [plan.portal, "Portal"],
    [plan.executor, "the Portal's Executor"],
    [plan.pot, "the shared intent Pot"],
    ...(plan.prover.destinationProver === undefined
      ? []
      : [
          [
            plan.prover.destinationProver,
            plan.prover.kind === undefined ? "the prover" : `the ${plan.prover.kind} prover`,
          ] as const,
        ]),
    [solver, "the solver"],
  ]);
  const base = {
    target,
    plan,
    client,
    results: plan.steps.map((_, index) => ({
      status: calls[index]?.status ?? "not run",
      ...(calls[index]?.gasUsed === undefined ? {} : { gasUsed: calls[index]!.gasUsed }),
    })),
    assumed,
    labels,
    notes,
  };
  const failed = plan.steps.findIndex((_, index) => calls[index]?.status !== "success");
  if (failed >= 0) {
    const step = plan.steps[failed]!;

    return {
      ...base,
      outcome: {
        ok: false,
        stage: step.kind,
        reason:
          step.kind === "fulfill"
            ? fulfillReason(calls[failed]?.data, target.intent, plan.pot)
            : stepReason(calls[failed]?.data),
      },
    };
  }
  const result = calls[plan.steps.length - 1]!;
  const logs = (result.logs ?? []).map((log) => ({
    address: getAddress(log.address),
    topics: log.topics as readonly Hex[],
    data: log.data,
  }));
  const native = getAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  const traced = plan.value === 0n || logs.some((log) => log.address === native);
  const effects = await effectsOf(client, chain, logs, traced, labels);
  const recorded = fulfilledLog(logs, plan);

  return {
    ...base,
    outcome: {
      ok: true,
      gas: result.gasUsed,
      effects,
      left: await leftBehind(client, effects, [plan.pot, plan.executor]),
      ...(recorded === undefined ? {} : { recordedClaimant: recorded }),
    },
  };
}

/** `IntentFulfilled(bytes32 indexed intentHash, bytes32 indexed claimant)` (`IInbox.sol`). */
const INTENT_FULFILLED = keccak256(toHex("IntentFulfilled(bytes32,bytes32)"));

/** The claimant the Portal's own record of the fill names: `IntentFulfilled(intentHash, claimant)`,
 *  what a prover later carries back to the source chain. */
function fulfilledLog(
  logs: ReadonlyArray<{ readonly address: Address; readonly topics: readonly Hex[] }>,
  plan: FillPlan,
): Hex | undefined {
  return logs.find(
    (log) =>
      log.address === plan.portal &&
      log.topics[0]?.toLowerCase() === INTENT_FULFILLED &&
      log.topics[1]?.toLowerCase() === plan.hashes.intentHash.toLowerCase(),
  )?.topics[2];
}

/** What each of `holders` held, before the fill and after it, of every token the fill moved to or
 *  from it: its balance now plus the fill's net change. */
async function leftBehind(
  client: PublicClient,
  effects: Effects,
  holders: readonly Address[],
): Promise<Left[]> {
  const pairs = holders.flatMap((holder) => {
    const tokens = new Set<Address | "native">();
    for (const move of [...effects.transfers, ...(effects.native ?? [])]) {
      if (move.from === holder || move.to === holder) tokens.add(move.token);
    }

    return [...tokens].map((token) => ({ holder, token }));
  });

  // Every balance at once: they are independent reads of the state before the fill.
  return Promise.all(
    pairs.map(async ({ holder, token }) => {
      const before =
        token === "native"
          ? await read("a balance", () => client.getBalance({ address: holder }))
          : await read("a token balance", () =>
              client.readContract({
                address: token,
                abi: ERC20,
                functionName: "balanceOf",
                args: [holder],
              }),
            );
      const delta =
        effects.changes
          .find((change) => change.address === holder)
          ?.deltas.find((entry) => entry.token === token)?.amount ?? 0n;

      return { holder, token, before, after: before + delta };
    }),
  );
}

const assumedText = (balance: Assumed): string =>
  balance.decimals === undefined
    ? `${balance.amount} ${balance.symbol} (base units)`
    : `${formatUnits(balance.amount, balance.decimals)} ${balance.symbol}`;

const head = (fill: Fill): string =>
  `Intent ${fill.plan.hashes.intentHash} from ${fill.target.source.slug} to ` +
  `${fill.target.destination.slug}: `;

/** One intent's rehearsal, for a person. */
function fillLines(fill: Fill, sending: boolean): string[] {
  const at = (address: Address): string => labelled(fill.labels, address);
  const outcome = fill.outcome;
  const { plan } = fill;
  const lines = [
    outcome.ok
      ? `${head(fill)}the fill succeeds, gas used ${outcome.gas}`
      : outcome.stage === "fulfill"
        ? `${head(fill)}the fill reverts: ${outcome.reason}`
        : `${head(fill)}the ${outcome.stage === "deploy" ? "Pot's deployment" : "approval"} before the ` +
          `fill reverts: ${outcome.reason}`,
    `Rehearsed with eth_simulateV1 on ${fill.target.destination.slug}, one block from the solver ` +
      `${plan.solver}; ${sending ? "nothing assumed" : "nothing was signed or sent"}:`,
    ...plan.steps.map((step, index) => {
      const ran = fill.results[index]!;
      const status =
        ran.status === "success"
          ? ran.gasUsed === undefined
            ? ""
            : ` (gas ${ran.gasUsed})`
          : ran.status === "not run"
            ? " (not run)"
            : " (reverts)";

      return `  ${index + 1}. ${step.kind === "deploy" ? `${step.what}: the shared intent Pot ${plan.pot} is not deployed on ${fill.target.destination.slug} yet, and any account may deploy it` : step.what}${status}`;
    }),
  ];
  if (fill.assumed.length > 0) {
    lines.push(
      "Assumed for this rehearsal only, by state override:",
      ...fill.assumed.map(
        (balance) =>
          `  the solver holds ${assumedText(balance)}: ${balance.because}` +
          (balance.slot === undefined
            ? ""
            : ` (its balance word ${balance.slot.slot}: ${balance.slot.layout})`),
      ),
    );
  }
  if (!outcome.ok) return lines;
  lines.push(
    ...effectLines(outcome.effects),
    outcome.recordedClaimant === undefined
      ? "warning: the Portal logged no IntentFulfilled for this intent"
      : `The Portal records the fill: IntentFulfilled(${plan.hashes.intentHash}, claimant ` +
          `${outcome.recordedClaimant})`,
  );
  const kept = outcome.left.filter((entry) => entry.after !== 0n);
  if (kept.length === 0) {
    lines.push(
      `Left behind: nothing. ${plan.cooks ? "The shared intent Pot and the" : "The"} Portal's ` +
        `Executor ${plan.cooks ? "end" : "ends"} holding none of what the fill moved.`,
    );
  } else {
    lines.push(
      "Left behind, where any later intent or solver can take it:",
      ...kept.map(
        (entry) =>
          `  ${at(entry.holder)} ends holding ` +
          `${formatAmount(outcome.effects, entry.token, entry.after)}` +
          (entry.before === 0n
            ? ""
            : ` (it held ${formatAmount(outcome.effects, entry.token, entry.before)} before)`),
      ),
    );
  }

  return lines;
}

const proverJson = (plan: FillPlan) => ({
  proves: plan.proves,
  prover: {
    kind: plan.prover.kind ?? null,
    source: plan.prover.sourceProver,
    destination: plan.prover.destinationProver ?? null,
    supported: plan.prover.supported,
    ...(plan.prover.why === undefined ? {} : { why: plan.prover.why }),
  },
  fee: { prover: plan.fee.prover.toString(), kitchen: plan.fee.kitchen.toString() },
});

/** One intent's rehearsal, for a program. */
function fillJson(fill: Fill): Record<string, unknown> {
  const outcome = fill.outcome;
  const { plan } = fill;

  return {
    ok: outcome.ok,
    intentHash: plan.hashes.intentHash,
    routeHash: plan.hashes.routeHash,
    rewardHash: plan.hashes.rewardHash,
    source: fill.target.source.slug,
    destination: fill.target.destination.slug,
    chainId: fill.target.destination.id,
    portal: plan.portal,
    executor: plan.executor,
    pot: plan.pot,
    potDeployed: plan.deployed,
    solver: plan.solver,
    claimant: plan.claimant,
    value: plan.value.toString(),
    ...proverJson(plan),
    path: "eth_simulateV1",
    calls: plan.steps.map((step, index) => ({
      what: step.what,
      kind: step.kind,
      to: step.to,
      data: step.data,
      value: step.value.toString(),
      status: fill.results[index]!.status,
      ...(fill.results[index]!.gasUsed === undefined
        ? {}
        : { gasUsed: fill.results[index]!.gasUsed!.toString() }),
    })),
    assumed: fill.assumed.map((balance) => ({
      holder: plan.solver,
      token: balance.token,
      symbol: balance.symbol,
      amount: balance.amount.toString(),
      ...(balance.decimals === undefined
        ? {}
        : { formatted: formatUnits(balance.amount, balance.decimals) }),
      because: balance.because,
      ...(balance.slot === undefined
        ? {}
        : { slot: balance.slot.slot, layout: balance.slot.layout }),
    })),
    ...(outcome.ok
      ? {
          gas: outcome.gas.toString(),
          fulfilled:
            outcome.recordedClaimant === undefined ? null : { claimant: outcome.recordedClaimant },
          ...effectsJson(outcome.effects),
          leftBehind: outcome.left.map((entry) => ({
            holder: entry.holder,
            ...(fill.labels.get(entry.holder) === undefined
              ? {}
              : { label: fill.labels.get(entry.holder) }),
            token: entry.token,
            ...(outcome.effects.tokens.get(entry.token)?.symbol === undefined
              ? {}
              : { symbol: outcome.effects.tokens.get(entry.token)!.symbol }),
            before: entry.before.toString(),
            after: entry.after.toString(),
          })),
        }
      : { stage: outcome.stage, reason: outcome.reason }),
  };
}

/** What a fill spends from the solver: each route token, and the value. */
function spendLines(fill: Fill): string[] {
  const { plan } = fill;
  const native = nativeSymbol(fill.target.destination);
  const parts = plan.tokens.map(
    (token) =>
      `${formatAmount({ tokens: new Map([[token.token, token.info]]) }, token.token, token.amount)} ` +
      "(the route's tokens, which the Portal pulls from you into its Executor)",
  );
  if (plan.value > 0n) {
    const pieces = [
      plan.fee.kitchen > 0n ? `${formatUnits(plan.fee.kitchen, 18)} for the Kitchen` : undefined,
      plan.value - plan.fee.kitchen - plan.fee.prover > 0n
        ? `${formatUnits(plan.value - plan.fee.kitchen - plan.fee.prover, 18)} the route spends`
        : undefined,
      plan.fee.prover > 0n
        ? `${formatUnits(plan.fee.prover, 18)} for the ${plan.prover.kind} proof`
        : undefined,
    ].filter((piece) => piece !== undefined);
    parts.push(`${formatUnits(plan.value, 18)} ${native} of value (${pieces.join(", ")})`);
  }

  return [
    `Filling ${plan.hashes.intentHash} on ${fill.target.destination.slug} sends ` +
      `${plan.steps.length} transaction(s) from ${plan.solver}:`,
    ...plan.steps.map((step, index) => `  ${index + 1}. ${step.what}`),
    `It spends ${parts.length === 0 ? "nothing but gas" : `${parts.join(" and ")}, plus gas`}.`,
  ];
}

/** One sent fill: its transactions, and what the fulfill did. */
interface SentFill {
  readonly fill: Fill;
  readonly sent: ReadonlyArray<{ readonly step: FillStep; readonly result: Sent }>;
  readonly effects: Effects;
  readonly recordedClaimant?: Hex;
  readonly messages: ReadonlyArray<{ readonly mailbox: Address; readonly id: Hex }>;
  readonly time: bigint;
}

/**
 * The fills again, planned and rehearsed on the chain as it is once a person has approved them:
 * a question can stand for minutes, in which the prover's fee or the solver's allowance can move.
 * Refuses, sending nothing, when a fill no longer rehearses or would now spend more native value
 * than was approved; a fill that spends less (a lower fee) goes ahead with the new plan.
 */
async function replanned(input: FillInput, fills: readonly Fill[]): Promise<Fill[]> {
  const fresh = await Promise.all(fills.map((fill) => rehearseFill(input, fill.target)));
  for (const [index, fill] of fresh.entries()) {
    const approved = fills[index]!.plan;
    if (!fill.outcome.ok) {
      throw new CliError(
        `not sent: ${fill.plan.hashes.intentHash} no longer rehearses on ` +
          `${fill.target.destination.slug} (${fill.outcome.reason}): run it again`,
      );
    }
    if (fill.plan.value > approved.value) {
      const native = nativeSymbol(fill.target.destination);
      throw new CliError(
        `not sent: filling ${fill.plan.hashes.intentHash} now takes ` +
          `${formatUnits(fill.plan.value, 18)} ${native} of value, more than the ` +
          `${formatUnits(approved.value, 18)} ${native} you approved (the prover's fee rose): run it again`,
      );
    }
  }

  return fresh;
}

/** Sends `fill`'s transactions, in order, from the signer: each simulated first by `sendAndWait`. */
async function sendFill(input: FillInput, fill: Fill): Promise<SentFill> {
  const send = input.send!;
  const url = input.endpointOf(fill.target.destination);
  const sent: Array<{ step: FillStep; result: Sent }> = [];
  for (const step of fill.plan.steps) {
    const result = await sendAndWait(fill.client, url, send.account, step);
    sent.push({ step, result });
    if (result.status !== "success") {
      throw new CliError(`${step.what}: ${result.hash} reverted: ${result.reason ?? "no reason"}`);
    }
  }
  const fulfill = sent[sent.length - 1]!.result;
  const effects = await effectsOf(
    fill.client,
    fill.target.destination,
    fulfill.logs,
    false,
    fill.labels,
  );
  const block = await read("the fill's block", () =>
    fill.client.getBlock({ blockNumber: fulfill.blockNumber }),
  );
  const recorded = fulfilledLog(fulfill.logs, fill.plan);

  return {
    fill,
    sent,
    effects,
    ...(recorded === undefined ? {} : { recordedClaimant: recorded }),
    messages: dispatchedMessages(fulfill.logs),
    time: block.timestamp,
  };
}

/** What a sent fill did, for a person. */
function sentLines(done: SentFill): string[] {
  const { fill } = done;
  const native = nativeSymbol(fill.target.destination);
  const costs = done.sent.map(({ step, result }) =>
    result.receipt === undefined ? undefined : costOf(result.receipt, step.value),
  );
  const lines = [
    `${head(fill)}${fill.plan.proves ? "filled, and its proof sent" : "filled"}, in ` +
      `${done.sent.length} transaction(s) on ${fill.target.destination.slug} from ${fill.plan.solver}:`,
    ...done.sent.map(({ step, result }, index) => {
      const cost = costs[index];

      return (
        `  ${index + 1}. ${step.what}: ${result.hash}, block ${result.blockNumber}` +
        (cost === undefined
          ? `, gas used ${result.gasUsed}`
          : `; ${costLine(cost, fill.target.destination, step.kind === "fulfill" ? "the route's native amount and the proof's fee" : "none")}`)
      );
    }),
    `In all: ${formatUnits(
      costs.reduce((sum, cost) => sum + (cost?.total ?? 0n), 0n),
      18,
    )} ${native}` +
      (fill.plan.fee.prover > 0n
        ? `, ${formatUnits(fill.plan.fee.prover, 18)} of it the proof's fee`
        : ""),
    ...effectLines(done.effects),
    done.recordedClaimant === undefined
      ? "warning: the Portal logged no IntentFulfilled for this intent"
      : `The Portal records the fill: IntentFulfilled(${fill.plan.hashes.intentHash}, claimant ` +
        `${done.recordedClaimant})`,
  ];
  for (const message of done.messages) {
    lines.push(
      `The proof travels to ${fill.target.source.slug} as Hyperlane message ${message.id} ` +
        `(dispatched by the Mailbox ${message.mailbox}).`,
    );
  }

  return lines;
}

/** `sauce intent fill`: a solver's fill of each intent, rehearsed on its destination, and with `--send`,
 *  sent. */
export async function fillCommand(input: FillInput): Promise<CommandOutput> {
  const destinations = new Set(input.intents.map((target) => target.destination.slug));
  if (input.endpointFlag === "--rpc-url" && destinations.size > 1) {
    throw new UsageError(
      `${input.from}'s intents go to ${[...destinations].join(" and ")}: --rpc-url names one ` +
        "endpoint, so give --config, which names each destination's",
    );
  }
  for (const target of input.intents) {
    if (target.destination.kind !== "evm") {
      throw new CliError(
        `the intent to ${target.destination.slug} is fulfilled through Solana's Portal program, ` +
          "which this rehearsal does not run: it rehearses an EVM destination's Portal.fulfill",
      );
    }
  }
  const fills: Fill[] = [];
  for (const target of input.intents) fills.push(await rehearseFill(input, target));
  const notes = fills.flatMap((fill) => fill.notes);
  for (const fill of fills) {
    if (!fill.outcome.ok) continue;
    for (const entry of fill.outcome.left) {
      if (entry.after > entry.before) {
        notes.push(
          `warning: the fill leaves ` +
            `${formatAmount(fill.outcome.effects, entry.token, entry.after - entry.before)} in ` +
            `${labelled(fill.labels, entry.holder)}, which every intent through ${fill.target.destination.slug}'s ` +
            "Portal shares: a later intent's program or solver can take it. Send it on in the body.",
        );
      }
    }
  }
  const ok = fills.every((fill) => fill.outcome.ok);
  const rehearsal = {
    text: fills.map((fill) => fillLines(fill, input.send !== undefined).join("\n")).join("\n\n"),
    json: { ok, chain: input.intents[0]!.source.slug, intents: fills.map(fillJson) },
  };
  if (input.send === undefined || !ok) {
    return {
      ...rehearsal,
      ...(notes.length === 0 && (input.send === undefined || ok)
        ? {}
        : {
            notes: [
              ...notes,
              ...(input.send === undefined ? [] : ["not sent: the rehearsal reverts"]),
            ],
          }),
      ...(ok ? {} : { exitCode: 1 }),
    };
  }

  // Sending: say what it spends, and have it approved.
  const send = input.send;
  const spend = fills.flatMap((fill) => spendLines(fill));
  const action = `fill ${fills.map((fill) => fill.plan.hashes.intentHash).join(", ")}: ${spend
    .at(-1)!
    .replace(/^It spends /, "spend ")
    .replace(/\.$/, "")}`;
  const answer = await send.approver.approve(action, `${spend.join("\n")}\nSend them? [y/N] `);
  if (answer === undefined) throw unapproved([action]);
  if (!answer) throw new CliError("not sent: you declined");
  const done: SentFill[] = [];
  for (const fill of send.approver.auto ? fills : await replanned(input, fills)) {
    const result = await sendFill(input, fill);
    done.push(result);
    record(send.store, result);
  }

  return {
    text: [
      ...(send.approver.auto ? [...spend, ""] : []),
      done.map((entry) => sentLines(entry).join("\n")).join("\n\n"),
    ].join("\n"),
    json: {
      ok: true,
      sent: true,
      chain: input.intents[0]!.source.slug,
      intents: done.map((entry) => ({
        intentHash: entry.fill.plan.hashes.intentHash,
        source: entry.fill.target.source.slug,
        destination: entry.fill.target.destination.slug,
        solver: entry.fill.plan.solver,
        claimant: entry.fill.plan.claimant,
        ...proverJson(entry.fill.plan),
        transactions: entry.sent.map(({ step, result }) => ({
          what: step.what,
          kind: step.kind,
          hash: result.hash,
          status: result.status,
          block: result.blockNumber.toString(),
          gasUsed: result.gasUsed.toString(),
          ...(result.receipt === undefined
            ? {}
            : { cost: costJson(costOf(result.receipt, step.value)) }),
        })),
        fulfilled:
          entry.recordedClaimant === undefined ? null : { claimant: entry.recordedClaimant },
        messages: entry.messages,
        ...effectsJson(entry.effects),
      })),
    },
    notes: [
      ...notes,
      ...done.map((entry) =>
        entry.fill.plan.proves
          ? `Once the proof arrives on ${entry.fill.target.source.slug}, claim the reward: ` +
            `\`sauce intent claim ${entry.fill.plan.hashes.intentHash} --chain ${entry.fill.target.source.slug}\``
          : `Prove the fill to ${entry.fill.target.source.slug}, then claim: \`sauce intent prove ` +
            `${entry.fill.plan.hashes.intentHash} --chain ${entry.fill.target.source.slug}\``,
      ),
    ],
  };
}

/** Records a sent fill in the store: the intent, once, and what happened to it. */
function record(store: IntentStore | undefined, done: SentFill): void {
  if (store === undefined) return;
  const { fill } = done;
  const intentRecordOf: IntentRecord = intentRecord(fill.target.intent, {
    sourcePortal: fill.target.sourcePortal,
  });
  store.save(intentRecordOf);
  const fulfill = done.sent[done.sent.length - 1]!.result;
  const time = new Date(Number(done.time) * 1000).toISOString();
  const base = {
    chain: fill.target.destination.slug,
    chainId: fill.target.destination.id,
    tx: fulfill.hash,
    block: fulfill.blockNumber.toString(),
    time,
    from: fill.plan.solver,
  };
  store.append(fill.plan.hashes.intentHash, { event: "filled", ...base });
  for (const message of done.messages) {
    store.append(fill.plan.hashes.intentHash, { event: "proving", ...base, message: message.id });
  }
}
