/**
 * Meteora DLMM bin math — exact transcription of the lb_clmm program's price
 * and amount conversions (github.com/MeteoraAg/dlmm-sdk commons/src/math/
 * {price_math,u64x64_math,u128x128_math}.rs, commons/src/extensions/bin.rs).
 *
 * A bin's PRICE is `(1 + bin_step/10000)^bin_id` in Q64.64 fixed point
 * (get_price_from_id → pow), a pure function of (bin_id, bin_step) — so it is
 * DRIFT-INVARIANT and shipped as a prepare param (the in-VM fragment never
 * runs the pow). `get_or_store_bin_price` lazily fills a bin's stored price
 * with exactly this value, so the shipped price also equals the live stored
 * field for any bin that has ever held liquidity.
 *
 * Amount conversions (SCALE_OFFSET = 64):
 * - swap_for_y (X in, Y out): out = round(price·x / 2^64); in = round(y·2^64 / price)
 * - !swap_for_y (Y in, X out): out = round(x·2^64 / price); in = round(y·price / 2^64)
 *
 * Verified against the live SOL/USDC bin_step=4 pair 5rCf1DM8... — the shipped
 * pow price equals the stored bin.price on every liquid fixture bin.
 */

export const SCALE_OFFSET = 64n;
export const ONE = 1n << 64n; // Q64.64 one
export const BASIS_POINT_MAX = 10_000n;
export const MAX_BIN_PER_ARRAY = 70;
export const MIN_BIN_ID = -443636;
export const MAX_BIN_ID = 443636;
const MAX_EXPONENTIAL = 0x80000; // 1048576
const U128_MAX = (1n << 128n) - 1n;

export type Rounding = "up" | "down";

/** mul_div(x, y, d, rounding) — round(x·y/d). */
function mulDiv(x: bigint, y: bigint, d: bigint, rounding: Rounding): bigint {
  const p = x * y;
  return rounding === "up" ? (p + d - 1n) / d : p / d;
}

/** mul_shr(x, y, 64, rounding) = round(x·y / 2^64). */
export function mulShr(x: bigint, y: bigint, rounding: Rounding): bigint {
  return mulDiv(x, y, ONE, rounding);
}

/** shl_div(x, y, 64, rounding) = round(x·2^64 / y). */
export function shlDiv(x: bigint, y: bigint, rounding: Rounding): bigint {
  return mulDiv(x, ONE, y, rounding);
}

/**
 * pow(base, exp) in Q64.64 — the u64x64_math.rs binary-exponentiation with
 * per-step `>> 64`, the reciprocal trick for base >= ONE, and the final invert
 * for negative exponents. Returns null on the venue's overflow/exp-cap aborts.
 */
export function pow(base: bigint, exp: number): bigint | null {
  let invert = exp < 0;
  if (exp === 0) return ONE;
  const e = Math.abs(exp);
  if (e >= MAX_EXPONENTIAL) return null;

  let squaredBase = base;
  let result = ONE;
  if (squaredBase >= result) {
    squaredBase = U128_MAX / squaredBase;
    invert = !invert;
  }
  const step = (bit: number): boolean => {
    if ((e & bit) > 0) {
      result = (result * squaredBase) >> 64n;
      if (result > U128_MAX) return false;
    }
    return true;
  };
  // bit 0 uses the initial squaredBase; then square before each subsequent bit.
  if (!step(0x1)) return null;
  for (let bit = 0x2; bit <= 0x40000; bit <<= 1) {
    squaredBase = (squaredBase * squaredBase) >> 64n;
    if (squaredBase > U128_MAX) return null;
    if (!step(bit)) return null;
  }
  if (result === 0n) return null;
  if (invert) result = U128_MAX / result;
  return result;
}

/** get_price_from_id(bin_id, bin_step): (1 + bin_step/1e4)^bin_id in Q64.64. */
export function priceFromId(binId: number, binStep: number): bigint {
  if (!Number.isInteger(binId) || binId < MIN_BIN_ID || binId > MAX_BIN_ID) {
    throw new Error(`priceFromId: bin id ${binId} out of range`);
  }
  const bps = (BigInt(binStep) << SCALE_OFFSET) / BASIS_POINT_MAX;
  const base = ONE + bps;
  const price = pow(base, binId);
  if (price === null) throw new Error(`priceFromId: pow overflow for bin ${binId} step ${binStep}`);
  return price;
}

/** get_amount_out(amount_in, price, swap_for_y, rounding). */
export function amountOut(
  amountIn: bigint,
  price: bigint,
  swapForY: boolean,
  rounding: Rounding,
): bigint {
  return swapForY ? mulShr(price, amountIn, rounding) : shlDiv(amountIn, price, rounding);
}

/** get_amount_in(amount_out, price, swap_for_y, rounding). */
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

/** floor(bin_id / 70) — the bin array index (toward negative infinity). */
export function binArrayIndex(binId: number): number {
  return Math.floor(binId / MAX_BIN_PER_ARRAY);
}
