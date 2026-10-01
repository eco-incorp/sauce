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
import { assumeTokenBalance, mergeOverrides } from "./assume.js";
import { connect, kitchenFee, potState } from "./chain.js";
import {
  cookOf,
  kitchenAddress,
  valueOf,
  type ChainAccess,
  type CliFiles,
  type CommandOutput,
  type CookInput,
} from "./commands.js";
import {
  addressLabels,
  effectLines,
  effectsJson,
  effectsOf,
  nativeSymbol,
  tokenInfo,
  type Effects,
} from "./effects.js";
import { baseUnits, type Funding, type FundRequest } from "./funding.js";
import { rehearse, type Rehearsal } from "./rehearse.js";

export interface SimulateInput extends CookInput, ChainAccess {
  /** `--assume-balance`: what the Pot holds, for this rehearsal only. */
  readonly assume: readonly FundRequest[];
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
): Promise<{ readonly assumed: Assumed[]; readonly overrides: StateOverride[number][] }> {
  const assumed: Assumed[] = [];
  const overrides: StateOverride[number][] = [];
  const wanted = new Map<string, { request?: FundRequest; amount?: bigint; credit: bigint }>();
  for (const request of input.assume) {
    wanted.set(request.token ?? "native", {
      request,
      amount: await baseUnits(client, request),
      credit: 0n,
    });
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
      (await client.readContract({
        address: token,
        abi: BALANCE_OF,
        functionName: "balanceOf",
        args: [pot],
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

  return { assumed, overrides };
}

/** How the rehearsal ran, for a person. */
function routeLines(
  rehearsal: Rehearsal,
  chain: string,
  owner: Address,
  pot: Address,
  deploy: { readonly salt: Hex } | undefined,
  signed: boolean,
): string[] {
  return [
    `Rehearsed with ${rehearsal.path}` +
      (rehearsal.fallback === undefined ? "" : ` (${rehearsal.fallback})`) +
      (signed
        ? "; the owner's key signed the pulls, and nothing was sent:"
        : "; nothing was signed or sent:"),
    ...(deploy === undefined
      ? []
      : [
          `  1. Kitchen.deployPot(${owner}, ${deploy.salt}): Pot ${pot} is not deployed on ` +
            `${chain} yet. Any account may send this; the Pot is the owner's either way.` +
            (rehearsal.path === "eth_call"
              ? " The Pot it deploys is put in place by state override."
              : ""),
        ]),
    `  ${deploy === undefined ? "" : "2. "}the cook, from the owner ${owner}`,
  ];
}

/** `sauce simulate`: the cook as a rehearsal from the Pot's owner — no key, nothing sent. */
export async function simulateCommand(
  input: SimulateInput,
  files: CliFiles,
): Promise<CommandOutput> {
  const cook = cookOf(input, files);
  const client = await connect(input.rpcUrl, input.chain);
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
  const { assumed, overrides } = await potBalances(client, input, cook.pot, funding?.credit ?? []);
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

  const rehearsal = await rehearse(client, {
    owner,
    pot: cook.pot,
    kitchen,
    ...(deploy === undefined ? {} : { deploy }),
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

  const how = routeLines(
    rehearsal,
    input.chain.slug,
    owner,
    cook.pot,
    deploy,
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
  const json: Record<string, unknown> = {
    ok: rehearsal.ok,
    chain: input.chain.slug,
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
          gas: rehearsal.gas === undefined ? null : rehearsal.gas.toString(),
          gasKind: rehearsal.gasKind,
          returns: rehearsal.returns,
          ...(effects === undefined ? {} : effectsJson(effects)),
        }
      : { stage: rehearsal.stage, reason: rehearsal.reason }),
  };
  const notes = [...(funding?.notes ?? []), ...rehearsal.notes];

  if (!rehearsal.ok) {
    return {
      text: [
        rehearsal.stage === "deploy"
          ? `Deploying the Pot reverts: ${rehearsal.reason}`
          : `The cook reverts: ${rehearsal.reason}`,
        ...how,
        ...assumedLines,
      ].join("\n"),
      json,
      notes,
      exitCode: 1,
    };
  }
  const gas =
    rehearsal.gas === undefined
      ? "gas not known"
      : rehearsal.gasKind === "used"
        ? `gas used ${rehearsal.gas}`
        : `gas ${rehearsal.gas} (estimated)`;

  return {
    text: [
      `The cook succeeds from ${owner}: ${gas}, returns ${rehearsal.returns}`,
      ...how,
      ...assumedLines,
      ...(effects === undefined ? [] : effectLines(effects)),
    ].join("\n"),
    json,
    notes,
  };
}
