/**
 * The intents a cook published, read from the Portal's `IntentPublished` in its logs: a rehearsal's
 * (`sauce simulate`, `intent publish --dry-run`, `file-intents.ts`) or a receipt's (`sauce run`,
 * `intent publish`). An intent a program opens exists nowhere else: `@sauce/intents` builds it while
 * the program compiles, and the program encodes it as it runs.
 */
import { getAddress, type Address, type Hex } from "viem";

import { chainById, type CanonicalChain } from "../chains/canonical.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { intentFromPublished } from "../routes/portal.js";
import type { Intent } from "../routes/types.js";
import { intentRecord } from "./lifecycle.js";

/** One intent a cook published, rebuilt from the Portal's log. */
export interface FileIntent {
  readonly intent: Intent;
  readonly intentHash: Hex;
  readonly destination: CanonicalChain;
  /** The Portal that published it, where it is claimed and refunded. */
  readonly portal: Address;
}

/** A log as a receipt or a rehearsal gives it. */
interface Log {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

/**
 * The intents `logs` record `chain`'s Portal publishing, each rebuilt from its `IntentPublished`.
 * A log from any other address is not the Portal's, whatever it says.
 */
export function loggedIntents(chain: CanonicalChain, logs: readonly Log[]): FileIntent[] {
  if (chain.kind !== "evm" || logs.length === 0) return [];
  let portal: Address;
  try {
    portal = getAddress(ecoRoutesPortal(chain));
  } catch {
    // No Portal on the chain: nothing there publishes an intent.
    return [];
  }

  return logs.flatMap((log) => {
    if (getAddress(log.address) !== portal) return [];
    const published = intentFromPublished(log, BigInt(chain.id));
    const destination =
      published === undefined ? undefined : chainById(Number(published.intent.destination));
    if (published === undefined || destination === undefined) return [];

    return [{ ...published, destination, portal }];
  });
}

/**
 * The intents a cook published, for a report: each one's hash, its destination, and its `record`,
 * the intent in full as the store keeps it and the intent commands and tools take it.
 */
export const intentsJson = (intents: readonly FileIntent[]): Record<string, unknown>[] =>
  intents.map(({ intent, intentHash, destination, portal }) => ({
    intentHash,
    destination: destination.slug,
    record: intentRecord(intent, { sourcePortal: portal }),
  }));

/** One line per intent a cook published. */
export const intentLines = (intents: readonly FileIntent[]): string[] =>
  intents.map(
    ({ intentHash, destination }) => `published intent ${intentHash} to ${destination.slug}`,
  );
