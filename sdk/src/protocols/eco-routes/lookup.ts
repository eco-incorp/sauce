/**
 * Where eco-routes is deployed, for every generation and environment it has been deployed in.
 *
 * The addresses come from `addresses.generated.ts`, vendored from `@eco-foundation/routes-ts` at a
 * pinned version and digest (see `scripts/sync-eco-routes-addresses.mjs`). This module is the part
 * an application calls: it turns a chain and a choice of deployment into an address, or into an
 * error that says which of the two was the problem.
 *
 * TWO AXES, because two things vary independently.
 *
 *  - **Generation.** `v3` is the current one: a single `Portal` that publishes, escrows and
 *    fulfills. `v2` is the previous one, with separate `IntentSource` and `Inbox` contracts and a
 *    different ABI. Both are addressable here. Only `v3` can be *built for* by this SDK's intent
 *    machinery, and asking for `v2` there fails with that sentence rather than with a type error
 *    three layers down.
 *  - **Environment.** `default` is production. `staging` is Eco's own staging deployment, a
 *    different set of addresses on the same chains.
 *
 * An absent role means no deployment, not a zero address: the generator drops zero cells precisely
 * so that a lookup cannot hand back an address that is not one.
 */
import type { Hex } from "viem";

import type { CanonicalChain } from "../../chains/canonical.js";
import { requireChain, type ChainRef } from "../../chains/canonical.js";
import { ECO_ROUTES_ADDRESSES } from "./addresses.generated.js";

export type EcoRoutesGeneration = keyof typeof ECO_ROUTES_ADDRESSES;
export type EcoRoutesEnvironment = "default" | "staging";

/** The current generation, and the one the intent machinery builds for. */
export const ECO_ROUTES_DEFAULT_GENERATION: EcoRoutesGeneration = "v3";
export const ECO_ROUTES_DEFAULT_ENVIRONMENT: EcoRoutesEnvironment = "default";

export interface EcoRoutesSelector {
  readonly generation?: EcoRoutesGeneration;
  readonly environment?: EcoRoutesEnvironment;
}

/** Every generation this SDK carries addresses for, with the published version each came from. */
export function ecoRoutesGenerations(): readonly {
  readonly generation: EcoRoutesGeneration;
  readonly version: string;
  readonly sha256: string;
  readonly summary: string;
  readonly roles: readonly string[];
}[] {
  return Object.entries(ECO_ROUTES_ADDRESSES).map(([generation, record]) => ({
    generation: generation as EcoRoutesGeneration,
    version: record.version,
    sha256: record.sha256,
    summary: record.summary,
    roles: record.roles,
  }));
}

function chainIdOf(chain: ChainRef | CanonicalChain): { id: string; slug: string } {
  const canonical = requireChain(chain as ChainRef);
  return { id: String(canonical.id), slug: canonical.slug };
}

function select(selector: EcoRoutesSelector | undefined): {
  generation: EcoRoutesGeneration;
  environment: EcoRoutesEnvironment;
} {
  return {
    generation: selector?.generation ?? ECO_ROUTES_DEFAULT_GENERATION,
    environment: selector?.environment ?? ECO_ROUTES_DEFAULT_ENVIRONMENT,
  };
}

/** Every role deployed on `chain` for the selected generation and environment, or `undefined` when
 *  eco-routes is not deployed there at all. */
export function ecoRoutesDeployment(
  chain: ChainRef | CanonicalChain,
  selector?: EcoRoutesSelector,
): Readonly<Record<string, Hex>> | undefined {
  const { generation, environment } = select(selector);
  const { id } = chainIdOf(chain);

  return (
    ECO_ROUTES_ADDRESSES[generation].chains as Record<
      string,
      Record<string, Record<string, Hex>> | undefined
    >
  )[id]?.[environment];
}

function requireRole(
  chain: ChainRef | CanonicalChain,
  role: string,
  selector: EcoRoutesSelector | undefined,
): Hex {
  const { generation, environment } = select(selector);
  const { id, slug } = chainIdOf(chain);
  const deployment = ecoRoutesDeployment(chain, selector);
  const where = `eco-routes ${generation}${environment === "default" ? "" : `/${environment}`}`;

  if (deployment === undefined) {
    const deployed = Object.keys(ECO_ROUTES_ADDRESSES[generation].chains).join(", ");
    throw new Error(
      `${where} is not deployed on ${slug} (chain ${id}). Deployed on: ${deployed}. Pass an explicit ` +
        `address if you are targeting a deployment this SDK does not carry.`,
    );
  }
  const address = deployment[role];
  if (address === undefined) {
    const present = Object.keys(deployment).join(", ") || "nothing";
    throw new Error(
      `${where} on ${slug} (chain ${id}) has no ${role}. It has: ${present}. Choose a different ` +
        `${role === "Portal" ? "chain" : "prover"}, or pass an explicit address.`,
    );
  }
  return address;
}

/** The Portal on `chain` — where an intent is published, funded and fulfilled. `v3` only; the `v2`
 *  generation has `IntentSource`/`Inbox` instead, and says so. */
export function ecoRoutesPortal(
  chain: ChainRef | CanonicalChain,
  selector?: EcoRoutesSelector,
): Hex {
  const { generation } = select(selector);
  if (generation !== "v3") {
    throw new Error(
      `eco-routes ${generation} has no Portal — that generation deploys IntentSource and Inbox ` +
        `separately. Use \`ecoRoutesContract(chain, "IntentSource", { generation })\` to address it, ` +
        `or build against the default v3 generation.`,
    );
  }
  return requireRole(chain, "Portal", selector);
}

/** Any role by name, for a generation whose roles this SDK does not model individually. */
export function ecoRoutesContract(
  chain: ChainRef | CanonicalChain,
  role: string,
  selector?: EcoRoutesSelector,
): Hex {
  return requireRole(chain, role, selector);
}

/**
 * The prover to record in a reward for a `source` -> `destination` route.
 *
 * A prover is a pair property, not a chain property: the reward names a prover on the SOURCE chain,
 * and it can only carry a proof back from a destination where the matching prover is also deployed.
 * So this picks the first prover both sides have, in a fixed preference order, and says what it
 * looked at when they have none in common.
 */
export const ECO_ROUTES_PROVER_PREFERENCE = [
  "HyperProver",
  "LayerZeroProver",
  "MetaProver",
  "PolymerProver",
] as const;

export function ecoRoutesProver(
  source: ChainRef | CanonicalChain,
  destination: ChainRef | CanonicalChain,
  selector?: EcoRoutesSelector,
): Hex {
  const here = ecoRoutesDeployment(source, selector);
  const there = ecoRoutesDeployment(destination, selector);
  const { generation, environment } = select(selector);
  const where = `eco-routes ${generation}${environment === "default" ? "" : `/${environment}`}`;

  if (here === undefined || there === undefined) {
    // Reuse the deployment-level diagnostic, which names which side is missing.
    requireRole(here === undefined ? source : destination, "Portal", selector);
  }
  for (const prover of ECO_ROUTES_PROVER_PREFERENCE) {
    if (here?.[prover] !== undefined && there?.[prover] !== undefined) return here[prover]!;
  }
  const sourceSlug = chainIdOf(source).slug;
  const destinationSlug = chainIdOf(destination).slug;
  throw new Error(
    `${where} has no prover deployed on both ${sourceSlug} and ${destinationSlug}. ` +
      `${sourceSlug} has: ${Object.keys(here ?? {}).join(", ") || "none"}; ` +
      `${destinationSlug} has: ${Object.keys(there ?? {}).join(", ") || "none"}. ` +
      `A reward's prover must be able to carry a proof back from the destination, so pass one ` +
      `explicitly only if you have verified that it can.`,
  );
}
