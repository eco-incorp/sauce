/**
 * No endpoint URL ever leaves the server. A provider URL carries its key in the path or the query,
 * so a server configured with one must never echo it: not in a result, not in an error, not in its
 * instructions. Every tool that reads a chain is called here against endpoints that refuse the
 * connection, which is where a URL would surface — in the failure.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
import { NO_ENDPOINTS } from "../src/config.js";
import { callReach } from "../src/reach.js";
import { errorText } from "../src/tools.js";
import { connect, endpointsFor, failed, ok, type Connected } from "./harness.js";

const SECRET = "pr0vider-key-9f8e7d6c5b4a";
// Port 9 (discard) on loopback: nothing listens, so every request fails at once and offline.
const EVM_URL = `http://127.0.0.1:9/v2/${SECRET}`;
const SVM_URL = `http://127.0.0.1:9/solana?api-key=${SECRET}`;
const SOLANA = requireChain("solana");
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SOLANA_OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const PAY = "function main(amount: Uint256) {\n  USDC.transfer(ctx.self(), amount);\n}\n";
const SVM =
  "function main(authority: Account<Signer>, amount: Uint256) {\n  require(amount > 0n);\n}\n";
const HASH = `0x${"ab".repeat(32)}`;

let mcp: Connected;
before(async () => {
  mcp = await connect(endpointsFor({ "8453": EVM_URL, [String(SOLANA.id)]: SVM_URL }));
});
after(async () => {
  await mcp.close();
});

describe("a server with endpoints", () => {
  it("says which chains it reads, never how", async () => {
    const { chains } = ok(await mcp.call("sauce_chains")) as {
      chains: Array<{ slug: string; endpoint: string }>;
    };
    assert.deepEqual(
      chains.filter((chain) => chain.endpoint === "config").map((chain) => chain.slug),
      ["base", "solana"].sort((a, b) => (a === "base" ? -1 : b === "base" ? 1 : 0)),
    );
    assert.match(mcp.client.getInstructions() ?? "", /own endpoints for chains 8453/);
  });

  it("fails every chain read without the URL in the failure", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["sauce_tx", { source: PAY, chain: "base", owner: OWNER, args: [1] }],
      ["sauce_pot", { chain: "base", owner: OWNER }],
      ["sauce_simulate", { source: PAY, chain: "base", owner: OWNER, args: [1] }],
      ["sauce_inspect", { hex: HASH, chain: "base" }],
      ["sauce_verify", { hex: HASH, chain: "base" }],
      [
        "sauce_intent_publish",
        {
          source: `Arbitrum.hop({ send: [{ token: USDC, amount: 7 }], refundee: ${OWNER} }).then(() => {\n  USDC.transfer(R, 5);\n});\n`,
          chain: "base",
          defines: { R: OWNER },
          intentDeadline: 2000000000,
          intentExecutionFee: 0,
          dryRun: true,
          owner: OWNER,
        },
      ],
      [
        "sauce_tx",
        {
          source: SVM,
          chain: "solana",
          owner: SOLANA_OWNER,
          accounts: { authority: "owner" },
          args: [1],
        },
      ],
      ["sauce_pot", { chain: "solana", owner: SOLANA_OWNER }],
      [
        "sauce_simulate",
        {
          source: SVM,
          chain: "solana",
          owner: SOLANA_OWNER,
          accounts: { authority: "owner" },
          args: [1],
        },
      ],
      ["sauce_verify", { chain: "solana", signature: "5".repeat(88), minOut: 0, splCount: 1 }],
    ];
    for (const [name, args] of calls) {
      const message = failed(await mcp.call(name, args));
      assert.ok(message.length > 0, `${name} says why`);
    }
    const everything = mcp.received.join("\n");
    assert.ok(!everything.includes(SECRET), "no key in any output");
    assert.ok(!everything.includes("127.0.0.1:9"), "no endpoint host in any output");
  });

  it("refuses a config with a placeholder or a chain id written another way, at start", () => {
    assert.throws(
      () => endpointsFor({ "8453": "<RPC_URL for Base>" }),
      /rpcUrls\["8453"\] is a placeholder/,
    );
    assert.throws(
      () => endpointsFor({ "08453": EVM_URL }),
      /rpcUrls key '08453' is not a chain id/,
    );
    assert.throws(() => endpointsFor({ "8453": "file:///etc/passwd" }), /is not an http\(s\) URL/);
  });

  it("scrubs a URL from any message that would carry one", () => {
    const text = errorText(new Error(`request to ${EVM_URL} failed; also ${SVM_URL}`));
    assert.ok(!text.includes(SECRET));
    assert.match(text, /\[redacted\]/);
  });
});

describe("a caller's own rpcUrl", () => {
  const KEY = "callers-own-key-0f1e2d3c4b5a69788796";
  let echo: Server;
  let url: string;
  let caller: Connected;
  before(async () => {
    // An endpoint that answers every request with an error quoting the URL it was reached at, as
    // some providers do: the one place an upstream message carries the key back.
    echo = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { id?: unknown } | Array<{ id?: unknown }>;
        const id = (Array.isArray(parsed) ? parsed[0]?.id : parsed.id) ?? 1;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: `invalid key at ${req.url}` },
          }),
        );
      });
    });
    echo.listen(0, "127.0.0.1");
    await once(echo, "listening");
    url = `http://127.0.0.1:${(echo.address() as { port: number }).port}/v2/${KEY}`;
    // The server's own endpoint for base is unreachable: the call's rpcUrl must win.
    caller = await connect(endpointsFor({ "8453": EVM_URL }));
  });
  after(async () => {
    await caller.close();
    echo.close();
  });

  it("is used for the call over the server's own, and never comes back, even quoted upstream", async () => {
    // The endpoint answered — so the call reached it, not the server's dead one: the server's
    // endpoint refuses connections, and this one returns an error.
    assert.match(
      failed(await caller.call("sauce_pot", { chain: "base", owner: OWNER, rpcUrl: url })),
      /reading the chain id failed: Missing or invalid parameters/,
    );
    failed(await caller.call("sauce_pot", { chain: "solana", owner: SOLANA_OWNER, rpcUrl: url }));
    for (const name of ["sauce_tx", "sauce_simulate"]) {
      failed(
        await caller.call(name, {
          source: PAY,
          chain: "base",
          owner: OWNER,
          args: [1],
          rpcUrl: url,
        }),
      );
    }
    const everything = caller.received.join("\n");
    assert.ok(!everything.includes(KEY), "the caller's key in no output");
    assert.ok(!everything.includes(url));
  });

  it("is taken out of any message that quotes it, whole, normalized, or as its key alone", async () => {
    const reach = callReach(NO_ENDPOINTS, undefined);
    const given = `https://Base-Mainnet.example.org/v2/${KEY}?tag=latest`;
    await reach.endpoint(requireChain("base"), given);
    const upstream = [
      `request to ${given} failed`,
      `POST ${new URL(given).href} 401`,
      `host base-mainnet.example.org refused key ${KEY}`,
      `encoded ${encodeURIComponent(KEY)}`,
    ].join("; ");
    const scrubbed = reach.scrub(upstream);
    assert.ok(!scrubbed.toLowerCase().includes(KEY.toLowerCase()), scrubbed);
    assert.ok(!scrubbed.toLowerCase().includes("base-mainnet.example.org"), scrubbed);
    // What is not the URL stays: a message still says what failed.
    assert.match(scrubbed, /^request to \[redacted\] failed; POST \[redacted\] 401/);
    assert.match(reach.scrub("on solana and base-mainnet"), /on solana and base-mainnet/);
  });

  it("is refused when it is not an http(s) URL, naming nothing of it", async () => {
    const message = failed(
      await caller.call("sauce_pot", { chain: "base", owner: OWNER, rpcUrl: `file:///etc/${KEY}` }),
    );
    assert.match(message, /rpcUrl must be an http\(s\) URL/);
    assert.ok(!message.includes(KEY));
  });
});
