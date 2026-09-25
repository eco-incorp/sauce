/**
 * stabble-common.ts's `isqrtFloor` Newton-seed fix — no engine, no RPC.
 *
 * The production loop (stabble-common.ts:618-643) is unchanged EXCEPT the
 * starting seed: the old seed was `x = n` itself, which for the
 * ISCALE(1e18)-inflated ~110-130-bit operands `weightedPowUp`'s fractional-
 * exponent path (stabble-common.ts:666-676, reached by every pool whose
 * weight ratio is not an exact 1/2/3/4 integer power — i.e. every weighted
 * pool that is not exactly 50/50) actually feeds it needs ~55-70 slow
 * halving iterations before Newton's method converges. The new seed,
 * `1n << ceil(bits/2)` where `bits` is n's bit length, starts Newton's
 * method just above the true root and converges in ~5-8 iterations instead.
 *
 * BYTE-IDENTITY PROOF: the classical integer-Newton floor-sqrt loop is
 * monotonically non-increasing and converges to exactly floor(sqrt(n))
 * from ANY starting point >= floor(sqrt(n)) — the property this loop has
 * always relied on (the old `x = n` seed is trivially >= floor(sqrt(n)) for
 * n >= 1). The new seed is ALSO always >= floor(sqrt(n)): n's bit length
 * `bits` means n < 2^bits, so sqrt(n) < 2^(bits/2) <= 2^ceil(bits/2) = seed,
 * i.e. seed > sqrt(n) >= floor(sqrt(n)). So the RESULT is unchanged for
 * every n >= 0; only the iteration count drops. This file proves that
 * directly (test 1), proves the seed-bound invariant the proof rests on
 * (test 2), and measures the iteration-count drop (test 3) — a single wrong
 * seed that ever dipped below floor(sqrt(n)) would corrupt every consumer
 * (isqrtCeil, sqrtInternalCeil, weightedPowUp, weightedCalcOutGivenIn), so
 * this is treated as a math-primitive change, not a perf tweak.
 */
import {
  isqrtFloor,
  weightedCalcOutGivenIn,
  STABBLE_ONE,
} from "../../../src/svm/venues/stabble-common.js";

// ---- the OLD (pre-fix) implementation, inlined verbatim as the trusted
// reference every new-seed result is checked against. Do NOT "clean this
// up" to reuse the new isqrtFloor — its entire job is to be a SEPARATE,
// independently-seeded computation of the same floor(sqrt(n)).
function isqrtFloorOld(n: bigint): bigint {
  if (n < 0n) throw new Error(`isqrtFloor needs a non-negative value, got ${n}`);
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// Old/new implementations that also COUNT Newton iterations (one "iteration"
// = one evaluation of the (x + n/x)/2 recurrence, including the first one
// computed before the while loop even starts) — used only by the perf test.
function isqrtFloorOldCounting(n: bigint): { result: bigint; iters: number } {
  if (n < 2n) return { result: n, iters: 0 };
  let x = n;
  let y = (x + 1n) / 2n;
  let iters = 1;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
    iters++;
  }
  return { result: x, iters };
}
function isqrtFloorNewCounting(n: bigint): { result: bigint; iters: number } {
  if (n < 2n) return { result: n, iters: 0 };
  const bits = n.toString(2).length;
  let x = 1n << BigInt((bits + 1) >> 1);
  let y = (x + n / x) / 2n;
  let iters = 1;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
    iters++;
  }
  return { result: x, iters };
}

// Deterministic PRNG (mulberry32) so the random-operand cells below are
// reproducible across runs/CI without pulling in a test-only dependency.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A pseudo-random bigint with EXACTLY `bits` bits (top bit forced to 1). */
function randomBigIntOfBitLength(bits: number, rng: () => number): bigint {
  let n = 1n; // top bit
  for (let i = 1; i < bits; i++) {
    n = (n << 1n) | (rng() < 0.5 ? 0n : 1n);
  }
  return n;
}

// ---- realistic sqrtInternalCeil operands, constructed the same way
// weightedPowUp's own fractional-exponent loop constructs them
// (stabble-common.ts:654, :666-676: baseInternal = base*ISCALE_PER_ONE, then
// each round's operand is `cur * ISCALE`, cur re-seeded from the PREVIOUS
// round's isqrtCeil result). ISCALE/ISCALE_PER_ONE/POW_FRAC_BITS are not
// exported (they are file-local constants in stabble-common.ts); they are
// re-declared here at the same values purely to shape realistic test
// operands, not as a second implementation of the algorithm under test —
// every operand is fed straight into the REAL, imported `isqrtFloor`.
const ISCALE = 10n ** 18n;
const ISCALE_PER_ONE = ISCALE / STABBLE_ONE; // = 10n ** 9n
const POW_FRAC_BITS = 64;

function isqrtCeilRef(x: bigint): bigint {
  const f = isqrtFloor(x);
  return f * f < x ? f + 1n : f;
}

/** Every `n` passed to isqrtFloor by a real weightedPowUp(base, exponent) call whose exponent takes the general (fractional) path. */
function fractionalSqrtOperands(base: bigint, exponent: bigint): bigint[] {
  const frac = exponent % STABBLE_ONE;
  const baseInternal = base * ISCALE_PER_ONE;
  const operands: bigint[] = [];
  if (frac > 0n) {
    let cur = baseInternal;
    let fracRemaining = frac;
    for (let k = 0; k < POW_FRAC_BITS && fracRemaining > 0n; k++) {
      const operand = cur * ISCALE;
      operands.push(operand);
      cur = isqrtCeilRef(operand);
      fracRemaining *= 2n;
      if (fracRemaining >= STABBLE_ONE) fracRemaining -= STABBLE_ONE;
    }
  }
  return operands;
}

// Mainnet-plausible (weightIn, weightOut) pairs whose ratio is NOT an exact
// 1/2/3/4 power (so weightedPowUp's general fractional path — the one that
// actually calls isqrtFloor — is the one exercised): a 70/30 pool, a 60/40
// pool, and an 80/20 pool swapped from its minority side (all real Balancer-
// style weight splits), each probed at a range of realistic trade sizes
// (base = balanceIn/(balanceIn+amountIn), from a tiny ~0.1% trade to a large
// ~90% of the pool).
const MAINNET_WEIGHT_PAIRS: Array<{ weightIn: bigint; weightOut: bigint }> = [
  { weightIn: 700_000_000n, weightOut: 300_000_000n }, // 70/30
  { weightIn: 600_000_000n, weightOut: 400_000_000n }, // 60/40
  { weightIn: 200_000_000n, weightOut: 800_000_000n }, // 80/20, minority side in
];
const REALISTIC_BASES: bigint[] = [
  999_000_000n,
  950_000_000n,
  700_000_000n,
  500_000_000n,
  300_000_000n,
  100_000_000n,
  10_000_000n,
];

const REAL_WEIGHTEDPOWUP_OPERANDS: bigint[] = MAINNET_WEIGHT_PAIRS.flatMap(
  ({ weightIn, weightOut }) => {
    const exponent = (weightIn * STABBLE_ONE) / weightOut; // mirrors divDown(weightIn, weightOut)
    return REALISTIC_BASES.flatMap((base) => fractionalSqrtOperands(base, exponent));
  },
);

describe("stabble-common isqrtFloor — Newton seed fix", () => {
  describe("byte-identity: new seed produces the IDENTICAL floor(sqrt(n)) as the old seed, for every n", () => {
    it("every n in [0, 10000]", () => {
      for (let i = 0n; i <= 10000n; i++) {
        expect(isqrtFloor(i)).toBe(isqrtFloorOld(i));
      }
    });

    it("power-of-2 and 2^k±1 boundaries up to ~200 bits", () => {
      for (let k = 0; k <= 200; k++) {
        const p = 1n << BigInt(k);
        for (const n of [p - 1n, p, p + 1n]) {
          if (n < 0n) continue;
          expect(isqrtFloor(n)).toBe(isqrtFloorOld(n));
        }
      }
    });

    it("random 64/96/128/160-bit operands", () => {
      const rng = mulberry32(0xc0ffee);
      for (const bits of [64, 96, 128, 160]) {
        for (let i = 0; i < 200; i++) {
          const n = randomBigIntOfBitLength(bits, rng);
          expect(isqrtFloor(n)).toBe(isqrtFloorOld(n));
        }
      }
    });

    it("the ISCALE-inflated operands a real weightedPowUp(base, exponent) call actually produces", () => {
      expect(REAL_WEIGHTEDPOWUP_OPERANDS.length).toBeGreaterThan(0);
      for (const n of REAL_WEIGHTEDPOWUP_OPERANDS) {
        expect(isqrtFloor(n)).toBe(isqrtFloorOld(n));
      }
    });

    it("sanity: those real operands actually land in the ~110-130-bit range the fix targets", () => {
      const bitLengths = REAL_WEIGHTEDPOWUP_OPERANDS.map((n) => n.toString(2).length);
      const min = Math.min(...bitLengths);
      const max = Math.max(...bitLengths);
      expect(min).toBeGreaterThanOrEqual(90);
      expect(max).toBeLessThanOrEqual(140);
    });

    it("end-to-end: weightedCalcOutGivenIn (which routes through weightedPowUp -> sqrtInternalCeil -> isqrtFloor on its general path) is internally consistent for a realistic 70/30 pool trade", () => {
      // A 70/30 pool, balances at 9-decimal-scaled realistic magnitudes,
      // a 12% trade — exercises the exact call chain the fix sits under,
      // with no reference to swap out (isqrtFloor's own identity proof
      // above is what actually certifies this call chain's output is
      // unchanged by the fix).
      const balanceIn = 5_000_000_000_000n;
      const balanceOut = 8_000_000_000_000n;
      const amountIn = 600_000_000_000n;
      const out = weightedCalcOutGivenIn(
        balanceIn,
        700_000_000n,
        balanceOut,
        300_000_000n,
        amountIn,
      );
      expect(out).not.toBeNull();
      expect(out! > 0n).toBe(true);
      expect(out! < balanceOut).toBe(true);
    });
  });

  describe("seed-bound invariant: the new seed is always >= floor(sqrt(n))", () => {
    function seedFor(n: bigint): bigint {
      if (n < 2n) return n;
      const bits = n.toString(2).length;
      return 1n << BigInt((bits + 1) >> 1);
    }

    it("holds for every n in [0, 10000]", () => {
      for (let i = 0n; i <= 10000n; i++) {
        expect(seedFor(i) >= isqrtFloorOld(i)).toBe(true);
      }
    });

    it("holds at power-of-2 / 2^k±1 boundaries up to ~200 bits", () => {
      for (let k = 0; k <= 200; k++) {
        const p = 1n << BigInt(k);
        for (const n of [p - 1n, p, p + 1n]) {
          if (n < 0n) continue;
          expect(seedFor(n) >= isqrtFloorOld(n)).toBe(true);
        }
      }
    });

    it("holds for random 64/96/128/160-bit operands and the real weightedPowUp-derived operands", () => {
      const rng = mulberry32(0xfeedface);
      const ns: bigint[] = [...REAL_WEIGHTEDPOWUP_OPERANDS];
      for (const bits of [64, 96, 128, 160]) {
        for (let i = 0; i < 200; i++) ns.push(randomBigIntOfBitLength(bits, rng));
      }
      for (const n of ns) {
        expect(seedFor(n) >= isqrtFloorOld(n)).toBe(true);
      }
    });
  });

  describe("perf: the new seed converges in far fewer Newton iterations", () => {
    it("a single ~128-bit operand converges in ~5-8x fewer iterations, same result", () => {
      const n = (1n << 127n) + 123_456_789_012_345n; // a real ~128-bit magnitude, not a round power of 2
      const oldRun = isqrtFloorOldCounting(n);
      const newRun = isqrtFloorNewCounting(n);
      expect(newRun.result).toBe(oldRun.result);
      expect(newRun.result).toBe(isqrtFloor(n));

      console.log(
        `[isqrtFloor perf] 128-bit operand: old=${oldRun.iters} iters, new=${newRun.iters} iters (${(oldRun.iters / newRun.iters).toFixed(1)}x fewer)`,
      );
      expect(oldRun.iters).toBeGreaterThanOrEqual(55);
      expect(oldRun.iters).toBeLessThanOrEqual(75);
      expect(newRun.iters).toBeGreaterThanOrEqual(4);
      expect(newRun.iters).toBeLessThanOrEqual(9);
      expect(oldRun.iters / newRun.iters).toBeGreaterThanOrEqual(5);
    });

    it("holds on average across the real ISCALE-inflated weightedPowUp operands (~110-130 bits), not just one hand-picked value", () => {
      let oldTotal = 0;
      let newTotal = 0;
      for (const n of REAL_WEIGHTEDPOWUP_OPERANDS) {
        const oldRun = isqrtFloorOldCounting(n);
        const newRun = isqrtFloorNewCounting(n);
        expect(newRun.result).toBe(oldRun.result);
        oldTotal += oldRun.iters;
        newTotal += newRun.iters;
      }
      const oldAvg = oldTotal / REAL_WEIGHTEDPOWUP_OPERANDS.length;
      const newAvg = newTotal / REAL_WEIGHTEDPOWUP_OPERANDS.length;

      console.log(
        `[isqrtFloor perf] avg over ${REAL_WEIGHTEDPOWUP_OPERANDS.length} real weightedPowUp operands: old=${oldAvg.toFixed(1)} iters, new=${newAvg.toFixed(1)} iters (${(oldAvg / newAvg).toFixed(1)}x fewer)`,
      );
      expect(oldAvg / newAvg).toBeGreaterThanOrEqual(5);
    });
  });
});
