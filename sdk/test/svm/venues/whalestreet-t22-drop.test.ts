/**
 * Token-2022 SELF-DROP pin for the whalestreet adapter. The swap CPI is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 mint on either side must
 * GRACEFULLY SELF-DROP. No checked-in fixture for this venue, so the pool
 * bytes are a minimal synthesized 605-byte pool account with the mints at
 * their real offsets.
 */
import { address, getAddressEncoder } from '@solana/kit';
import {
  fetchWhalestreetPoolConfig,
  WHALESTREET_OFF_MINT_A,
  WHALESTREET_OFF_MINT_B,
  WHALESTREET_OFF_VAULT_A,
  WHALESTREET_OFF_VAULT_B,
} from '../../../src/svm/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeT22Mint, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const POOL = address('Hhugr5Bw2NpmM4zKgDcQpypnVG7UPjcFFtHeaTbz764h');
const MINT_A = address('So11111111111111111111111111111111111111112'); // wSOL
const MINT_B = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const VAULT_A = address('5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV');
const VAULT_B = address('9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx');

/** A minimal 605-byte WhaleStreet pool with mints/vaults at their real offsets. */
function poolBytes(): Uint8Array {
  const out = new Uint8Array(605);
  const enc = getAddressEncoder();
  out.set(enc.encode(MINT_A), WHALESTREET_OFF_MINT_A);
  out.set(enc.encode(VAULT_A), WHALESTREET_OFF_VAULT_A);
  out.set(enc.encode(MINT_B), WHALESTREET_OFF_MINT_B);
  out.set(enc.encode(VAULT_B), WHALESTREET_OFF_VAULT_B);
  return out;
}

function loader(target: string, mintData: Uint8Array): AccountLoader {
  const pool = poolBytes();
  return async (addr) => {
    if (String(addr) === String(POOL)) return pool;
    if (String(addr) === target) return mintData;
    return null;
  };
}

describe('whalestreet Token-2022 self-drop', () => {
  test('legacy mints (unvendored) decode — legacy path unchanged', async () => {
    const base: AccountLoader = async (addr) => (String(addr) === String(POOL) ? poolBytes() : null);
    const cfg = await fetchWhalestreetPoolConfig(base, POOL);
    expect(cfg.venue).toBe('whalestreet');
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  test('a Token-2022 mintA self-drops', async () => {
    await expect(fetchWhalestreetPoolConfig(loader(String(MINT_A), makeT22Mint()), POOL)).rejects.toThrow(/dropping pool/);
  });

  test('a NonTransferable mintB self-drops as un-routable', async () => {
    await expect(
      fetchWhalestreetPoolConfig(loader(String(MINT_B), makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/dropping pool/);
  });
});
