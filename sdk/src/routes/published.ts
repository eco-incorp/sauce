/**
 * The intents a cook published, read from the Portal's `IntentPublished` in its logs: a rehearsal's
 * (`eth_simulateV1`) or a receipt's. An intent a program opens exists nowhere else: `@sauce/hop`
 * builds it while the program compiles, and the program encodes it as it runs, so its hash is the
 * one its log announces.
 */
import { getAddress, type Address, type Hex } from "viem";

import {
  chainById,
  requireChain,
  type CanonicalChain,
  type ChainRef,
} from "../chains/canonical.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { intentFromPublished } from "./portal.js";
import type { Intent } from "./types.js";

/** One intent a cook published, rebuilt from the Portal's log. */
export interface LoggedIntent {
  readonly intent: Intent;
  readonly intentHash: Hex;
  readonly destination: CanonicalChain;
  /** The Portal that published it, where it is claimed and refunded. */
  readonly portal: Address;
}

/** A log as a receipt or a rehearsal gives it. */
export interface IntentLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/**
 * The intents `logs` record `chain`'s Portal publishing — the registry's, or `portal` — each rebuilt
 * from its `IntentPublished` and held to the hash it announces. A log from any other address is not
 * that Portal's, whatever it says.
 */
export function loggedIntents(
  chain: ChainRef,
  logs: readonly IntentLog[],
  portal?: Address,
): LoggedIntent[] {
  const source = requireChain(chain);
  if (source.kind !== "evm" || logs.length === 0) return [];
  let from: Address;
  try {
    from = getAddress(portal ?? ecoRoutesPortal(source));
  } catch {
    // No Portal on the chain: nothing there publishes an intent.
    return [];
  }

  return logs.flatMap((log) => {
    if (getAddress(log.address) !== from) return [];
    const published = intentFromPublished(log, BigInt(source.id));
    const destination =
      published === undefined ? undefined : chainById(Number(published.intent.destination));
    if (published === undefined || destination === undefined) return [];

    return [{ ...published, destination, portal: from }];
  });
}
