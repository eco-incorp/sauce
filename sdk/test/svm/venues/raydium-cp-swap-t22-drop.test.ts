/**
 * raydium-cp-swap Token-2022 handling: the per-side token programs are read
 * straight off PoolState (offsets 232/264), so a zero-fee / advisory-only
 * Token-2022 mint must ROUTE (not be dropped), the legacy fixture stays
 * byte-identical, and only a genuinely un-routable (NonTransferable / frozen)
 * mint self-drops. A TransferFeeConfig mint stays rejected — fee netting is a
 * documented follow-up (see the TODO(t22-fee-netting) in the adapter).
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { address, getAddressCodec } from '@solana/kit';
import { raydiumCpSwap } from '../../../src/svm/venues/raydium-cp-swap/index.js';
import { fixtureLoader, loadFixtures } from '../fixtures.js';
import type { AccountFixture } from '../fixtures.js';
import { makeT22Mint, tlvEntry, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'raydium-cp-swap');
const POOL = address('7JuwJuNU88gurFnyWeiyGKbFmExMWcmRZntn9imEzdny');
const WSOL = 'So11111111111111111111111111111111111111112'; // token_0 mint
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const fixtures = loadFixtures(FIXTURE_DIR);
const pubkeyBytes = (addr: string): Uint8Array => new Uint8Array(getAddressCodec().encode(address(addr)));

/** Point token_0_program (PoolState offset 232) at Token-2022 so the gate inspects the token_0 mint. */
function withToken0AsT22(mintBytes: Uint8Array): AccountFixture[] {
  return [
    ...fixtures.map((f) => {
      if (f.address !== POOL) return f;
      const data = new Uint8Array(Buffer.from(f.base64Data, 'base64'));
      data.set(pubkeyBytes(TOKEN_2022), 232);
      return { ...f, base64Data: Buffer.from(data).toString('base64') };
    }),
    { address: WSOL, owner: TOKEN_2022, base64Data: Buffer.from(mintBytes).toString('base64') },
  ];
}

describe('raydium-cp-swap Token-2022 handling', () => {
  it('routes a zero-fee (extensionless) Token-2022 mint', async () => {
    const cfg = await raydiumCpSwap.fetchPoolConfig(fixtureLoader(withToken0AsT22(makeT22Mint())), POOL);
    expect(cfg.token0Program).toBe(TOKEN_2022);
  });

  it('routes a Token-2022 mint whose only extension is advisory (MintCloseAuthority)', async () => {
    const cfg = await raydiumCpSwap.fetchPoolConfig(fixtureLoader(withToken0AsT22(makeT22Mint(tlvEntry(3, new Uint8Array(32))))), POOL);
    expect(cfg.token0Program).toBe(TOKEN_2022);
  });

  it('drops the pool when the Token-2022 mint carries a blocking NonTransferable extension', async () => {
    const load = fixtureLoader(withToken0AsT22(makeT22Mint(NON_TRANSFERABLE_TLV)));
    await expect(raydiumCpSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/un-routable/);
  });

  it('still rejects a TransferFeeConfig mint (fee-netting is a documented follow-up)', async () => {
    const load = fixtureLoader(withToken0AsT22(makeT22Mint(tlvEntry(1, new Uint8Array(108)))));
    await expect(raydiumCpSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/transfer-fee extension/);
  });

  it('legacy path unchanged: the unmodified real fixture resolves as Tokenkeg on both sides', async () => {
    const cfg = await raydiumCpSwap.fetchPoolConfig(fixtureLoader(fixtures), POOL);
    expect(cfg.token0Program).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    expect(cfg.token1Program).toBe('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  });
});
