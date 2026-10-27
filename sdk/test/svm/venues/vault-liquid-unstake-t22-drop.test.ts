/**
 * Token-2022 SELF-DROP pin for the vault-liquid-unstake adapter. `sell_lst`
 * is legacy-SPL (Tokenkeg) only (outMint is always wrapped SOL), so a
 * Token-2022 LST mint must GRACEFULLY SELF-DROP. No checked-in fixture, so the
 * LstInfo / global Pool / stake-pool accounts are minimal synthesized stubs
 * (enough to pass the pre-existing shape gates and reach the mint check). A
 * mint is classified by its OWNER: an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one, so only the owner can tell them apart.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { vaultLiquidUnstake } from "../../../src/svm/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

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

/** The synthesized venue accounts (owned by the venue program) and, when given, the LST mint. */
function loader(mint: { data: Uint8Array; owner: Address } | null): OwnedAccountLoader {
  const program = vaultLiquidUnstake.programId;
  const map = new Map<string, { data: Uint8Array; owner: Address }>([
    [LST_INFO, { data: lstInfoBytes(), owner: program }],
    [GLOBAL_POOL, { data: globalPoolBytes(), owner: program }],
    [STAKE_POOL, { data: stakePoolBytes(), owner: program }],
  ]);
  if (mint) map.set(LST_MINT, mint);
  return async (addr) => map.get(String(addr)) ?? null;
}

const t22 = (data = makeT22Mint()) => ({ data, owner: TOKEN_2022_PROGRAM_ID });

describe("vault-liquid-unstake Token-2022 self-drop", () => {
  test("legacy (unvendored LST mint) decodes — legacy path unchanged", async () => {
    const cfg = await vaultLiquidUnstake.fetchPoolConfig(loader(null), address(LST_INFO));
    expect(cfg.venue).toBe("vault-liquid-unstake");
    expect(cfg.mint).toBe(LST_MINT);
  });

  test("a Token-2022 LST mint self-drops", async () => {
    await expect(
      vaultLiquidUnstake.fetchPoolConfig(loader(t22()), address(LST_INFO)),
    ).rejects.toThrow(/dropping pool/);
  });

  test("an extensionless (82-byte) Token-2022 LST mint self-drops as Token-2022", async () => {
    await expect(
      vaultLiquidUnstake.fetchPoolConfig(loader(t22(makeLegacyMint())), address(LST_INFO)),
    ).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable LST mint self-drops as un-routable", async () => {
    await expect(
      vaultLiquidUnstake.fetchPoolConfig(
        loader(t22(makeT22Mint(NON_TRANSFERABLE_TLV))),
        address(LST_INFO),
      ),
    ).rejects.toThrow(/dropping pool/);
  });
});
