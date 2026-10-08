/**
 * The destination Pot an intent's route cooks on, when the caller does not name one.
 *
 * One implementation for every way an intent is built, so no two can derive different Pots for the
 * same route.
 *
 * THE OWNER IS THE RECORDED PORTAL'S EXECUTOR. A route call runs as the Executor of the Portal that
 * fulfils it, and `Pot.cook` is `onlyOwner`. So the owner is derived from the Portal the route
 * RECORDS — the caller's override when there is one — never from the registry's Portal for the
 * chain: a route naming Portal B cooks as B's Executor, and a Pot owned by the registry Portal's
 * Executor rejects that with `NotOwner()`.
 *
 * THE POT MUST ALREADY EXIST. This derives an address; nothing in the route deploys a contract
 * there. The Pot is the one the solver deploys for each Portal — owner `executor()`, salt zero —
 * and a fulfilment cooking on a Pot that is not there reverts, because the Executor refuses a call
 * with calldata to an address without code. Anyone deploying it first uses `sauceEvmDeployPotCall`
 * with this Executor and `SAUCE_INTENT_POT_SALT`.
 */
import { getAddress, type Hex } from "viem";

import type { ChainRef } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import type { AddressInput } from "./types.js";

export interface IntentPotOverrides {
  /** A Pot the caller owns instead of the derived one. */
  readonly pot?: AddressInput;
  /** Defaults to the released engine address. */
  readonly engine?: AddressInput;
}

export interface IntentPot {
  /** An override is returned exactly as given; only a derived address is the SDK's spelling. */
  readonly pot: AddressInput;
  readonly engine: AddressInput;
}

const evmAddress = (value: AddressInput): Hex =>
  getAddress(denormalizeToEvm(toUniversalAddress(value))) as Hex;

/** The Pot and engine for a route recording `portal`. */
export function resolveIntentPot(
  portal: AddressInput,
  overrides: IntentPotOverrides = {},
): IntentPot {
  return {
    pot: overrides.pot ?? v12PredictPot(ecoRoutesExecutorOf(evmAddress(portal))),
    engine: overrides.engine ?? (v12EngineAddress() as Hex),
  };
}

/**
 * The Pot an intent's route on `destination` cooks on when none is named — for a caller that has
 * to address it before building, such as a `precalls` transfer from the Executor into it, or a
 * check that it has been deployed.
 *
 * `portal` is the destination Portal the route will record; omit it for the registry's. Derived,
 * not read: this does not say whether the Pot exists yet.
 */
export function destinationPot(
  destination: ChainRef,
  options: { readonly portal?: AddressInput; readonly ecoRoutes?: EcoRoutesSelector } = {},
): Hex {
  const portal = options.portal ?? ecoRoutesPortal(destination, options.ecoRoutes);

  return resolveIntentPot(portal).pot as Hex;
}
