/**
 * Raydium CLMM tick math — exact transcription of
 * raydium-clmm/programs/amm/src/libraries/tick_math.rs `get_sqrt_price_at_tick`:
 * the STANDARD Uniswap-V3 magic-constant ladder, but emitting a Q64.64
 * sqrt price directly (each factor is `2^64 / 1.0001^(2^(i-1))`, accumulated
 * with `(ratio * magic) >> 64`, then reciprocated as `(2^128 - 1) / ratio`
 * for positive ticks). This is NOT Orca's whirlpool table — Raydium's
 * MAX_SQRT_PRICE (79226673521066979257578248091) differs from Orca's
 * (79226673515401279992447579055), so the two families need separate math.
 *
 * Verified against the source's pinned bounds AND the live SOL/USDC 0.04%
 * pool 3ucNos4N... (tick 0 -> 2^64; tick -25007 -> 5283561491725923125,
 * just below the pool's live mid-tick sqrt 5283759320557551589).
 *
 * Used ONLY off-chain (prepare + the mirror): a shipped boundary's sqrt price
 * is drift-invariant (a pure function of the PDA-pinned tick), so the in-VM
 * fragment never recomputes it (an in-VM bit ladder is unaffordable).
 */

export const MIN_TICK = -443636;
export const MAX_TICK = 443636;
export const MIN_SQRT_PRICE_X64 = 4_295_048_016n;
export const MAX_SQRT_PRICE_X64 = 79_226_673_521_066_979_257_578_248_091n;

/** `2^64 / 1.0001^(2^(i-1))` for i in 0..19 (tick_math.rs magic factors). */
const MAGIC: readonly bigint[] = [
  0xfffcb933bd6fb800n,
  0xfff97272373d4000n,
  0xfff2e50f5f657000n,
  0xffe5caca7e10f000n,
  0xffcb9843d60f7000n,
  0xff973b41fa98e800n,
  0xff2ea16466c9b000n,
  0xfe5dee046a9a3800n,
  0xfcbe86c7900bb000n,
  0xf987a7253ac65800n,
  0xf3392b0822bb6000n,
  0xe7159475a2caf000n,
  0xd097f3bdfd2f2000n,
  0xa9f746462d9f8000n,
  0x70d869a156f31c00n,
  0x31be135f97ed3200n,
  0x9aa508b5b85a500n,
  0x5d6af8dedc582cn,
  0x2216e584f5fan,
];
const Q64 = 1n << 64n;
const U128_MAX = (1n << 128n) - 1n;

/** sqrt_price_from_tick_index (Q64.64) over the UNBIASED tick. */
export function raydiumSqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`raydiumSqrtPriceAtTick: tick ${tick} out of range`);
  }
  const abs = BigInt(Math.abs(tick));
  let ratio = (abs & 1n) !== 0n ? MAGIC[0] : Q64;
  for (let i = 1; i < MAGIC.length; i++) {
    if ((abs & (1n << BigInt(i))) !== 0n) ratio = (ratio * MAGIC[i]) >> 64n;
  }
  return tick > 0 ? U128_MAX / ratio : ratio;
}
