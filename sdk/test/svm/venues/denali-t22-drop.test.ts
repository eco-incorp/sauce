/**
 * Denali Token-2022 self-drop: this venue's on-chain swap ix is legacy-SPL
 * (Tokenkeg) only, so fetchPoolConfig must DROP a pool whose mintA or mintB is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). A
 * synthesized 517-byte pool (correct discriminator + mint pubkeys at the real
 * offsets) reaches the mint gate; the drop fires before the oracle PDA is even
 * derived. A classic 82-byte mint on both sides is the legacy control. A mint
 * is classified by its OWNER: an extensionless Token-2022 mint is 82 bytes,
 * byte for byte a legacy one, so only the owner can tell them apart.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { denali } from "../../../src/svm/venues/denali/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

type Mint = { data: Uint8Array; owner: Address };
const t22 = (data = makeT22Mint()): Mint => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (): Mint => ({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID });
const DENALI_PROGRAM = address("DNL1tgEj3nJovHw9jtyCCQD3arssCJzkmpDizknwzey4");

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

function loaderWith(mints: Record<string, Mint>): OwnedAccountLoader {
  const pool = synthPool();
  return async (addr: Address) => {
    if (addr === POOL) return { data: new Uint8Array(pool), owner: DENALI_PROGRAM };
    const m = mints[addr as string];
    return m === undefined ? null : { data: new Uint8Array(m.data), owner: m.owner };
  };
}

describe("denali Token-2022 self-drop", () => {
  it("drops the pool when mintA is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: t22(), [MINT_B]: legacy() });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when mintB is a Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: t22() });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when a mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: t22(makeLegacyMint()) });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("builds the config for two classic legacy mints (proves the gate is byte-transparent)", async () => {
    const load = loaderWith({ [MINT_A]: legacy(), [MINT_B]: legacy() });
    const cfg = await denali.fetchPoolConfig(load, POOL);
    expect(cfg.venue).toBe("denali");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const load = loaderWith({
      [MINT_A]: legacy(),
      [MINT_B]: { data: makeLegacyMint(), owner: foreign },
    });
    await expect(denali.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `token-program: mint ${MINT_B} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
