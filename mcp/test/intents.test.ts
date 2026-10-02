/**
 * The intent tools in process, with no chain: how a call names its intent (a record, its JSON
 * text, or the transaction that published it), what is refused before anything is read, and what
 * each tool says when it has no endpoint for a chain it needs. `intents.e2e.test.ts` runs them
 * against two chains.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { connect, failed, ok, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const TX = `0x${"ab".repeat(32)}`;

/** Base USDC to RECIPIENT for Ethereum USDC: an intent fixed when it is built. */
const PROGRAM = {
  source: [
    "Base.Portal.send([{ token: USDC, amount: 7n }]).then(() => {",
    "  USDC.transfer(RECIPIENT, 5n);",
    "});",
    "",
  ].join("\n"),
  chain: "ethereum",
  defines: { RECIPIENT },
  intentDeadline: 2_000_000_000,
  intentCreator: OWNER,
};

type IntentJson = {
  schema: string;
  intentHash: string;
  source: { chainId: number; chain: string };
  destination: { chainId: number; chain: string };
  reward: { tokens: Array<{ token: string; amount: string }> };
};

let mcp: Connected;
let record: IntentJson;

before(async () => {
  mcp = await connect();
  const published = ok(await mcp.call("sauce_intent_publish", PROGRAM)) as {
    intents: Array<{ intentHash: string; record: IntentJson }>;
  };
  record = published.intents[0]!.record;
});
after(() => mcp.close());

describe("sauce_intent_publish", () => {
  it("returns each intent's record, the input every intent tool takes", () => {
    assert.equal(record.schema, "sauce.intent/1");
    assert.deepEqual([record.source.chain, record.destination.chain], ["ethereum", "base"]);
    assert.match(record.intentHash, /^0x[0-9a-f]{64}$/);
  });
});

describe("naming an intent", () => {
  it("takes a record or a transaction, one of them", async () => {
    for (const tool of ["sauce_intent_status", "sauce_intent_refund", "sauce_intent_cancel"]) {
      assert.match(failed(await mcp.call(tool, {})), /give intent .* or txHash with chain/);
      assert.match(
        failed(await mcp.call(tool, { intent: record, txHash: TX, chain: "ethereum" })),
        /not both/,
      );
    }
    assert.match(
      failed(await mcp.call("sauce_intent_status", { txHash: TX })),
      /txHash needs chain: the source chain/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_status", { intent: record, chain: "base" })),
      /chain and index go with txHash/,
    );
  });

  it("checks a record: its shape, its schema, and that it hashes to its intentHash", async () => {
    assert.match(
      failed(await mcp.call("sauce_intent_status", { intent: "{not json" })),
      /intent: not JSON/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_status", { intent: { intentHash: record.intentHash } })),
      /intent is not an intent record \(sauce\.intent\/1\): schema: .*source/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_status", { intent: { ...record, schema: "sauce.intent/0" } }),
      ),
      /schema is "sauce\.intent\/0", not sauce\.intent\/1/,
    );
    const changed = structuredClone(record);
    changed.reward.tokens[0]!.amount = "8";
    assert.match(
      failed(await mcp.call("sauce_intent_refund", { intent: changed })),
      /it was changed after it was written/,
    );
    // As its JSON text, the same record: refused here only for want of an endpoint.
    assert.match(
      failed(await mcp.call("sauce_intent_refund", { intent: JSON.stringify(record) })),
      /a refund needs ethereum's endpoint \(chain id 1\): pass rpcUrls \{ "ethereum": "<url>" \}/,
    );
  });
});

describe("with no endpoint", () => {
  it("says which chain each tool needs, and how to give it", async () => {
    const expected: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        "sauce_intent_import",
        { txHash: TX, chain: "ethereum" },
        /Reading the transaction that published it needs an RPC endpoint for ethereum .*Pass rpcUrl with the call/,
      ],
      [
        "sauce_intent_status",
        { intent: record },
        /Reading where an intent stands needs an endpoint for ethereum or base: pass rpcUrls/,
      ],
      [
        "sauce_intent_status",
        { txHash: TX, chain: "ethereum" },
        /Reading the transaction that published it needs an RPC endpoint for ethereum/,
      ],
      ["sauce_intent_claim", { intent: [record, record] }, /a claim needs ethereum's endpoint/],
      ["sauce_intent_refund", { intent: record }, /a refund needs ethereum's endpoint/],
      ["sauce_intent_prove", { intent: record }, /needs base's endpoint \(chain id 8453\)/],
      ["sauce_intent_cancel", { intent: record }, /needs base's endpoint \(chain id 8453\)/],
      [
        "sauce_intent_fill",
        { intent: record, from: OWNER },
        /Building a fill needs an RPC endpoint for base \(chain id 8453\)/,
      ],
      [
        "sauce_intent_fill",
        { ...PROGRAM, dryRun: true },
        /Rehearsing a fill needs an RPC endpoint for base \(chain id 8453\)/,
      ],
    ];
    for (const [tool, args, message] of expected) {
      assert.match(failed(await mcp.call(tool, args)), message, tool);
    }
  });
});

describe("sauce_intent_fill", () => {
  it("names its intents one way, and builds for a solver unless it rehearses", async () => {
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { from: OWNER })),
      /name the intents one way: source .*, intent .*, or txHash/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { ...PROGRAM, intent: record, from: OWNER })),
      /name the intents one way/,
    );
    assert.match(
      failed(await mcp.call("sauce_intent_fill", { intent: record })),
      /give from: the solver's address, which signs these .* or dryRun/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", { intent: record, from: OWNER, claimant: "0x12" }),
      ),
      /claimant: '0x12' is neither an address \(20 bytes\) nor 32 bytes of hex/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", {
          intent: record,
          from: OWNER,
          rpcUrls: { nowhere: "http://127.0.0.1:9/" },
        }),
      ),
      /nowhere/,
    );
  });
});
