/**
 * Token-2022 SELF-DROP pin for the vault-liquid-unstake adapter. `sell_lst`
 * is legacy-SPL (Tokenkeg) only (outMint is always wrapped SOL), so a
 * Token-2022 LST mint must GRACEFULLY SELF-DROP. No checked-in fixture, so the
 * LstInfo / global Pool / stake-pool accounts are minimal synthesized stubs
 * (enough to pass the pre-existing shape gates and reach the mint check).
 */
import { address, getAddressEncoder } from "@solana/kit";
import { vaultLiquidUnstake } from "../../../src/svm/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const GLOBAL_POOL = "9nyw5jxhzuSs88HxKJyDCsWBZMhxj2uNXsFcyHF5KBAb";
const LST_INFO = "Hhugr5Bw2NpmM4zKgDcQpypnVG7UPjcFFtHeaTbz764h";
const LST_MINT = "5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV"; // arbitrary valid mint addr
const STAKE_POOL = "9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx"; // arbitrary valid addr

const LST_INFO_DISC = [0x4f, 0x71, 0xe2, 0x3c, 0xab, 0x08, 0x8e, 0x21];
const POOL_DISC = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];

function lstInfoBytes(): Uint8Array {
  const out = new Uint8Array(144); // LST_INFO_LEN default-config layout
  out.set(LST_INFO_DISC, 0);
  out.set(getAddressEncoder().encode(address(LST_MINT)), 40); // LST_INFO_OFF_MINT
  out.set(getAddressEncoder().encode(address(STAKE_POOL)), 72); // LST_INFO_OFF_STAKE_POOL
  return out;
}
function globalPoolBytes(): Uint8Array {
  const out = new Uint8Array(316); // POOL_LEN
  out.set(POOL_DISC, 0);
  return out;
}
function stakePoolBytes(): Uint8Array {
  const out = new Uint8Array(611); // STAKE_POOL_LEN
  out[0] = 1; // account_type == StakePool
  return out;
}

function loader(mintData: Uint8Array | null): AccountLoader {
  const map = new Map<string, Uint8Array>([
    [LST_INFO, lstInfoBytes()],
    [GLOBAL_POOL, globalPoolBytes()],
    [STAKE_POOL, stakePoolBytes()],
  ]);
  if (mintData) map.set(LST_MINT, mintData);
  return async (addr) => map.get(String(addr)) ?? null;
}

describe("vault-liquid-unstake Token-2022 self-drop", () => {
  test("legacy (unvendored LST mint) decodes — legacy path unchanged", async () => {
    const cfg = await vaultLiquidUnstake.fetchPoolConfig(loader(null), address(LST_INFO));
    expect(cfg.venue).toBe("vault-liquid-unstake");
    expect(cfg.mint).toBe(LST_MINT);
  });

  test("a Token-2022 LST mint self-drops", async () => {
    await expect(
      vaultLiquidUnstake.fetchPoolConfig(loader(makeT22Mint()), address(LST_INFO)),
    ).rejects.toThrow(/dropping pool/);
  });

  test("a NonTransferable LST mint self-drops as un-routable", async () => {
    await expect(
      vaultLiquidUnstake.fetchPoolConfig(
        loader(makeT22Mint(NON_TRANSFERABLE_TLV)),
        address(LST_INFO),
      ),
    ).rejects.toThrow(/dropping pool/);
  });
});
