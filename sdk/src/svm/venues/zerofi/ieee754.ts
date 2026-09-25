/**
 * IEEE-754 binary64 -> baked integer-scale reduction, shared by index.ts
 * (fetchPoolConfig, which runs this once per pool against the fetched
 * oracle bytes) and ladder.ts (the on-chain fragment + its TS reference
 * mirror). See ladder.ts's module doc for the full derivation and why this
 * is necessary (the SVM target's arithmetic is pure-integer; the Wildcard
 * oracle stores price as a real f64).
 *
 * Split into its own file (not index.ts or ladder.ts) purely to avoid a
 * cross-import between those two — both need it, neither owns it.
 */

/** 2^52 - 1 (52-bit mantissa mask, IEEE-754 binary64). */
export const MANTISSA_MASK = 4_503_599_627_370_495n;
/** 2^52 (the implicit leading mantissa bit, restored before use). */
export const IMPLICIT_BIT = 4_503_599_627_370_496n;

/**
 * Decode an IEEE-754 binary64 bit pattern into the ladder's baked constants
 * for ONE pool: `bakedTop` (compared live on-chain every cook), `shiftPre`
 * (a mantissa right-shift, FLOOR-only — never inflates the decoded price),
 * and the canonical (num, den) rational such that, for any LIVE bit
 * pattern whose top 12 bits (sign + biased exponent) still equal
 * `bakedTop`:
 *
 *   liveMantissa = (liveBits & MANTISSA_MASK) | IMPLICIT_BIT
 *   reduced      = liveMantissa >> shiftPre
 *   price       ≈ reduced * num / den            (mintA -> mintB direction)
 *   price       ≈ num / (reduced * den)          (mintB -> mintA direction, exact reciprocal)
 *
 * already folding the 2^(exponent-1075) term AND the mintA/mintB decimals
 * difference, gcd-reduced so the on-chain fragment's live multiply/divide
 * never needs to carry more than ~53 live mantissa bits through a plain
 * `*`/`/` (see ladder.ts's module doc for why that matters).
 */
export function ieee754ScaleParams(
  rawBits: bigint,
  decimalsA: number,
  decimalsB: number,
): { bakedTop: bigint; shiftPre: bigint; num: bigint; den: bigint } {
  const top = rawBits >> 52n;
  if (top === 0n || top >= 0x800n) {
    throw new Error(
      `zerofi oracle price bit pattern 0x${rawBits.toString(16)} is subnormal/zero/negative/NaN-range`,
    );
  }
  const sShiftFull = 1075n - top;
  if (sShiftFull < 0n) {
    throw new Error(
      `zerofi oracle price bit pattern 0x${rawBits.toString(16)} implies a value >= 2^53 (unexpected)`,
    );
  }
  const shiftPre = sShiftFull > 63n ? sShiftFull - 63n : 0n;
  const sShiftRemaining = sShiftFull - shiftPre;
  const d = decimalsB - decimalsA;
  let num = d >= 0 ? 10n ** BigInt(d) : 1n;
  let den = (d >= 0 ? 1n : 10n ** BigInt(-d)) * (1n << sShiftRemaining);
  const g = gcd(num, den);
  num /= g;
  den /= g;
  return { bakedTop: top, shiftPre, num, den };
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}
