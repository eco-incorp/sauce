/**
 * `sauce simulate` on an EVM chain: the cook rehearsed from the Pot's owner with no key and nothing
 * sent — on a Pot that need not be deployed yet, holding what `--assume-balance` gives it — and what
 * it did, read back from its logs.
 *
 * `rehearse.ts` runs it (`eth_simulateV1`, else `eth_call`), `assume.ts` finds where a token keeps
 * the Pot's balance, and `effects.ts` decodes the logs. This file decides what to rehearse and
 * prints it.
 */
import {
  formatUnits,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type StateOverride,
} from "viem";

import { v12EngineAddress } from "../deployments/index.js";
import { CliError } from "./args.js";
import { entryReturnType } from "../routes/entry.js";
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { balanceReader, connectAt, kitchenFee, potState } from "./chain.js";
import {
  type ChainAccess,
  type CliFiles,
  type CommandOutput,
  type CookInput,
  cookOf,
  potOf,
  withSwapRoutes,
  kitchenAddress,
  priceLimitNotes,
  revertedFirst,
  valueOf,
} from "./commands.js";
import {
  addressLabels,
  effectLines,
  effectsJson,
  effectsOf,
  heldAround,
  leftInPotJson,
  leftInPotLines,
  nativeSymbol,
  tokenInfo,
  type Effects,
  type Held,
} from "./effects.js";
import { intentLines, intentsJson, loggedIntents } from "./logged-intents.js";
import { baseUnits, type BeforeCook, type Funding, type FundRequest } from "./funding.js";
import { rehearse, type Rehearsal } from "./rehearse.js";
import { decodeReturned, returnedLine } from "./returned.js";

export interface SimulateInput extends CookInput, ChainAccess {
  /** `--assume-balance`: what the Pot holds, for this rehearsal only. */
  readonly assume: readonly FundRequest[];
  /** `--block`: the block to rehearse on (a number or a tag); the latest when absent. */
  readonly block?: string;
}

/** One balance the rehearsal sets by state override. */
interface Assumed {
  readonly holder: Address;
  /** Who holds it, for a person: the Pot, the owner. */
  readonly role: string;
  readonly token: Address | "native";
  readonly symbol: string;
  readonly decimals?: number;
  readonly amount: bigint;
  /** Where a token keeps it, as found. */
  readonly slot?: { readonly slot: Hex; readonly layout: string };
  /** Why: `--assume-balance`, `--fund` with no key to pull it, or the cook's value. */
  readonly because: string;
}

const BALANCE_OF = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const amountText = (balance: Assumed): string =>
  balance.decimals === undefined
    ? `${balance.amount} ${balance.symbol} (base units)`
    : `${formatUnits(balance.amount, balance.decimals)} ${balance.symbol}`;

/**
 * The balances `--assume-balance` and a keyless `--fund` give the Pot, as state overrides. An
 * assumed token balance is the Pot's balance outright; a keyless `--fund` adds what its pull would
 * bring — to the assumed balance, or else to the Pot's balance as it stands.
 */
async function potBalances(
  client: PublicClient,
  input: SimulateInput,
  pot: Address,
  credit: NonNullable<Funding["credit"]>,
): Promise<{
  readonly assumed: Assumed[];
  readonly overrides: StateOverride[number][];
  readonly notes: string[];
}> {
  const assumed: Assumed[] = [];
  const overrides: StateOverride[number][] = [];
  const notes: string[] = [];
  const wanted = new Map<string, { request?: FundRequest; amount?: bigint; credit: bigint }>();
  for (const request of input.assume) {
    const { amount, note } = await baseUnits(client, request);
    if (note !== undefined) notes.push(note);
    wanted.set(request.token ?? "native", { request, amount, credit: 0n });
  }
  for (const funded of credit) {
    const before = wanted.get(funded.token);
    wanted.set(funded.token, { ...before, credit: (before?.credit ?? 0n) + funded.amount });
  }
  for (const [key, want] of wanted) {
    if (key === "native") {
      overrides.push({ address: pot, balance: want.amount! });
      assumed.push({
        holder: pot,
        role: "the Pot",
        token: "native",
        symbol: nativeSymbol(input.chain),
        decimals: 18,
        amount: want.amount!,
        because: "--assume-balance",
      });
      continue;
    }
    const token = key as Address;
    const info = await tokenInfo(client, input.chain, token);
    const symbol = info.symbol ?? want.request?.label ?? token;
    const start =
      want.amount ??
      (await client
        .readContract({ address: token, abi: BALANCE_OF, functionName: "balanceOf", args: [pot] })
        .catch((error: unknown) => {
          throw new CliError(
            `reading the Pot's ${symbol} balance failed: ` +
              ((error as { shortMessage?: string }).shortMessage ?? "the call reverted"),
          );
        }));
    const amount = start + want.credit;
    const found = await assumeTokenBalance(client, token, pot, amount, symbol);
    overrides.push(found.override);
    assumed.push({
      holder: pot,
      role: "the Pot",
      token,
      symbol,
      ...(info.decimals === undefined ? {} : { decimals: info.decimals }),
      amount,
      slot: { slot: found.slot, layout: found.layout },
      because:
        want.credit === 0n
          ? "--assume-balance"
          : want.amount === undefined
            ? "what --fund would pull, credited (no key to sign the pull)"
            : "--assume-balance, plus what --fund would pull (no key to sign the pull)",
    });
  }

  return { assumed, overrides, notes };
}

/** A transaction's gas as the rehearsal knows it: used, or estimated. */
const gasText = (gas: bigint | undefined, kind: "used" | "estimated"): string =>
  gas === undefined
    ? "gas not known"
    : kind === "used"
      ? `gas used ${gas}`
      : `gas ${gas} (estimated)`;

/** How the rehearsal ran, for a person: each transaction, with its own gas once it succeeded. */
function routeLines(
  rehearsal: Rehearsal,
  chain: string,
  block: bigint,
  owner: Address,
  pot: Address,
  deploy: { readonly salt: Hex } | undefined,
  before: readonly BeforeCook[],
  signed: boolean,
): string[] {
  const gas = (used: bigint | undefined): string =>
    rehearsal.ok ? `, ${gasText(used, rehearsal.gasKind)}` : "";
  const steps = [
    ...(deploy === undefined
      ? []
      : [
          `Kitchen.deployPot(${owner}, ${deploy.salt})${gas(rehearsal.ok ? rehearsal.deployGas : undefined)}: ` +
            `Pot ${pot} is not deployed on ${chain} yet. Any account may send this; the Pot is the ` +
            "owner's either way." +
            (rehearsal.path === "eth_call"
              ? " The Pot it deploys is put in place by state override."
              : ""),
        ]),
    ...before.map(
      (each, index) =>
        `${each.what}, from the owner ${owner}` +
        gas(rehearsal.ok ? rehearsal.beforeGas[index] : undefined) +
        ": sauce run sends this before the cook",
    ),
    `the cook, from the owner ${owner}${gas(rehearsal.ok ? rehearsal.gas : undefined)}`,
  ];

  return [
    `Rehearsed with ${rehearsal.path} on the state of block ${block}` +
      (rehearsal.fallback === undefined ? "" : ` (${rehearsal.fallback})`) +
      (signed
        ? "; the owner's key signed the pulls, and nothing was sent:"
        : "; nothing was signed or sent:"),
    ...steps.map((step, index) => `  ${steps.length === 1 ? "" : `${index + 1}. `}${step}`),
  ];
}

/**
 * `sauce simulate`: the cook as a rehearsal from the Pot's owner — no key, nothing sent. A revert
 * leads its output (`revertedFirst`).
 */
export async function simulateCommand(
  input: SimulateInput,
  files: CliFiles,
): Promise<CommandOutput> {
  return revertedFirst(await simulateEvm(input, files));
}

async function simulateEvm(given: SimulateInput, files: CliFiles): Promise<CommandOutput> {
  const input = await withSwapRoutes(given, files, potOf(given.target));
  const cook = cookOf(input, files);
  // Every read and the rehearsal itself on one block: what it saw is what it says it saw.
  const { client, block } = await connectAt(input.rpcUrl, input.chain, input.block);
  const state = await potState(client, cook.pot);
  const target = input.target;
  if (!state.deployed && !("owner" in target)) {
    throw new CliError(
      `Pot ${cook.pot} is not deployed on ${input.chain.slug}, and --pot does not say whose it is: ` +
        "give its --owner (and --salt) instead, and the rehearsal deploys it first",
    );
  }
  const owner = state.deployed ? state.owner! : (target as { readonly owner: Address }).owner;
  const deploy = state.deployed ? undefined : { salt: (target as { readonly salt: Hex }).salt };
  const kitchen = kitchenAddress();

  const funding = input.fund === undefined ? undefined : await input.fund(client, cook.pot, owner);
  const funded =
    funding === undefined ? cook : cookOf({ ...input, text: funding.wrap(input.text) }, files);
  const value =
    valueOf(input.value, await kitchenFee(client, input.chain), input.chain) +
    (funding?.value ?? 0n);
  const {
    assumed,
    overrides,
    notes: amountNotes,
  } = await potBalances(client, input, cook.pot, funding?.credit ?? []);
  // The owner pays the cook's value. One that holds less is given it for the rehearsal, and told.
  const held = await client.getBalance({ address: owner });
  if (held < value) {
    overrides.push({ address: owner, balance: value });
    assumed.push({
      holder: owner,
      role: "the owner",
      token: "native",
      symbol: nativeSymbol(input.chain),
      decimals: 18,
      amount: value,
      because:
        `the cook's value; it holds ${formatUnits(held, 18)}, and a real cook needs the value ` +
        "and gas",
    });
  }

  // With the owner's key, the approvals and transfers `sauce run` sends first, in the same block.
  const before = funding?.beforeCook ?? [];
  const rehearsal = await rehearse(client, {
    owner,
    pot: cook.pot,
    kitchen,
    ...(deploy === undefined ? {} : { deploy }),
    ...(before.length === 0 ? {} : { before }),
    cook: { to: cook.pot, data: funded.data, value },
    overrides: mergeOverrides(overrides),
  });
  const labels = addressLabels(input.chain, [
    [kitchen, "Kitchen"],
    [getAddress(v12EngineAddress()), "engine"],
    [owner, "owner"],
    [cook.pot, "the Pot"],
  ]);
  const effects: Effects | undefined =
    rehearsal.ok && rehearsal.logs !== undefined
      ? await effectsOf(client, input.chain, rehearsal.logs, rehearsal.traced, labels)
      : undefined;
  // What the Pot ends holding of what the cook moved: what it held before (as assumed, else as it
  // stands at the block) plus the cook's net change.
  const unread: Array<Address | "native"> = [];
  const potBefore = balanceReader(client, cook.pot);
  const potHeld: Held[] | undefined =
    effects === undefined
      ? undefined
      : await heldAround(effects, cook.pot, async (token) => {
          const given = assumed.find(
            (balance) =>
              balance.holder === cook.pot &&
              (balance.token === "native" || token === "native"
                ? balance.token === token
                : getAddress(balance.token) === token),
          );
          const before = given?.amount ?? (await potBefore(token));
          if (before === undefined) unread.push(token);

          return before;
        });

  // The intents the cook published, read back from the Portal's logs.
  const intents =
    rehearsal.ok && rehearsal.logs !== undefined ? loggedIntents(input.chain, rehearsal.logs) : [];

  const how = routeLines(
    rehearsal,
    input.chain.slug,
    block,
    owner,
    cook.pot,
    deploy,
    before,
    funding?.signed === true,
  );
  const assumedLines =
    assumed.length === 0
      ? []
      : [
          "Assumed for this rehearsal only, by state override:",
          ...assumed.map(
            (balance) =>
              `  ${balance.role} holds ${amountText(balance)}: ${balance.because}` +
              (balance.slot === undefined
                ? ""
                : ` (its balance word ${balance.slot.slot}: ${balance.slot.layout})`),
          ),
        ];
  // What main returned, read as the type it declares.
  const returnType = entryReturnType(cook.program.entrySignature);
  const returned =
    rehearsal.ok && returnType !== undefined
      ? decodeReturned(returnType, rehearsal.returns, input.chain)
      : undefined;
  const json: Record<string, unknown> = {
    ok: rehearsal.ok,
    // First, so nobody looks in the owner's wallet for what stays in the Pot.
    ...(effects === undefined || potHeld === undefined
      ? {}
      : { leftInPot: leftInPotJson(effects, potHeld) }),
    chain: input.chain.slug,
    block: block.toString(),
    from: owner,
    to: cook.pot,
    value: value.toString(),
    path: rehearsal.path,
    ...(rehearsal.fallback === undefined ? {} : { fallback: rehearsal.fallback }),
    deployPot: deploy === undefined ? null : { kitchen, owner, salt: deploy.salt },
    assumed: assumed.map((balance) => ({
      holder: balance.holder,
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
    ...(rehearsal.ok
      ? {
          // The cook's own gas; with the Pot deployed first, `transactions` gives each one's.
          gas: rehearsal.gas === undefined ? null : rehearsal.gas.toString(),
          gasKind: rehearsal.gasKind,
          transactions: [
            ...(deploy === undefined
              ? []
              : [
                  {
                    step: "deployPot",
                    from: owner,
                    to: kitchen,
                    gas: rehearsal.deployGas === undefined ? null : rehearsal.deployGas.toString(),
                    gasKind: rehearsal.gasKind,
                  },
                ]),
            // What `sauce run` sends before the cook: each one a transaction of its own to send.
            ...before.map((each, index) => ({
              step: "fund",
              what: each.what,
              from: owner,
              to: each.tx.to,
              data: each.tx.data,
              gas: rehearsal.beforeGas[index]?.toString() ?? null,
              gasKind: rehearsal.gasKind,
            })),
            {
              step: "cook",
              from: owner,
              to: cook.pot,
              gas: rehearsal.gas === undefined ? null : rehearsal.gas.toString(),
              gasKind: rehearsal.gasKind,
            },
          ],
          returns: rehearsal.returns,
          ...(returnType === undefined ? {} : { returnType, returned: returned ?? null }),
          ...(intents.length === 0 ? {} : { intents: intentsJson(intents) }),
          ...(effects === undefined ? {} : effectsJson(effects)),
        }
      : {
          stage: rehearsal.stage,
          ...(rehearsal.what === undefined ? {} : { what: rehearsal.what }),
          reason: rehearsal.reason,
        }),
  };
  const notes = [
    ...amountNotes,
    ...priceLimitNotes(input, cook.program.entryParams, input.args),
    ...(funding?.notes ?? []),
    ...rehearsal.notes,
    ...unread.map(
      (token) =>
        `the Pot's ${effects?.tokens.get(token)?.symbol ?? token} balance could not be read, so ` +
        "what the cook leaves in the Pot leaves it out",
    ),
  ];

  if (!rehearsal.ok) {
    return {
      text: [
        rehearsal.stage === "deploy"
          ? `Deploying the Pot reverts: ${rehearsal.reason}`
          : rehearsal.stage === "before"
            ? `${rehearsal.what}, which sauce run sends before the cook, fails: ${rehearsal.reason}`
            : `The cook reverts: ${rehearsal.reason}`,
        ...how,
        ...assumedLines,
      ].join("\n"),
      json,
      notes,
      exitCode: 1,
    };
  }
  const gas = gasText(rehearsal.gas, rehearsal.gasKind);
  // The transactions before the cook, numbered as the route below lists them.
  const first = before.length + (deploy === undefined ? 0 : 1);
  const after =
    first === 0
      ? ""
      : before.length === 0
        ? " for the cook, after the Pot's deploy (1. below)"
        : ` for the cook, after what it needs sent first (${first === 1 ? "1." : `1. to ${first}.`} below)`;

  return {
    text: [
      `The cook succeeds from ${owner}: ${gas}${after}, returns ${rehearsal.returns}`,
      ...(returnType === undefined
        ? []
        : [returnedLine(returnType, rehearsal.returns, input.chain)]),
      ...(effects === undefined || potHeld === undefined
        ? []
        : leftInPotLines(effects, potHeld, "the owner's wallet")),
      ...intentLines(intents),
      ...how,
      ...assumedLines,
      ...(effects === undefined ? [] : effectLines(effects)),
    ].join("\n"),
    json,
    notes,
  };
}
