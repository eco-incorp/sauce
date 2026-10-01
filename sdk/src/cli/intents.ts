/**
 * What the intents a program opens need on their destination chains, checked from the command
 * line: the Kitchen's execution fee their cooks pay (`--intent-execution-fee auto`), and the Pot
 * they cook on — the one every intent through a destination's Portal shares, owned by its Executor
 * with salt zero — which has to be deployed before any solver can fill them.
 *
 * Every address here is the SDK's: the Pot is the cook's own target in the route the lowering
 * built, the Executor `ecoRoutesExecutorOf` the route's Portal. Only the reads are this module's.
 */
import { getAddress, slice, toFunctionSelector, type Address } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { v12PotAbi } from "../evm/engine.js";
import { ecoRoutesExecutorOf } from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../routes/encode.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { CliError, UsageError } from "./args.js";
import { connect, kitchenFee, potState } from "./chain.js";

const COOK = toFunctionSelector(v12PotAbi.find((item) => item.name === "cook")!);

/** An intent whose route runs a program: the cook its route calls, and on what. */
export interface IntentCook {
  readonly destination: CanonicalChain;
  /** The Pot the route cooks on. */
  readonly pot: Address;
  /** The Executor of the Portal the route records: the Pot's owner. */
  readonly executor: Address;
}

/** The cooks the intents' routes call — one per intent whose body runs a program. */
export function intentCooks(intents: readonly LoweredIntent[]): IntentCook[] {
  return intents.flatMap((lowered) => {
    const { route } = lowered.intent;
    const cook = route.calls.find(
      (call) => call.data.length >= 10 && slice(call.data, 0, 4) === COOK,
    );
    if (cook === undefined || lowered.destination.kind !== "evm") return [];

    return [
      {
        destination: lowered.destination,
        pot: getAddress(denormalizeToEvm(cook.target)),
        executor: getAddress(ecoRoutesExecutorOf(getAddress(denormalizeToEvm(route.portal)))),
      },
    ];
  });
}

/** An endpoint for a chain the command reaches, from `--config` (or `--rpc-url` for its own). */
export type Endpoints = (chain: CanonicalChain) => string | undefined;

const unique = (cooks: readonly IntentCook[]): CanonicalChain[] => [
  ...new Map(cooks.map((cook) => [cook.destination.id, cook.destination])).values(),
];

/**
 * `--intent-execution-fee auto`: the fee the destination Kitchens charge, read from each. One fee
 * pays every intent's cook, so destinations that charge differently are refused, naming each fee.
 */
export async function destinationFee(
  cooks: readonly IntentCook[],
  endpoints: Endpoints,
): Promise<bigint> {
  const fees: Array<[CanonicalChain, bigint]> = [];
  for (const chain of unique(cooks)) {
    const url = endpoints(chain);
    if (url === undefined) {
      throw new UsageError(
        `--intent-execution-fee auto reads the Kitchen's fee on ${chain.slug}, the intent's ` +
          `destination: give --config with an rpcUrls entry for chain id ${chain.id}`,
      );
    }
    fees.push([chain, await kitchenFee(await connect(url, chain), chain)]);
  }
  const distinct = new Set(fees.map(([, fee]) => fee));
  if (distinct.size > 1) {
    throw new CliError(
      `--intent-execution-fee auto: the destination Kitchens charge different fees (` +
        `${fees.map(([chain, fee]) => `${chain.slug} ${fee} wei`).join(", ")}), and one fee pays ` +
        "every intent's cook: open them from separate files, or pass the fee yourself",
    );
  }

  return fees[0]?.[1] ?? 0n;
}

/** Whether each cook's Pot is deployed, where an endpoint for its chain was given. */
export interface PotCheck extends IntentCook {
  /** `undefined` where no endpoint reached the destination. */
  readonly deployed?: boolean;
}

/** Each intent cook's Pot, checked on its destination where an endpoint reaches it. */
export async function checkIntentPots(
  cooks: readonly IntentCook[],
  endpoints: Endpoints,
): Promise<PotCheck[]> {
  return Promise.all(
    cooks.map(async (cook) => {
      const url = endpoints(cook.destination);
      if (url === undefined) return cook;
      const state = await potState(await connect(url, cook.destination), cook.pot);

      return { ...cook, deployed: state.deployed };
    }),
  );
}

/** The warning for a cook whose Pot is not there: no solver can fill the intent until it is. */
export function missingPotNote(check: PotCheck): string {
  return (
    `warning: the intent to ${check.destination.slug} cooks on Pot ${check.pot}, which is not ` +
    `deployed there, so no solver can fill it yet. It is the Pot every intent through that ` +
    `Portal shares (owner: its Executor ${check.executor}, salt 0), and any account may deploy ` +
    `it: sauce pot --deploy --chain ${check.destination.slug} --owner ${check.executor} ` +
    "--keystore <keystore>"
  );
}

/** The note for a cook whose Pot no endpoint reached: what to pass to check it. */
export function uncheckedPotNote(check: PotCheck): string {
  return (
    `the intent to ${check.destination.slug} cooks on Pot ${check.pot} (owner: the Portal's ` +
    `Executor ${check.executor}, salt 0), which no solver can fill until it is deployed: pass ` +
    `--config with an rpcUrls entry for chain id ${check.destination.id} to check that it is`
  );
}

/** The report of each intent cook, for `--json`. */
export const potCheckJson = (check: PotCheck): Record<string, unknown> => ({
  destination: check.destination.slug,
  pot: check.pot,
  executor: check.executor,
  deployed: check.deployed ?? null,
});
