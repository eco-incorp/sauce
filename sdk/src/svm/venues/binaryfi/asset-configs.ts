/**
 * BinaryFi per-asset conservative floor-rate directory — see ./index.ts's
 * module header for WHY a flat, per-mint calibrated rate is used instead of a
 * reserve-ratio (constant-product) quote: on this venue the two are
 * PROVABLY unrelated (a naive CP-off-live-reserves model was measured
 * OVER-quoting a real trade by 6.77x — see that file), so there is no safe
 * general formula, only per-asset calibration against real fills.
 *
 * Each entry is `[floorRateNum, floorRateDen]`: a conservative, sub-real,
 * linear (assetOut-raw per quoteIn-raw) rate for THAT SPECIFIC asset mint,
 * quoted against ITS OWN quote mint (always USDC/USDT/wSOL per the family's
 * observed markets) — never portable to a different asset. A mint absent
 * from this table is UNCALIBRATED: `binaryfi.fetchPoolConfig` throws a named
 * error and the pool is dropped from discovery/universe (the per-market
 * "gate the rest out" shape), exactly like scorch's `SCORCH_ASSET_CONFIGS`
 * gates an unknown mint.
 *
 * CALIBRATION METHOD (98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g, market
 * `GWqUcqoZtjq8K6H48YvcHJMEGq8CahNDGMuz3iqU4ESA`, quote mint USDC): 5 REAL
 * mainnet swaps recovered via `getTransaction` on signatures that reference
 * the market's own vault-authority PDA (`GvwJ2x7h6C4VH9ozwxZ1cyUeGwK3Zt4axx61peDFmvJh`),
 * spanning an ~11-hour window and 4+ orders of magnitude of trade size
 * (amountIn 19 .. 879,398,527 raw quote units):
 *
 *   amountIn        amountOut        assetOut/quoteIn (raw)
 *   19              360              18.947
 *   20,129          384,063          19.081
 *   244,828,325     4,702,037,179    19.207
 *   600,000,000     10,934,473,483   18.224
 *   879,398,527     16,016,568,246   18.212  <- worst (lowest) observed
 *
 * The raw ratio is REMARKABLY stable (18.21-19.21, ~5.2% band) across trade
 * sizes and reserve states that vary by 5+ orders of magnitude — direct
 * proof the fill price is NOT reserve-driven (an oracle/keeper-fed reference
 * price, not a bonding curve). floorRateNum/floorRateDen below is the WORST
 * (lowest) observed ratio (18.212, from the largest probe) with an
 * additional ~62% haircut (kept deliberately far larger than the ~30%
 * margin used elsewhere in this file family, because here the uncertainty
 * is about a PRICE LEVEL that can drift arbitrarily over time, not a curve
 * SHAPE bounded by a known formula): 18.212 * 0.4 ~= 7.28, floored to 7.
 * Re-measure and re-pin (or widen the haircut) if this asset's real price
 * has plausibly moved since 2026-07-31.
 */
export const BINARYFI_ASSET_FLOOR_RATES: Readonly<Record<string, readonly [bigint, bigint]>> = {
  "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g": [7n, 1n],
};
