/**
 * `sauce pools`' arithmetic and inputs, with nothing reached: a pool's state as prices both ways
 * round, before and after its fee, as the distributed swap's `maxPrice`, and as depth through its
 * ticks; the venues it reads on a chain; and the invocations it refuses. `cli-pools.e2e.test.ts`
 * runs it against real Uniswap V3 pools.
 */
import { getAddress, type Address } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import {
  decimalOf,
  depthToMove1Pct,
  parseV4Key,
  poolSides,
  shortDecimal,
  significant,
  sqrtPriceAtTick,
  STANDARD_V4_KEYS,
  v4PoolId,
  v4SwapFee,
  venuesOn,
} from "../src/cli/pools.js";
import type { PriceToken } from "../src/cli/price.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { MAX_SQRT_PRICE_X96, MIN_SQRT_PRICE_X96 } from "../src/price.js";

const Q96 = 1n << 96n;

/** Two tokens at fixed addresses: `low` is token0. */
const token = (symbol: string, decimals: number, low: boolean): PriceToken => ({
  symbol,
  address: getAddress(low ? `0x${"11".repeat(20)}` : `0x${"ee".repeat(20)}`) as Address,
  decimals,
});

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

describe("a pool's prices, both ways round", () => {
  it("6 and 8 decimals: 400 USDC per token, and maxPrice as price x 10^(18 + 6 - 8)", () => {
    // USDC is token0; one 8-decimal unit costs 4 USDC units, so the pool's price (token1 units per
    // token0 unit) is 1/4 and its sqrt exactly 2^95.
    const usdc = token("USDC", 6, true);
    const stock = token("SPCX", 8, false);
    const state = { sqrtPriceX96: Q96 / 2n, liquidity: 0n, tick: -13_863 };
    const [buyStock, buyUsdc] = poolSides(usdc, stock, state, [0, 0]);
    expect(buyStock).toMatchObject({ mid: "400", taker: "400", feePpm: 0 });
    expect(buyStock.maxPrice).toBe(400n * 10n ** 16n);
    expect(buyStock.maxPrice).toBe(4n * 10n ** 18n);
    expect(buyUsdc).toMatchObject({ mid: "0.0025", taker: "0.0025" });
    expect(buyUsdc.maxPrice).toBe(25n * 10n ** 16n); // 0.0025 x 10^(18 + 8 - 6)
    expect(buyStock.depth1Pct).toBeUndefined();
  });

  it("6 and 18 decimals, the 6-decimal token as token1", () => {
    // 2^-20 USDC units per WETH unit: 10^12 / 2^20 = 953674.31640625 USDC per WETH, exactly.
    const weth = token("WETH", 18, true);
    const usdc = token("USDC", 6, false);
    const state = { sqrtPriceX96: Q96 >> 10n, liquidity: 0n, tick: 0 };
    const [buyUsdc, buyWeth] = poolSides(weth, usdc, state, [0, 0]);
    expect(buyWeth.mid).toBe("953674.31640625");
    // USDC base units per WETH base unit, times 1e18 = 953674.31640625 x 10^(18 + 6 - 18), rounded up.
    expect(buyWeth.maxPrice).toBe(953_674_316_407n);
    expect(buyUsdc.mid).toBe("0.000001048576");
    // Paying WETH: WETH base units per USDC base unit, times 1e18 = 1.048576e-6 x 10^(18+18-6).
    expect(buyUsdc.maxPrice).toBe(1_048_576n * 10n ** 18n);
  });

  it("18 and 18 decimals, and the fee: the taker pays mid / (1 - fee), rounded up in maxPrice", () => {
    const a = token("A", 18, true);
    const b = token("B", 18, false);
    // Price 4: a sqrt of 2.
    const state = { sqrtPriceX96: 2n * Q96, liquidity: 0n, tick: 13_863 };
    const [buyB, buyA] = poolSides(a, b, state, [3000, 3000]);
    expect(buyA.mid).toBe("4");
    expect(buyA.taker).toBe("4.01203610832497492"); // 4 / 0.997, to 18 significant digits
    expect(buyA.maxPrice).toBe(4_012_036_108_324_974_925n); // ceil(4e18 / 0.997)
    expect(buyB.mid).toBe("0.25");
    expect(buyB.taker).toBe("0.250752256770310933"); // 0.25 / 0.997
    expect(buyB.maxPrice).toBe(250_752_256_770_310_932n + 1n);
    // Each side its own fee: a V4 pool's protocol fee differs by direction.
    const [cheap, dear] = poolSides(a, b, state, [0, 10_000]);
    expect(cheap.taker).toBe("0.25");
    expect(dear.taker).toBe("4.0404040404040404");
  });

  it("the taker price is the mid divided by (1 - fee), for every decimals pair, both ways", () => {
    for (const [d0, d1] of [
      [6, 8],
      [6, 18],
      [18, 18],
      [8, 6],
    ] as const) {
      const a = token("A", d0, true);
      const b = token("B", d1, false);
      const state = { sqrtPriceX96: 79_228_162_514_264_337_593_543n, liquidity: 0n, tick: 0 };
      for (const side of poolSides(a, b, state, [500, 500])) {
        const mid = Number(side.mid);
        expect(Number(side.taker) / mid).toBeCloseTo(1 / 0.9995, 9);
        // maxPrice is the taker price times 10^(18 + pay decimals - buy decimals), rounded up to
        // a whole number.
        const want = Number(side.taker) * 10 ** (18 + side.pay.decimals - side.buy.decimals);
        expect(Math.abs(Number(side.maxPrice) - want)).toBeLessThanOrEqual(1 + want * 1e-12);
        expect(Number(side.maxPrice)).toBeGreaterThanOrEqual(want * (1 - 1e-12));
      }
    }
  });
});

describe("a V4 pool's fee", () => {
  it("adds the protocol fee one way, as the PoolManager charges it", () => {
    const packed = 300 | (100 << 12);
    expect(v4SwapFee(500, 0, true)).toBe(500);
    expect(v4SwapFee(500, packed, true)).toBe(800);
    expect(v4SwapFee(500, packed, false)).toBe(600);
    // protocol + lp - protocol * lp / 1e6, rounded down.
    expect(v4SwapFee(3000, 1000, true)).toBe(3997);
  });

  it("is keyed by the pool's id over the sorted currencies", () => {
    const id = v4PoolId(
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      { fee: 3000, tickSpacing: 60 },
    );
    expect(id).toMatch(/^0x[0-9a-f]{64}$/);
    expect(STANDARD_V4_KEYS).toEqual([
      { fee: 100, tickSpacing: 1 },
      { fee: 500, tickSpacing: 10 },
      { fee: 3000, tickSpacing: 60 },
      { fee: 10_000, tickSpacing: 200 },
    ]);
  });
});

describe("ticks and depth", () => {
  it("prices a tick as a pool does, to its bounds", () => {
    expect(sqrtPriceAtTick(0)).toBe(Q96);
    expect(sqrtPriceAtTick(-887_272)).toBe(MIN_SQRT_PRICE_X96);
    expect(sqrtPriceAtTick(887_272)).toBe(MAX_SQRT_PRICE_X96);
    expect(sqrtPriceAtTick(1)).toBe(79_232_123_823_359_799_118_286_999_568n);
    // Against sqrt(1.0001^tick) * 2^96, exactly as rationals, to within a unit.
    for (const tick of [1, 7, 60, 255, 1024, 4097, -1, -10, -200, -1023, -5000]) {
      const [n, d] =
        tick > 0
          ? [10_001n ** BigInt(tick), 10_000n ** BigInt(tick)]
          : [10_000n ** BigInt(-tick), 10_001n ** BigInt(-tick)];
      const got = sqrtPriceAtTick(tick);
      // got^2 / 2^192 against n / d: (got - 1)^2 * d <= n * 2^192 <= (got + 1)^2 * d.
      expect((got - 1n) ** 2n * d <= n * Q96 * Q96).toBe(true);
      expect((got + 1n) ** 2n * d >= n * Q96 * Q96).toBe(true);
    }
    expect(() => sqrtPriceAtTick(887_273)).toThrow(/out of range/);
  });

  it("with no tick in reach, is the liquidity times the move in sqrt price", () => {
    const state = { sqrtPriceX96: Q96, liquidity: 10n ** 18n, tick: 0 };
    // Price 1 to 1.01: L * (sqrt(1.01) - 1) of token1, and L * (sqrt(1.01) - 1) of token0 down.
    const up = depthToMove1Pct(state, [], true);
    const down = depthToMove1Pct(state, [], false);
    expect(Number(up) / 1e18).toBeCloseTo(Math.sqrt(1.01) - 1, 12);
    expect(Number(down) / 1e18).toBeCloseTo(Math.sqrt(1.01) - 1, 12);
  });

  it("walks the ticks it crosses: more liquidity past one costs more, none past one costs nothing", () => {
    const state = { sqrtPriceX96: Q96, liquidity: 10n ** 18n, tick: 0 };
    const flat = depthToMove1Pct(state, [], true);
    // Liquidity doubles at tick 50 (half way to a 1% move) and is gone below tick -50.
    const ticks = [
      { tick: 50, liquidityNet: 10n ** 18n },
      { tick: -50, liquidityNet: 10n ** 18n },
    ];
    const up = depthToMove1Pct(state, ticks, true);
    const half = sqrtPriceAtTick(50) - Q96;
    const rest =
      (Q96 * BigInt(Math.round(Math.sqrt(1.01) * 1e15))) / 10n ** 15n - sqrtPriceAtTick(50);
    expect(Number(up)).toBeCloseTo(Number((10n ** 18n * half + 2n * 10n ** 18n * rest) / Q96), -6);
    expect(up > flat).toBe(true);
    // Down: 50 ticks of liquidity, and none past tick -50: the rest of the 1% costs nothing.
    const down = depthToMove1Pct(state, ticks, false);
    const toFifty =
      (10n ** 18n * Q96 * (Q96 - sqrtPriceAtTick(-50))) / (Q96 * sqrtPriceAtTick(-50));
    expect(down - toFifty).toBeLessThanOrEqual(1n);
    expect(down < depthToMove1Pct(state, [], false)).toBe(true);
  });
});

describe("numbers for a person", () => {
  it("rounds half up, and to significant digits", () => {
    expect(decimalOf(2n, 3n, 4)).toBe("0.6667");
    expect(decimalOf(10n, 4n, 0)).toBe("3");
    expect(decimalOf(5n, 1n, 6)).toBe("5");
    expect(significant(2n, 3000n)).toBe("0.000666667");
    expect(significant(1_234_567_891n, 1n)).toBe("1234567891");
    expect(shortDecimal("148.770673813160181390")).toBe("148.771");
    expect(shortDecimal("0.006728481661361976")).toBe("0.00672848");
    expect(shortDecimal("0")).toBe("0");
  });
});

describe("the venues and the inputs", () => {
  it("reads every price-limit venue the registry records on Base, as a program names it", () => {
    expect(venuesOn(requireChain("base")).map((venue) => [venue.kind, venue.contract])).toEqual([
      ["v3", "UniswapV3.Factory"],
      ["v3", "PancakeswapV3.Factory"],
      ["slipstream", "AerodromeSlipstream.CLFactory"],
      ["slipstream", "AerodromeSlipstream.CLFactoryGaugeCaps"],
      ["slipstream", "AerodromeSlipstream.CLFactoryGaugesV3"],
      ["v4", "UniswapV4.StateView"],
    ]);
    // Ethereum has no Slipstream.
    expect(venuesOn(requireChain("ethereum")).some((venue) => venue.kind === "slipstream")).toBe(
      false,
    );
  });

  it("takes a hookless V4 key as fee:tickSpacing", () => {
    expect(parseV4Key("3000:60")).toEqual({ fee: 3000, tickSpacing: 60 });
    expect(parseV4Key("0:1")).toEqual({ fee: 0, tickSpacing: 1 });
    for (const bad of ["3000", "3000:0", "1000001:1", "3000:32768", "a:b", "-1:60"]) {
      expect(() => parseV4Key(bad)).toThrow(/<fee>:<tickSpacing>/);
    }
  });

  it("names what it cannot list, exiting 2, before reaching any endpoint", async () => {
    const cases: Array<[string[], RegExp]> = [
      [["--chain", "base", "USDC"], /missing the pair: <token> <token>/],
      [["--chain", "base", "USDC", "WETH", "DAI"], /unexpected argument DAI/],
      [["--chain", "solana", "USDC", "SOL"], /on an EVM chain; solana has none/],
      [["--chain", "base", "USDC", "WETH"], /missing --rpc-url <url> \(or --config <file>\)/],
      [
        ["--chain", "base", "USDC", "WETH", "--v4-key", "3000", "--rpc-url", "http://127.0.0.1:1"],
        /--v4-key 3000: a hookless V4 pool's key is <fee>:<tickSpacing>/,
      ],
    ];
    for (const [argv, message] of cases) {
      const run = await sauce("pools", ...argv);
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(message);
    }
  });

  it("sauce price names the endpoint that would read an address's decimals", async () => {
    const run = await sauce("price", "--chain", "base", "USDC", `0x${"12".repeat(20)}`, "1");
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /give them as 0x[0-9a-fA-F]{40}:<decimals>, or an endpoint \(--rpc-url or --config\) to read them from the token/,
    );
  });
});
