/**
 * `sauce fill`: a solver's fill of the intents a file opens, rehearsed on each intent's DESTINATION
 * chain with no key and nothing sent — the other half of `publish --dry-run`, which rehearses only
 * the source chain's funding of the vault and `publish`. The route's body is where an intent fails (a
 * swap, a minimum, a refund), and it runs only on the destination, inside `Portal.fulfill`.
 *
 * One `eth_simulateV1` block, every call from the solver, state carried from one to the next:
 *
 *   1. `Kitchen.deployPot(executor, 0)`, when the route cooks on the destination's shared intent
 *      Pot and it is not deployed yet. Any account may send it; the Pot is the Executor's either way.
 *   2. The solver's approval of the Portal for each route token (`fulfillApprovalTxs`), reset to
 *      zero first where a smaller allowance stands. The Portal pulls the tokens from the solver.
 *   3. `Portal.fulfill(intentHash, route, rewardHash, claimant)` (`fulfillTx`), with the route's
 *      `nativeAmount` — the Kitchen's fee for each cook — as its value.
 *
 * The solver is given what it delivers by state override: each route token's balance, where the
 * token keeps it found as `simulate --assume-balance` finds it (`assume.ts`), and the value. What
 * the fill moved is read back from the fulfill's logs (`effects.ts`), and what it left in the
 * shared Pot and the Executor — shared by every intent through that Portal, so anything left there
 * is anyone's — from their balances before it plus what it moved.
 *
 * `eth_simulateV1` only: three calls whose state carries is what a fill is, and an `eth_call` has
 * one. Every address is the registry's or read from the chain: the Portal is the one the route
 * records, the Executor its `executor()`, the Pot derived from that Executor and the zero salt.
 */
import {
  decodeErrorResult,
  encodeFunctionData,
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

import type { CanonicalChain } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12PredictPot } from "../deployments/pot.js";
import { v12PotAbi } from "../evm/engine.js";
import { PortalABI } from "../protocols/eco-routes/abis.js";
import { denormalizeToEvm, hashIntent } from "../routes/encode.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { fulfillApprovalTxs, fulfillTx, intentHashCall } from "../routes/portal.js";
import { sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import { CliError, UsageError } from "./args.js";
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { connect, kitchenFee, potState, revertReason, type TxRequest } from "./chain.js";
import {
  compileProgram,
  kitchenAddress,
  type CliFiles,
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
  tokenInfo,
  type Effects,
} from "./effects.js";

/** The solver a rehearsal fills from when none is named: an address nobody holds the key of. */
export const DEFAULT_SOLVER: Address = getAddress("0x5a0ce0000000000000000000000000000000f111");

export interface FillInput extends ProgramInput {
  /** The endpoint of `chain`, an intent's destination; throws when none was given for it. */
  readonly endpointOf: (chain: CanonicalChain) => string;
  /** Whether that endpoint came from `--rpc-url` (one URL), for a message that names it. */
  readonly endpointFlag: "--rpc-url" | "--config";
  /** Who fills: the account the calls come from, given what it delivers. */
  readonly solver?: Address;
  /** Who claims the reward, 20 or 32 bytes; the solver when absent. */
  readonly claimant?: Hex;
}

/** The Executor's refusals (`IExecutor.sol`, eco-routes `main`), which a failed route call reverts
 *  `fulfill` with: the Executor is a contract of its own, so the Portal's ABI does not declare them. */
const EXECUTOR_ERRORS = parseAbi([
  "error CallFailed((address target, bytes data, uint256 value) call, bytes reason)",
  "error CallToEOA(address target)",
  "error NonPortalCaller(address caller)",
]);

/** What `fulfill` reverts with by name: the Portal's own errors (the Inbox's refusals among them,
 *  and SafeERC20's on a route token pull), and the Executor's. */
const FULFILL_ERRORS = [
  ...PortalABI.filter((item) => item.type === "error"),
  ...EXECUTOR_ERRORS,
] as const;

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);

const COOK = toFunctionSelector(getAbiItem({ abi: v12PotAbi, name: "cook" }));

/** One call of the block, and what it is for. */
interface Step extends TxRequest {
  readonly what: string;
  readonly kind: "deploy" | "approve" | "fulfill";
}

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
  readonly intent: LoweredIntent;
  readonly source: CanonicalChain;
  readonly chain: CanonicalChain;
  readonly hashes: ReturnType<typeof hashIntent>;
  readonly portal: Address;
  readonly executor: Address;
  readonly pot: Address;
  /** Whether the route cooks on the shared Pot, and whether it is deployed. */
  readonly cooks: boolean;
  readonly deployed: boolean;
  readonly solver: Address;
  readonly claimant: Hex;
  readonly value: bigint;
  readonly steps: readonly Step[];
  readonly results: ReadonlyArray<{ readonly status: string; readonly gasUsed?: bigint }>;
  readonly assumed: readonly Assumed[];
  readonly labels: ReadonlyMap<string, string>;
  readonly notes: readonly string[];
  readonly outcome:
    | {
        readonly ok: true;
        readonly gas: bigint;
        readonly effects: Effects;
        readonly left: readonly Left[];
        /** The claimant the Portal's `IntentFulfilled` log records, when it logged one. */
        readonly recordedClaimant?: Hex;
      }
    | { readonly ok: false; readonly stage: Step["kind"]; readonly reason: string };
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
function fillable(input: ProgramInput, files: CliFiles): readonly LoweredIntent[] {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce fill rehearses intents an EVM chain opens, and ${input.chain.slug} is not one: ` +
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
          `${intent.captures.map((name) => `\`${name}\``).join(", ")}, measured on chain while the ` +
          "program runs: its route exists only once the program has run, so it cannot be " +
          "rehearsed from the file",
      );
    }
    if (intent.destination.kind !== "evm") {
      throw new CliError(
        `the intent to ${intent.destination.slug} is fulfilled through Solana's Portal program, ` +
          "which this rehearsal does not run: it rehearses an EVM destination's Portal.fulfill",
      );
    }
  }

  return intents;
}

/** Names for the addresses a define holds: `RECIPIENT`, `REFUND_TO`. A define of an address-sized
 *  integer that is not one names nothing a fill touches. */
function defineLabels(input: ProgramInput): Array<readonly [Address, string]> {
  const names = new Map<string, string[]>();
  for (const [name, value] of Object.entries(input.defines)) {
    if (typeof value !== "bigint" || value < 1n << 64n || value >= 1n << 160n) continue;
    const address = getAddress(numberToHex(value, { size: 20 }));
    names.set(address, [...(names.get(address) ?? []), name]);
  }

  return [...names].map(([address, list]) => [address as Address, list.join(", ")] as const);
}

/** Why the fulfill reverted, unwrapping a failed route call to the reason it failed with. */
function fulfillReason(data: Hex | undefined, fill: Pick<Fill, "intent" | "pot">): string {
  if (data === undefined || data === "0x") {
    return "it reverted with no data (out of gas, or a revert with no reason)";
  }
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: FULFILL_ERRORS, data });
  } catch {
    return revertReason({ data });
  }
  const route = fill.intent.intent.route;
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
        target === fill.pot && call.data.startsWith(COOK)
          ? `the cook on the shared Pot ${target}`
          : `the call to ${target}`;
      const which = index < 0 ? "a route call" : `route call ${index + 1} of ${route.calls.length}`;

      return `${which} (${what}) reverted: ${fulfillReason(reason, fill)}`;
    }
    case "CallToEOA": {
      const [target] = decoded.args;

      return getAddress(target) === fill.pot
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

/** Rehearses the fill of one intent on its destination. */
async function rehearseFill(
  input: FillInput,
  lowered: LoweredIntent,
  defined: ReadonlyArray<readonly [Address, string]>,
): Promise<Fill> {
  const chain = lowered.destination;
  const intent = lowered.intent;
  let client: PublicClient;
  try {
    client = await connect(input.endpointOf(chain), chain);
  } catch (error) {
    if (error instanceof CliError && input.endpointFlag === "--rpc-url") {
      throw new CliError(
        `${error.message}. sauce fill rehearses on the intent's destination, so --rpc-url is ` +
          `${chain.slug}'s endpoint, not ${input.chain.slug}'s`,
      );
    }
    throw error;
  }
  const portal = getAddress(denormalizeToEvm(intent.route.portal));
  const code = await read("the Portal's code", () => client.getCode({ address: portal }));
  if (code === undefined || code === "0x") {
    throw new CliError(`the Portal the route records, ${portal}, has no code on ${chain.slug}`);
  }
  const executor = await read("the Portal's executor()", () =>
    client.readContract({ address: portal, abi: PortalABI, functionName: "executor" }),
  );
  const notes: string[] = [];
  const hashes = hashIntent(intent);
  const check = intentHashCall(intent, { portal });
  const answer = await read("the Portal's getIntentHash", () =>
    client.call({ to: check.to, data: check.data }),
  );
  if (answer.data !== undefined && check.decode(answer.data).intentHash !== hashes.intentHash) {
    notes.push(
      `the Portal on ${chain.slug} hashes this intent to ${check.decode(answer.data).intentHash}, ` +
        `not ${hashes.intentHash}: its fulfill refuses the route as InvalidHash`,
    );
  }

  // The shared intent Pot: the one a route cooks on unless it names another.
  const pot = getAddress(v12PredictPot(executor, SAUCE_INTENT_POT_SALT) as Address);
  const cookTargets = intent.route.calls
    .filter((call) => call.data.startsWith(COOK))
    .map((call) => getAddress(denormalizeToEvm(call.target)));
  const cooks = cookTargets.includes(pot);
  const { deployed } = await potState(client, pot);
  for (const other of new Set(cookTargets.filter((target) => target !== pot))) {
    if (!(await potState(client, other)).deployed) {
      notes.push(
        `the route cooks on Pot ${other}, which is not deployed on ${chain.slug} and is not the ` +
          "shared intent Pot, so the rehearsal cannot deploy it: deploy it first",
      );
    }
  }
  if (cooks && !deployed) {
    notes.push(
      `warning: the shared intent Pot ${pot} is not deployed on ${chain.slug}. The rehearsal ` +
        "deploys it first, as the first solver to fill an intent there must. Any account may " +
        `deploy it: \`sauce pot --owner ${executor} --chain ${chain.slug}\` prints the ` +
        "transaction, and with --deploy and a signer sends it.",
    );
  }
  if (cookTargets.length > 0) {
    const fee = await kitchenFee(client, chain);
    intent.route.calls.forEach((call, index) => {
      if (call.data.startsWith(COOK) && call.value < fee) {
        notes.push(
          `route call ${index + 1} pays the Kitchen ${call.value} wei, and ${chain.slug}'s ` +
            `Kitchen charges ${fee}: its cook reverts with FeeNotPaid. Build the intent with ` +
            `--intent-execution-fee ${fee}.`,
        );
      }
    });
  }

  const solver = input.solver ?? DEFAULT_SOLVER;
  const claimant = (input.claimant ?? solver) as Hex;
  const fulfill = fulfillTx(intent, { claimant });
  const overrides: StateOverride[number][] = [];
  const assumed: Assumed[] = [];
  const steps: Step[] = [];
  if (cooks && !deployed) {
    const kitchen = kitchenAddress();
    steps.push({
      kind: "deploy",
      what: `Kitchen.deployPot(${executor}, ${SAUCE_INTENT_POT_SALT})`,
      to: kitchen,
      data: sauceEvmDeployPotCall({ kitchen, owner: executor, salt: SAUCE_INTENT_POT_SALT }).data,
      value: 0n,
    });
  }
  // What each route token needs, read for every token at once: its name, what the solver holds
  // and has approved, and — where it holds too little — the balance word to give it more.
  const delivered = await Promise.all(
    fulfillApprovalTxs(intent).map(async (approval) => {
      const token = getAddress(approval.to);
      const amount = intent.route.tokens
        .filter((entry) => getAddress(denormalizeToEvm(entry.token)) === token)
        .reduce((sum, entry) => sum + entry.amount, 0n);
      const [info, held, standing] = await Promise.all([
        tokenInfo(client, chain, token),
        read(`the solver's ${token} balance`, () =>
          client.readContract({
            address: token,
            abi: ERC20,
            functionName: "balanceOf",
            args: [solver],
          }),
        ),
        read(`the solver's ${token} allowance to the Portal`, () =>
          client.readContract({
            address: token,
            abi: ERC20,
            functionName: "allowance",
            args: [solver, portal],
          }),
        ),
      ]);
      const symbol = info.symbol ?? token;
      const found =
        held >= amount
          ? undefined
          : await assumeTokenBalance(client, token, solver, amount, symbol).catch(
              (error: unknown) => {
                if (!(error instanceof CliError)) throw error;
                // `assume.ts` words its refusals for `--assume-balance`; here the balance is the
                // solver's.
                const why = error.message
                  .replace(/^--assume-balance [^:]+: /, "")
                  .replace(/ Fund the Pot instead\.$/, "")
                  .replace(/\.$/, "");
                throw new CliError(
                  `the solver delivers ${symbol}, and the rehearsal cannot give it a balance: ` +
                    `${why}. Pass --solver <an address that holds it>.`,
                );
              },
            );

      return { approval, token, amount, info, symbol, standing, found };
    }),
  );
  for (const { approval, token, amount, info, symbol, standing, found } of delivered) {
    if (found !== undefined) {
      overrides.push(found.override);
      assumed.push({
        token,
        symbol,
        ...(info.decimals === undefined ? {} : { decimals: info.decimals }),
        amount,
        slot: { slot: found.slot, layout: found.layout },
        because: "the route's tokens, which the solver delivers",
      });
    }
    if (standing >= amount) continue;
    const amountText = formatAmount({ tokens: new Map([[token, info]]) }, token, amount);
    if (standing > 0n) {
      steps.push({
        kind: "approve",
        what: `reset the solver's ${symbol} allowance to the Portal`,
        to: token,
        data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [portal, 0n] }),
        value: 0n,
      });
    }
    steps.push({
      kind: "approve",
      what: `approve the Portal for ${amountText}`,
      ...approval,
      to: token,
    });
  }
  steps.push({
    kind: "fulfill",
    what:
      `Portal.fulfill(${hashes.intentHash}, route, ${hashes.rewardHash}, ${claimant}) with ` +
      `${fulfill.value} wei: the route's nativeAmount` +
      (cookTargets.length > 0 ? ", the Kitchen's fee for its cook" : ""),
    to: portal,
    data: fulfill.data,
    value: fulfill.value,
  });
  const balance = await read("the solver's balance", () => client.getBalance({ address: solver }));
  if (balance < fulfill.value) {
    overrides.push({ address: solver, balance: fulfill.value });
    assumed.push({
      token: "native",
      symbol: nativeSymbol(chain),
      decimals: 18,
      amount: fulfill.value,
      because: "fulfill's value",
    });
  }

  let calls;
  try {
    const merged = mergeOverrides(overrides);
    [{ calls } = { calls: [] }] = await client.simulateBlocks({
      blocks: [
        {
          calls: steps.map(({ to, data, value }) => ({ account: solver, to, data, value })),
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
    ...defined,
    [kitchenAddress(), "Kitchen"],
    [getAddress(v12EngineAddress()), "engine"],
    [portal, "Portal"],
    [executor, "the Portal's Executor"],
    [pot, "the shared intent Pot"],
    [solver, "the solver"],
  ]);
  const base = {
    intent: lowered,
    source: input.chain,
    chain,
    hashes,
    portal,
    executor,
    pot,
    cooks,
    deployed,
    solver,
    claimant,
    value: fulfill.value,
    steps,
    results: steps.map((_, index) => ({
      status: calls[index]?.status ?? "not run",
      ...(calls[index]?.gasUsed === undefined ? {} : { gasUsed: calls[index]!.gasUsed }),
    })),
    assumed,
    labels,
    notes,
  };
  const failed = steps.findIndex((_, index) => calls[index]?.status !== "success");
  if (failed >= 0) {
    const step = steps[failed]!;

    return {
      ...base,
      outcome: {
        ok: false,
        stage: step.kind,
        reason:
          step.kind === "fulfill"
            ? fulfillReason(calls[failed]?.data, { intent: lowered, pot })
            : stepReason(calls[failed]?.data),
      },
    };
  }
  const result = calls[steps.length - 1]!;
  const logs = (result.logs ?? []).map((log) => ({
    address: getAddress(log.address),
    topics: log.topics as readonly Hex[],
    data: log.data,
  }));
  const native = getAddress("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  const traced = fulfill.value === 0n || logs.some((log) => log.address === native);
  const effects = await effectsOf(client, chain, logs, traced, labels);
  // The Portal's own record of the fill: `IntentFulfilled(intentHash, claimant)`, what a prover
  // later carries back to the source chain.
  const recorded = logs.find(
    (log) =>
      log.address === portal &&
      log.topics[0]?.toLowerCase() === INTENT_FULFILLED &&
      log.topics[1]?.toLowerCase() === hashes.intentHash.toLowerCase(),
  );

  return {
    ...base,
    outcome: {
      ok: true,
      gas: result.gasUsed,
      effects,
      left: await leftBehind(client, effects, [pot, executor]),
      ...(recorded?.topics[2] === undefined ? {} : { recordedClaimant: recorded.topics[2] }),
    },
  };
}

/** `IntentFulfilled(bytes32 indexed intentHash, bytes32 indexed claimant)` (`IInbox.sol`). */
const INTENT_FULFILLED = keccak256(toHex("IntentFulfilled(bytes32,bytes32)"));

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

/** One intent's rehearsal, for a person. */
function fillLines(fill: Fill): string[] {
  const at = (address: Address): string => labelled(fill.labels, address);
  const head = `Intent ${fill.hashes.intentHash} from ${fill.source.slug} to ${fill.chain.slug}: `;
  const outcome = fill.outcome;
  const lines = [
    outcome.ok
      ? `${head}the fill succeeds, gas used ${outcome.gas}`
      : outcome.stage === "fulfill"
        ? `${head}the fill reverts: ${outcome.reason}`
        : `${head}the ${outcome.stage === "deploy" ? "Pot's deployment" : "approval"} before the ` +
          `fill reverts: ${outcome.reason}`,
    `Rehearsed with eth_simulateV1 on ${fill.chain.slug}, one block from the solver ` +
      `${fill.solver}; nothing was signed or sent:`,
    ...fill.steps.map((step, index) => {
      const ran = fill.results[index]!;
      const status =
        ran.status === "success"
          ? ran.gasUsed === undefined
            ? ""
            : ` (gas ${ran.gasUsed})`
          : ran.status === "not run"
            ? " (not run)"
            : " (reverts)";

      return `  ${index + 1}. ${step.kind === "deploy" ? `${step.what}: the shared intent Pot ${fill.pot} is not deployed on ${fill.chain.slug} yet, and any account may deploy it` : step.what}${status}`;
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
      : `The Portal records the fill: IntentFulfilled(${fill.hashes.intentHash}, claimant ` +
          `${outcome.recordedClaimant})`,
  );
  const kept = outcome.left.filter((entry) => entry.after !== 0n);
  if (kept.length === 0) {
    lines.push(
      `Left behind: nothing. ${fill.cooks ? "The shared intent Pot and the" : "The"} Portal's ` +
        `Executor ${fill.cooks ? "end" : "ends"} holding none of what the fill moved.`,
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

/** One intent's rehearsal, for a program. */
function fillJson(fill: Fill): Record<string, unknown> {
  const outcome = fill.outcome;

  return {
    ok: outcome.ok,
    intentHash: fill.hashes.intentHash,
    routeHash: fill.hashes.routeHash,
    rewardHash: fill.hashes.rewardHash,
    source: fill.source.slug,
    destination: fill.chain.slug,
    chainId: fill.chain.id,
    portal: fill.portal,
    executor: fill.executor,
    pot: fill.pot,
    potDeployed: fill.deployed,
    solver: fill.solver,
    claimant: fill.claimant,
    value: fill.value.toString(),
    path: "eth_simulateV1",
    calls: fill.steps.map((step, index) => ({
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
      holder: fill.solver,
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

/** `sauce fill`: a solver's fill of each of the file's intents, rehearsed on its destination. */
export async function fillCommand(input: FillInput, files: CliFiles): Promise<CommandOutput> {
  const intents = fillable(input, files);
  const destinations = new Set(intents.map((intent) => intent.destination.slug));
  if (input.endpointFlag === "--rpc-url" && destinations.size > 1) {
    throw new UsageError(
      `${input.file}'s intents go to ${[...destinations].join(" and ")}: --rpc-url names one ` +
        "endpoint, so give --config, which names each destination's",
    );
  }
  const defined = defineLabels(input);
  const fills: Fill[] = [];
  for (const intent of intents) fills.push(await rehearseFill(input, intent, defined));
  const notes = fills.flatMap((fill) => fill.notes);
  for (const fill of fills) {
    if (!fill.outcome.ok) continue;
    for (const entry of fill.outcome.left) {
      if (entry.after > entry.before) {
        notes.push(
          `warning: the fill leaves ` +
            `${formatAmount(fill.outcome.effects, entry.token, entry.after - entry.before)} in ` +
            `${labelled(fill.labels, entry.holder)}, which every intent through ${fill.chain.slug}'s ` +
            "Portal shares: a later intent's program or solver can take it. Send it on in the body.",
        );
      }
    }
  }
  const ok = fills.every((fill) => fill.outcome.ok);

  return {
    text: fills.map((fill) => fillLines(fill).join("\n")).join("\n\n"),
    json: { ok, chain: input.chain.slug, intents: fills.map(fillJson) },
    ...(notes.length === 0 ? {} : { notes }),
    ...(ok ? {} : { exitCode: 1 }),
  };
}
