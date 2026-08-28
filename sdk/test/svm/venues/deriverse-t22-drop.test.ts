/**
 * Deriverse Token-2022 self-drop: this venue's Swap ix is legacy-SPL (Tokenkeg)
 * only, so fetchPoolConfig must DROP an instrument whose asset or crncy mint is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). Reuses
 * the REAL mainnet instrument fixture for the pool bytes and vends a synthesized
 * Token-2022 mint for one side. The unmodified fixture does not vendor the mint
 * accounts at all — so the drop path is only reachable when a mint account is
 * actually present AND is Token-2022, exactly the null-fallback that keeps the
 * base deriverse.test.ts green.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { deriverse } from '../../../src/svm/venues/deriverse/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { fixtureLoader, loadFixtures } from '../fixtures.js';
import { makeT22Mint } from '../fixtures/token-2022/synth.js';

const FIXTURES = resolve(process.cwd(), 'test/svm/fixtures/deriverse');
const REAL_POOL = address('8Wk2L1yDovBJifCN1o86X7g7pDcqLau39m6tEsJ9Sheh');
const ASSET_MINT = address('So11111111111111111111111111111111111111112'); // wSOL
const CRNCY_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC

/** The real fixture loader, but also vending a Token-2022 mint at `t22Mint`. */
function loaderWithT22Mint(t22Mint: Address): AccountLoader {
  const base = fixtureLoader(loadFixtures(FIXTURES));
  return async (addr: Address) => (addr === t22Mint ? makeT22Mint() : base(addr));
}

describe('deriverse Token-2022 self-drop', () => {
  it('drops the instrument when the asset mint is Token-2022', async () => {
    await expect(deriverse.fetchPoolConfig(loaderWithT22Mint(ASSET_MINT), REAL_POOL)).rejects.toThrow(/Token-2022/);
  });

  it('drops the instrument when the crncy mint is Token-2022', async () => {
    await expect(deriverse.fetchPoolConfig(loaderWithT22Mint(CRNCY_MINT), REAL_POOL)).rejects.toThrow(/Token-2022/);
  });

  it('legacy control: the unmodified fixture (mints not vendored → legacy assumption) builds a config', async () => {
    const cfg = await deriverse.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), REAL_POOL);
    expect(cfg.venue).toBe('deriverse');
    expect(cfg.assetMint).toBe(ASSET_MINT);
    expect(cfg.crncyMint).toBe(CRNCY_MINT);
  });
});
