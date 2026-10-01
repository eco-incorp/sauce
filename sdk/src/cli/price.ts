/**
 * `sauce price`: a human price for a pair as the numbers a swap program takes — the pool's
 * `sqrtPriceX96` for that pair on the chain, which is also the swap's price limit, and the
 * average-price floor a program compares a fill against (`out * 1e18 >= minAvgPrice * spent`), for
 * selling the base token and for buying it.
 *
 * The conversion is the SDK's own (`price.ts`); this adds only the chain's token order and decimals,
 * from the registry `sauce globals` lists. With an endpoint it also reads the pair's live price from
 * its deepest Uniswap V3 pool, and warns when the price given is far from it — a price written the
 * wrong way round is off by its own square, a millionfold for WETH/USDC.
 */
import {
  getAddress,
  isAddress,
  parseAbi,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { chainDefines } from "../routes/ambient.js";
import {
  priceFromSqrtPriceX96,
  sqrtPriceX96FromPrice,
  MAX_SQRT_PRICE_X96,
  MIN_SQRT_PRICE_X96,
  type PoolPriceTokens,
} from "../price.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";

/** One side of the pair. */
export interface PriceToken {
  /** The registry symbol, or the address when it is not one. */
  readonly symbol: string;
  readonly address: Address;
  readonly decimals: number;
}

/** Refuses a chain with no V3- or V4-style pools to price. */
export function pricedChain(chain: CanonicalChain): CanonicalChain {
  if (chain.kind !== "evm") {
    throw new UsageError(
      `sqrtPriceX96 is the price of a Uniswap V3 or V4 pool (or a fork), on an EVM chain; ` +
        `${chain.slug} has none`,
    );
  }

  return chain;
}

/** `<symbol>`, `<address>` (a registered one) or `<address>:<decimals>`, on `chain`. */
export function parsePriceToken(raw: string, chain: CanonicalChain): PriceToken {
  const rows = TOKEN_REGISTRY[pricedChain(chain).id] ?? [];
  const [given, decimalsText, ...rest] = raw.split(":");
  if (rest.length > 0 || given === undefined || given === "") {
    throw new UsageError(`'${raw}' is not a token: a symbol, or an address with :<decimals>`);
  }
  const decimals =
    decimalsText === undefined
      ? undefined
      : /^\d{1,2}$/.test(decimalsText)
        ? Number(decimalsText)
        : (() => {
            throw new UsageError(`${raw}: '${decimalsText}' is not a token's decimals (0 to 99)`);
          })();
  if (isAddress(given, { strict: false })) {
    const address = getAddress(given);
    const row = rows.find((entry) => getAddress(entry.address) === address);
    if (row !== undefined && decimals !== undefined && decimals !== row.decimals) {
      throw new UsageError(`${raw}: ${row.symbol} has ${row.decimals} decimals, not ${decimals}`);
    }
    const known = decimals ?? row?.decimals;
    if (known === undefined) {
      throw new UsageError(
        `${given} is not a token ${chain.slug} registers, so its decimals are not known: give them ` +
          `as ${given}:<decimals>`,
      );
    }

    return { symbol: row?.symbol ?? address, address, decimals: known };
  }
  const row = rows.find((entry) => entry.symbol === given.toUpperCase());
  if (row === undefined) {
    throw new UsageError(
      `${given} is not a token ${chain.slug} registers (sauce globals --chain ${chain.slug} ` +
        "--tokens lists them): give its address with :<decimals>",
    );
  }
  if (decimals !== undefined && decimals !== row.decimals) {
    throw new UsageError(`${raw}: ${row.symbol} has ${row.decimals} decimals, not ${decimals}`);
  }

  return { symbol: row.symbol, address: getAddress(row.address), decimals: row.decimals };
}

export interface PriceInput {
  readonly chain: CanonicalChain;
  /** The token the price is per one of. */
  readonly base: PriceToken;
  /** The token the price is in. */
  readonly quote: PriceToken;
  /** A price in quote tokens per base token, or the pool's `sqrtPriceX96` to read as one. */
  readonly price: { readonly decimal: string } | { readonly sqrtPriceX96: bigint };
  /** The pair's live price, when an endpoint read it (`livePrice`). */
  readonly live?: LivePrice;
}

/** A pair's price as its deepest Uniswap V3 pool on the chain has it now. */
export interface LivePrice {
  readonly pool: Address;
  /** The pool's fee tier, in millionths: 500 is 0.05%. */
  readonly fee: number;
  readonly sqrtPriceX96: bigint;
}

const V3 = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
]);

/** Uniswap V3's fee tiers every deployment enables. */
const FEES = [100, 500, 3000, 10_000] as const;

/**
 * The pair's live price from its Uniswap V3 pool with the most liquidity on the chain, through the
 * registry's factory — `undefined` where the chain has no Uniswap V3 factory or the pair no pool.
 */
export async function livePrice(
  client: PublicClient,
  chain: CanonicalChain,
  base: PriceToken,
  quote: PriceToken,
): Promise<LivePrice | undefined> {
  const factory = chainDefines(chain).UniswapV3_Factory;
  if (typeof factory !== "bigint") return undefined;
  const at = getAddress(`0x${factory.toString(16).padStart(40, "0")}`);
  const pools = await Promise.all(
    FEES.map(async (fee) => {
      const pool = await client.readContract({
        address: at,
        abi: V3,
        functionName: "getPool",
        args: [base.address, quote.address, fee],
      });
      if (pool === zeroAddress) return undefined;
      const [liquidity, slot0] = await Promise.all([
        client.readContract({ address: pool, abi: V3, functionName: "liquidity" }),
        client.readContract({ address: pool, abi: V3, functionName: "slot0" }),
      ]);

      return { pool, fee, liquidity, sqrtPriceX96: slot0[0] };
    }),
  );
  const deepest = pools
    .filter((pool) => pool !== undefined && pool.liquidity > 0n)
    .sort((a, b) => (a!.liquidity > b!.liquidity ? -1 : 1))[0];

  return deepest === undefined
    ? undefined
    : { pool: deepest.pool, fee: deepest.fee, sqrtPriceX96: deepest.sqrtPriceX96 };
}

/** How far apart two prices of the pair are, as the larger over the smaller: from sqrt prices. */
const apart = (a: bigint, b: bigint): number => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  const ratio = Number(hi) / Number(lo);

  return ratio * ratio;
};

/**
 * The price as given: a decimal number of quote tokens per base token, or a pool's `sqrtPriceX96`
 * to read back as one — exactly one of the two.
 */
export function priceGiven(
  price: string | undefined,
  sqrtPriceX96: string | undefined,
): PriceInput["price"] {
  if ((price === undefined) === (sqrtPriceX96 === undefined)) {
    throw new UsageError(
      price === undefined
        ? "missing <price>: how many quote tokens one base token is worth (or --sqrt-price-x96)"
        : "give <price> or --sqrt-price-x96, not both",
    );
  }
  if (price !== undefined) {
    if (!/^\d+(?:\.\d+)?$/.test(price)) {
      throw new UsageError(`'${price}' is not a price: a decimal number, as 2700 or 0.00037`);
    }

    return { decimal: price };
  }
  if (!/^\d+$/.test(sqrtPriceX96!)) {
    throw new UsageError(`--sqrt-price-x96: '${sqrtPriceX96}' is not a whole number`);
  }

  return { sqrtPriceX96: BigInt(sqrtPriceX96!) };
}

const ceilDiv = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator - 1n) / denominator;

const SCALE = 10n ** 18n;

/** `sauce price`: the price as a pool's `sqrtPriceX96`, and both directions' limit and floor. */
export function priceCommand(input: PriceInput): CommandOutput {
  const { base, quote } = input;
  const chain = pricedChain(input.chain);
  if (base.address === quote.address) {
    throw new UsageError(`a price is between two tokens: ${base.symbol} is both`);
  }
  const baseIsToken0 = BigInt(base.address) < BigInt(quote.address);
  const tokens: PoolPriceTokens = {
    baseDecimals: base.decimals,
    quoteDecimals: quote.decimals,
    baseIsToken0,
  };
  let sqrtPriceX96: bigint;
  try {
    sqrtPriceX96 =
      "sqrtPriceX96" in input.price
        ? input.price.sqrtPriceX96
        : sqrtPriceX96FromPrice(input.price.decimal, tokens);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  if (sqrtPriceX96 < MIN_SQRT_PRICE_X96 || sqrtPriceX96 >= MAX_SQRT_PRICE_X96) {
    throw new UsageError(
      `--sqrt-price-x96 ${sqrtPriceX96} is outside the range a pool can hold ` +
        `[${MIN_SQRT_PRICE_X96}, ${MAX_SQRT_PRICE_X96})`,
    );
  }
  const price =
    "decimal" in input.price ? input.price.decimal : priceFromSqrtPriceX96(sqrtPriceX96, tokens);
  // Quote base units per base unit, exactly: from the price as given, or from the pool's.
  const [num, den] =
    "sqrtPriceX96" in input.price
      ? baseIsToken0
        ? [sqrtPriceX96 * sqrtPriceX96, 1n << 192n]
        : [1n << 192n, sqrtPriceX96 * sqrtPriceX96]
      : rational(price, quote.decimals, base.decimals);
  // Output units per input unit, times 1e18, rounded up: a fill the check passes is never at a worse
  // average than the price.
  const directions = [
    { name: "sell", tokenIn: base, tokenOut: quote, minAvgPrice: ceilDiv(num * SCALE, den) },
    { name: "buy", tokenIn: quote, tokenOut: base, minAvgPrice: ceilDiv(den * SCALE, num) },
  ].map((side) => {
    const zeroForOne = BigInt(side.tokenIn.address) < BigInt(side.tokenOut.address);

    return { ...side, zeroForOne, limit: zeroForOne ? "floor" : "ceiling" };
  });
  const [token0, token1] = baseIsToken0 ? [base, quote] : [quote, base];
  const width = Math.max(token0.symbol.length, token1.symbol.length);
  const row = (token: PriceToken, which: string): string =>
    `  ${which}  ${token.symbol.padEnd(width)}  ${token.address}  ${token.decimals} decimals`;
  // The same price read the other way round: base tokens per quote token.
  const inverse = priceFromSqrtPriceX96(sqrtPriceX96, {
    baseDecimals: quote.decimals,
    quoteDecimals: base.decimals,
    baseIsToken0: !baseIsToken0,
  });
  const means = `${price} ${quote.symbol} per ${base.symbol}`;
  const inverseMeans = `${inverse} ${base.symbol} per ${quote.symbol}`;
  const liveReport = (found: LivePrice) => {
    const now = priceFromSqrtPriceX96(found.sqrtPriceX96, tokens);
    const off = apart(found.sqrtPriceX96, sqrtPriceX96);
    const pool = `the Uniswap V3 pool ${found.pool} (fee ${found.fee / 10_000}%)`;
    // The number given read the other way round, as base tokens per quote token: near the pool's,
    // it was written the wrong way round.
    const inverted = (() => {
      try {
        const flipped = sqrtPriceX96FromPrice(price, {
          baseDecimals: quote.decimals,
          quoteDecimals: base.decimals,
          baseIsToken0: !baseIsToken0,
        });

        return apart(found.sqrtPriceX96, flipped) < 10;
      } catch {
        // Read that way it is no price a pool can hold.
        return false;
      }
    })();
    const warning =
      off < 10
        ? undefined
        : `the price given, ${means}, is ${off < 1e6 ? `${Math.round(off)}x` : `about 10^${Math.round(Math.log10(off))} times`} ` +
          `off ${pool}, which is at ${now} ${quote.symbol} per ${base.symbol}` +
          (inverted
            ? `: it looks the wrong way round. For ${price} ${base.symbol} per ${quote.symbol}, ` +
              `run \`sauce price --chain ${chain.slug} ${price} ${base.symbol} per ${quote.symbol}\``
            : "");

    return {
      json: {
        pool: found.pool,
        fee: found.fee,
        sqrtPriceX96: found.sqrtPriceX96.toString(),
        price: now,
        means: `${now} ${quote.symbol} per ${base.symbol}`,
      },
      line: `Live: ${pool} is at ${now} ${quote.symbol} per ${base.symbol} (sqrtPriceX96 ${found.sqrtPriceX96})`,
      warning,
    };
  };
  const live = input.live === undefined ? undefined : liveReport(input.live);

  return {
    text: [
      `${means} on ${chain.slug}: 1 ${base.symbol} = ${price} ${quote.symbol}, 1 ${quote.symbol} = ${inverse} ${base.symbol}`,
      row(token0, "token0"),
      row(token1, "token1"),
      `sqrtPriceX96  ${sqrtPriceX96}`,
      ...(live === undefined ? [] : [live.line]),
      "",
      ...directions.flatMap((side) => [
        `${side.name === "sell" ? "Selling" : "Buying"} ${base.symbol} ` +
          `(${side.tokenIn.symbol} in, ${side.tokenOut.symbol} out):`,
        `  sqrtPriceLimitX96  ${sqrtPriceX96}  a ${side.limit}: selling ` +
          `${side.zeroForOne ? "token0 lowers" : "token1 raises"} the price`,
        `  minAvgPrice        ${side.minAvgPrice}  ${side.tokenOut.symbol} units per ` +
          `${side.tokenIn.symbol} unit, times 1e18: out * 1e18 >= minAvgPrice * spent`,
      ]),
    ].join("\n"),
    ...(live?.warning === undefined ? {} : { notes: [live.warning] }),
    json: {
      chain: chain.slug,
      price,
      means,
      inverse: { price: inverse, means: inverseMeans },
      base,
      quote,
      token0: token0.symbol,
      token1: token1.symbol,
      sqrtPriceX96: sqrtPriceX96.toString(),
      ...(live === undefined
        ? {}
        : { live: live.json, ...(live.warning === undefined ? {} : { warning: live.warning }) }),
      ...Object.fromEntries(
        directions.map((side) => [
          side.name,
          {
            tokenIn: side.tokenIn.symbol,
            tokenOut: side.tokenOut.symbol,
            zeroForOne: side.zeroForOne,
            sqrtPriceLimitX96: sqrtPriceX96.toString(),
            limit: side.limit,
            minAvgPrice: side.minAvgPrice.toString(),
          },
        ]),
      ),
    },
  };
}

/** A decimal price as quote base units per base unit: `numerator / denominator`. */
function rational(price: string, quoteDecimals: number, baseDecimals: number): [bigint, bigint] {
  const [whole = "0", fraction = ""] = price.split(".");
  const n = BigInt(`${whole}${fraction}`);

  return [
    n * 10n ** BigInt(quoteDecimals),
    10n ** BigInt(fraction.length) * 10n ** BigInt(baseDecimals),
  ];
}
