/**
 * A server with no endpoint of its own reads a chain through the built-in public endpoints the
 * `sauce` command hands it, when a call gives no `rpcUrl` — and says so in the result. Nothing is
 * reached: the public endpoint is a fake `fetch` answering JSON-RPC, behind the real loopback
 * forwarder, as `sauce mcp` starts it.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { NO_ENDPOINTS } from "../src/config.js";
import { publicEndpoints, type PublicEndpoints } from "../src/sdk.js";
import { connect, failed, ok, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const RECIPIENT = "0x6666666666666666666666666666666666666666";
const PUBLIC = "https://public.example";
const PAY = [
  "function main(recipient: Address, amount: Uint256) {",
  "  USDC.transfer(recipient, amount);",
  "}",
  "",
].join("\n");
const NOTE = /base was read through a built-in public endpoint, which can be slow or rate-limited/;

/** Base, as a node would answer: no code at the Pot, a Kitchen fee of zero, a rehearsal that
 *  succeeds with no logs. */
function answer(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x2105";
    case "eth_blockNumber":
      return "0x1000";
    case "eth_getCode":
      return "0x";
    case "eth_getBalance":
      return "0x0";
    case "eth_call":
      return `0x${"0".repeat(64)}`;
    case "eth_simulateV1": {
      const [{ blockStateCalls }] = params as [{ blockStateCalls: Array<{ calls: unknown[] }> }];

      return blockStateCalls.map((block, index) => ({
        number: `0x${(0x1001 + index).toString(16)}`,
        hash: `0x${"00".repeat(32)}`,
        timestamp: "0x1",
        gasLimit: "0x1c9c380",
        gasUsed: "0x5208",
        baseFeePerGas: "0x1",
        calls: block.calls.map(() => ({
          status: "0x1",
          returnData: "0x",
          gasUsed: "0x5208",
          logs: [],
        })),
      }));
    }
    default:
      throw new Error(`the fake endpoint does not answer ${method}`);
  }
}

describe("a server with no endpoint of its own", () => {
  const asked: Array<{ readonly url: string; readonly method: string }> = [];
  let endpoints: PublicEndpoints;
  let mcp: Connected;

  before(async () => {
    const send = (async (input: string | URL | Request, init?: RequestInit) => {
      const { id, method, params } = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params: unknown[];
      };
      asked.push({ url: String(input), method });

      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: answer(method, params) }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    endpoints = publicEndpoints({
      rpcs: { 8453: [{ url: PUBLIC, simulateV1: true }] },
      fetch: send,
    });
    await endpoints.ready();
    mcp = await connect({ ...NO_ENDPOINTS, public: endpoints });
  });
  after(async () => {
    await mcp.close();
    await endpoints.close();
  });

  it("says rpcUrl is optional, and which chains it reads through public endpoints", async () => {
    assert.match(mcp.client.getInstructions() ?? "", /built-in public endpoint/);
    const { chains } = ok(await mcp.call("sauce_chains")) as {
      chains: Array<{ slug: string; endpoint: string }>;
    };
    assert.equal(chains.find((chain) => chain.slug === "base")?.endpoint, "public");
    assert.equal(chains.find((chain) => chain.slug === "ethereum")?.endpoint, "none");
  });

  it("simulates with no rpcUrl, through the chain's public endpoint, and says so", async () => {
    asked.length = 0;
    const simulated = ok(
      await mcp.call("sauce_simulate", {
        source: PAY,
        chain: "base",
        owner: OWNER,
        args: [RECIPIENT, "1000000"],
      }),
    );
    assert.equal(simulated.ok, true);
    assert.equal(simulated.path, "eth_simulateV1");
    assert.ok((simulated.notes as string[]).some((note) => NOTE.test(note)));
    assert.ok(asked.length > 0 && asked.every((each) => each.url === PUBLIC));
    assert.ok(asked.some((each) => each.method === "eth_simulateV1"));
  });

  it("uses the call's rpcUrl over the public endpoint", async () => {
    asked.length = 0;
    // An endpoint nothing listens on: the call fails reaching it, and never reaches the public one.
    const message = failed(
      await mcp.call("sauce_pot", { chain: "base", owner: OWNER, rpcUrl: "http://127.0.0.1:9/" }),
    );
    assert.doesNotMatch(message, NOTE);
    assert.deepEqual(asked, []);
  });

  it("refuses, as before, a chain with no public endpoint", async () => {
    const message = failed(
      await mcp.call("sauce_simulate", {
        source: PAY,
        chain: "ethereum",
        owner: OWNER,
        args: [RECIPIENT, "1000000"],
      }),
    );
    assert.match(message, /needs an RPC endpoint for ethereum .* nor a built-in public one/);
    assert.match(message, /Pass rpcUrl with the call/);
  });
});
