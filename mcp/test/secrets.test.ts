/**
 * No endpoint URL ever leaves the server. A provider URL carries its key in the path or the query,
 * so a server configured with one must never echo it: not in a result, not in an error, not in its
 * instructions. Every tool that reads a chain is called here against endpoints that refuse the
 * connection, which is where a URL would surface — in the failure.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { requireChain } from "../../sdk/dist/chains/canonical.js";
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
      chains: Array<{ slug: string; endpoint: boolean }>;
    };
    assert.deepEqual(
      chains.filter((chain) => chain.endpoint).map((chain) => chain.slug),
      ["base", "solana"].sort((a, b) => (a === "base" ? -1 : b === "base" ? 1 : 0)),
    );
    assert.match(mcp.client.getInstructions() ?? "", /reads chains 8453/);
  });

  it("fails every chain read without the URL in the failure", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ["sauce_tx", { source: PAY, chain: "base", owner: OWNER, args: [1] }],
      ["sauce_pot", { chain: "base", owner: OWNER }],
      ["sauce_simulate", { source: PAY, chain: "base", owner: OWNER, args: [1] }],
      ["sauce_inspect", { hex: HASH, chain: "base" }],
      ["sauce_verify", { hex: HASH, chain: "base" }],
      [
        "sauce_publish",
        {
          source:
            "Arbitrum(() => {\n  USDC.transfer(R, 5n);\n}).reward({ tokens: [{ token: USDC, amount: 7n }] });\n",
          chain: "base",
          defines: { R: OWNER },
          intentDeadline: 2000000000,
          intentCreator: OWNER,
          dryRun: true,
          from: OWNER,
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

  it("scrubs a URL from any message that would carry one", () => {
    const text = errorText(new Error(`request to ${EVM_URL} failed; also ${SVM_URL}`));
    assert.ok(!text.includes(SECRET));
    assert.match(text, /\[redacted\]/);
  });
});
