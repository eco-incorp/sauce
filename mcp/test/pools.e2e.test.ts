/**
 * `sauce_pools` and `sauce_price` against a local Base (`sdk/test/pools-anvil.ts`, the harness the
 * `sauce pools` suite runs): real Uniswap V3 pools at the registry's factories, one behind a
 * Slipstream lookup, and V4 pools in a StateView, reached only through each call's `rpcUrl`, which
 * never comes back. The tool returns what the command prints with `--json`.
 *
 * Needs `anvil` on PATH: skipped without it locally, and a failure in CI, where Foundry is set up.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";

import { connect as viemConnect } from "../../sdk/dist/cli/chain.js";
import { poolsCommand } from "../../sdk/dist/cli/pools.js";
import { requireChain } from "../../sdk/dist/chains/canonical.js";
import {
  freePort,
  SPCX,
  startPoolsChain,
  USDC,
  type PoolsChain,
} from "../../sdk/test/pools-anvil.js";
import { connect, failed, ok, type Connected } from "./harness.js";

const ANVIL = spawnSync("anvil", ["--version"]).status === 0;
if (!ANVIL && process.env.CI) throw new Error("anvil is not on PATH in CI — this suite must run.");

describe("sauce_pools and sauce_price against a chain", { skip: !ANVIL }, () => {
  let chain: PoolsChain;
  let mcp: Connected;

  before(async () => {
    chain = await startPoolsChain(await freePort());
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    await chain?.stop();
    // Every byte the server sent: never the endpoint.
    assert.ok(!mcp.received.join("\n").includes(chain.rpcUrl.replace("http://", "")));
  });

  it("lists the pair's pools, deepest first, as the command does", async () => {
    const args = { chain: "base", tokenA: "USDC", tokenB: SPCX, v4Pools: ["50:1"] };
    const out = ok(await mcp.call("sauce_pools", { ...args, rpcUrl: chain.rpcUrl })) as {
      tokens: Array<Record<string, unknown>>;
      pools: Array<{ contract: string; liquidity: string; sides: Array<Record<string, unknown>> }>;
      empty: Array<{ why: string }>;
    };
    assert.deepEqual(out.tokens[1], {
      symbol: "SPCXc",
      address: SPCX,
      decimals: 8,
      readFromChain: true,
      position: "token1",
    });
    assert.equal(out.tokens[0]!.address, USDC);
    assert.equal(out.pools.length, 7);
    assert.equal(out.pools[0]!.contract, "AerodromeSlipstream.CLFactoryGaugesV3");
    assert.deepEqual(
      out.empty.map((pool) => pool.why),
      ["not initialized: it has no price", "no liquidity at its price"],
    );
    // The command's own output, field for field.
    const base = requireChain("base");
    const command = await poolsCommand({
      chain: base,
      client: await viemConnect(chain.rpcUrl, base),
      tokens: ["USDC", SPCX],
      v4Keys: [{ fee: 50, tickSpacing: 1 }],
    });
    assert.deepEqual(out, JSON.parse(JSON.stringify(command.json)));
  });

  it("reads an unregistered token's decimals for sauce_price, with the call's endpoint", async () => {
    const out = ok(
      await mcp.call("sauce_price", {
        chain: "base",
        base: SPCX,
        quote: "USDC",
        price: "400",
        rpcUrl: chain.rpcUrl,
      }),
    );
    assert.deepEqual(out.base, {
      symbol: "SPCXc",
      address: SPCX,
      decimals: 8,
      readFromChain: true,
    });
    assert.equal(out.sqrtPriceX96, (1n << 95n).toString());
    // Without the endpoint, the same address is refused, naming what would read it.
    assert.match(
      failed(
        await mcp.call("sauce_price", { chain: "base", base: SPCX, quote: "USDC", price: "400" }),
      ),
      /or an endpoint \(rpcUrl or --config\)/,
    );
  });
});
