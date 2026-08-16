/**
 * AlphaQ non-stable oracle pricing + the "sane oracle price" staleness guard —
 * the fix for the syrupUSDC catastrophic route and the AlphaQ stable-pair-only
 * limitation, hardened so a stale/garbage oracle can never serve a wrong price.
 *
 * FAILING-FIRST: before the fix, `fetchAlphaqPoolConfig` THREW for the
 * SYRUPU-USDC market ("not a curated stablecoin pair"), so the deep AlphaQ
 * syrupUSDC liquidity self-dropped and Sauce delivered ~1 unit for 100k USDC.
 *
 * All fixtures are real mainnet bytes captured live (owner ALPHAQme…). Because
 * the oracle carries a crank timestamp the freshness guard checks, every test
 * PINS `now` relative to the fixture's own timestamp (never wall-clock) so it
 * stays deterministic as the fixtures age.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import {
  fetchAlphaqPoolConfig,
  __alphaqCpQuoteForTest as cpQuote,
  __alphaqQuoteForTest as alphaqQuote,
} from '../../../src/svm/venues/alphaq/index.js';
import type { AccountLoader } from '../../../src/svm/venues/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
type Fixture = {
  market: { address: string; dataBase64: string };
  stats: { address: string; dataBase64: string };
  priceAt56_over_1e10: number;
};
const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join(HERE, `../fixtures/alphaq/${name}.json`), 'utf8')) as Fixture;

const syrup = load('syrupu-usdc');
const jlpStale = load('jlp-usdc-stale');

function loaderFor(fx: Fixture, statsOverride?: Uint8Array): AccountLoader {
  const bytes: Record<string, Uint8Array> = {
    [fx.market.address]: Uint8Array.from(Buffer.from(fx.market.dataBase64, 'base64')),
    [fx.stats.address]: statsOverride ?? Uint8Array.from(Buffer.from(fx.stats.dataBase64, 'base64')),
  };
  return async (a: Address) => bytes[a as unknown as string] ?? null;
}
/** The crank timestamp baked into a fixture's stats bytes (u64 LE @48). */
function fixtureTs(fx: Fixture): bigint {
  const d = Uint8Array.from(Buffer.from(fx.stats.dataBase64, 'base64'));
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[48 + i]);
  return v;
}

describe('alphaq: non-stable oracle pricing (syrupUSDC)', () => {
  const fresh = fixtureTs(syrup) + 60n; // 1 minute after the crank — fresh

  it('resolves the SYRUPU-USDC market that USED to self-drop, reading the oracle spot', async () => {
    const cfg = await fetchAlphaqPoolConfig(loaderFor(syrup), address(syrup.market.address), fresh);
    expect(cfg.symbol).toBe('SYRUPU-USDC');
    expect(cfg.isStablePair).toBe(false);
    expect(cfg.decimalsA).toBe(cfg.decimalsB);
    expect(cfg.priceRaw).toBe(11783480754n);
    expect(cfg.priceTimestamp).toBe(fixtureTs(syrup));
  });

  it('prices USDC->syrup at ~0.849 (the real rate), not ~1.0 (the old parity bug)', async () => {
    const cfg = await fetchAlphaqPoolConfig(loaderFor(syrup), address(syrup.market.address), fresh);
    const bigDepth = 1_000_000_000_000_000n;
    const amountInUSDC = 1_000_000_000n; // 1,000 USDC (6dp), syrup=mintA/USDC=mintB → BtoA
    const out = alphaqQuote(amountInUSDC, bigDepth, bigDepth, cfg.priceRaw, cfg.isStablePair, 'BtoA');
    const rate = Number(out) / Number(amountInUSDC);
    expect(rate).toBeGreaterThan(0.84);
    expect(rate).toBeLessThan(0.86); // ≈ 1/1.1783 = 0.8486, matching Jupiter's realized 0.8485
  });

  it('the reverse leg (syrup->USDC) prices at ~1.178', async () => {
    const cfg = await fetchAlphaqPoolConfig(loaderFor(syrup), address(syrup.market.address), fresh);
    const bigDepth = 1_000_000_000_000_000n;
    const out = alphaqQuote(1_000_000_000n, bigDepth, bigDepth, cfg.priceRaw, cfg.isStablePair, 'AtoB');
    const rate = Number(out) / 1_000_000_000;
    expect(rate).toBeGreaterThan(1.17);
    expect(rate).toBeLessThan(1.19);
  });
});

describe('alphaq: "sane oracle price" guard self-drops stale/garbage oracles', () => {
  it('self-drops a genuinely STALE real market (JLP-USDC, last cranked 2025-10-09)', async () => {
    // @56 reads 5.834 but JLP really trades ~3.62 — serving it would over-promise
    // by 60%. now = just past the freshness window relative to JLP's own crank.
    const now = fixtureTs(jlpStale) + 4000n; // > MAX_PRICE_AGE_SECONDS (3600)
    await expect(
      fetchAlphaqPoolConfig(loaderFor(jlpStale), address(jlpStale.market.address), now),
    ).rejects.toThrow(/STALE/);
  });

  it('self-drops when the SAME market goes stale (now far past the crank)', async () => {
    const stale = fixtureTs(syrup) + 7200n; // 2h after crank > 1h window
    await expect(
      fetchAlphaqPoolConfig(loaderFor(syrup), address(syrup.market.address), stale),
    ).rejects.toThrow(/STALE/);
  });

  it('self-drops a never-cranked oracle (timestamp 0)', async () => {
    // synthesize a stats buffer with a plausible @56 price but @48 == 0
    const s = Uint8Array.from(Buffer.from(syrup.stats.dataBase64, 'base64'));
    for (let i = 0; i < 8; i++) s[48 + i] = 0; // zero the timestamp
    await expect(
      fetchAlphaqPoolConfig(loaderFor(syrup, s), address(syrup.market.address), fixtureTs(syrup) + 60n),
    ).rejects.toThrow(/never-cranked/);
  });

  it('self-drops when the stats price is zero (garbage)', async () => {
    const s = Uint8Array.from(Buffer.from(syrup.stats.dataBase64, 'base64'));
    for (let i = 0; i < 8; i++) s[56 + i] = 0; // zero the price
    await expect(
      fetchAlphaqPoolConfig(loaderFor(syrup, s), address(syrup.market.address), fixtureTs(syrup) + 60n),
    ).rejects.toThrow(/no readable oracle price/);
  });
});

describe('alphaq: stable-pair quote is byte-identical (regression guard)', () => {
  it('alphaqQuote on a stable pair returns exactly the original parity cpQuote', () => {
    for (const [x, a, b] of [
      [5_000_000n, 1_000_000_000n, 900_000_000n],
      [123_456_789n, 500_000_000n, 500_000_000n],
      [1n, 10n, 10n],
    ] as const) {
      const parity = cpQuote(x, a, b);
      expect(alphaqQuote(x, a, b, 9_999_999_999n, true, 'AtoB')).toBe(parity);
      expect(alphaqQuote(x, a, b, 12_000_000_000n, true, 'BtoA')).toBe(parity);
    }
  });
});
