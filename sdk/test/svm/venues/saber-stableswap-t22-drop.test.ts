/**
 * saber-stableswap Token-2022 self-drop: a pool whose mint is a Token-2022
 * mint must DROP (fetchPoolConfig throws — the SvmRoute graceful-drop signal),
 * because the v1 swap ix is legacy-SPL (Tokenkeg) only. The legacy path is
 * unchanged: the real mainnet fixture (whose mint accounts are not vendored)
 * still decodes fine.
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import { saberStableswap } from '../../../src/svm/venues/saber-stableswap/index.js';
import type { SaberPoolConfig } from '../../../src/svm/venues/saber-stableswap/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { fixtureLoader, loadFixtures } from '../fixtures.js';
import { makeLegacyMint, makeT22Mint, tlvEntry, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const POOL = address('YAkoNb6HKmSxQN9L8hiBE5tPJRsniSSMzND1boHmZxe');
const fixtures = loadFixtures(resolve(process.cwd(), 'test/svm/fixtures/saber-stableswap'));
const baseLoader = fixtureLoader(fixtures);

/** Loader that overrides one mint's bytes, delegating everything else to the fixture. */
function withMint(mint: string, bytes: Uint8Array): AccountLoader {
  return async (addr) => (addr === mint ? bytes : baseLoader(addr));
}

describe('saber-stableswap Token-2022 self-drop', () => {
  let mintA: string;
  beforeAll(async () => {
    const cfg = (await saberStableswap.fetchPoolConfig(baseLoader, POOL)) as SaberPoolConfig;
    mintA = cfg.mintA;
  });

  it('legacy path is unchanged (mint accounts unvendored → legacy assumption)', async () => {
    await expect(saberStableswap.fetchPoolConfig(baseLoader, POOL)).resolves.toBeDefined();
  });

  it('a vendored legacy (82-byte) mint keeps the pool routable', async () => {
    const load = withMint(mintA, makeLegacyMint());
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).resolves.toBeDefined();
  });

  it('drops when mintA is a Token-2022 mint', async () => {
    const load = withMint(mintA, makeT22Mint());
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it('drops when mintA is a Token-2022 mint carrying a blocking extension', async () => {
    const load = withMint(mintA, makeT22Mint(NON_TRANSFERABLE_TLV, tlvEntry(0)));
    await expect(saberStableswap.fetchPoolConfig(load, POOL)).rejects.toThrow(
      new RegExp(`dropping pool ${POOL}`),
    );
  });
});
