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
import { UsageError } from "./args.js";
import { connect, kitchenFee, potState } from "./chain.js";

type PotFunction = Extract<(typeof v12PotAbi)[number], { type: "function" }>;
const COOK = toFunctionSelector(
  v12PotAbi.find((item): item is PotFunction => item.type === "function" && item.name === "cook")!,
);

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

/**
 * `--intent-execution-fee auto`, and the default: each destination's Kitchen fee, by chain id, read
 * through `endpoints`. Each intent's cook pays its own destination's.
 */
export async function destinationFees(
  chains: readonly CanonicalChain[],
  endpoints: Endpoints,
): Promise<Map<number, bigint>> {
  const fees = new Map<number, bigint>();
  for (const chain of chains) {
    const url = endpoints(chain);
    if (url === undefined) {
      throw new UsageError(
        `an intent's body runs a program on ${chain.slug}, whose cook pays its Kitchen's fee: the ` +
          `command reads the Kitchen's fee on ${chain.slug} from the chain, and nothing here reaches ` +
          `it (--offline, or no endpoint: --config with an rpcUrls entry for chain id ` +
          `${chain.id}). Give the fee with \`.fee(<wei>)\` after \`.receive(...)\`, or ` +
          `--intent-execution-fee <wei>`,
      );
    }
    fees.set(chain.id, await kitchenFee(await connect(url, chain), chain));
  }

  return fees;
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
