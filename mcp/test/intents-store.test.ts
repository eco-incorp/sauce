/**
 * The intent store a LOCAL server keeps, in process with no chain: the store's tools listed only
 * where the server keeps it, an intent the `sauce` command stored listed and shown, every intent
 * tool taking it by its hash, a hash the store does not hold refused by name, and an intent a call
 * names made known to the store for what its transactions do. Over HTTP (no stores) there is
 * neither the tools nor `intentHash`. `intents-store.e2e.test.ts` records what transactions do.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { IntentStore } from "../../sdk/dist/cli/store.js";
import type { IntentRecord } from "../../sdk/dist/cli/lifecycle.js";
import { NO_ENDPOINTS } from "../src/config.js";
import { INTENT_STORE_TOOL_NAMES, INTENT_TOOL_NAMES } from "../src/intents.js";
import { connect, failed, ok, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const TX = `0x${"ab".repeat(32)}` as const;

/** Base USDC to `recipient` for Ethereum USDC, at `deadline`: an intent fixed by main's argument. */
const program = (deadline: number) => ({
  source: [
    "function main(recipient: Address) {",
    "  Base(() => {",
    "    USDC.transfer(recipient, 5);",
    "  }).reward({ tokens: [{ token: USDC, amount: 7 }] });",
    "}",
    "",
  ].join("\n"),
  chain: "ethereum",
  args: [RECIPIENT],
  intentDeadline: deadline,
  intentCreator: OWNER,
});

/** The tools that name an intent, and so take `intentHash` where the server keeps the store. */
const NAMING = INTENT_TOOL_NAMES.filter((name) => name !== "sauce_intent_import");

let dir: string;
let store: IntentStore;
let local: Connected;
let remote: Connected;
let record: IntentRecord;

/** An intent's record, as sauce_intent_publish builds it. */
async function recordOf(deadline: number): Promise<IntentRecord> {
  const published = ok(await remote.call("sauce_intent_publish", program(deadline))) as {
    intents: Array<{ record: IntentRecord }>;
  };

  return published.intents[0]!.record;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sauce-mcp-intents-store-"));
  store = new IntentStore(join(dir, "intents"));
  // As `sauce mcp` serves over stdio: the command's store, kept. And as over HTTP: none.
  local = await connect(NO_ENDPOINTS, undefined, undefined, true, { intents: store });
  remote = await connect();
  record = await recordOf(2_000_000_000);
  // Stored as the sauce command stores what it publishes.
  store.save(record);
  store.append(record.intentHash, {
    event: "published",
    chain: "ethereum",
    chainId: 1,
    tx: TX,
    block: "1",
    time: "2026-10-15T00:00:00.000Z",
    from: OWNER,
  });
});
after(async () => {
  await local.close();
  await remote.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the intent store over stdio", () => {
  it("lists its tools, and intentHash on every intent tool, only where the server keeps it", async () => {
    const listed = async (mcp: Connected) =>
      new Map(
        (await mcp.client.listTools()).tools.map((tool) => [
          tool.name,
          Object.keys(tool.inputSchema.properties ?? {}),
        ]),
      );
    const kept = await listed(local);
    const names = [...kept.keys()];
    const at = names.indexOf(INTENT_TOOL_NAMES.at(-1)!);
    assert.deepEqual(names.slice(at + 1, at + 1 + INTENT_STORE_TOOL_NAMES.length), [
      ...INTENT_STORE_TOOL_NAMES,
    ]);
    for (const name of NAMING) assert.ok(kept.get(name)!.includes("intentHash"), name);
    assert.match(
      local.client.getInstructions() ?? "",
      /THIS SERVER KEEPS THE sauce COMMAND'S INTENT STORE/,
    );

    const none = await listed(remote);
    for (const name of INTENT_STORE_TOOL_NAMES) assert.equal(none.has(name), false, name);
    for (const name of NAMING) assert.ok(!none.get(name)!.includes("intentHash"), name);
    assert.match(remote.client.getInstructions() ?? "", /This server keeps no intents/);
    assert.match(
      failed(await remote.call("sauce_intent_status", { intentHash: record.intentHash })),
      /intentHash/,
    );
  });

  it("lists and shows what the sauce command stored, as sauce intent list and show do", async () => {
    // No endpoint reaches either chain: what the store holds, with no state read.
    const list = ok(await local.call("sauce_intent_list"));
    assert.deepEqual(list.store, store.dir);
    assert.deepEqual(list.intents, [
      {
        intentHash: record.intentHash,
        source: "ethereum",
        destination: "base",
        last: "published",
      },
    ]);
    const shown = ok(await local.call("sauce_intent_show", { intentHash: record.intentHash })) as {
      record: IntentRecord;
      events: Array<{ event: string; tx: string; from: string }>;
      status?: unknown;
      notes: string[];
    };
    assert.deepEqual(shown.record, record);
    assert.deepEqual(
      shown.events.map((event) => [event.event, event.tx, event.from]),
      [["published", TX, OWNER]],
    );
    assert.equal(shown.status, undefined);
    assert.ok(shown.notes.some((note) => /rpcUrls with both chains' endpoints/.test(note)));
  });

  it("takes a stored intent by its hash, and refuses one the store does not hold", async () => {
    // Found in the store: what stops it is the endpoint it has none of.
    assert.match(
      failed(await local.call("sauce_intent_status", { intentHash: record.intentHash })),
      /needs an endpoint for ethereum or base/,
    );
    for (const tool of ["sauce_intent_claim", "sauce_intent_prove"]) {
      assert.match(
        failed(await local.call(tool, { intentHash: [record.intentHash] })),
        /endpoint/,
        tool,
      );
    }
    const missing = `0x${"00".repeat(31)}01`;
    for (const tool of ["sauce_intent_status", "sauce_intent_show"]) {
      assert.match(
        failed(await local.call(tool, { intentHash: missing })),
        new RegExp(`no intent ${missing} in ${store.dir}: sauce_intent_import stores one`),
        tool,
      );
    }
    assert.match(
      failed(
        await local.call("sauce_intent_status", { intentHash: record.intentHash, intent: record }),
      ),
      /give intent .*, intentHash .* or txHash with chain .*, only one of them/,
    );
  });

  it("knows an intent a call names by its record, for what its transactions do", async () => {
    const other = await recordOf(2_000_000_100);
    assert.equal(store.recall(other.intentHash), undefined);
    failed(await local.call("sauce_intent_refund", { intent: other }));
    // In memory, for a transaction that lands an event of it: nothing is written yet.
    assert.deepEqual(store.recall(other.intentHash), other);
    assert.equal(store.has(other.intentHash), false);
  });
});
