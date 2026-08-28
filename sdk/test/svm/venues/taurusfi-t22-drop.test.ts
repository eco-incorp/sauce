/**
 * Token-2022 SELF-DROP pin for the taurusfi adapter. The swap CPI is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 mint on either side must
 * GRACEFULLY SELF-DROP. No checked-in fixture for this venue, so the price
 * account and both vaults are minimal synthesized stubs (enough to pass the
 * pre-existing gates and reach the mint check); one mint is then poisoned.
 */
import { address, getAddressEncoder } from '@solana/kit';
import { fetchTaurusFiConfig, TAURUSFI_POOL_REGISTRY } from '../../../src/svm/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeT22Mint, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const POOL = 'EWqXjWSd4sfVsZHdSc25DoD1QfMbMrVpQZPpayoiFPSP';
const ENTRY = TAURUSFI_POOL_REGISTRY[POOL];

/** A minimal SPL token account (>=72 bytes) holding `mint` at offset 0. */
function vaultBytes(mint: string): Uint8Array {
  const out = new Uint8Array(72);
  out.set(getAddressEncoder().encode(address(mint)), 0);
  return out;
}

/** Price account: 8 bytes of a plausible non-zero f64 bit pattern. */
function priceBytes(): Uint8Array {
  return new Uint8Array([0, 0, 0, 0, 0, 0, 0x52, 0x40]); // ~73.0 as f64 LE
}

function loader(poison?: { mint: string; data: Uint8Array }): AccountLoader {
  const map = new Map<string, Uint8Array>([
    [String(ENTRY.priceAccount), priceBytes()],
    [String(ENTRY.vault0), vaultBytes(String(ENTRY.mint0))],
    [String(ENTRY.vault1), vaultBytes(String(ENTRY.mint1))],
  ]);
  if (poison) map.set(poison.mint, poison.data);
  return async (addr) => map.get(String(addr)) ?? null;
}

describe('taurusfi Token-2022 self-drop', () => {
  test('legacy (unvendored mints) decodes — legacy path unchanged', async () => {
    const cfg = await fetchTaurusFiConfig(loader(), address(POOL));
    expect(cfg.venue).toBe('taurusfi');
    expect(cfg.mint0).toBe(ENTRY.mint0);
  });

  test('a Token-2022 mint0 self-drops', async () => {
    const load = loader({ mint: String(ENTRY.mint0), data: makeT22Mint() });
    await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(/dropping pool/);
  });

  test('a NonTransferable mint1 self-drops as un-routable', async () => {
    const load = loader({ mint: String(ENTRY.mint1), data: makeT22Mint(NON_TRANSFERABLE_TLV) });
    await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(/dropping pool/);
  });
});
