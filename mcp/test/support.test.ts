/**
 * The release's chain gate through the tools (`sdk/src/cli/support.ts`, the command's own): every
 * tool that returns a transaction refuses a preview chain BEFORE it reaches the call's endpoint —
 * one that records each request it gets stays untouched — with a structured `refused` the calling
 * agent can act on; compile, simulate, the dry runs and the reads still run there.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { chainSupportRequest } from "../../sdk/dist/cli/support.js";
import { intentRecord } from "../../sdk/dist/cli/lifecycle.js";
import { ecoRoutesPortal, ecoRoutesProver } from "../../sdk/dist/protocols/eco-routes/lookup.js";
import { assembleIntent } from "../../sdk/dist/routes/intent.js";
import { registryTokenAddress } from "../../sdk/dist/routes/token-registry.js";
import { connect, ok, textOf, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const TX = `0x${"ab".repeat(32)}`;

const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");
/** The record of an intent from `source` to `destination` built by hand, `USDC.transfer` its
 *  route's one call: the input every intent tool takes. */
function recordOf(source: string, destination: string): Record<string, unknown> {
  const from = requireChain(source);
  const to = requireChain(destination);
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

  return intentRecord(intent, { sourcePortal: ecoRoutesPortal(from.slug) }) as unknown as Record<
    string,
    unknown
  >;
}

/** An endpoint that answers the reads a rehearsal starts with, as Arbitrum, and keeps each method
 *  asked. */
let methods: string[] = [];
let server: Server;
let url: string;

let mcp: Connected;
before(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const parsed = JSON.parse(body) as { id: number; method: string } | object[];
      const calls = [parsed].flat() as Array<{ id: number; method: string }>;
      const answers = calls.map((call) => {
        methods.push(call.method);
        const result =
          call.method === "eth_chainId"
            ? "0xa4b1"
            : call.method === "eth_getCode" || call.method === "eth_call"
              ? "0x"
              : call.method === "eth_blockNumber"
                ? "0x1"
                : undefined;

        return result === undefined
          ? { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not here" } }
          : { jsonrpc: "2.0", id: call.id, result };
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(parsed) ? answers : answers[0]));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  mcp = await connect();
  // As every client does: listed, the tools' output schemas are what the client then validates
  // each result against, an error's structured content included.
  await mcp.client.listTools();
});
after(async () => {
  await mcp.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => (methods = []));

type Refusal = {
  code: string;
  action: string;
  message: string;
  supportedChains: Array<{ slug: string; id: number; name: string }>;
  previewChains: Array<{
    slug: string;
    id: number;
    name: string;
    request: ReturnType<typeof chainSupportRequest>;
  }>;
};

/** An error result whose structured content is the refusal of `slug`, its text the same JSON. */
function refused(result: CallToolResult, slug: string): Refusal {
  assert.equal(result.isError, true, `expected a refusal, got: ${textOf(result)}`);
  const structured = result.structuredContent as { refused: Refusal } | undefined;
  assert.ok(structured !== undefined, `a refusal carries structured content: ${textOf(result)}`);
  assert.deepEqual(JSON.parse(textOf(result)), structured, "its text block is the same JSON");
  const { refused: refusal } = structured;
  assert.equal(refusal.code, "preview-chain");
  assert.deepEqual(
    refusal.supportedChains.map((chain) => chain.slug),
    ["ethereum", "base", "solana"],
  );
  const chain = requireChain(slug);
  assert.deepEqual(
    refusal.previewChains.map((preview) => preview.slug),
    [slug],
  );
  assert.deepEqual(refusal.previewChains[0]!.request, chainSupportRequest(chain));
  assert.match(refusal.message, new RegExp(`it involves ${slug} \\(`));

  return refusal;
}

describe("refused on a preview chain, before the call's endpoint", () => {
  it("sauce_tx, for the program's chain", async () => {
    const pay = { source: PAY, owner: OWNER, args: [RECIPIENT, "1"], rpcUrl: url };
    const refusal = refused(await mcp.call("sauce_tx", { ...pay, chain: "optimism" }), "optimism");
    assert.equal(refusal.action, "building the cook transaction");
    assert.deepEqual(methods, []);
  });

  it("each intent step, by the chain it is sent on", async () => {
    const toArbitrum = recordOf("base", "arbitrum");
    const fromArbitrum = recordOf("arbitrum", "base");
    const rpcUrls = { base: url, arbitrum: url };
    // The destination's: a fill, a proof, a cancellation.
    refused(
      await mcp.call("sauce_intent_fill", { intent: toArbitrum, from: OWNER, rpcUrls }),
      "arbitrum",
    );
    refused(await mcp.call("sauce_intent_prove", { intent: toArbitrum, rpcUrls }), "arbitrum");
    refused(await mcp.call("sauce_intent_cancel", { intent: toArbitrum, rpcUrls }), "arbitrum");
    // The source's: a claim and a refund — named by the source transaction, before it is read.
    refused(await mcp.call("sauce_intent_claim", { intent: fromArbitrum, rpcUrls }), "arbitrum");
    refused(await mcp.call("sauce_intent_refund", { intent: fromArbitrum, rpcUrls }), "arbitrum");
    refused(
      await mcp.call("sauce_intent_claim", { txHash: TX, chain: "arbitrum", rpcUrl: url }),
      "arbitrum",
    );
    refused(
      await mcp.call("sauce_intent_refund", { txHash: TX, chain: "arbitrum", rpcUrl: url }),
      "arbitrum",
    );
    assert.deepEqual(methods, []);
    // The other side of each is supported, so the same steps go ahead (and fail on the recorder).
    const claim = await mcp.call("sauce_intent_claim", { intent: toArbitrum, rpcUrls });
    assert.doesNotMatch(textOf(claim), /preview-chain/);
    assert.ok(methods.length > 0);
  });
});

describe("the rest of a tool's answer, with `refused` in place of its transaction", () => {
  it("sauce_pot predicts and reads a Pot on a preview chain, without its deployment", async () => {
    const predicted = ok(await mcp.call("sauce_pot", { chain: "arbitrum", owner: OWNER }));
    assert.match(predicted.pot as string, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(predicted.to, undefined);
    assert.equal(predicted.data, undefined);
    assert.equal((predicted.refused as Refusal).code, "preview-chain");
    // With an endpoint it reads the chain: the recorder has no Kitchen, which it says, unrefused.
    const read = await mcp.call("sauce_pot", {
      chain: "arbitrum",
      owner: OWNER,
      rpcUrl: url,
      balances: false,
    });
    assert.doesNotMatch(textOf(read), /preview-chain/);
    assert.ok(methods.includes("eth_getCode"));
  });

  it("sauce_actions reports the document, and refuses only its cook", async () => {
    const program = { version: 1, actions: [{ type: "wrapETH", weth: "WETH", amount: "1" }] };
    const out = ok(
      await mcp.call("sauce_actions", { program, chain: "optimism", owner: OWNER, rpcUrl: url }),
    );
    assert.match(out.bytecode as string, /^0x/);
    assert.equal(out.transaction, undefined);
    assert.equal((out.refused as Refusal).previewChains[0]!.slug, "optimism");
    assert.deepEqual(methods, []);
  });
});

describe("still runs on a preview chain", () => {
  it("lists each chain's support, and says so up front", async () => {
    const { chains, supported, requestChain } = ok(await mcp.call("sauce_chains")) as {
      chains: Array<{ slug: string; support: string }>;
      supported: string[];
      requestChain: string;
    };
    assert.deepEqual(supported, ["ethereum", "base", "solana"]);
    for (const chain of chains) {
      assert.equal(chain.support, supported.includes(chain.slug) ? "supported" : "preview");
    }
    assert.equal(
      requestChain,
      "https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml",
    );
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /builds transactions only on Ethereum, Base and Solana/);
    assert.match(instructions, /returns `refused` instead/);
    const { tools } = await mcp.client.listTools();
    for (const name of [
      "sauce_tx",
      "sauce_pot",
      "sauce_actions",
      "sauce_intent_fill",
      "sauce_intent_prove",
      "sauce_intent_claim",
      "sauce_intent_refund",
      "sauce_intent_cancel",
    ]) {
      const tool = tools.find((each) => each.name === name);
      assert.match(tool?.description ?? "", /only on Ethereum, Base and Solana/, name);
    }
  });

  it("compiles, and simulates through the call's endpoint", async () => {
    const compiled = ok(await mcp.call("sauce_compile", { source: PAY, chain: "optimism" }));
    assert.equal(compiled.chain, "optimism");
    const simulated = await mcp.call("sauce_simulate", {
      source: PAY,
      chain: "optimism",
      owner: OWNER,
      args: [RECIPIENT, "1"],
      rpcUrl: url,
    });
    assert.doesNotMatch(textOf(simulated), /preview-chain/);
    assert.ok(methods.length > 0, "the rehearsal reached the endpoint");
  });
});
