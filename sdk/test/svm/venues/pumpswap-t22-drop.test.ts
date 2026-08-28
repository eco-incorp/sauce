/**
 * PumpSwap Token-2022 handling: the base side already resolves its token
 * program per mint (baseTokenProgram / quoteTokenProgram), so a zero-fee /
 * advisory-only Token-2022 base mint must ROUTE (not be dropped), a legacy
 * base mint stays Tokenkeg, and only a genuinely un-routable (NonTransferable /
 * frozen) mint self-drops. A TransferFeeConfig mint stays rejected — fee
 * netting is a documented follow-up (see the TODO(t22-fee-netting) in the
 * adapter), and the rejection is the safe self-limiting behavior.
 */
import { join } from 'path';
import { address } from '@solana/kit';
import { pumpswapAdapter } from '../../../src/svm/venues/pumpswap/index.js';
import { fixtureLoader, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';
import { makeT22Mint, makeLegacyMint, tlvEntry, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const POOL = address('2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd');
const PUMP_MINT = 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn'; // base mint (real fixture is Token-2022)
const TOKENKEG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const FIXTURE_DIR = join(process.cwd(), 'test', 'svm', 'fixtures', 'pumpswap');

/** The real fixture set with the base (PUMP) mint account overwritten. */
function withBaseMint(bytes: Uint8Array, owner = TOKEN_2022): AccountFixture[] {
  return loadFixtures(FIXTURE_DIR).map((f) =>
    f.address === PUMP_MINT ? { ...f, owner, base64Data: Buffer.from(bytes).toString('base64') } : f,
  );
}

describe('pumpswap Token-2022 handling', () => {
  it('routes a zero-fee (extensionless) Token-2022 base mint; quote side stays legacy', async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(fixtureLoader(withBaseMint(makeT22Mint())), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG); // USDC quote mint — unchanged
  });

  it('routes the real (advisory-only) Token-2022 base mint fixture unchanged', async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURE_DIR)), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
  });

  it('drops the pool when the base mint carries a blocking NonTransferable extension', async () => {
    const load = fixtureLoader(withBaseMint(makeT22Mint(NON_TRANSFERABLE_TLV)));
    await expect(pumpswapAdapter.fetchPoolConfig(load, POOL)).rejects.toThrow(/un-routable/);
  });

  it('still rejects a TransferFeeConfig base mint (fee-netting is a documented follow-up)', async () => {
    const load = fixtureLoader(withBaseMint(makeT22Mint(tlvEntry(1, new Uint8Array(108)))));
    await expect(pumpswapAdapter.fetchPoolConfig(load, POOL)).rejects.toThrow(/TransferFeeConfig/);
  });

  it('a legacy 82-byte base mint routes as Tokenkeg (byte-identical legacy path)', async () => {
    const cfg = await pumpswapAdapter.fetchPoolConfig(fixtureLoader(withBaseMint(makeLegacyMint(), TOKENKEG)), POOL);
    expect(cfg.baseTokenProgram).toBe(TOKENKEG);
    expect(cfg.quoteTokenProgram).toBe(TOKENKEG);
  });
});
