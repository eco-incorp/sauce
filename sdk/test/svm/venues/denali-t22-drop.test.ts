/**
 * Denali Token-2022 self-drop: this venue's on-chain swap ix is legacy-SPL
 * (Tokenkeg) only, so fetchPoolConfig must DROP a pool whose mintA or mintB is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). A
 * synthesized 517-byte pool (correct discriminator + mint pubkeys at the real
 * offsets) reaches the mint gate; the drop fires before the oracle PDA is even
 * derived. A classic 82-byte mint on both sides is the legacy control.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { denali } from "../../../src/svm/venues/denali/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("46TF9vo4oqnLuY7LrueQybyJoLsgMeauUhTHFYfcgFyJ");
const MINT_A = address("So11111111111111111111111111111111111111112"); // wSOL
const MINT_B = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

// Constant Anchor-style discriminator dbbed53700e3c69a and the fixed 517-byte size.
const POOL_DISCRIMINATOR = [0xdb, 0xbe, 0xd5, 0x37, 0x00, 0xe3, 0xc6, 0x9a];
const POOL_ACCOUNT_SIZE = 517;
const OFF_MINT_A = 72;
const OFF_MINT_B = 104;

function synthPool(): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(POOL_DISCRIMINATOR, 0);
  const enc = getAddressEncoder();
  data.set(enc.encode(MINT_A), OFF_MINT_A);
  data.set(enc.encode(MINT_B), OFF_MINT_B);
  return data;
}

function loaderWith(mintBytes: Record<string, Uint8Array>): AccountLoader {
  const pool = synthPool();
  return async (addr: Address) => {
    if (addr === POOL) return new Uint8Array(pool);
    const m = mintBytes[addr as string];
    return m === undefined ? null : new Uint8Array(m);
  };
}

describe("denali Token-2022 self-drop", () => {
  it("drops the pool when mintA is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: makeT22Mint(), [MINT_B]: makeLegacyMint() });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when mintB is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: makeLegacyMint(), [MINT_B]: makeT22Mint() });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("builds the config for two classic legacy mints (proves the gate is byte-transparent)", async () => {
    const load = loaderWith({ [MINT_A]: makeLegacyMint(), [MINT_B]: makeLegacyMint() });
    const cfg = await denali.fetchPoolConfig(load, POOL);
    expect(cfg.venue).toBe("denali");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });
});
