/**
 * Token-2022 SELF-DROP pin for the voltr adapter. `deposit_vault` /
 * `instant_withdraw_vault` pass the classic Token program for the asset side,
 * so a Token-2022 asset mint must GRACEFULLY SELF-DROP (previously it was a
 * documented simplification relying on the CPI to fail on-chain). No
 * checked-in fixture, so the Vault account is a minimal synthesized 928-byte
 * stub whose stored LP mint matches its own PDA derivation (the adapter's
 * self-consistency check), reached before the mint check.
 */
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';
import { fetchVoltrConfig, VOLTR_PROGRAM_ID } from '../../../src/svm/index.js';
import type { AccountLoader } from '../../../src/svm/index.js';
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from '../fixtures/token-2022/synth.js';

const POOL = address('Gj8kURFs8fK3GhiX5Yc6H1HQKSpEvLHeDRZsP6Y2D1je');
const ASSET_MINT = address('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
const VAULT_DISC = [211, 8, 232, 43, 2, 152, 117, 119];

async function derivedLpMint(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: VOLTR_PROGRAM_ID,
    seeds: [new TextEncoder().encode('vault_lp_mint'), new Uint8Array(getAddressEncoder().encode(POOL))],
  });
  return pda;
}

function vaultBytes(lpMint: Address): Uint8Array {
  const out = new Uint8Array(928); // VAULT_MIN_LEN
  const enc = getAddressEncoder();
  out.set(VAULT_DISC, 0);
  out.set(enc.encode(ASSET_MINT), 104); // OFF_ASSET_MINT
  out.set(enc.encode(lpMint), 272); // OFF_LP_MINT
  return out;
}

async function loader(assetMintData: Uint8Array): Promise<AccountLoader> {
  const lpMint = await derivedLpMint();
  const map = new Map<string, Uint8Array>([
    [String(POOL), vaultBytes(lpMint)],
    [String(ASSET_MINT), assetMintData],
    [String(lpMint), makeLegacyMint()],
  ]);
  return async (addr) => map.get(String(addr)) ?? null;
}

describe('voltr Token-2022 self-drop', () => {
  test('legacy asset mint decodes — legacy path unchanged', async () => {
    const cfg = await fetchVoltrConfig(await loader(makeLegacyMint()), POOL);
    expect(cfg.venue).toBe('voltr');
    expect(cfg.assetMint).toBe(ASSET_MINT);
  });

  test('a Token-2022 asset mint self-drops', async () => {
    await expect(fetchVoltrConfig(await loader(makeT22Mint()), POOL)).rejects.toThrow(/dropping pool/);
  });

  test('a NonTransferable asset mint self-drops as un-routable', async () => {
    await expect(fetchVoltrConfig(await loader(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL)).rejects.toThrow(
      /dropping pool/,
    );
  });
});
