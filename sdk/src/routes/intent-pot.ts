/**
 * The destination Pot an intent's route cooks on, when the caller does not name one.
 *
 * One implementation for both ways of building an intent — `Chain(() => ...).reward(...)` written
 * inside a program (`sauce-route.ts#compileIntentChild`) and the TypeScript builder
 * (`intent-dsl.ts#openRoute`) — so the two cannot derive different Pots for the same route.
 *
 * THE OWNER IS THE RECORDED PORTAL'S EXECUTOR. A route call runs as the Executor of the Portal that
 * fulfils it, and `Pot.cook` is `onlyOwner`. So the owner is derived from the Portal the route
 * RECORDS — the caller's override when there is one — never from the registry's Portal for the
 * chain: a route naming Portal B cooks as B's Executor, and a Pot owned by the registry Portal's
 * Executor rejects that with `NotOwner()`.
 *
 * THE ROUTE DEPLOYS IT. A derived Pot comes with `Kitchen.deployPot(executor, salt)` as the route's
 * first call. That call is safe on every fulfilment: at `kitchen-evm-v1.0.0` (`Kitchen.sol:119-137`)
 * it computes `predictPot(owner, salt)`, deploys only when no code is there, and otherwise returns
 * the existing Pot; it is permissionless and reverts only on a zero owner. The first fulfilment on
 * a chain deploys, and every later one pays for a no-op instead of reverting on a missing Pot.
 *
 * A Pot the caller names gets no such call. It need not sit at the SDK's (owner, salt), so the
 * call would deploy a second, unused Pot next to it rather than guarantee the one the route uses.
 */
import { getAddress, type Hex } from "viem";

import type { ChainRef } from "../chains/canonical.js";
import { v12EngineAddress } from "../deployments/index.js";
import { SAUCE_INTENT_POT_SALT, v12GateKitchen, v12PredictPot } from "../deployments/pot.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import { sauceEvmDeployPotCall } from "./sauce-calls.js";
import type { AddressInput } from "./types.js";

export interface IntentPotOverrides {
  /** A Pot the caller owns instead. Suppresses the `deployPot` call. */
  readonly pot?: AddressInput;
  /** Defaults to the released engine address. */
  readonly engine?: AddressInput;
}

export interface IntentPot {
  /** An override is returned exactly as given; only a derived address is the SDK's spelling. */
  readonly pot: AddressInput;
  readonly engine: AddressInput;
  /** `Kitchen.deployPot(executor, SAUCE_INTENT_POT_SALT)`, present exactly when the Pot was
   *  derived. It belongs FIRST in `route.calls`, before anything moves assets to the Pot or cooks. */
  readonly deployPot:
    { readonly target: Hex; readonly data: Hex; readonly value: bigint } | undefined;
}

const evmAddress = (value: AddressInput): Hex =>
  getAddress(denormalizeToEvm(toUniversalAddress(value))) as Hex;

/** The Pot, engine and (for a derived Pot) deployment call for a route recording `portal`. */
export function resolveIntentPot(
  portal: AddressInput,
  overrides: IntentPotOverrides = {},
): IntentPot {
  const engine = overrides.engine ?? (v12EngineAddress() as Hex);
  if (overrides.pot !== undefined) return { pot: overrides.pot, engine, deployPot: undefined };
  const executor = ecoRoutesExecutorOf(evmAddress(portal));
  // The Kitchen the released engine's gate re-derives against: prediction and deployment must name
  // the same one, or the route deploys a Pot at an address other than the one it cooks on.
  const kitchen = v12GateKitchen();
  const call = sauceEvmDeployPotCall({ kitchen, owner: executor, salt: SAUCE_INTENT_POT_SALT });

  return {
    pot: v12PredictPot(executor, SAUCE_INTENT_POT_SALT, kitchen),
    engine,
    deployPot: { target: kitchen, data: call.data, value: 0n },
  };
}

/**
 * The Pot an intent's route on `destination` cooks on when none is named — for a caller that has
 * to address it before building, such as a `precalls` transfer from the Executor into it.
 *
 * `portal` is the destination Portal the route will record; omit it for the registry's. Derived,
 * not read: the Pot may not exist yet, and the route built for it deploys it first.
 */
export function destinationPot(
  destination: ChainRef,
  options: { readonly portal?: AddressInput; readonly ecoRoutes?: EcoRoutesSelector } = {},
): Hex {
  const portal = options.portal ?? ecoRoutesPortal(destination, options.ecoRoutes);

  return resolveIntentPot(portal).pot as Hex;
}
