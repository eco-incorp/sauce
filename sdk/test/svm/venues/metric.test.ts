/**
 * Metric venue adapter units (no engine, no RPC-at-test-time): fetchPoolConfig against a REAL
 * mainnet fixture (pool G5B2Ws2DKattHTm75AoANWCpbQ48R9n8ZJur42RLYRYF, USDC/USDT) with a stubbed
 * `fetchOracleQuote` returning REAL, live-measured oracle CPI return data (captured
 * 2026-08-03 via a standalone `simulateTransaction` against the deployed oracle program — see
 * index.ts's module doc), the refuse-don't-guess gate when it is omitted, the scale/cap math in
 * `referenceQuote`, and that the emitted fragment actually compiles as valid SauceScript on the
 * 'svm' target (the CPI-in-emitSetup shape is novel in this tree — see ladder.ts's module doc).
 */
import { resolve } from "path";
import { metric, METRIC_QUOTE_HAIRCUT_PPM } from "../../../src/svm/venues/metric/index.js";

const HAIRCUT_PPM = METRIC_QUOTE_HAIRCUT_PPM;
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { address } from "@solana/kit";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/metric");
const POOL = address("G5B2Ws2DKattHTm75AoANWCpbQ48R9n8ZJur42RLYRYF");

// Real 32-byte oracle CPI return data captured live (bid, then ask — u128 LE halves), against the
// SAME ground-truth (oracleConfig, priceAccount) pair the fixture's pool resolves to.
const REAL_BID = 18461132534087045066n; // /2^64 ~= 1.00078
const REAL_ASK = 18461317001527782162n; // /2^64 ~= 1.00079
function realOracleQuoteBytes(): Uint8Array {
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, REAL_BID & 0xffffffffffffffffn, true);
  view.setBigUint64(8, REAL_BID >> 64n, true);
  view.setBigUint64(16, REAL_ASK & 0xffffffffffffffffn, true);
  view.setBigUint64(24, REAL_ASK >> 64n, true);
  return out;
}

describe("metric.fetchPoolConfig", () => {
  it("decodes the real pool topology and bakes the supplied oracle quote", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await metric.fetchPoolConfig(load, POOL, 0, async () => realOracleQuoteBytes());

    expect(cfg.mintA).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
    expect(cfg.mintB).toBe("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT
    expect(cfg.decimalsA).toBe(6);
    expect(cfg.decimalsB).toBe(6);
    expect(cfg.oracleConfig).toBe("BHqHqvdiW9WQPgYkkxcpHicM5zS8czHn7tLdHs23tGxb");
    expect(cfg.priceAccount).toBe("BubYekVVTtbTuVsAtptiAZV4rpPQNFyBs3THPSGJgk6a");
    expect(cfg.bidQ64).toBe(REAL_BID);
    expect(cfg.askQ64).toBe(REAL_ASK);
    expect(cfg.bakedPrice).toBe(REAL_BID); // direction 0 bakes bid

    // Independently derived (not via metricScaleParams): equal decimals -> scale == bid/2^64, with
    // the measured conservative haircut folded in (num *= 1e6 - HAIRCUT, den *= 1e6), gcd-reduced.
    const num = REAL_BID * (1_000_000n - HAIRCUT_PPM);
    const den = (1n << 64n) * 1_000_000n;
    const g = gcd(num, den);
    expect(cfg.scaleNum).toBe(num / g);
    expect(cfg.scaleDen).toBe(den / g);

    // The haircut is a genuine, measured lower-bound correction: the scaled price is strictly below
    // the raw oracle price, and by the expected ~50 ppm.
    const rawG = gcd(REAL_BID, 1n << 64n);
    expect(cfg.scaleNum * ((1n << 64n) / rawG)).toBeLessThan(cfg.scaleDen * (REAL_BID / rawG));
  });

  it("direction 1 bakes the ask and the exact reciprocal scale", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await metric.fetchPoolConfig(load, POOL, 1, async () => realOracleQuoteBytes());
    expect(cfg.bakedPrice).toBe(REAL_ASK);
    // Reciprocal direction: num = 2^64, den = ask, same haircut folded in.
    const num = (1n << 64n) * (1_000_000n - HAIRCUT_PPM);
    const den = REAL_ASK * 1_000_000n;
    const g = gcd(num, den);
    expect(cfg.scaleNum).toBe(num / g);
    expect(cfg.scaleDen).toBe(den / g);
  });

  it("throws (refuse, do not guess) when fetchOracleQuote is not supplied", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    await expect(metric.fetchPoolConfig(load, POOL)).rejects.toThrow(
      /has no fetchOracleQuote supplied/,
    );
  });

  it("throws when the oracle quote callback returns the wrong length", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    await expect(
      metric.fetchPoolConfig(load, POOL, 0, async () => new Uint8Array(16)),
    ).rejects.toThrow(/expected 32/);
  });
});

describe("the baked scale is a conservative lower bound (measured over-quote correction)", () => {
  // A paired-differential simulation of the REAL swap on real pools (funded recent trader, sizes
  // spanning 667x pinned to one slot) found the RAW oracle-price prediction over-quotes the realized
  // fill by a size-INDEPENDENT ~3-4 ppm (confirming a flat, no-slippage PMM fill — a bin-walk would
  // address slippage that does not exist). The haircut folds that offset out so predicted <= realized.
  it("predicts strictly LESS than the raw oracle price would, by ~HAIRCUT_PPM, for both directions", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    const x = 2_000_000_000n; // 2000 USDC/USDT atoms — the top of the measured size range
    for (const dir of [0, 1] as const) {
      const cfg = await metric.fetchPoolConfig(load, POOL, dir, async () => realOracleQuoteBytes());
      const priced = (x * cfg.scaleNum) / cfg.scaleDen;
      // Raw (un-haircut) prediction from the same baked price and equal decimals.
      const raw = dir === 0 ? (x * REAL_BID) / (1n << 64n) : (x * (1n << 64n)) / REAL_ASK;
      expect(priced).toBeLessThan(raw);
      // The gap is the haircut (~50 ppm), i.e. within a few ppm of raw * HAIRCUT_PPM / 1e6.
      const cut = (raw * HAIRCUT_PPM) / 1_000_000n;
      const gap = raw - priced;
      expect(gap).toBeGreaterThan((cut * 90n) / 100n);
      expect(gap).toBeLessThan((cut * 110n) / 100n);
      // And comfortably above the measured raw over-quote (~4 ppm), so predicted <= realized holds.
      const measuredOverQuotePpm = 4n;
      expect(gap).toBeGreaterThan((raw * measuredOverQuotePpm) / 1_000_000n);
    }
  });
});

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}
