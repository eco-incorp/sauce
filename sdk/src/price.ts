/**
 * A human price — "2,700 USDC per WETH" — as the `sqrtPriceX96` a Uniswap V3 or V4 pool (or one of
 * their forks: PancakeSwap V3, Aerodrome Slipstream, Algebra) stores and takes as a swap's price
 * limit, and back.
 *
 * A pool's price is token1 per token0 in base units, token0 being the lower address (in V4, the
 * lower currency); `sqrtPriceX96 = floor(sqrt(price) * 2^96)`. The conversion is exact integer
 * arithmetic, with no float anywhere, so it runs the same in Node and a browser.
 */

/** The two tokens a price is quoted in, and which of them is the pool's token0. */
export interface PoolPriceTokens {
  /** Decimals of the token the price is per one of: WETH, in "2,700 USDC per WETH". */
  readonly baseDecimals: number;
  /** Decimals of the token the price is in: USDC, in "2,700 USDC per WETH". */
  readonly quoteDecimals: number;
  /** Whether the base token is the pool's token0: the lower of the two addresses. */
  readonly baseIsToken0: boolean;
}

/** The bounds a V3 or V4 pool's price is held within: `TickMath.MIN_SQRT_RATIO` and `MAX_SQRT_RATIO`. */
export const MIN_SQRT_PRICE_X96 = 4295128739n;
export const MAX_SQRT_PRICE_X96 = 1461446703485210103287273052203988822378723970342n;

const Q192 = 1n << 192n;

/** A non-negative decimal (`"2700"`, `"0.00037"`, `"1.5e3"`, `2700`, `2700n`) as `numerator / 10^scale`. */
function decimal(value: string | number | bigint, what: string): { n: bigint; scale: bigint } {
  if (typeof value === "bigint") {
    if (value < 0n) throw new RangeError(`${what}: ${value} is negative`);

    return { n: value, scale: 0n };
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError(`${what}: ${value} is not a finite number`);
  }
  const text = String(value).trim();
  const match = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match === null || (match[1] === "" && (match[2] ?? "") === "")) {
    throw new RangeError(`${what}: '${text}' is not a non-negative decimal number`);
  }
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const n = BigInt(`${whole}${fraction}` || "0");
  const scale = BigInt(fraction.length) - BigInt(exponent);

  return scale >= 0n ? { n, scale } : { n: n * 10n ** -scale, scale: 0n };
}

function digits(decimals: number, what: string): bigint {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`${what}: ${decimals} is not a token's decimals (an integer, 0 to 255)`);
  }

  return BigInt(decimals);
}

/** `floor(sqrt(value))`, by Newton's method. */
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

/**
 * The `sqrtPriceX96` of a pool trading at `price` units of the quote token per one base token, in
 * whole tokens: 2,700 USDC per WETH is `sqrtPriceX96FromPrice("2700", { baseDecimals: 18,
 * quoteDecimals: 6, baseIsToken0 })`. Rounded down. Throws a `RangeError` for a price a pool cannot
 * hold, outside [`MIN_SQRT_PRICE_X96`, `MAX_SQRT_PRICE_X96`).
 *
 * As a swap's price limit it bounds both directions: selling token0 moves the pool's price down, so
 * the limit is a floor; selling token1 moves it up, so the limit is a ceiling.
 */
export function sqrtPriceX96FromPrice(
  price: string | number | bigint,
  tokens: PoolPriceTokens,
): bigint {
  const { n, scale } = decimal(price, "price");
  if (n === 0n) throw new RangeError("price: a pool's price is never zero");
  const base = 10n ** digits(tokens.baseDecimals, "baseDecimals");
  const quote = 10n ** digits(tokens.quoteDecimals, "quoteDecimals");
  const ten = 10n ** scale;
  // Base units of token1 per base unit of token0, times 2^192.
  const scaled = tokens.baseIsToken0
    ? (n * quote * Q192) / (ten * base)
    : (ten * base * Q192) / (n * quote);
  const sqrtPriceX96 = sqrtFloor(scaled);
  if (sqrtPriceX96 < MIN_SQRT_PRICE_X96 || sqrtPriceX96 >= MAX_SQRT_PRICE_X96) {
    throw new RangeError(
      `price: ${String(price)} is a sqrtPriceX96 of ${sqrtPriceX96}, outside the range a pool can ` +
        `hold [${MIN_SQRT_PRICE_X96}, ${MAX_SQRT_PRICE_X96})`,
    );
  }

  return sqrtPriceX96;
}

/**
 * The price a pool at `sqrtPriceX96` trades at, in quote tokens per one base token as a decimal
 * string: the inverse of {@link sqrtPriceX96FromPrice}. Rounded to `fractionDigits` decimal places
 * (default 18), half up, without trailing zeros.
 */
export function priceFromSqrtPriceX96(
  sqrtPriceX96: bigint,
  tokens: PoolPriceTokens,
  options: { readonly fractionDigits?: number } = {},
): string {
  if (sqrtPriceX96 <= 0n) throw new RangeError("sqrtPriceX96: a pool's price is never zero");
  const places = digits(options.fractionDigits ?? 18, "fractionDigits");
  const base = 10n ** digits(tokens.baseDecimals, "baseDecimals");
  const quote = 10n ** digits(tokens.quoteDecimals, "quoteDecimals");
  const square = sqrtPriceX96 * sqrtPriceX96;
  // Quote per base in whole tokens, as numerator / denominator.
  const [numerator, denominator] = tokens.baseIsToken0
    ? [square * base, Q192 * quote]
    : [Q192 * base, square * quote];
  const unit = 10n ** places;
  const rounded = (2n * numerator * unit + denominator) / (2n * denominator);
  const whole = rounded / unit;
  const fraction = (rounded % unit).toString().padStart(Number(places), "0").replace(/0+$/, "");

  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}
