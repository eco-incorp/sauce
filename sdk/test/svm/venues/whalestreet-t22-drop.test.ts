/**
 * Token-2022 SELF-DROP pin for the whalestreet adapter. The swap CPI is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 mint on either side must
 * GRACEFULLY SELF-DROP. No checked-in fixture for this venue, so the pool
 * bytes are a minimal synthesized 605-byte pool account with the mints at
 * their real offsets. The mint is classified by its OWNER: an extensionless
 * Token-2022 mint is 82 bytes, byte for byte a legacy one.
 */
import { address, getAddressEncoder } from "@solana/kit";
import {
  fetchWhalestreetPoolConfig,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WHALESTREET_OFF_MINT_A,
  WHALESTREET_OFF_MINT_B,
  WHALESTREET_OFF_VAULT_A,
  WHALESTREET_OFF_VAULT_B,
  WHALESTREET_PROGRAM_ID,
} from "../../../src/svm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const POOL = address("Hhugr5Bw2NpmM4zKgDcQpypnVG7UPjcFFtHeaTbz764h");
const MINT_A = address("So11111111111111111111111111111111111111112"); // wSOL
const MINT_B = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
const VAULT_A = address("5pVN5XZB8cYBjNLFrsBCPWkCQBan5K5Mq2dWGzwPgGJV");
const VAULT_B = address("9t4P5wMwfFkyn92Z7hf463qYKEZf8ERVZsGBEPNp8uJx");

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

function loader(target: string, mintData: Uint8Array): OwnedAccountLoader {
  const pool = poolBytes();
  return async (addr) => {
    if (String(addr) === String(POOL)) return { data: pool, owner: WHALESTREET_PROGRAM_ID };
    if (String(addr) === target) return { data: mintData, owner: TOKEN_2022_PROGRAM_ID };
    return null;
  };
}

describe("whalestreet Token-2022 self-drop", () => {
  test("legacy mints (unvendored) decode — legacy path unchanged", async () => {
    const base: OwnedAccountLoader = async (addr) =>
      String(addr) === String(POOL) ? { data: poolBytes(), owner: WHALESTREET_PROGRAM_ID } : null;
    const cfg = await fetchWhalestreetPoolConfig(base, POOL);
    expect(cfg.venue).toBe("whalestreet");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  test("a Token-2022 mintA self-drops", async () => {
    await expect(
      fetchWhalestreetPoolConfig(loader(String(MINT_A), makeT22Mint()), POOL),
    ).rejects.toThrow(/dropping pool/);
  });

  test("an 82-byte mintA owned by Token-2022 (extensionless) self-drops", async () => {
    await expect(
      fetchWhalestreetPoolConfig(loader(String(MINT_A), makeLegacyMint()), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable mintB self-drops as un-routable", async () => {
    await expect(
      fetchWhalestreetPoolConfig(loader(String(MINT_B), makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/dropping pool/);
  });

  test("legacy control: both mints served as 82-byte Tokenkeg-owned mints pass the owner gate", async () => {
    // The gate (fetchWhalestreetPoolConfig's mint loop) runs right before the return, so a config
    // built here means both mints were classified by their legacy owner and passed.
    const pool = poolBytes();
    const mintsServed: string[] = [];
    const load: OwnedAccountLoader = async (addr) => {
      if (String(addr) === String(POOL)) return { data: pool, owner: WHALESTREET_PROGRAM_ID };
      if (String(addr) === String(MINT_A) || String(addr) === String(MINT_B)) {
        mintsServed.push(String(addr));
        return { data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID };
      }
      return null;
    };
    const cfg = await fetchWhalestreetPoolConfig(load, POOL);
    expect(mintsServed).toEqual([MINT_A, MINT_B]);
    expect(cfg).toEqual({
      venue: "whalestreet",
      pool: POOL,
      direction: 0,
      mintA: MINT_A,
      mintB: MINT_B,
      vaultA: VAULT_A,
      vaultB: VAULT_B,
    });
  });

  test("an 82-byte mint owned by neither token program is refused", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [MINT_A, MINT_B]) {
      const pool = poolBytes();
      const load: OwnedAccountLoader = async (addr) => {
        if (String(addr) === String(POOL)) return { data: pool, owner: WHALESTREET_PROGRAM_ID };
        if (String(addr) === String(MINT_A) || String(addr) === String(MINT_B)) {
          return { data: makeLegacyMint(), owner: addr === mint ? foreign : TOKEN_PROGRAM_ID };
        }
        return null;
      };
      await expect(fetchWhalestreetPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
