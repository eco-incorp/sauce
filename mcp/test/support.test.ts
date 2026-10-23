/**
 * The release's chain gate through the tools (`sdk/src/cli/support.ts`, the command's own): every
 * tool that returns a transaction refuses a preview chain BEFORE it reaches the call's endpoint —
 * one that records each request it gets stays untouched — with a structured `refused` the calling
 * agent can act on; compile, simulate and the reads still run there.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { after, afterEach, before, describe, it } from "node:test";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { privateKeyToAccount } from "viem/accounts";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { chainSupportRequest } from "../../sdk/dist/cli/support.js";
import { connect, ok, textOf, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";

const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");

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
    ["ethereum", "base", "arc", "solana"],
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

  it("sauce_signed_cook, for the program's chain and for a cancellation", async () => {
    const pay = { source: PAY, owner: OWNER, args: [RECIPIENT, "1"], rpcUrl: url };
    const signing = refused(
      await mcp.call("sauce_signed_cook", { ...pay, chain: "optimism" }),
      "optimism",
    );
    assert.equal(signing.action, "signing a cook");
    const cancelling = refused(
      await mcp.call("sauce_signed_cook", {
        chain: "arbitrum",
        owner: OWNER,
        cancel: ["1"],
        rpcUrl: url,
      }),
      "arbitrum",
    );
    assert.equal(cancelling.action, "cancelling signed cooks");
    assert.deepEqual(methods, []);
  });
});

describe("sauce_send, refused by the chain its transactions are signed for", () => {
  it("refuses a transaction signed for a preview chain before reaching an endpoint", async () => {
    // A throwaway key: the signer is the caller's, and the tool never sees one.
    const signer = privateKeyToAccount(`0x${"42".repeat(32)}`);
    const signed = await signer.signTransaction({
      chainId: 42161,
      type: "eip1559",
      to: RECIPIENT,
      value: 0n,
      nonce: 0,
      gas: 21_000n,
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });
    const refusal = refused(
      await mcp.call("sauce_send", { transactions: [signed], rpcUrl: url }),
      "arbitrum",
    );
    assert.equal(refusal.action, "sending");
    assert.deepEqual(methods, []);
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
    assert.deepEqual(supported, ["ethereum", "base", "arc", "solana"]);
    for (const chain of chains) {
      assert.equal(chain.support, supported.includes(chain.slug) ? "supported" : "preview");
    }
    assert.equal(
      requestChain,
      "https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml",
    );
    const instructions = mcp.client.getInstructions() ?? "";
    assert.match(instructions, /builds transactions only on Ethereum, Base, Arc and Solana/);
    assert.match(instructions, /returns `refused` instead/);
    const { tools } = await mcp.client.listTools();
    for (const name of ["sauce_tx", "sauce_pot", "sauce_actions"]) {
      const tool = tools.find((each) => each.name === name);
      assert.match(tool?.description ?? "", /only on Ethereum, Base, Arc and Solana/, name);
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
    assert.ok(methods.length > 0, "the simulation reached the endpoint");
  });
});
