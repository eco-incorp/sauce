/**
 * `sauce pools` against a local Base (`pools-anvil.ts`): real Uniswap V3 pools at the registry's
 * Uniswap V3 and PancakeSwap V3 factory addresses, one behind a Slipstream CLFactory's lookup, and
 * V4 pools in a StateView. It must take a tokenized stock by its symbol, find every pool of the
 * pair, list the empty ones apart, price each pool both ways round as the SDK's own conversion
 * does, and report a depth the pool really takes: a swap to 1% past the price costs what it says.
 * An address the registry does not know has its decimals and symbol read from the token, for
 * `sauce pools` and `sauce price` alike.
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
  ACME,
  IMPOSTOR,
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
  block: string;
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
    chain = await startPoolsChain();
    const run = await sauce(
      ...["pools", "--chain", "base", "USDC", "SPCXc", "--v4-key", "50:1"],
      ...["--rpc-url", chain.rpcUrl, "--json"],
    );
    if (run.code !== 0) throw new Error(`sauce pools exited ${run.code}: ${run.stderr}`);
    report = JSON.parse(run.stdout) as Report;
  }, 180_000);

  afterAll(async () => {
    await chain?.stop();
  });

  const poolOf = (name: string) => chain.pools.get(name)!.address;

  it("takes a tokenized stock by its symbol, as the registry records it", () => {
    expect(report.tokens).toEqual([
      { symbol: "USDC", address: USDC, decimals: 6, position: "token0" },
      { symbol: "SPCXc", address: SPCX, decimals: 8, position: "token1" },
    ]);
  });

  it("reads an unregistered token's decimals and symbol from the token, and finds no pools", async () => {
    const run = await sauce(
      ...["pools", "--chain", "base", "USDC", ACME, "--rpc-url", chain.rpcUrl, "--json"],
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as Report;
    expect(out.tokens[1]).toEqual({
      symbol: "ACME",
      address: ACME,
      decimals: 8,
      readFromChain: true,
      position: "token1",
    });
    expect([out.pools, out.empty]).toEqual([[], []]);
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
      const run = await sauce("pools", "--chain", "base", "USDC", "SPCXc", "--rpc-url", url);
      expect(run.code).toBe(0);
      // The chain id and the block every read is at, then five rounds (the tokens beside the
      // first), each a few calls of up to 32 reads: nearly 150 reads here.
      expect(methods.slice(0, 2)).toEqual(["eth_chainId", "eth_blockNumber"]);
      expect(methods.slice(2).every((method) => method === "eth_call")).toBe(true);
      expect(methods.length).toBeLessThanOrEqual(12);
    } finally {
      proxy.close();
    }
  });

  it("prints the same for a person", async () => {
    const run = await sauce("pools", "--chain", "base", "usdc", "spcxc", "--rpc-url", chain.rpcUrl);
    expect(run.code).toBe(0);
    expect(run.stdout.split("\n")[0]).toMatch(
      /^USDC\/SPCXc on base at block \d+: 6 pools with liquidity, deepest first \(by liquidity at the pool's price\)$/,
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
      ...["price", "--chain", "base", ACME, "USDC", "400"],
      ...["--rpc-url", chain.rpcUrl, "--json"],
    );
    expect(run.code).toBe(0);
    const out = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(out.base).toEqual({ symbol: "ACME", address: ACME, decimals: 8, readFromChain: true });
    // 400 USDC per ACME: a quarter of an ACME unit per USDC unit, a sqrt of exactly 2^95.
    expect(out.sqrtPriceX96).toBe((1n << 95n).toString());
    // A token calling itself by a symbol the registry gives another is shown by its address.
    const impostor = await sauce(
      ...["price", "--chain", "base", IMPOSTOR, "WETH", "1"],
      ...["--rpc-url", chain.rpcUrl, "--json"],
    );
    expect(impostor.code).toBe(0);
    expect((JSON.parse(impostor.stdout) as { base: unknown }).base).toEqual({
      symbol: IMPOSTOR,
      address: IMPOSTOR,
      decimals: 6,
      readFromChain: true,
    });
    // An address that is no token is named.
    const none = await sauce(
      ...["price", "--chain", "base", POOL_ADDRESS(chain), "USDC", "1", "--rpc-url", chain.rpcUrl],
    );
    expect(none.code).toBe(2);
    expect(none.stderr).toMatch(/answers no decimals\(\) on base .*: is it a token there\?/);
  });

  // Last: these move a pool's price in later blocks, and put it back.
  const pools = async (...flags: string[]) => {
    const run = await sauce(
      ...["pools", "--chain", "base", "USDC", "SPCXc", "--rpc-url", chain.rpcUrl, "--json"],
      ...flags,
    );
    if (run.code !== 0) throw new Error(`sauce pools exited ${run.code}: ${run.stderr}`);

    return JSON.parse(run.stdout) as Report;
  };
  const sqrtOf = (report: Report, pool: Address) =>
    report.pools.find((each) => each.pool === pool)!.sqrtPriceX96;

  it("reads every pool at the block --block names, and names the block it read", async () => {
    const pool = poolOf("v3:500");
    const before = await pools();
    const at = BigInt(before.block);
    // The latest block when it ran (read now, past viem's cache of the block number).
    expect(before.block).toBe(String(await chain.publicClient.getBlockNumber({ cacheTime: 0 })));
    // The pool's price moves in a later block: its sqrtPriceX96 is the low 160 bits of slot 0.
    await chain.testClient.mine({ blocks: 1 });
    const word = BigInt((await chain.publicClient.getStorageAt({ address: pool, slot: "0x0" }))!);
    const low = (1n << 160n) - 1n;
    const moved = ((word & low) * 101n) / 100n;
    const set = async (value: bigint) => {
      await chain.testClient.setStorageAt({
        address: pool,
        index: "0x0",
        value: `0x${value.toString(16).padStart(64, "0")}`,
      });
      await chain.testClient.mine({ blocks: 1 });
    };
    await set((word & ~low) | moved);
    try {
      const pinned = await pools("--block", at.toString());
      expect(pinned.block).toBe(at.toString());
      expect(sqrtOf(pinned, pool)).toBe(sqrtOf(before, pool));
      const latest = await pools();
      expect(BigInt(latest.block) > at).toBe(true);
      expect(sqrtOf(latest, pool)).toBe(moved.toString());
      // A tag names its block too.
      expect((await pools("--block", "latest")).block).toBe(latest.block);
    } finally {
      await set(word);
    }
  });

  it("prices the pair from a pool of each V3-style venue, naming the venue", async () => {
    for (const [name, venue, contract, price] of [
      ["v3:500", "Uniswap V3", "UniswapV3.Factory", "400"],
      ["pancake:2500", "PancakeSwap V3", "PancakeswapV3.Factory", "399"],
      ["slipstream:10", "Aerodrome Slipstream", "AerodromeSlipstream.CLFactoryGaugesV3", "400.5"],
    ] as const) {
      const run = await sauce(
        ...["price", "--chain", "base", "SPCXc", "USDC", "--pool", poolOf(name)],
        ...["--rpc-url", chain.rpcUrl, "--json"],
      );
      expect(run.stderr).toBe("");
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as {
        sqrtPriceX96: string;
        pool: Record<string, unknown>;
        buy: { maxPrice: string; maxAvgPrice: string };
      };
      expect(out.pool).toMatchObject({ address: poolOf(name), venue, contract, readFrom: "base" });
      expect(out.sqrtPriceX96).toBe(sqrtAt(price).toString());
      // Buying SPCXc with USDC: the price x 10^(18 + 6 - 8), as the distributed swap takes it.
      expect(Number(out.buy.maxPrice) / (Number(price) * 1e16)).toBeCloseTo(1, 12);
      expect(out.buy.maxAvgPrice).toBe(out.buy.maxPrice);
    }
    // A pool of another pair is refused, naming what it trades.
    const other = await sauce(
      ...["price", "--chain", "base", "WETH", "USDC", "--pool", poolOf("v3:500")],
      ...["--rpc-url", chain.rpcUrl],
    );
    expect(other.code).toBe(2);
    expect(other.stderr).toMatch(/trades 0x\w+ and 0x\w+, not WETH and USDC/);
    // An address with code that is no pool says so.
    const token = await sauce(
      ...["price", "--chain", "base", "SPCXc", "USDC", "--pool", USDC, "--rpc-url", chain.rpcUrl],
    );
    expect(token.code).toBe(2);
    expect(token.stderr).toMatch(/answers none of a V3-style pool's reads on base/);
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
