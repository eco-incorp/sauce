/**
 * `sauce pools` against a local Base (`pools-anvil.ts`): real Uniswap V3 pools at the registry's
 * Uniswap V3 and PancakeSwap V3 factory addresses, one behind a Slipstream CLFactory's lookup, and
 * V4 pools in a StateView. It must find every pool of the pair, list the empty ones apart, read an
 * unregistered token's decimals from the token, price each pool both ways round as the SDK's own
 * conversion does, and report a depth the pool really takes: a swap to 1% past the price costs
 * what it says. And `sauce price` reads an address's decimals the same way.
 *
 * Needs `anvil` on PATH: skipped without it locally, and a failure in CI, where Foundry is set up.
 */
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";

import type { Address } from "viem";

import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { priceFromSqrtPriceX96 } from "../src/price.js";
import {
  freePort,
  LIQUIDITY,
  SPCX,
  sqrtAt,
  startPoolsChain,
  USDC,
  v4Id,
  VENUES,
  type PoolsChain,
} from "./pools-anvil.js";

const ANVIL = spawnSync("anvil", ["--version"]).status === 0;
const describeAnvil = ANVIL ? describe : describe.skip;
// A skipped suite and a passing one are the same line in jest's summary: in CI, where Foundry is
// installed, an absent anvil is a failure rather than a silent no-op.
if (!ANVIL && process.env.CI) throw new Error("anvil is not on PATH in CI — this suite must run.");

async function sauce(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    ...nodeIo(),
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
  };

  return { code: await runCli(argv, io), stdout, stderr };
}

interface Side {
  pay: string;
  buy: string;
  feePpm: number;
  mid: string;
  taker: string;
  maxPrice: string;
  depth1Pct: string | null;
}
interface Listed {
  venue: string;
  contract: string;
  contractAddress: string;
  pool?: string;
  poolId?: string;
  key?: Record<string, unknown>;
  fee: number;
  protocolFee?: number;
  tickSpacing: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick: number;
  sides: [Side, Side];
}
interface Report {
  tokens: Array<Record<string, unknown>>;
  sortedBy: string;
  pools: Listed[];
  empty: Array<Listed & { why: string }>;
  checked: Array<Record<string, unknown>>;
}

/** USDC per SPCXc at `sqrtPriceX96`, as the SDK's conversion reads it, to 18 places. */
const usdcPerSpcx = (sqrtPriceX96: bigint) =>
  priceFromSqrtPriceX96(sqrtPriceX96, { baseDecimals: 8, quoteDecimals: 6, baseIsToken0: false });

describeAnvil("sauce pools, against a local Base", () => {
  let chain: PoolsChain;
  let report: Report;

  beforeAll(async () => {
    chain = await startPoolsChain(await freePort());
    const run = await sauce(
      ...["pools", "--chain", "base", "USDC", SPCX, "--v4-key", "50:1"],
      ...["--rpc-url", chain.rpcUrl, "--json"],
    );
    if (run.code !== 0) throw new Error(`sauce pools exited ${run.code}: ${run.stderr}`);
    report = JSON.parse(run.stdout) as Report;
  }, 180_000);

  afterAll(async () => {
    await chain?.stop();
  });

  const poolOf = (name: string) => chain.pools.get(name)!.address;

  it("reads the unregistered token's decimals and symbol from the token", () => {
    expect(report.tokens).toEqual([
      { symbol: "USDC", address: USDC, decimals: 6, position: "token0" },
      { symbol: "SPCXc", address: SPCX, decimals: 8, readFromChain: true, position: "token1" },
    ]);
  });

  it("finds every pool with liquidity, at every venue, deepest first", () => {
    expect(report.sortedBy).toBe("liquidity");
    expect(report.pools.map((pool) => [pool.contract, pool.pool ?? pool.key])).toEqual([
      ["AerodromeSlipstream.CLFactoryGaugesV3", poolOf("slipstream:10")],
      ["UniswapV3.Factory", poolOf("v3:3000")],
      ["UniswapV3.Factory", poolOf("v3:500")],
      [
        "UniswapV4.StateView",
        {
          currency0: USDC,
          currency1: SPCX,
          fee: 500,
          tickSpacing: 10,
          hooks: "0x0000000000000000000000000000000000000000",
        },
      ],
      ["PancakeswapV3.Factory", poolOf("pancake:2500")],
      ["UniswapV3.Factory", poolOf("v3:200")],
      [
        "UniswapV4.StateView",
        {
          currency0: USDC,
          currency1: SPCX,
          fee: 50,
          tickSpacing: 1,
          hooks: "0x0000000000000000000000000000000000000000",
        },
      ],
    ]);
    const liquidity = report.pools.map((pool) => BigInt(pool.liquidity));
    expect(liquidity).toEqual([...liquidity].sort((x, y) => (x > y ? -1 : x < y ? 1 : 0)));
    // Each pool's own fee and spacing, read from it: the Slipstream pool's from the pool.
    expect(report.pools.map((pool) => [pool.fee, pool.tickSpacing])).toEqual([
      [500, 10],
      [3000, 60],
      [500, 10],
      [500, 10],
      [2500, 50],
      [200, 4],
      [50, 1],
    ]);
    expect(report.pools[3]!.poolId).toBe(v4Id(500, 10));
    expect(report.pools[3]!.contractAddress).toBe(VENUES.stateView);
  });

  it("lists the empty pools apart, and skips them", () => {
    expect(report.empty.map((pool) => [pool.pool, pool.why])).toEqual([
      [poolOf("v3:100"), "not initialized: it has no price"],
      [poolOf("v3:10000"), "no liquidity at its price"],
    ]);
  });

  it("prices each pool both ways round, decimals-aware, before and with its fee", () => {
    for (const pool of report.pools) {
      const sqrt = BigInt(pool.sqrtPriceX96);
      const [buySpcx, buyUsdc] = pool.sides;
      expect([buySpcx.pay, buySpcx.buy, buyUsdc.pay, buyUsdc.buy]).toEqual([
        "USDC",
        "SPCXc",
        "SPCXc",
        "USDC",
      ]);
      // USDC per SPCXc is the SDK's own conversion of the pool's price.
      expect(Number(buySpcx.mid)).toBeCloseTo(Number(usdcPerSpcx(sqrt)), 12);
      expect(Number(buyUsdc.mid) * Number(buySpcx.mid)).toBeCloseTo(1, 12);
      for (const side of pool.sides) {
        expect(Number(side.taker) / Number(side.mid)).toBeCloseTo(1e6 / (1e6 - side.feePpm), 12);
        // maxPrice: the taker price x 10^(18 + pay decimals - buy decimals).
        const scale = side.pay === "USDC" ? 16 : 20;
        expect(Number(side.maxPrice) / (Number(side.taker) * 10 ** scale)).toBeCloseTo(1, 12);
      }
    }
    // 0.05% Uniswap V3 at 400 USDC per SPCXc: 400 / 0.9995 with the fee (to 18 significant
    // digits), and maxPrice that x 10^(18 + 6 - 8), rounded up.
    const v3 = report.pools.find((pool) => pool.pool === poolOf("v3:500"))!;
    expect(v3.sqrtPriceX96).toBe(sqrtAt("400").toString());
    expect(v3.sides[0].mid).toBe("400");
    expect(v3.sides[0].taker).toBe("400.200100050025013");
    expect(v3.sides[0].maxPrice).toBe("4002001000500250126");
    // The V4 pool's protocol fee on top of its LP fee, each way: 0.03% paying token0, 0.01% token1.
    const v4 = report.pools[3]!;
    expect(v4.protocolFee).toBe(300 | (100 << 12));
    expect(v4.sides.map((side) => side.feePpm)).toEqual([800, 600]);
  });

  it("reports a depth the pool really takes: a swap to 1% past its price costs it", async () => {
    for (const name of ["v3:500", "v3:3000", "slipstream:10"]) {
      const pool = poolOf(name);
      const listed = report.pools.find((each) => each.pool === pool)!;
      const sqrt = BigInt(listed.sqrtPriceX96);
      // Paying USDC (token0) lowers the price 1%; paying SPCXc (token1) lifts it 1%.
      for (const [side, zeroForOne, target, decimals] of [
        [listed.sides[0], true, sqrtFloor((sqrt * sqrt * 100n) / 101n), 6],
        [listed.sides[1], false, sqrtFloor((sqrt * sqrt * 101n) / 100n), 8],
      ] as const) {
        const { result } = await chain.publicClient.simulateContract({
          address: chain.liquidity,
          abi: LIQUIDITY.abi,
          functionName: "swap",
          args: [pool, zeroForOne, 10n ** 30n, target],
          account: chain.deployer,
        });
        const [amount0, amount1] = result as readonly [bigint, bigint];
        const paid = zeroForOne ? amount0 : amount1;
        const [whole, fraction = ""] = side.depth1Pct!.split(".");
        const reported = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
        // Each tick crossed rounds its step up by a unit, as the pool does.
        expect(reported - paid).toBeLessThanOrEqual(4n);
        expect(paid - reported).toBeLessThanOrEqual(4n);
      }
    }
    // The 0.3% pool's narrow position ends within 1% each way: its depth is less than its
    // liquidity at the price would give over the whole move.
    const crossed = report.pools.find((each) => each.pool === poolOf("v3:3000"))!;
    const flat = report.pools.find((each) => each.pool === poolOf("v3:500"))!;
    expect(Number(crossed.sides[1].depth1Pct)).toBeLessThan(
      (Number(flat.sides[1].depth1Pct) * Number(crossed.liquidity)) / Number(flat.liquidity),
    );
  });

  it("says what it looked at: the tiers, spacings and keys, and a factory it could not read", () => {
    const at = Object.fromEntries(report.checked.map((each) => [each.contract, each]));
    expect(at["UniswapV3.Factory"]).toMatchObject({ fees: ["100", "200", "500", "3000", "10000"] });
    expect(at["PancakeswapV3.Factory"]).toMatchObject({ fees: ["500", "2500", "3000", "10000"] });
    expect(at["AerodromeSlipstream.CLFactoryGaugesV3"]).toMatchObject({
      tickSpacings: ["1", "10", "50"],
    });
    expect(at["UniswapV4.StateView"]).toMatchObject({
      keys: ["100:1", "500:10", "3000:60", "10000:200", "50:1"],
    });
    // Nothing stands at the other two Slipstream factories here.
    expect(at["AerodromeSlipstream.CLFactory"]?.error).toEqual(expect.any(String));
  });

  it("reads the chain in a few requests, each one eth_call carrying many reads", async () => {
    const methods: string[] = [];
    const proxy = createServer((incoming, outgoing) => {
      let body = "";
      incoming.on("data", (chunk: Buffer) => (body += chunk.toString()));
      incoming.on("end", () => {
        const parsed = JSON.parse(body) as { method: string } | Array<{ method: string }>;
        for (const each of Array.isArray(parsed) ? parsed : [parsed]) methods.push(each.method);
        const forward = httpRequest(
          chain.rpcUrl,
          { method: "POST", headers: { "content-type": "application/json" } },
          (answer) => {
            outgoing.writeHead(answer.statusCode ?? 200, { "content-type": "application/json" });
            answer.pipe(outgoing);
          },
        );
        forward.end(body);
      });
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    try {
      const url = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
      const run = await sauce("pools", "--chain", "base", "USDC", SPCX, "--rpc-url", url);
      expect(run.code).toBe(0);
      // The chain id, then five rounds (the tokens beside the first), each a few calls of up to
      // 32 reads: nearly 150 reads here.
      expect(methods[0]).toBe("eth_chainId");
      expect(methods.slice(1).every((method) => method === "eth_call")).toBe(true);
      expect(methods.length).toBeLessThanOrEqual(12);
    } finally {
      proxy.close();
    }
  });

  it("prints the same for a person", async () => {
    const run = await sauce("pools", "--chain", "base", "USDC", SPCX, "--rpc-url", chain.rpcUrl);
    expect(run.code).toBe(0);
    expect(run.stdout.split("\n")[0]).toBe(
      "USDC/SPCXc on base: 6 pools with liquidity, deepest first (by liquidity at the pool's price)",
    );
    expect(run.stdout).toContain(`1. Aerodrome Slipstream ${poolOf("slipstream:10")}`);
    expect(run.stdout).toMatch(/buy SPCXc with USDC {2}400\.2 USDC each, 400 before the fee; /);
    expect(run.stdout).toContain("maxPrice 4002001000500250126");
    expect(run.stdout).toContain("No liquidity at their price, skipped (2):");
    expect(run.stdout).toContain("UniswapV3.Factory");
    // The other Slipstream factories have no code here, and it says so.
    expect(run.stdout).toMatch(/AerodromeSlipstream\.CLFactory 0x\w+: could not be read/);
  });

  it("sauce price reads an unregistered token's decimals from the token too", async () => {
    const run = await sauce(
      ...["price", "--chain", "base", SPCX, "USDC", "400"],
      ...["--rpc-url", chain.rpcUrl, "--json"],
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(out.base).toEqual({ symbol: "SPCXc", address: SPCX, decimals: 8, readFromChain: true });
    // 400 USDC per SPCXc: a quarter of an SPCXc unit per USDC unit, a sqrt of exactly 2^95.
    expect(out.sqrtPriceX96).toBe((1n << 95n).toString());
    // An address that is no token is named.
    const none = await sauce(
      ...["price", "--chain", "base", POOL_ADDRESS(chain), "USDC", "1", "--rpc-url", chain.rpcUrl],
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/answers no decimals\(\) on base .*: is it a token there\?/);
  });
});

/** An address with code that is no token: a pool. */
const POOL_ADDRESS = (chain: PoolsChain): Address => chain.pools.get("v3:500")!.address;

function sqrtFloor(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }

  return x;
}
