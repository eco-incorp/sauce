/**
 * sauce_pot on Solana against a JSON-RPC endpoint that answers only what the tool asks: the Pot
 * and the Pot's associated token account for each mint the cluster registers. The endpoint holds
 * exactly the accounts a test puts there, so each answer the tool gives is one the test chose.
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { connect, ok, type Connected } from "./harness.js";

const OWNER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

interface TokenAccount {
  symbol: string;
  mint: string;
  decimals: number;
  account: string;
  exists: boolean;
  balance: string | null;
}

describe("sauce_pot on Solana", () => {
  let server: Server;
  let url: string;
  let mcp: Connected;
  /** The accounts the endpoint holds, with each token account's balance. */
  const present = new Map<string, string | null>();
  const asked: string[] = [];

  before(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const call = JSON.parse(body) as { id: number; method: string; params: [string] };
        const account = call.params[0];
        asked.push(`${call.method} ${account}`);
        const context = { slot: 1 };
        const result =
          call.method === "getAccountInfo"
            ? {
                context,
                value: present.has(account)
                  ? {
                      data: ["", "base64"],
                      executable: false,
                      lamports: 2_039_280,
                      owner: "11111111111111111111111111111111",
                      rentEpoch: 0,
                      space: 0,
                    }
                  : null,
              }
            : {
                context,
                value: {
                  amount: present.get(account) ?? "0",
                  decimals: 6,
                  uiAmount: null,
                  uiAmountString: "0",
                },
              };
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    url = `http://127.0.0.1:${port}/`;
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reads whether the Pot exists, and each registered mint's token account", async () => {
    const empty = ok(await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url }));
    assert.equal(empty.deployed, false);
    const accounts = empty.tokenAccounts as TokenAccount[];
    const usdc = accounts.find((each) => each.symbol === "USDC");
    assert.ok(usdc !== undefined, "USDC is registered on Solana");
    assert.ok(accounts.every((each) => !each.exists && each.balance === null));

    // The Pot, and its USDC account holding 2.5 USDC.
    present.set(empty.pot as string, null);
    present.set(usdc.account, "2500000");
    const held = ok(await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url }));
    assert.equal(held.deployed, true);
    assert.ok((held.notes as string[]).some((note) => /deployed already/.test(note)));
    for (const each of held.tokenAccounts as TokenAccount[]) {
      assert.deepEqual(
        [each.exists, each.balance],
        each.symbol === "USDC" ? [true, "2500000"] : [false, null],
        each.symbol,
      );
    }

    // balances: false reads only whether the Pot exists.
    asked.length = 0;
    const bare = ok(
      await mcp.call("sauce_pot", { chain: "solana", owner: OWNER, rpcUrl: url, balances: false }),
    );
    assert.equal(bare.deployed, true);
    assert.equal(bare.tokenAccounts, undefined);
    assert.deepEqual(asked, [`getAccountInfo ${String(empty.pot)}`]);
  });
});
