/**
 * The intents a cook published, read from the Portal's `IntentPublished` in its logs: a rehearsal's
 * (`sauce simulate`, `intent publish --dry-run`, `file-intents.ts`) or a receipt's (`sauce run`,
 * `intent publish`). An intent a program opens exists nowhere else: `@sauce/hop` builds it while
 * the program compiles, and the program encodes it as it runs.
 */
import { loggedIntents as published, type LoggedIntent } from "../routes/published.js";
import type { CanonicalChain } from "../chains/canonical.js";
import { intentRecord } from "./lifecycle.js";

/** One intent a cook published, rebuilt from the Portal's log. */
export type FileIntent = LoggedIntent;

/** The intents `logs` record `chain`'s registry Portal publishing (`routes/published.ts`). */
export const loggedIntents = (
  chain: CanonicalChain,
  logs: Parameters<typeof published>[1],
): FileIntent[] => published(chain, logs);

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
