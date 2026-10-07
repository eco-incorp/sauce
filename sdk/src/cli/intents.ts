/**
 * What the intents a program opens need on their destination chains, checked from the command
 * line: the Kitchen's execution fee their cooks pay (`--intent-execution-fee auto`), and the Pot
 * they cook on — the one every intent through a destination's Portal shares, owned by its Executor
 * with salt zero — which has to be deployed before any solver can fill them.
 *
 * Every address here is the SDK's: the Pot is the cook's own target in the route the lowering
 * built, the Executor `ecoRoutesExecutorOf` the route's Portal. Only the reads are this module's.
 */
import { getAddress, type Address } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "../routes/encode.js";
import type { IntentDefaults } from "../routes/intent-defaults.js";
import { resolveIntentPot } from "../routes/intent-pot.js";
import { toUniversalAddress } from "../routes/normalize.js";
import type { CompiledBody } from "../routes/sauce-route.js";
import { UsageError } from "./args.js";
import { connect, kitchenFee, potState } from "./chain.js";

/** An intent whose route runs a program: the cook its route calls, and on what. */
export interface IntentCook {
  readonly destination: CanonicalChain;
  /** The Pot the route cooks on. */
  readonly pot: Address;
  /** The Executor of the Portal the route records: the Pot's owner. */
  readonly executor: Address;
}

/** The cooks the intents' routes call — one per body, every body being a program, on the Pot of
 *  its destination's Portal (or the one `defaults` names). */
export function intentCooks(
  bodies: readonly CompiledBody[],
  defaults: IntentDefaults = {},
): IntentCook[] {
  const seen = new Set<number>();
  return bodies.flatMap((body) => {
    const { destination } = body;
    if (destination.kind !== "evm" || seen.has(destination.id)) return [];
    seen.add(destination.id);
    const portal = getAddress(
      denormalizeToEvm(
        toUniversalAddress(defaults.destinationPortal ?? ecoRoutesPortal(destination, defaults)),
      ),
    );
    const { pot } = resolveIntentPot(portal, defaults);

    return [
      {
        destination,
        pot: getAddress(denormalizeToEvm(toUniversalAddress(pot))),
        executor: getAddress(ecoRoutesExecutorOf(portal)),
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
          `${chain.id}). Give the fee as the hop's \`fee: <wei>\`, or ` +
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
