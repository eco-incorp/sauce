/**
 * Token-2022 SELF-DROP pin for the taurusfi adapter. The swap CPI is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 mint on either side must
 * GRACEFULLY SELF-DROP. No checked-in fixture for this venue, so the price
 * account and both vaults are minimal synthesized stubs (enough to pass the
 * pre-existing gates and reach the mint check); one mint is then poisoned.
 */
import { address, getAddressEncoder } from "@solana/kit";
import { fetchTaurusFiConfig, TAURUSFI_POOL_REGISTRY } from "../../../src/svm/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import type { Address } from "@solana/kit";
import { ownedByShape } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = "EWqXjWSd4sfVsZHdSc25DoD1QfMbMrVpQZPpayoiFPSP";
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

/** Accounts are owned as their shape implies, unless `poison.owner` names the mint's owner. */
function loader(poison?: { mint: string; data: Uint8Array; owner?: Address }): OwnedAccountLoader {
  const map = new Map<string, Uint8Array>([
    [String(ENTRY.priceAccount), priceBytes()],
    [String(ENTRY.vault0), vaultBytes(String(ENTRY.mint0))],
    [String(ENTRY.vault1), vaultBytes(String(ENTRY.mint1))],
  ]);
  if (poison) map.set(poison.mint, poison.data);
  const shaped = ownedByShape(async (addr) => map.get(String(addr)) ?? null);
  return async (addr) =>
    poison?.owner !== undefined && String(addr) === poison.mint
      ? { data: poison.data, owner: poison.owner }
      : shaped(addr);
}

describe("taurusfi Token-2022 self-drop", () => {
  test("legacy (unvendored mints) decodes — legacy path unchanged", async () => {
    const cfg = await fetchTaurusFiConfig(loader(), address(POOL));
    expect(cfg.venue).toBe("taurusfi");
    expect(cfg.mint0).toBe(ENTRY.mint0);
  });

  test("a Token-2022 mint0 self-drops", async () => {
    const load = loader({ mint: String(ENTRY.mint0), data: makeT22Mint() });
    await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(/dropping pool/);
  });

  test("an 82-byte mint0 owned by Token-2022 (extensionless Token-2022) self-drops", async () => {
    const load = loader({
      mint: String(ENTRY.mint0),
      data: makeLegacyMint(),
      owner: TOKEN_2022_PROGRAM_ID,
    });
    await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable mint1 self-drops as un-routable", async () => {
    const load = loader({ mint: String(ENTRY.mint1), data: makeT22Mint(NON_TRANSFERABLE_TLV) });
    await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(/dropping pool/);
  });

  test("legacy control: both mints served as 82-byte Tokenkeg-owned mints pass the owner gate", async () => {
    // The gate (fetchTaurusFiConfig's mint loop) runs right before the return, so a config built
    // here means both mints were classified by their legacy owner and passed.
    const shaped = loader();
    const mintsServed: string[] = [];
    const load: OwnedAccountLoader = async (addr) => {
      if (String(addr) === String(ENTRY.mint0) || String(addr) === String(ENTRY.mint1)) {
        mintsServed.push(String(addr));
        return { data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID };
      }
      return shaped(addr);
    };
    const cfg = await fetchTaurusFiConfig(load, address(POOL));
    expect(mintsServed).toEqual([String(ENTRY.mint0), String(ENTRY.mint1)]);
    expect(cfg).toEqual(await fetchTaurusFiConfig(loader(), address(POOL)));
    expect(cfg.mint0).toBe(ENTRY.mint0);
    expect(cfg.mint1).toBe(ENTRY.mint1);
  });

  test("an 82-byte mint owned by neither token program is refused", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [String(ENTRY.mint0), String(ENTRY.mint1)]) {
      const load = loader({ mint, data: makeLegacyMint(), owner: foreign });
      await expect(fetchTaurusFiConfig(load, address(POOL))).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
