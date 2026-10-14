/**
 * The intent tools in process, with no chain: how a call names its intent (a record, its JSON
 * text, or the transaction that published it), what is refused before anything is read, and what
 * each tool says when it has no endpoint for a chain it needs.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { intentRecord } from "../../sdk/dist/cli/lifecycle.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { assembleIntent } from "../../sdk/dist/routes/intent.js";
import { registryTokenAddress } from "../../sdk/dist/routes/token-registry.js";
import { connect, failed, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const TX = `0x${"ab".repeat(32)}`;

type IntentJson = {
  schema: string;
  intentHash: string;
  source: { chainId: number; chain: string };
  destination: { chainId: number; chain: string };
  reward: { tokens: Array<{ token: string; amount: string }> };
};

let mcp: Connected;
let record: IntentJson;

/** Base USDC to `recipient` for Ethereum USDC, built by hand: its record, the input every intent
 *  tool takes. */
function recordOf(): IntentJson {
  const [from, to] = [requireChain("ethereum"), requireChain("base")];
  const usdc = (chain: typeof from) =>
    `0x${registryTokenAddress(chain, "USDC")!.toString(16).padStart(40, "0")}` as `0x${string}`;
  const intent = assembleIntent(
    from,
    to,
    {
      deadline: 2_000_000_000n,
      portal: ecoRoutesPortal(to.slug),
      tokens: [{ token: usdc(to), amount: 5n }],
      calls: [
        {
          target: usdc(to),
          data: `0xa9059cbb${RECIPIENT.slice(2).padStart(64, "0")}${5n.toString(16).padStart(64, "0")}`,
          value: 0n,
        },
      ],
    },
    {
      deadline: 2_000_000_000n,
      creator: OWNER,
      prover: ecoRoutesProver(from.slug, to.slug),
      tokens: [{ token: usdc(from), amount: 7n }],
    },
  );

  return JSON.parse(
    JSON.stringify(intentRecord(intent, { sourcePortal: ecoRoutesPortal(from.slug) })),
  ) as IntentJson;
}

before(async () => {
  mcp = await connect();
  record = recordOf();
});
after(() => mcp.close());

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
        { intent: record, dryRun: true },
        /Simulating a fill needs an RPC endpoint for base \(chain id 8453\)/,
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
      /name the intents one way: intent .*, or txHash/,
    );
    assert.match(
      failed(
        await mcp.call("sauce_intent_fill", { intent: record, txHash: TX, chain: "ethereum" }),
      ),
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

describe("sauce_intent_publish", () => {
  it("refuses whatever it is given: opening an intent is coming soon", async () => {
    const said =
      "sauce_intent_publish: opening an intent is coming soon. It will be written " +
      "`<Chain>.hop({ send, receive, refundee }).then(() => { … })`; until then, the intent " +
      "tools act on intents that already exist: sauce_intent_import, sauce_intent_status, " +
      "sauce_intent_fill, sauce_intent_prove, sauce_intent_claim, sauce_intent_refund and " +
      "sauce_intent_cancel.";
    for (const args of [
      {},
      { source: "Base(() => {}).reward({ tokens: [] });", chain: "ethereum", dryRun: true },
    ]) {
      assert.equal(failed(await mcp.call("sauce_intent_publish", args)), said);
    }
    const { tools } = await mcp.client.listTools();
    const publish = tools.find((tool) => tool.name === "sauce_intent_publish");
    assert.match(publish!.description!, /^Coming soon: opening an intent/);
    assert.equal(publish!.annotations?.readOnlyHint, true);
  });

  it("a program that opens an intent meets the same refusal in every tool that compiles", async () => {
    const source =
      "function main(to: Address, amount: Uint256) {\n" +
      "  Ethereum.hop({ send: { token: USDC, amount }, refundee: to }).then(() => {});\n" +
      "}\n";
    assert.match(
      failed(await mcp.call("sauce_compile", { source, chain: "base" })),
      /^[^]*`Ethereum\.hop\(…\)` at line 2: opening an intent is coming soon\. It will be written /,
    );
  });
});
