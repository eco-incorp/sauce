/**
 * meteora-damm-v1-stable Token-2022 self-drop: the mainnet USDC/USDT fixture
 * decodes normally (its token mints are not vendored, so the guard falls back to
 * the legacy assumption). Vendoring a Token-2022 mint at tokenAMint's address
 * makes the pool drop (fetchPoolConfig throws).
 */
import { fileURLToPath } from 'url';
import { address } from '@solana/kit';
import { meteoraDammV1Stable } from '../../../src/svm/venues/meteora-damm-v1-stable/index.js';
import type { MeteoraDammV1StablePoolConfig } from '../../../src/svm/venues/meteora-damm-v1-stable/index.js';
import { TOKEN_2022_PROGRAM_ID } from '../../../src/svm/token-program.js';
import { fixtureLoader, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';
import { makeT22Mint, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/meteora-damm-v1-stable/', import.meta.url));
const POOL = address('32D4zRxNc1EssbJieVHfPhZM3rH6CzfUPrWUuWxD9prG');
/** tokenAMint decoded from the fixture pool (USDC). */
const TOKEN_A_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const fixtures = loadFixtures(FIXTURE_DIR);

function withMintFixture(data: Uint8Array): AccountFixture[] {
  return [
    ...fixtures,
    { address: TOKEN_A_MINT, owner: TOKEN_2022_PROGRAM_ID, base64Data: Buffer.from(data).toString('base64') },
  ];
}

describe('meteora-damm-v1-stable Token-2022 self-drop', () => {
  it('drops the pool when tokenAMint is a Token-2022 mint', async () => {
    const load = fixtureLoader(withMintFixture(makeT22Mint()));
    await expect(meteoraDammV1Stable.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it('drops the pool when tokenAMint carries an un-routable extension', async () => {
    const load = fixtureLoader(withMintFixture(makeT22Mint(NON_TRANSFERABLE_TLV)));
    await expect(meteoraDammV1Stable.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022|un-routable/);
  });

  it('decodes the plain fixture unchanged (legacy fallback, mints not vendored)', async () => {
    const cfg = (await meteoraDammV1Stable.fetchPoolConfig(fixtureLoader(fixtures), POOL)) as MeteoraDammV1StablePoolConfig;
    expect(cfg.venue).toBe('meteora-damm-v1-stable');
    expect(cfg.tokenAMint).toBe(TOKEN_A_MINT);
  });
});
