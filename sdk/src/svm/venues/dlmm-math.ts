/**
 * Bin math shared by the bin-step DLMM venues (meteora-dlmm, saros-dlmm). Prices
 * are Q64.64 fixed point (64 fractional bits): a bin's price is
 * (1 + binStep / 10000) raised to the bin's exponent, and the amount
 * conversions below are at a bin's price.
 *
 * - swap for Y (X in, Y out): out from in is price times in; in from out is out divided by price
 * - swap for X (Y in, X out): out from in is in divided by price; in from out is price times out
 *
 * Every function here is awaiting a clean-room rewrite (see the specification
 * kept outside this repository).
 */

export type Rounding = "up" | "down";

/** Multiply `x` by `y` and divide by 2^64, rounded as asked. */
export function mulShr(_x: bigint, _y: bigint, _rounding: Rounding): bigint {
  throw new Error("clean-room rewrite pending");
}

/** Multiply `x` by 2^64 and divide by `y`, rounded as asked. */
export function shlDiv(_x: bigint, _y: bigint, _rounding: Rounding): bigint {
  throw new Error("clean-room rewrite pending");
}

/** `base` (a Q64.64 value) raised to the integer power `exp`, as a Q64.64 value; null where it cannot be represented. */
export function pow(_base: bigint, _exp: number): bigint | null {
  throw new Error("clean-room rewrite pending");
}

/** (1 + binStep / 10000) ^ exponent in Q64.64; null where it cannot be represented. */
export function binPrice(_exponent: number, _binStep: number): bigint | null {
  throw new Error("clean-room rewrite pending");
}

/** The amount received for `amountIn` paid into a bin at `price`. */
export function amountOut(
  _amountIn: bigint,
  _price: bigint,
  _swapForY: boolean,
  _rounding: Rounding,
): bigint {
  throw new Error("clean-room rewrite pending");
}

/** The amount that must be paid into a bin at `price` to receive `amountOutValue`. */
export function amountIn(
  _amountOutValue: bigint,
  _price: bigint,
  _swapForY: boolean,
  _rounding: Rounding,
): bigint {
  throw new Error("clean-room rewrite pending");
}
