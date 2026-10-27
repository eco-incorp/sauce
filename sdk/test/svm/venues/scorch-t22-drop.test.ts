/**
 * scorch Token-2022 self-drop: a PairConfig one of whose mints is a Token-2022
 * mint must SELF-DROP (fetchPoolConfig throws — the ONE pool leaves discovery)
 * because the ROUTER's swap CPI is legacy-SPL only. Synthesizes a minimal
 * 658-byte PairConfig (tag + the two mint slots) and answers a Token-2022 mint
 * for the mint accounts. A mint is classified by its OWNER: an extensionless
 * Token-2022 mint is 82 bytes, byte for byte a legacy one, so only the owner can
 * tell them apart.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { scorch } from "../../../src/svm/venues/scorch/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const PAIR_CONFIG_SIZE = 658;
const POOL = address("So11111111111111111111111111111111111111112");

function pairConfig(): Uint8Array {
  const buf = new Uint8Array(PAIR_CONFIG_SIZE);
  buf[0] = 0x02; // PAIR_TAG
  buf.set(new Uint8Array(32).fill(7), 16); // mintA @16
  buf.set(new Uint8Array(32).fill(9), 82); // mintB @82
  return buf;
}

/** The two mint slots `pairConfig` writes. */
const MINT_A = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const MINT_B = getAddressDecoder().decode(new Uint8Array(32).fill(9));

/** The pair at POOL; every other address answers `mintData`, owned by Token-2022. */
function loaderWith(mintData: () => Uint8Array): OwnedAccountLoader {
  const buf = pairConfig();
  return async (addr) =>
    addr === POOL
      ? { data: new Uint8Array(buf), owner: scorch.programId }
      : { data: mintData(), owner: TOKEN_2022_PROGRAM_ID };
}

describe("scorch: Token-2022 mint self-drop", () => {
  it("rejects a pair whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    await expect(scorch.fetchPoolConfig(loaderWith(makeT22Mint), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("rejects a pair whose mint is an extensionless (82-byte) Token-2022 mint", async () => {
    await expect(scorch.fetchPoolConfig(loaderWith(makeLegacyMint), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("legacy control: both mints served as 82-byte Tokenkeg-owned mints pass the owner gate", async () => {
    // The gate (fetchPoolConfig's mint loop) runs before the AssetConfig lookup, so failing on
    // mintA's missing AssetConfig means both mints were classified by their legacy owner and passed.
    const buf = pairConfig();
    const mintsServed: Address[] = [];
    const load: OwnedAccountLoader = async (addr) => {
      if (addr === POOL) return { data: new Uint8Array(buf), owner: scorch.programId };
      if (addr === MINT_A || addr === MINT_B) {
        mintsServed.push(addr);
        return { data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID };
      }
      return null;
    };
    await expect(scorch.fetchPoolConfig(load, POOL)).rejects.toThrow(
      `scorch pool ${POOL}: no known AssetConfig for mint ${MINT_A} — refresh the consuming app scorch-asset-configs venue module`,
    );
    expect(mintsServed).toEqual([MINT_A, MINT_B]);
  });

  it("rejects a pair whose 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const buf = pairConfig();
    for (const mint of [MINT_A, MINT_B]) {
      const load: OwnedAccountLoader = async (addr) =>
        addr === POOL
          ? { data: new Uint8Array(buf), owner: scorch.programId }
          : { data: makeLegacyMint(), owner: addr === mint ? foreign : TOKEN_PROGRAM_ID };
      await expect(scorch.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
