/**
 * Bin math shared by the bin-step DLMM venues (meteora-dlmm, saros-dlmm). Prices
 * are Q64.64 fixed point (64 fractional bits): a bin's price is
 * (1 + binStep / 10000) raised to the bin's exponent, and the amount
 * conversions below are at a bin's price.
 *
 * - swap for Y (X in, Y out): out from in is price times in; in from out is out divided by price
 * - swap for X (Y in, X out): out from in is in divided by price; in from out is price times out
 */

export type Rounding = "up" | "down";

const SHIFT = 64n;
const ONE = 1n << SHIFT;
const LOW_MASK = ONE - 1n;
/** The largest unsigned 128-bit value; also the numerator of a Q64.64 reciprocal. */
const MAX_U128 = (1n << 128n) - 1n;
/** Exponents of this magnitude or more have more than 19 bits and are refused. */
const MAX_EXPONENT = 0x80000;
const BASIS_POINTS = 10000n;

/** Multiply `x` by `y` and divide by 2^64, rounded as asked. */
export function mulShr(x: bigint, y: bigint, rounding: Rounding): bigint {
  const product = x * y;
  const quotient = product >> SHIFT;
  return rounding === "up" && (product & LOW_MASK) !== 0n ? quotient + 1n : quotient;
}

/** Multiply `x` by 2^64 and divide by `y`, rounded as asked. */
export function shlDiv(x: bigint, y: bigint, rounding: Rounding): bigint {
  const numerator = x << SHIFT;
  const quotient = numerator / y;
  return rounding === "up" && numerator % y !== 0n ? quotient + 1n : quotient;
}

/** `base` (a Q64.64 value) raised to the integer power `exp`, as a Q64.64 value; null where it cannot be represented. */
export function pow(base: bigint, exp: number): bigint | null {
  if (exp === 0) return ONE;
  if (!Number.isInteger(exp) || Math.abs(exp) >= MAX_EXPONENT) return null;

  // Every product is taken on a factor below one, so a base of one or more is
  // replaced by its reciprocal and the result inverted back at the end. A
  // negative exponent inverts the result too; the two inversions cancel.
  let invert = exp < 0;
  let square = base;
  if (square >= ONE) {
    square = MAX_U128 / square;
    invert = !invert;
  }

  let result = ONE;
  for (let bits = Math.abs(exp); bits > 0; bits >>= 1) {
    if (bits & 1) {
      const product = result * square;
      if (product > MAX_U128) return null;
      result = product >> SHIFT;
    }
    if (bits > 1) {
      const product = square * square;
      if (product > MAX_U128) return null;
      square = product >> SHIFT;
    }
  }

  if (result === 0n) return null;
  if (!invert) return result;
  const inverse = MAX_U128 / result;
  return inverse > MAX_U128 ? null : inverse;
}

/** (1 + binStep / 10000) ^ exponent in Q64.64; null where it cannot be represented. */
export function binPrice(exponent: number, binStep: number): bigint | null {
  // Only an integer step converts to a bigint; any other step has no price.
  if (!Number.isInteger(binStep)) return null;
  const base = ONE + (BigInt(binStep) << SHIFT) / BASIS_POINTS;
  return pow(base, exponent);
}

/** The amount received for `amountIn` paid into a bin at `price`. */
export function amountOut(
  amountIn: bigint,
  price: bigint,
  swapForY: boolean,
  rounding: Rounding,
): bigint {
  return swapForY ? mulShr(price, amountIn, rounding) : shlDiv(amountIn, price, rounding);
}

/** The amount that must be paid into a bin at `price` to receive `amountOutValue`. */
export function amountIn(
  amountOutValue: bigint,
  price: bigint,
  swapForY: boolean,
  rounding: Rounding,
): bigint {
  return swapForY
    ? shlDiv(amountOutValue, price, rounding)
    : mulShr(amountOutValue, price, rounding);
}
