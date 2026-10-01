/**
 * The `sauce` command's intent store: every intent it publishes, fills, proves, claims, refunds,
 * cancels or imports, kept on disk so a later command can name it by hash alone.
 *
 * One directory per intent, `<dir>/<intentHash>/`, holding two files, so that nothing is ever read,
 * changed and written back — the shape that has no conflict between two processes:
 *
 *  - `intent.json`, IMMUTABLE: the full intent (`lifecycle.ts#IntentRecord` — the route and
 *    reward, both chains, the Portal, the hashes, the vault). It is written to a temporary file
 *    beside it and LINKED into place, which fails if the name exists: the content appears whole,
 *    and two writers cannot both win. The loser finds the file there and checks it holds the same
 *    intent (a record without the vault and one with it are the same intent).
 *  - `events.jsonl`, APPEND-ONLY: one JSON line per thing that happened to the intent (published,
 *    funded, filled, proving, proven, claimed, refunded, cancelled) with its chain, transaction,
 *    block and time, each appended by ONE `write` to a file opened `O_APPEND`, and kept short so
 *    the append is atomic. A line that does not parse — a write cut short — is skipped with a
 *    warning, never fatal.
 *
 * Nothing here is a status: what an intent's state is comes from these events and a live read of
 * the chains (`lifecycle.ts#intentStatus`), every time. No key, password or endpoint is ever
 * written: the record and the events hold only public chain data.
 *
 * NODE-ONLY (the filesystem), like the rest of `cli/` that touches it; the default directory is
 * `~/.sauce/intents` (`os.homedir()`), and `--store <dir>` names another.
 */
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Hex } from "viem";

import { CliError } from "./args.js";
import { INTENT_SCHEMA, intentOf, type IntentRecord } from "./lifecycle.js";

/** Where intents are kept unless `--store` says otherwise. */
export const defaultStoreDir = (): string => join(homedir(), ".sauce", "intents");

/** What can happen to an intent, as the store records it. */
export const STORE_EVENTS = [
  "published",
  "funded",
  "imported",
  "filled",
  "proving",
  "proven",
  "claimed",
  "refunded",
  "cancelled",
] as const;
export type StoreEventName = (typeof STORE_EVENTS)[number];

/** One line of `events.jsonl`. */
export interface StoreEvent {
  /** The line's schema version. */
  readonly v: 1;
  readonly event: StoreEventName;
  /** The chain it happened on. */
  readonly chain: string;
  readonly chainId: number;
  readonly tx?: Hex;
  readonly block?: string;
  /** When: the block's time where there is a block, else the moment it was recorded (ISO 8601). */
  readonly time: string;
  /** Who sent it, or who it paid. */
  readonly from?: Hex;
  /** A Hyperlane message a proof travels as. */
  readonly message?: Hex;
}

/** An intent as the store holds it. */
export interface StoredIntent {
  readonly intentHash: Hex;
  readonly record: IntentRecord;
  readonly events: readonly StoreEvent[];
  /** What could not be read: a corrupt line skipped, say. */
  readonly warnings: readonly string[];
}

const HASH = /^0x[0-9a-f]{64}$/;

/** The longest line `append` writes: comfortably inside one atomic write. */
const MAX_LINE = 1024;

/** `record` with `vault` dropped: what two records of one intent must agree on. */
const comparable = (record: IntentRecord): string =>
  JSON.stringify({ ...record, vault: undefined });

export class IntentStore {
  constructor(readonly dir: string) {}

  private intentDir(intentHash: Hex): string {
    const hash = intentHash.toLowerCase();
    if (!HASH.test(hash))
      throw new CliError(`'${intentHash}' is not an intent hash (32 bytes of hex)`);

    return join(this.dir, hash);
  }

  /**
   * Keeps `record`, once: `"created"` when this call wrote it, `"exists"` when it was there already
   * (holding the same intent). A different intent under the same hash — impossible unless a file
   * was edited — is an error, and the file is left as it was.
   */
  save(record: IntentRecord): "created" | "exists" {
    intentOf(record);
    const dir = this.intentDir(record.intentHash);
    mkdirSync(dir, { recursive: true });
    const final = join(dir, "intent.json");
    const text = `${JSON.stringify(record, null, 2)}\n`;
    const temporary = join(
      dir,
      `.intent.json.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    writeFileSync(temporary, text, { flag: "wx" });
    try {
      linkSync(temporary, final);

      return "created";
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      const existing = this.readRecord(record.intentHash);
      if (comparable(existing) !== comparable(record)) {
        throw new CliError(
          `${final} holds a different intent under the same hash: it was edited, so it is left ` +
            "as it is",
        );
      }

      return "exists";
    } finally {
      unlinkSync(temporary);
    }
  }

  /** Appends `event` to the intent's log, in one write. */
  append(intentHash: Hex, event: Omit<StoreEvent, "v">): void {
    const dir = this.intentDir(intentHash);
    mkdirSync(dir, { recursive: true });
    const line = `${JSON.stringify({ v: 1, ...event })}\n`;
    const bytes = new TextEncoder().encode(line);
    if (bytes.length > MAX_LINE) {
      throw new CliError(`an event line of ${bytes.length} bytes is too long to append atomically`);
    }
    const fd = openSync(join(dir, "events.jsonl"), "a");
    try {
      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
  }

  private readRecord(intentHash: Hex): IntentRecord {
    const path = join(this.intentDir(intentHash), "intent.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new CliError(
        (error as { code?: string }).code === "ENOENT"
          ? `no intent ${intentHash.toLowerCase()} in ${this.dir}`
          : `${path} is not JSON`,
      );
    }
    const record = parsed as IntentRecord;
    if (record.schema !== INTENT_SCHEMA) {
      throw new CliError(
        `${path}: schema ${JSON.stringify(record.schema)} is not ${INTENT_SCHEMA}`,
      );
    }

    return record;
  }

  /** Whether the store holds `intentHash`. */
  has(intentHash: Hex): boolean {
    return existsSync(join(this.intentDir(intentHash), "intent.json"));
  }

  /** The intent `intentHash`, with its events. */
  load(intentHash: Hex): StoredIntent {
    const record = this.readRecord(intentHash);
    const { events, warnings } = this.readEvents(intentHash);

    return { intentHash: record.intentHash, record, events, warnings };
  }

  private readEvents(intentHash: Hex): { events: StoreEvent[]; warnings: string[] } {
    const path = join(this.intentDir(intentHash), "events.jsonl");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return { events: [], warnings: [] };
      throw error;
    }
    const events: StoreEvent[] = [];
    const warnings: string[] = [];
    text.split("\n").forEach((line, index) => {
      if (line.trim() === "") return;
      try {
        const event = JSON.parse(line) as StoreEvent;
        if (event.v !== 1 || !(STORE_EVENTS as readonly string[]).includes(event.event)) {
          throw new Error("not an event");
        }
        events.push(event);
      } catch {
        warnings.push(`warning: ${path}:${index + 1} is not an event line; skipped`);
      }
    });

    return { events, warnings };
  }

  /** Every intent the store holds, newest event last within each. */
  list(): StoredIntent[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return [];
      throw error;
    }

    return names
      .filter((name) => HASH.test(name) && existsSync(join(this.dir, name, "intent.json")))
      .flatMap((name) => {
        try {
          return [this.load(name as Hex)];
        } catch {
          return [];
        }
      });
  }
}
