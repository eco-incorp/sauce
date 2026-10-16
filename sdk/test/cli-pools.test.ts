/**
 * `sauce pools`' arithmetic and inputs, with nothing reached: a pool's state as prices both ways
 * round, before and after its fee, as the distributed swap's `maxPrice`, and as depth through its
 * ticks; the venues it reads on a chain; and the invocations it refuses. `cli-pools.e2e.test.ts`
 * runs it against real Uniswap V3 pools.
 */
import { readFileSync } from "node:fs";

import {
  decodeFunctionResult,
  getAddress,
  hexToBigInt,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor } from "../src/descriptors/query.js";
import {
  decimalOf,
  depthToMove1Pct,
  parseV4Key,
  poolSides,
  readPoolAt,
  shortDecimal,
  significant,
  sqrtPriceAtTick,
  STANDARD_V4_KEYS,
  v4PoolId,
  v4SwapFee,
  venuesOn,
} from "../src/cli/pools.js";
import { priceCommand, tokenGiven, type PriceToken } from "../src/cli/price.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { solanaRpcStub } from "../scripts/solana-rpc-stub.mjs";
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
      [["--chain", "solana", "USDC", "WSOL"], /missing --rpc-url <url> \(or --config <file>\)/],
      [["--chain", "solana", "USDC", "WSOL", "--v4-key", "3000:60"], /is for an EVM chain's pools/],
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

/** What three Base pools answered, one per V3-style venue (`fixtures/cli/v3-pools-base.json`). */
interface CapturedPool {
  readonly venue: string;
  readonly contract: string;
  readonly address: Address;
  readonly answers: Readonly<Record<string, Hex>>;
  readonly getPool: Hex;
}
const CAPTURED = (
  JSON.parse(
    readFileSync(new URL("./fixtures/cli/v3-pools-base.json", import.meta.url), "utf8"),
  ) as { pools: CapturedPool[] }
).pools;
const BASE = requireChain("base");
const word = (data: Hex, index: number): bigint =>
  hexToBigInt(`0x${data.slice(2 + 64 * index, 2 + 64 * (index + 1))}`);

/**
 * A client whose `multicall` answers each call with the return data `answers` holds for its
 * address and function, decoded with the call's own ABI as viem's multicall decodes it: a call with
 * no answer reverts, and data its ABI cannot decode fails that call alone.
 */
function capturedClient(answers: ReadonlyMap<string, Readonly<Record<string, Hex>>>): PublicClient {
  return {
    multicall: async ({
      contracts,
    }: {
      contracts: Array<{ address: Address; abi: Abi; functionName: string; args?: unknown[] }>;
    }) =>
      contracts.map(({ address, abi, functionName, args }) => {
        const data = answers.get(getAddress(address))?.[functionName];
        if (data === undefined) {
          return { status: "failure", error: { shortMessage: "execution reverted" } };
        }
        try {
          return {
            status: "success",
            result: decodeFunctionResult({ abi, functionName, data, args } as never),
          };
        } catch (error) {
          return { status: "failure", error };
        }
      }),
  } as unknown as PublicClient;
}

/** The answers of `pool` and of its factory, whose getPool returns `getPool`. */
const answersOf = (pool: CapturedPool, change: Partial<Record<string, Hex | undefined>> = {}) => {
  const own = Object.fromEntries(
    Object.entries({ ...pool.answers, ...change }).filter(([, data]) => data !== undefined),
  ) as Record<string, Hex>;
  const factory = getAddress(`0x${pool.answers.factory!.slice(-40)}`);

  return new Map([
    [getAddress(pool.address), own],
    [factory, { getPool: pool.getPool }],
  ]);
};

describe("a pool given by its address (sauce price --pool)", () => {
  it("reads every V3-style venue's pool as Base's answered, and names its venue", async () => {
    for (const pool of CAPTURED) {
      const read = await readPoolAt(capturedClient(answersOf(pool)), BASE, pool.address);
      const slot0 = pool.answers.slot0!;
      expect(read).toEqual({
        pool: getAddress(pool.address),
        token0: getAddress(`0x${pool.answers.token0!.slice(-40)}`),
        token1: getAddress(`0x${pool.answers.token1!.slice(-40)}`),
        sqrtPriceX96: word(slot0, 0),
        // The tick is the second word, an int24 sign-extended.
        tick: Number(BigInt.asIntN(24, word(slot0, 1))),
        liquidity: hexToBigInt(pool.answers.liquidity!),
        fee: 500,
        tickSpacing: 10,
        factory: getAddress(`0x${pool.answers.factory!.slice(-40)}`),
        venue: { name: pool.venue, contract: pool.contract },
      });
      expect(read.tick).toBeLessThan(0);
    }
  });

  it("decodes only the price and tick: the venues' slot0s differ after them", () => {
    const [uniswap, pancake, slipstream] = CAPTURED;
    // Slipstream's slot0 is six words, which Uniswap V3's seven-output slot0 overruns: what
    // `sauce_price` with a pool failed on.
    const uniswapPool = getDescriptor("uniswap-v3", "Pool")!.abi;
    expect(() =>
      decodeFunctionResult({
        abi: uniswapPool,
        functionName: "slot0",
        data: slipstream!.answers.slot0!,
      } as never),
    ).toThrow(/out of bounds/);
    expect((slipstream!.answers.slot0!.length - 2) / 64).toBe(6);
    // PancakeSwap V3's feeProtocol is a uint32 where Uniswap's is a uint8.
    expect(word(pancake!.answers.slot0!, 5)).toBe(0x0d480d48n);
    expect(word(uniswap!.answers.slot0!, 5)).toBeLessThan(256n);
  });

  it("names no venue for a pool no registry factory made", async () => {
    const pool = CAPTURED[2]!;
    const stranger = `0x${"00".repeat(12)}${"ab".repeat(20)}` as Hex;
    const unknown = await readPoolAt(
      capturedClient(answersOf(pool, { factory: stranger })),
      BASE,
      pool.address,
    );
    expect(unknown.venue).toBeUndefined();
    expect(unknown.unrecognized).toMatch(/is none the registry records on base/);
    // A pool naming a registry factory whose lookup returns another.
    const claimed = await readPoolAt(
      capturedClient(
        new Map([
          [getAddress(pool.address), pool.answers],
          [getAddress(`0x${pool.answers.factory!.slice(-40)}`), { getPool: stranger }],
        ]),
      ),
      BASE,
      pool.address,
    );
    expect(claimed.venue).toBeUndefined();
    expect(claimed.unrecognized).toMatch(
      /names AerodromeSlipstream\.CLFactoryGaugesV3 as its factory, whose getPool does not return it/,
    );
    const anonymous = await readPoolAt(
      capturedClient(answersOf(pool, { factory: undefined })),
      BASE,
      pool.address,
    );
    expect(anonymous.unrecognized).toMatch(/answers no factory\(\)/);
  });

  it("refuses an address that is no V3-style pool, saying what it is not", async () => {
    const pool = CAPTURED[0]!;
    await expect(
      readPoolAt(capturedClient(answersOf(pool, { slot0: undefined })), BASE, pool.address),
    ).rejects.toThrow(
      /answers no slot0\(\) on base .*: it is not a V3-style pool \(Uniswap V3, PancakeSwap V3, Aerodrome Slipstream\)\. A Uniswap V4 pool has no address of its own/,
    );
    await expect(readPoolAt(capturedClient(new Map()), BASE, pool.address)).rejects.toThrow(
      /answers none of a V3-style pool's reads on base/,
    );
  });

  it("prices the pair from the pool, which must be of the pair", async () => {
    const pool = CAPTURED[2]!;
    const read = await readPoolAt(capturedClient(answersOf(pool)), BASE, pool.address);
    const [spcx, usdc] = [tokenGiven("SPCXc", BASE), tokenGiven("USDC", BASE)] as PriceToken[];
    const out = priceCommand({
      chain: BASE,
      base: spcx!,
      quote: usdc!,
      price: { sqrtPriceX96: read.sqrtPriceX96 },
      pool: read,
    });
    expect(out.json.pool).toEqual({
      address: getAddress(pool.address),
      venue: "Aerodrome Slipstream",
      contract: "AerodromeSlipstream.CLFactoryGaugesV3",
      factory: getAddress(`0x${pool.answers.factory!.slice(-40)}`),
      sqrtPriceX96: read.sqrtPriceX96.toString(),
      tick: read.tick,
      liquidity: read.liquidity.toString(),
      feePpm: 500,
      tickSpacing: 10,
      readFrom: "base",
    });
    expect(out.text).toContain(
      `Pool: Aerodrome Slipstream ${getAddress(pool.address)} ` +
        "(AerodromeSlipstream.CLFactoryGaugesV3), fee 0.05%, tick spacing 10",
    );
    // Buying SPCXc with USDC: the distributed swap's maxPrice is USDC units per SPCXc unit times
    // 1e18, the price times 10^(18 + 6 - 8), as sauce pools gives each pool's.
    const buy = out.json.buy as { maxPrice: string; maxAvgPrice: string; minAvgPrice: string };
    const [usdcPerSpcx] = poolSides(
      usdc as PriceToken,
      spcx as PriceToken,
      { sqrtPriceX96: read.sqrtPriceX96, liquidity: read.liquidity, tick: read.tick },
      [0, 0],
    );
    // sauce pools rounds its taker price up, sauce price its limit down: one unit apart at most.
    expect(usdcPerSpcx.maxPrice - BigInt(buy.maxPrice)).toBeGreaterThanOrEqual(0n);
    expect(usdcPerSpcx.maxPrice - BigInt(buy.maxPrice)).toBeLessThanOrEqual(1n);
    expect(buy.maxAvgPrice).toBe(buy.maxPrice);
    // minAvgPrice is the other way round: SPCXc units per USDC unit, about 1e36 / maxPrice.
    expect(BigInt(buy.minAvgPrice) * BigInt(buy.maxPrice)).toBeGreaterThanOrEqual(10n ** 36n);
    expect(() =>
      priceCommand({
        chain: BASE,
        base: tokenGiven("WETH", BASE) as PriceToken,
        quote: usdc!,
        price: { sqrtPriceX96: read.sqrtPriceX96 },
        pool: read,
      }),
    ).toThrow(/trades 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 and 0xb2\w+, not WETH and USDC/);
  });
});

describe("sauce pools on Solana, through an endpoint with no pools", () => {
  const SYSTEM = "11111111111111111111111111111111";

  it("chooses no pool for --pay, every slot of the program the System program", async () => {
    const stub = await solanaRpcStub();
    try {
      const run = await sauce(
        ...["pools", "--chain", "solana", "USDC", "SOL", "--rpc-url", stub.url],
        ...["--pay", "SOL", "--slots", "5", "--json"],
      );
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as {
        chosen: unknown[];
        poolArgs: string[];
        accounts: Record<string, string>;
      };
      expect(out.chosen).toEqual([]);
      // The pools for main's arguments, in slot order: five empty slots.
      expect(out.poolArgs).toEqual(Array(5).fill(SYSTEM));
      // And the slots' accounts, for a program that takes them as accounts.
      expect(Object.keys(out.accounts)).toHaveLength(45);
      expect(out.accounts.program4).toBe(SYSTEM);
      expect(new Set(Object.values(out.accounts))).toEqual(new Set([SYSTEM]));
      // The text gives the pools ready for --args.
      const text = await sauce(
        ...["pools", "--chain", "solana", "USDC", "SOL", "--rpc-url", stub.url],
        ...["--pay", "SOL", "--slots", "5"],
      );
      expect(text.stdout).toContain(
        `The pools for main's --args, in slot order: ${Array(5).fill(SYSTEM).join(" ")}`,
      );
    } finally {
      await stub.close();
    }
  });

  it("asks a refused scan again, so a rate limit that lifts reads every venue", async () => {
    const stub = await solanaRpcStub({ rateLimitScans: 2 });
    try {
      const run = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", stub.url, "--json"],
      );
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as { checked: { venue: string; error?: string }[] };
      expect(out.checked).toHaveLength(9);
      expect(out.checked.filter((one) => one.error !== undefined)).toEqual([]);
      expect(stub.methods.get("getProgramAccounts")).toBe(12); // 10 scans, 2 of them twice
    } finally {
      await stub.close();
    }
  }, 30_000);

  it("says a listing is partial when a venue cannot be read even asked again, and exits 1", async () => {
    const stub = await solanaRpcStub({
      refuseScans: ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"],
    });
    try {
      const run = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", stub.url, "--json"],
      );
      expect(run.code).toBe(1);
      expect(run.stderr).toMatch(/1 of 9 venues could not be read \(Orca Whirlpools\)/);
      expect(run.stderr).toMatch(/with --rpc-url <url> or --config <file>/);
      expect(stub.methods.get("getProgramAccounts")).toBe(13); // Orca's, asked 4 times
      const out = JSON.parse(run.stdout) as { checked: { venue: string; error?: string }[] };
      expect(out.checked.filter((one) => one.error !== undefined).map((one) => one.venue)).toEqual([
        "Orca Whirlpools",
      ]);
    } finally {
      await stub.close();
    }
  }, 30_000);

  it("takes --max-price, --per-venue and --slots only with --pay", async () => {
    for (const extra of [["--per-venue"], ["--slots", "5"], ["--max-price", "1"]]) {
      const run = await sauce(
        ...["pools", "--chain", "solana", "USDC", "WSOL", "--rpc-url", "http://127.0.0.1:9"],
        ...extra,
      );
      expect(run.code).toBe(2);
      expect(run.stderr).toMatch(/choose pools for --pay <token>/);
    }
  });
});
