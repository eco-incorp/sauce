/**
 * riptide Token-2022 self-drop: a pool holding a Token-2022 mint must DROP
 * (fetchPoolConfig throws — the SvmRoute graceful-drop signal), because the
 * swap ix is legacy-SPL (Tokenkeg) only. No mainnet fixture exists for this
 * closed-source prop AMM, so the 1024-byte pool account is synthesized with two
 * real mint addresses at the decoded offsets; the vaults are pure ATA PDA math
 * (no account read), so only the pool + a T22 mint are needed to exercise the
 * drop.
 */
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  fetchPoolConfig,
  OFF_MINT_A,
  OFF_MINT_B,
  POOL_ACCOUNT_SIZE,
} from "../../../src/svm/venues/riptide/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { ownedByShape } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const POOL = address("6Vzx4ASRjUPW2yBxHdBT3hDam2zxB6UmhM2MYYM5k8ci");
const MINT_A = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
const MINT_B = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"); // USDT
const enc = getAddressEncoder();

function synthPool(): Uint8Array {
  const data = new Uint8Array(POOL_ACCOUNT_SIZE);
  data.set(enc.encode(MINT_A), OFF_MINT_A);
  data.set(enc.encode(MINT_B), OFF_MINT_B);
  return data;
}

function loader(mintOverrides: Record<string, Uint8Array>): OwnedAccountLoader {
  const pool = synthPool();
  return ownedByShape(async (addr) => {
    if (addr === POOL) return pool;
    if (addr in mintOverrides) return mintOverrides[addr];
    return null;
  });
}

describe("riptide Token-2022 self-drop", () => {
  it("legacy path is unchanged (mints unvendored → legacy assumption)", async () => {
    await expect(fetchPoolConfig(loader({}), POOL)).resolves.toBeDefined();
  });

  it("a vendored legacy (82-byte) mint keeps the pool routable", async () => {
    await expect(
      fetchPoolConfig(loader({ [MINT_A]: makeLegacyMint(), [MINT_B]: makeLegacyMint() }), POOL),
    ).resolves.toBeDefined();
  });

  it("drops when mintA is a Token-2022 mint", async () => {
    await expect(fetchPoolConfig(loader({ [MINT_A]: makeT22Mint() }), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops when mintB is a Token-2022 mint", async () => {
    await expect(fetchPoolConfig(loader({ [MINT_B]: makeT22Mint() }), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops when mintA is an 82-byte mint owned by Token-2022 (extensionless Token-2022)", async () => {
    const shaped = loader({ [MINT_B]: makeLegacyMint() });
    const load: OwnedAccountLoader = async (addr) =>
      addr === MINT_A ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID } : shaped(addr);
    await expect(fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("legacy control: both mints served as 82-byte Tokenkeg-owned mints pass the owner gate", async () => {
    // The gate (fetchPoolConfig's mint loop) runs before the vault derivation and the return, so a
    // config built here means both mints were classified by their legacy owner and passed.
    const shaped = loader({});
    const mintsServed: Address[] = [];
    const load: OwnedAccountLoader = async (addr) => {
      if (addr === MINT_A || addr === MINT_B) {
        mintsServed.push(addr);
        return { data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID };
      }
      return shaped(addr);
    };
    const cfg = await fetchPoolConfig(load, POOL);
    expect(mintsServed).toEqual([MINT_A, MINT_B]);
    const [vaultA] = await findAssociatedTokenPda({
      owner: POOL,
      mint: MINT_A,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    const [vaultB] = await findAssociatedTokenPda({
      owner: POOL,
      mint: MINT_B,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    expect(cfg).toEqual({
      venue: "riptide",
      pool: POOL,
      direction: 0,
      mintA: MINT_A,
      mintB: MINT_B,
      vaultA,
      vaultB,
    });
  });

  it("refuses the pool when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [MINT_A, MINT_B]) {
      const shaped = loader({ [MINT_A]: makeLegacyMint(), [MINT_B]: makeLegacyMint() });
      const load: OwnedAccountLoader = async (addr) =>
        addr === mint ? { data: makeLegacyMint(), owner: foreign } : shaped(addr);
      await expect(fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
