/**
 * The intent store (`cli/store.ts`): an intent written once and never changed, its events appended
 * one line at a time, nothing read and written back — and so nothing two processes can tear. The
 * concurrency checks run real writers in processes of their own (`fixtures/cli/store-writer.mjs`),
 * started together, against one store.
 */
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intentOf, intentRecord, type IntentRecord } from "../src/cli/lifecycle.js";
import { IntentStore } from "../src/cli/store.js";
import { ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { toUniversalAddress } from "../src/routes/normalize.js";
import type { Intent } from "../src/routes/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WRITER = join(HERE, "fixtures/cli/store-writer.mjs");

const u = (address: `0x${string}`) => toUniversalAddress(address);
const portal = ecoRoutesPortal("base");
/** A Base -> Arbitrum intent: USDC to a recipient, for USDC. */
const INTENT: Intent = {
  sourceChainId: 8453n,
  destination: 42161n,
  route: {
    salt: `0x${"00".repeat(31)}01`,
    deadline: 2_000_000_000n,
    portal: u(ecoRoutesPortal("arbitrum")),
    nativeAmount: 0n,
    tokens: [{ token: u("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"), amount: 1_000_000n }],
    calls: [
      {
        target: u("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"),
        data: "0xa9059cbb",
        value: 0n,
      },
    ],
  },
  reward: {
    deadline: 2_000_086_400n,
    creator: u("0x5a0Ce0000000000000000000000000000000Beef"),
    prover: u("0xec004Ab4870c4e177c66949329dCdb503CE41022"),
    nativeAmount: 0n,
    tokens: [{ token: u("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), amount: 1_050_000n }],
  },
};

/** Runs `writers` at once, each `mode` with its own `arg`, and returns what each printed. */
async function together(dir: string, writers: ReadonlyArray<{ mode: string; arg: string }>) {
  mkdirSync(dir, { recursive: true });
  const go = join(dir, `go-${Math.random().toString(36).slice(2)}`);
  const children = writers.map(({ mode, arg }, index) => {
    const child = spawn(process.execPath, [WRITER, dir, mode, go, `w${index}`, arg], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));

    return new Promise<string>((resolve, reject) =>
      child.on("exit", (code) =>
        code === 0 ? resolve(out) : reject(new Error(`writer ${index} exited ${code}: ${err}`)),
      ),
    );
  });
  // Every writer is waiting on `go`; this releases them at once.
  await new Promise((resolve) => setTimeout(resolve, 300));
  writeFileSync(go, "");

  return Promise.all(children);
}

describe("the intent store", () => {
  let dir: string;
  let record: IntentRecord;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-store-test-"));
    record = intentRecord(INTENT, { sourcePortal: portal });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps an intent once, under its hash, and reads it back exactly", () => {
    const store = new IntentStore(dir);
    expect(store.save(record)).toBe("created");
    expect(store.save(record)).toBe("exists");
    // A record with the vault and one without are the same intent.
    expect(store.save({ ...record, vault: "0x1111111111111111111111111111111111111111" })).toBe(
      "exists",
    );
    const loaded = store.load(record.intentHash);
    expect(loaded.record).toEqual(record);
    expect(intentOf(loaded.record)).toEqual(INTENT);
    expect(store.list().intents.map((entry) => entry.intentHash)).toEqual([record.intentHash]);
  });

  it("lists every record it can read, and warns of one it cannot instead of dropping it unsaid", () => {
    const store = new IntentStore(dir);
    store.save(record);
    const broken = `0x${"ef".repeat(32)}`;
    mkdirSync(join(dir, broken));
    writeFileSync(join(dir, broken, "intent.json"), '{"schema":"sauce.intent/1","intentHa');
    const listing = store.list();
    expect(listing.intents.map((entry) => entry.intentHash)).toEqual([record.intentHash]);
    expect(listing.warnings).toEqual([
      expect.stringMatching(
        new RegExp(`${broken}/intent\\.json is not JSON; that intent is left out`),
      ),
    ]);
  });

  it("refuses a different intent under the same hash, and leaves the file as it was", () => {
    const store = new IntentStore(dir);
    store.save(record);
    const path = join(dir, record.intentHash, "intent.json");
    const before = readFileSync(path, "utf8");
    expect(() => store.save({ ...record, route: { ...record.route, deadline: "1" } })).toThrow(
      /holds a different intent under the same hash/,
    );
    expect(readFileSync(path, "utf8")).toBe(before);
    // And a record whose hashes no longer match its route is refused when it is read as an intent.
    expect(() => intentOf({ ...record, route: { ...record.route, deadline: "1" } })).toThrow(
      /was changed after it was written/,
    );
  });

  it("appends events in order, and skips a line cut short with a warning", () => {
    const store = new IntentStore(dir);
    store.save(record);
    const event = { chain: "base", chainId: 8453, time: "2026-10-01T00:00:00.000Z" } as const;
    store.append(record.intentHash, { event: "published", ...event, tx: `0x${"ab".repeat(32)}` });
    store.append(record.intentHash, { event: "funded", ...event });
    // A write that stopped half way: no newline, no closing brace.
    appendFileSync(join(dir, record.intentHash, "events.jsonl"), '{"v":1,"event":"fil');
    const loaded = store.load(record.intentHash);
    expect(loaded.events.map((entry) => entry.event)).toEqual(["published", "funded"]);
    expect(loaded.warnings).toEqual([
      expect.stringMatching(/events\.jsonl:3 is not an event line; skipped/),
    ]);
  });

  it("names a hash it does not hold, and refuses one that is not a hash", () => {
    const store = new IntentStore(dir);
    expect(() => store.load(`0x${"cd".repeat(32)}`)).toThrow(/no intent 0x(cd){32} in /);
    expect(() => store.load("0x1234")).toThrow(/is not an intent hash/);
    expect(store.list()).toEqual({ intents: [], warnings: [] });
  });

  it("loses no event when two processes append at once", async () => {
    const store = new IntentStore(dir);
    store.save(record);
    writeFileSync(join(dir, "record.json"), JSON.stringify(record));
    const count = 250;
    expect(
      await together(dir, [
        { mode: "append", arg: String(count) },
        { mode: "append", arg: String(count) },
      ]),
    ).toEqual(["appended", "appended"]);
    const loaded = store.load(record.intentHash);
    expect(loaded.warnings).toEqual([]);
    expect(loaded.events).toHaveLength(2 * count);
    for (const writer of ["w0", "w1"]) {
      const mine = loaded.events.filter((event) => event.chain === writer);
      // Each writer's own lines, all there and in its order.
      expect(mine.map((event) => event.chainId)).toEqual([...Array(count).keys()]);
    }
  }, 60_000);

  it("lets exactly one of two processes create an intent, and both see the same file", async () => {
    const file = join(dir, "record.json");
    writeFileSync(file, JSON.stringify(record));
    for (let round = 0; round < 5; round++) {
      const store = join(dir, `round-${round}`);
      const results = await together(store, [
        { mode: "save", arg: file },
        { mode: "save", arg: file },
      ]);
      expect([...results].sort()).toEqual(["created", "exists"]);
      expect(
        JSON.parse(readFileSync(join(store, record.intentHash, "intent.json"), "utf8")),
      ).toEqual(record);
    }
  }, 60_000);
});
