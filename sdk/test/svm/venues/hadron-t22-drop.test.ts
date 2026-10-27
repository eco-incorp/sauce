/**
 * hadron Token-2022 self-drop: a synthesized (otherwise valid, registry-matched)
 * PAIR account whose mintA is a Token-2022 mint must make fetchHadronConfig
 * REJECT (the graceful self-drop signal). The Token-2022 check runs before the
 * ATA vault derivation, so the drop needs no vault fixtures; the legacy path
 * (mints classic, vaults present) is unaffected. A mint is classified by its
 * OWNER: an extensionless Token-2022 mint is 82 bytes, byte for byte a legacy
 * one, so only the owner can tell them apart.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  TOKEN_2022_PROGRAM_ID,
  type AccountLoader,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import {
  fetchHadronConfig,
  HADRON_PAIR_ACCOUNT_SIZE,
  HADRON_TOKEN_PROGRAM,
  HADRON_SPL_TOKEN_ACCOUNT_SIZE,
} from "../../../src/svm/venues/hadron/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";
import { ownedByShape } from "../fixtures.js";

const POOL = address("CcWf5D6BhUTv2tD4ebFFcmCdTUgBWMc8CqqoJvFHGGXi");
// mintA MUST be a HADRON_ASSET_REGISTRY key, mintB its registered quote.
const MINT_A = address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"); // jitoSOL
const MINT_B = address("So11111111111111111111111111111111111111112"); // WSOL

const codec = getAddressCodec();
function writePubkey(buf: Uint8Array, off: number, addr: Address): void {
  buf.set(new Uint8Array(codec.encode(addr)), off);
}

function buildPair(): Uint8Array {
  const data = new Uint8Array(HADRON_PAIR_ACCOUNT_SIZE);
  writePubkey(data, 41, MINT_A); // HADRON_OFF_MINT_A
  writePubkey(data, 73, MINT_B); // HADRON_OFF_MINT_B
  writePubkey(data, 106, MINT_B); // HADRON_OFF_ASSET_CFG_B (any 32B pubkey)
  return data;
}

/** Owners by data shape, with `owners` naming the ones a test sets explicitly. */
function loaderFrom(
  map: Record<string, Uint8Array>,
  owners: Record<string, Address> = {},
): OwnedAccountLoader {
  const data: AccountLoader = async (addr: Address) => map[addr] ?? null;
  const byShape = ownedByShape(data);
  return async (addr: Address) => {
    const account = await byShape(addr);
    const owner = owners[addr];
    return account === null || owner === undefined ? account : { data: account.data, owner };
  };
}

describe("hadron Token-2022 self-drop", () => {
  it("REJECTS a pool whose mintA is a Token-2022 mint", async () => {
    const load = loaderFrom(
      {
        [POOL]: buildPair(),
        [MINT_A]: makeT22Mint(),
        [MINT_B]: makeLegacyMint(),
      },
      { [MINT_A]: TOKEN_2022_PROGRAM_ID },
    );
    await expect(fetchHadronConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("REJECTS a pool whose mintA is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = loaderFrom(
      {
        [POOL]: buildPair(),
        [MINT_A]: makeLegacyMint(),
        [MINT_B]: makeLegacyMint(),
      },
      { [MINT_A]: TOKEN_2022_PROGRAM_ID },
    );
    await expect(fetchHadronConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("does NOT drop a classic-legacy pool", async () => {
    const [vaultA] = await findAssociatedTokenPda({
      owner: POOL,
      mint: MINT_A,
      tokenProgram: HADRON_TOKEN_PROGRAM,
    });
    const [vaultB] = await findAssociatedTokenPda({
      owner: POOL,
      mint: MINT_B,
      tokenProgram: HADRON_TOKEN_PROGRAM,
    });
    const load = loaderFrom({
      [POOL]: buildPair(),
      [MINT_A]: makeLegacyMint(),
      [MINT_B]: makeLegacyMint(),
      [vaultA]: new Uint8Array(HADRON_SPL_TOKEN_ACCOUNT_SIZE),
      [vaultB]: new Uint8Array(HADRON_SPL_TOKEN_ACCOUNT_SIZE),
    });
    const cfg = await fetchHadronConfig(load, POOL);
    expect(cfg.venue).toBe("hadron");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  it("REJECTS a pool whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [MINT_A, MINT_B]) {
      const load = loaderFrom(
        {
          [POOL]: buildPair(),
          [MINT_A]: makeLegacyMint(),
          [MINT_B]: makeLegacyMint(),
        },
        { [mint]: foreign },
      );
      await expect(fetchHadronConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
