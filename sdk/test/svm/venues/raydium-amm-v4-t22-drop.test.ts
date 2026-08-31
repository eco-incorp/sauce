/**
 * Raydium AMM v4 Token-2022 self-drop: swap_base_in_v2 carries one legacy-SPL
 * (Tokenkeg) token program, so a Token-2022 mint must make fetchPoolConfig
 * THROW. Built on the real mainnet AmmInfo fixture; the pool's coin mint (WSOL)
 * is not vendored as a fixture, so the drop test ADDS a synthesized Token-2022
 * account at that mint address. With no mint accounts vendored (the existing
 * fixtures), both mints read null → the legacy assumption holds and the config
 * resolves (byte-identical legacy path).
 */
import { resolve } from 'path';
import { address } from '@solana/kit';
import { raydiumAmmV4 } from '../../../src/svm/venues/raydium-amm-v4/index.js';
import type { RaydiumAmmV4PoolConfig } from '../../../src/svm/venues/raydium-amm-v4/index.js';
import { loadFixtures, fixtureLoader } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';
import { makeT22Mint } from '../fixtures/token-2022/synth.js';

const FIXTURES = resolve(process.cwd(), 'test/svm/fixtures/raydium-amm-v4');
const POOL = address('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2');
const COIN_MINT = 'So11111111111111111111111111111111111111112'; // WSOL (coin mint)
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // pc mint

/** The vault-only fixtures plus a synthetic Token-2022 account at `mint`. */
function withT22Mint(mint: string): AccountFixture[] {
  return [
    ...loadFixtures(FIXTURES),
    { address: mint, owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', base64Data: Buffer.from(makeT22Mint()).toString('base64') },
  ];
}

describe('raydium-amm-v4 Token-2022 self-drop', () => {
  it('drops the pool when the coin mint is Token-2022', async () => {
    const load = fixtureLoader(withT22Mint(COIN_MINT));
    await expect(raydiumAmmV4.fetchPoolConfig(load, POOL)).rejects.toThrow(/is Token-2022/);
  });

  it('drops the pool when the pc mint is Token-2022', async () => {
    const load = fixtureLoader(withT22Mint(USDC_MINT));
    await expect(raydiumAmmV4.fetchPoolConfig(load, POOL)).rejects.toThrow(/is Token-2022/);
  });

  it('still resolves for the unmodified fixtures (mints unvendored → legacy fallback)', async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    const cfg = (await raydiumAmmV4.fetchPoolConfig(load, POOL)) as RaydiumAmmV4PoolConfig;
    expect(cfg.venue).toBe('raydium-amm-v4');
    expect(cfg.coinMint).toBe(COIN_MINT);
    expect(cfg.pcMint).toBe(USDC_MINT);
  });
});
