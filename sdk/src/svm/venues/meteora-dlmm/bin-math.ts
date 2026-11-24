/**
 * Meteora DLMM bin geometry and a bin's price. The price arithmetic is the
 * shared bin-step DLMM math in `../dlmm-math.ts`.
 *
 * A bin's price is a pure function of (bin id, bin step), so it does not drift
 * and is shipped as a prepare param. For a bin that has held liquidity it equals
 * the price stored in the bin account.
 */
import { binPrice } from "../dlmm-math.js";

export const SCALE_OFFSET = 64n;
export const ONE = 1n << 64n; // Q64.64 one
export const BASIS_POINT_MAX = 10_000n;
export const MAX_BIN_PER_ARRAY = 70;
export const MIN_BIN_ID = -443636;
export const MAX_BIN_ID = 443636;

/** A bin's price: (1 + binStep / 10000) ^ binId, in Q64.64. */
export function priceFromId(binId: number, binStep: number): bigint {
  if (!Number.isInteger(binId) || binId < MIN_BIN_ID || binId > MAX_BIN_ID) {
    throw new Error(`priceFromId: bin id ${binId} out of range`);
  }
  const price = binPrice(binId, binStep);
  if (price === null) throw new Error(`priceFromId: pow overflow for bin ${binId} step ${binStep}`);
  return price;
}

/** floor(bin_id / 70) — the bin array index (toward negative infinity). */
export function binArrayIndex(binId: number): number {
  return Math.floor(binId / MAX_BIN_PER_ARRAY);
}
