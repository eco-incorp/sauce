/**
 * `sauce price`: a human price for a pair as the numbers a swap program takes — the pool's
 * `sqrtPriceX96` for that pair on the chain, which is also the swap's price limit, and the
 * average-price floor a program compares a fill against (`out * 1e18 >= minAvgPrice * spent`), for
 * selling the base token and for buying it.
 *
 * The conversion is the SDK's own (`price.ts`); this adds only the chain's token order and decimals,
 * from the registry `sauce globals` lists. Nothing here reads a network.
 */
import { getAddress, isAddress, type Address } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
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

  return {
    text: [
      `${price} ${quote.symbol} per ${base.symbol} on ${chain.slug}`,
      row(token0, "token0"),
      row(token1, "token1"),
      `sqrtPriceX96  ${sqrtPriceX96}`,
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
    json: {
      chain: chain.slug,
      price,
      base,
      quote,
      token0: token0.symbol,
      token1: token1.symbol,
      sqrtPriceX96: sqrtPriceX96.toString(),
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
