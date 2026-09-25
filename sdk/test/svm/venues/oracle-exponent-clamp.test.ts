/**
 * ECO-2310 (Octane round-2, M11): oracle-derived exponents are range-checked
 * before any `10n ** BigInt(...)`, for all three adapters that bake one.
 *
 * WHAT THE ATTACK ACTUALLY COSTS (measured on this repo's Node 22, not assumed —
 * it decides which fixtures matter):
 *
 *   10n ** 10_000_000n    computes in     ~0.5s
 *   10n ** 50_000_000n    computes in     ~2.2s
 *   10n ** 100_000_000n   still running after 20s (killed)
 *   10n ** 1_000_000_000n still running after 3s  (killed)
 *   10n ** 2_147_483_647n RangeError in    ~27ms   <- i32::MAX bails EARLY
 *
 * So the i32 EXTREMES are not the dangerous inputs: V8 rejects a result that
 * large on sight. The dangerous input is the MID-RANGE — an exponent around
 * 1e8 sails past V8's size check and burns the quoting thread for minutes.
 * That is why MID_RANGE_DOS below is a first-class fixture alongside the
 * extremes: an attacker picks 1e8, not i32::MAX. (The extremes still matter —
 * unguarded they surface an uncaught RangeError instead of a clean venue
 * self-drop — they are just not the availability hole.)
 *
 * NOTE ON REVERTING THE GUARD (the "can this test fail?" check): with the guard
 * removed, the just-out-of-range cases (±13) go RED normally. The MID_RANGE_DOS
 * cases instead HANG the jest worker rather than failing — which is precisely
 * the bug being fixed, since a blocked event loop cannot service a timeout.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import {
  ORACLE_EXPONENT_RANGES,
  PYTH_MAX_NUM_DECIMALS,
  assertOracleExponent,
} from "../../../src/svm/venues/oracle-exponent.js";
import { carrot } from "../../../src/svm/venues/carrot/index.js";
import { obricV2 } from "../../../src/svm/venues/obric-v2/index.js";
import type { ObricV2PoolConfig } from "../../../src/svm/venues/obric-v2/index.js";
import { fetchWoofiConfig } from "../../../src/svm/venues/woofi/index.js";
import { loadFixtures, fixtureLoader } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";
import { makeCarrotVault } from "../fixtures/carrot/synth.js";

const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
/** The exponent an attacker would actually choose — see the header's measurements. */
const MID_RANGE_DOS = 100_000_000;
const IN_RANGE = Object.freeze([-12, -8, -6, -3, -1, 0, 1, 3, 6, 8, 12]);

/** The pre-ECO-2310 expressions, transcribed verbatim from d3686430. */
const oldCarrotScale = (expo: number, decimals: number): bigint =>
  10n ** BigInt(18 + expo - decimals);
const oldFeedScale = (expo: number, decimalMult: bigint): { div: bigint; mul: bigint } =>
  expo < -3
    ? { div: 10n ** BigInt(-3 - expo), mul: decimalMult }
    : { div: 1n, mul: 10n ** BigInt(expo + 3) * decimalMult };
const oldWoofiPow = (expo: number): bigint => 10n ** BigInt(Math.abs(expo));

// ---------------------------------------------------------------------------
// The range table itself
// ---------------------------------------------------------------------------

describe("assertOracleExponent: the provider range table", () => {
  it("bounds both Pyth account formats at the oracle program's own MAX_NUM_DECIMALS", () => {
    expect(PYTH_MAX_NUM_DECIMALS).toBe(12);
    for (const provider of ["pyth-price-update-v2", "pyth-v2-price-account"] as const) {
      expect(ORACLE_EXPONENT_RANGES[provider].min).toBe(-12);
      expect(ORACLE_EXPONENT_RANGES[provider].max).toBe(12);
      // The number is cited, not invented — every row says where it came from.
      expect(ORACLE_EXPONENT_RANGES[provider].provenance).toMatch(/MAX_NUM_DECIMALS=12/);
    }
  });

  it.each(["pyth-price-update-v2", "pyth-v2-price-account"] as const)(
    "%s accepts the whole inclusive range and rejects one step past either end",
    (provider) => {
      for (let expo = -12; expo <= 12; expo++) {
        expect(() => assertOracleExponent(provider, expo, "ctx")).not.toThrow();
      }
      expect(() => assertOracleExponent(provider, -13, "ctx")).toThrow(/outside the supported/);
      expect(() => assertOracleExponent(provider, 13, "ctx")).toThrow(/outside the supported/);
    },
  );

  it.each([I32_MIN, I32_MAX, MID_RANGE_DOS, -MID_RANGE_DOS, 2_147_483_648, -2_147_483_649])(
    "rejects the extreme/mid-range exponent %i",
    (expo) => {
      expect(() => assertOracleExponent("pyth-price-update-v2", expo, "ctx")).toThrow(
        /outside the supported/,
      );
    },
  );

  it("rejects non-integers (NaN never silently passes a `<`/`>` pair)", () => {
    for (const bad of [NaN, 1.5, Infinity, -Infinity]) {
      expect(() => assertOracleExponent("pyth-price-update-v2", bad, "ctx")).toThrow(
        /outside the supported/,
      );
    }
  });

  it("is deterministic and actionable: same input, same message, naming caller context", () => {
    const call = () => assertOracleExponent("pyth-v2-price-account", I32_MIN, "venue X feed Y");
    expect(call).toThrow(
      "venue X feed Y: oracle exponent -2147483648 is outside the supported pyth-v2-price-account range [-12, 12] — refusing to raise 10 to an unvalidated oracle-controlled power",
    );
    let first = "";
    let second = "";
    try {
      call();
    } catch (e) {
      first = (e as Error).message;
    }
    try {
      call();
    } catch (e) {
      second = (e as Error).message;
    }
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// carrot — Pyth PriceUpdateV2, exponent folded into `CARROT_TARGET_SCALE + expo - decimals`
// ---------------------------------------------------------------------------

describe("carrot: oracle exponent clamp", () => {
  const vaultWith = (exponent: number, decimals = 6) =>
    makeCarrotVault([{ assetId: 0, decimals, exponent }]);

  it("normal price: a live-shaped feed (expo -8, 6-decimal asset) still scales to 1e4", async () => {
    const { pool, load } = vaultWith(-8);
    const cfg = await carrot.fetchPoolConfig(load, pool);
    expect(cfg.assets).toHaveLength(1);
    expect(cfg.assets[0]!.scale).toBe(10_000n);
    expect(cfg.assets[0]!.priceSnapshot).toBe(100_000_000n);
  });

  it("every in-range exponent is byte-identical to the pre-guard formula (both signs)", async () => {
    for (const exponent of IN_RANGE) {
      const { pool, load } = vaultWith(exponent);
      const cfg = await carrot.fetchPoolConfig(load, pool);
      expect(cfg.assets[0]!.scale).toBe(oldCarrotScale(exponent, 6));
    }
  });

  it("accepts the exact boundaries -12 and +12", async () => {
    const lo = vaultWith(-12);
    await expect(carrot.fetchPoolConfig(lo.load, lo.pool)).resolves.toBeDefined();
    const hi = vaultWith(12);
    const cfg = await carrot.fetchPoolConfig(hi.load, hi.pool);
    expect(cfg.assets[0]!.scale).toBe(10n ** 24n);
  });

  it.each([-13, 13, MID_RANGE_DOS, -MID_RANGE_DOS, I32_MAX, I32_MIN])(
    "self-drops the whole vault on out-of-range exponent %i",
    async (exponent) => {
      const { pool, load } = vaultWith(exponent);
      await expect(carrot.fetchPoolConfig(load, pool)).rejects.toThrow(
        /oracle exponent .* is outside the supported pyth-price-update-v2 range \[-12, 12\]/,
      );
    },
  );

  it("names the offending asset and oracle account in the error", async () => {
    const { pool, load, accounts } = vaultWith(I32_MAX);
    const oracle = [...accounts.keys()].find((a) => accounts.get(a)!.length === 134)!;
    await expect(carrot.fetchPoolConfig(load, pool)).rejects.toThrow(
      new RegExp(`carrot vault ${pool}: asset 0 oracle ${oracle}`),
    );
  });

  it("i32::MIN now fails on the EXPONENT, not incidentally on the negative-scale check", async () => {
    // Pre-change, i32::MIN happened to be caught by `scaleExp < 0` — correct outcome,
    // misleading message, and pure luck: i32::MAX had no such backstop. Both extremes
    // now report the real cause.
    const { pool, load } = vaultWith(I32_MIN);
    await expect(carrot.fetchPoolConfig(load, pool)).rejects.toThrow(/oracle exponent/);
    await expect(carrot.fetchPoolConfig(load, pool)).rejects.not.toThrow(
      /CARROT_TARGET_SCALE too small/,
    );
  });

  it("leaves the pre-existing negative-scale check intact for an IN-range exponent", async () => {
    // expo -12 with an 18-decimal asset is a legitimate Pyth exponent that this
    // vault's target scale genuinely cannot express — a different, still-live error.
    const { pool, load } = vaultWith(-12, 18);
    await expect(carrot.fetchPoolConfig(load, pool)).rejects.toThrow(
      /negative implied scale exponent -12 .* CARROT_TARGET_SCALE too small/,
    );
  });

  it("does not harden the bounded token-decimal field: decimals 0..255 all resolve", async () => {
    for (const decimals of [0, 1, 18, 255]) {
      const { pool, load } = vaultWith(12, decimals);
      if (18 + 12 - decimals < 0) continue;
      const cfg = await carrot.fetchPoolConfig(load, pool);
      expect(cfg.assets[0]!.scale).toBe(oldCarrotScale(12, decimals));
    }
  });
});

// ---------------------------------------------------------------------------
// obric-v2 — legacy Pyth v2 price account, expo @20, exponentiated in BOTH feedScale branches
// ---------------------------------------------------------------------------

describe("obric-v2: oracle exponent clamp", () => {
  const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/obric-v2");
  const POOL = address("AJ5HfGY32igLgUbDtfNRdrkjTSYkCVKdhmnFFfcZMJ1E");
  /** Both mints are 6-decimal, so decimalMult is 1 on each side (asserted below). */
  const DEC_MULT = 1n;

  let baseline: ObricV2PoolConfig;
  beforeAll(async () => {
    baseline = (await obricV2.fetchPoolConfig(
      fixtureLoader(loadFixtures(FIXTURES)),
      POOL,
    )) as ObricV2PoolConfig;
  });

  /** The aj5-* fixtures with one feed's i32 expo @20 overwritten. */
  function withExpo(feed: string, expo: number): AccountFixture[] {
    return loadFixtures(FIXTURES).map((f) => {
      if (f.address !== feed) return f;
      const buf = Buffer.from(f.base64Data, "base64");
      buf.writeInt32LE(expo, 20);
      return { ...f, base64Data: buf.toString("base64") };
    });
  }

  const resolveWith = (feed: string, expo: number) =>
    obricV2.fetchPoolConfig(
      fixtureLoader(withExpo(feed, expo)),
      POOL,
    ) as Promise<ObricV2PoolConfig>;

  it("normal price: the untouched mainnet fixture (expo -8) is unchanged", () => {
    expect(baseline.divX).toBe(100_000n); // 10^(-3 - -8)
    expect(baseline.mulX).toBe(DEC_MULT);
    expect(baseline.divY).toBe(100_000n);
    expect(baseline.mulY).toBe(DEC_MULT);
  });

  it("every in-range exponent is byte-identical to the pre-guard formula, on BOTH branches", async () => {
    for (const expo of IN_RANGE) {
      const cfg = await resolveWith(baseline.feedX, expo);
      const expected = oldFeedScale(expo, DEC_MULT);
      expect({ div: cfg.divX, mul: cfg.mulX }).toEqual(expected);
      // The untouched Y feed must not move.
      expect({ div: cfg.divY, mul: cfg.mulY }).toEqual({ div: baseline.divY, mul: baseline.mulY });
    }
  });

  it("covers both sides of the expo < -3 branch point exactly", async () => {
    const below = await resolveWith(baseline.feedX, -4);
    expect({ div: below.divX, mul: below.mulX }).toEqual({ div: 10n, mul: 1n });
    const at = await resolveWith(baseline.feedX, -3);
    expect({ div: at.divX, mul: at.mulX }).toEqual({ div: 1n, mul: 1n });
  });

  it("accepts the exact boundaries -12 and +12", async () => {
    const lo = await resolveWith(baseline.feedX, -12);
    expect({ div: lo.divX, mul: lo.mulX }).toEqual({ div: 10n ** 9n, mul: 1n });
    const hi = await resolveWith(baseline.feedX, 12);
    expect({ div: hi.divX, mul: hi.mulX }).toEqual({ div: 1n, mul: 10n ** 15n });
  });

  it.each([-13, 13, MID_RANGE_DOS, -MID_RANGE_DOS, I32_MAX, I32_MIN])(
    "self-drops the pool on feed X exponent %i",
    async (expo) => {
      await expect(resolveWith(baseline.feedX, expo)).rejects.toThrow(
        /oracle exponent .* is outside the supported pyth-v2-price-account range \[-12, 12\]/,
      );
    },
  );

  it.each([-13, 13, MID_RANGE_DOS, I32_MAX, I32_MIN])(
    "self-drops the pool on feed Y exponent %i (the second feed is gated too)",
    async (expo) => {
      await expect(resolveWith(baseline.feedY, expo)).rejects.toThrow(
        /feed Y .*outside the supported pyth-v2-price-account range/,
      );
    },
  );

  it("names which feed is bad, not just the pool", async () => {
    await expect(resolveWith(baseline.feedX, I32_MIN)).rejects.toThrow(
      new RegExp(`obric-v2 pool ${POOL} feed X ${baseline.feedX}`),
    );
  });
});

// ---------------------------------------------------------------------------
// woofi — Pyth PriceUpdateV2 quote feed, `10n ** BigInt(Math.abs(quoteExpo))`
// ---------------------------------------------------------------------------

describe("woofi: oracle exponent clamp", () => {
  const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/woofi");
  const POOL = address("BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs");
  /** PriceUpdateV2 exponent i32 @89 (the adapter's OFF_PYTH_EXPONENT). */
  const EXPO_OFF = 89;

  let baseline: Awaited<ReturnType<typeof fetchWoofiConfig>>;
  beforeAll(async () => {
    baseline = await fetchWoofiConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL);
  });

  function withQuoteExpo(expo: number): AccountFixture[] {
    return loadFixtures(FIXTURES).map((f) => {
      if (f.address !== baseline.priceUpdateQuote) return f;
      const buf = Buffer.from(f.base64Data, "base64");
      buf.writeInt32LE(expo, EXPO_OFF);
      return { ...f, base64Data: buf.toString("base64") };
    });
  }

  const resolveWith = (expo: number) => fetchWoofiConfig(fixtureLoader(withQuoteExpo(expo)), POOL);

  it("normal price: the untouched mainnet fixture (expo -8) is unchanged", () => {
    expect(baseline.pythQuoteDecPow).toBe(100_000_000n);
  });

  it("every in-range exponent is byte-identical to the pre-guard formula (both signs)", async () => {
    for (const expo of IN_RANGE) {
      const cfg = await resolveWith(expo);
      expect(cfg.pythQuoteDecPow).toBe(oldWoofiPow(expo));
    }
  });

  it("accepts the exact boundaries -12 and +12 (abs collapses both to 1e12)", async () => {
    expect((await resolveWith(-12)).pythQuoteDecPow).toBe(10n ** 12n);
    expect((await resolveWith(12)).pythQuoteDecPow).toBe(10n ** 12n);
  });

  it.each([-13, 13, MID_RANGE_DOS, -MID_RANGE_DOS, I32_MAX, I32_MIN])(
    "self-drops the pool on quote exponent %i",
    async (expo) => {
      await expect(resolveWith(expo)).rejects.toThrow(
        /oracle exponent .* is outside the supported pyth-price-update-v2 range \[-12, 12\]/,
      );
    },
  );

  it("i32::MIN is rejected despite Math.abs making it look ordinary", async () => {
    // Math.abs(-2147483648) === 2147483648 — a perfectly valid JS number that
    // reaches `10n ** 2147483648n` intact. The sign trick is not a bound.
    expect(Math.abs(I32_MIN)).toBe(2_147_483_648);
    expect(Number.isSafeInteger(Math.abs(I32_MIN))).toBe(true);
    await expect(resolveWith(I32_MIN)).rejects.toThrow(/oracle exponent -2147483648/);
  });

  it("names the quote price-update account in the error", async () => {
    await expect(resolveWith(I32_MAX)).rejects.toThrow(
      new RegExp(`woofi pool ${POOL} quote price-update ${baseline.priceUpdateQuote}`),
    );
  });

  it("does not harden the bounded token-decimal fields — they stay exactly as decoded", async () => {
    const cfg = await resolveWith(-8);
    expect(cfg.priceDec).toBe(baseline.priceDec);
    expect(cfg.quoteDec).toBe(baseline.quoteDec);
    expect(cfg.baseDec).toBe(baseline.baseDec);
    expect([cfg.priceDec, cfg.quoteDec, cfg.baseDec]).toEqual([
      100_000_000n,
      1_000_000n,
      1_000_000_000n,
    ]);
  });
});
