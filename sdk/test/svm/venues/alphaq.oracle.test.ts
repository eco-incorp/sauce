/**
 * AlphaQ non-stable oracle pricing — the fix for the syrupUSDC catastrophic
 * route and the "stable-pair-only" AlphaQ limitation.
 *
 * FAILING-FIRST: before the fix, `fetchAlphaqPoolConfig` THREW for the
 * SYRUPU-USDC market ("not a curated stablecoin pair … no price oracle"), so
 * the deep AlphaQ syrupUSDC liquidity self-dropped and Sauce was forced onto a
 * thin path delivering ~1 unit for 100k USDC. This test drives the real
 * mainnet SYRUPU-USDC market + stats bytes (captured live into
 * fixtures/alphaq/syrupu-usdc.json; owner ALPHAQme…) and asserts the market now
 * resolves and prices at AlphaQ's real oracle spot (stats@56/1e10 ≈ 1.1783 USDC
 * per syrupUSDC) — matching Jupiter's realized rate (100k USDC -> 84,852
 * syrupUSDC ≈ 0.8485 syrup/USDC), NOT the ~1.0 the old parity model implied.
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
const fx = JSON.parse(
  readFileSync(join(HERE, '../fixtures/alphaq/syrupu-usdc.json'), 'utf8'),
) as {
  market: { address: string; dataBase64: string };
  stats: { address: string; dataBase64: string };
  priceAt56_over_1e10: number;
};

/** Loader over the two vendored accounts (market + its stats companion). */
function fixtureLoader(): AccountLoader {
  const bytes: Record<string, Uint8Array> = {
    [fx.market.address]: Uint8Array.from(Buffer.from(fx.market.dataBase64, 'base64')),
    [fx.stats.address]: Uint8Array.from(Buffer.from(fx.stats.dataBase64, 'base64')),
  };
  return async (a: Address) => bytes[a as unknown as string] ?? null;
}

describe('alphaq: non-stable oracle pricing (syrupUSDC)', () => {
  it('resolves the SYRUPU-USDC market that USED to self-drop, reading the oracle spot', async () => {
    const cfg = await fetchAlphaqPoolConfig(fixtureLoader(), address(fx.market.address));
    expect(cfg.symbol).toBe('SYRUPU-USDC');
    expect(cfg.isStablePair).toBe(false); // syrup is not a curated stablecoin
    expect(cfg.decimalsA).toBe(cfg.decimalsB); // 6/6
    // oracle spot: price of mintA (syrup) in mintB (USDC), *1e10
    expect(cfg.priceRaw).toBe(11783480754n);
  });

  it('prices USDC->syrup at ~0.849 (the real rate), not ~1.0 (the old parity bug)', async () => {
    const cfg = await fetchAlphaqPoolConfig(fixtureLoader(), address(fx.market.address));
    // syrup = mintA, USDC = mintB → USDC input spends mintB → 'BtoA'.
    // Use a large depth so slippage is negligible and we isolate the SPOT.
    const bigDepth = 1_000_000_000_000_000n;
    const amountInUSDC = 1_000_000_000n; // 1,000 USDC (6dp)
    const out = alphaqQuote(amountInUSDC, bigDepth, bigDepth, cfg.priceRaw, cfg.isStablePair, 'BtoA');
    const rate = Number(out) / Number(amountInUSDC); // syrup per USDC
    expect(rate).toBeGreaterThan(0.84);
    expect(rate).toBeLessThan(0.86); // ≈ 1/1.1783 = 0.8486, matching Jupiter
    // and emphatically NOT the old parity ~1.0 that caused the catastrophic route
    expect(rate).toBeLessThan(0.9);
  });

  it('the reverse leg (syrup->USDC) prices at ~1.178', async () => {
    const cfg = await fetchAlphaqPoolConfig(fixtureLoader(), address(fx.market.address));
    const bigDepth = 1_000_000_000_000_000n;
    const amountInSyrup = 1_000_000_000n; // 1,000 syrup
    const out = alphaqQuote(amountInSyrup, bigDepth, bigDepth, cfg.priceRaw, cfg.isStablePair, 'AtoB');
    const rate = Number(out) / Number(amountInSyrup); // USDC per syrup
    expect(rate).toBeGreaterThan(1.17);
    expect(rate).toBeLessThan(1.19);
  });
});

describe('alphaq: stable-pair quote is byte-identical (regression guard)', () => {
  it('alphaqQuote on a stable pair returns exactly the original parity cpQuote', () => {
    // For isStablePair=true the oracle price is IGNORED — the output must equal
    // the untouched parity model for every input/depth/direction.
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
