/**
 * crema Token-2022 self-drop: a Clmmpool whose token mint is a Token-2022 mint
 * (or one carrying a blocking extension) must REJECT at fetchPoolConfig. The
 * swap ix's token_program account is a single fixed program (Tokenkeg only).
 * The mint is classified by its OWNER: an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one.
 */
import { address, getAddressDecoder } from "@solana/kit";
import { crema, CLMMPOOL_DISCRIMINATOR } from "../../../src/svm/venues/crema/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const POOL = getAddressDecoder().decode(
  Uint8Array.from({ length: 32 }, (_, i) => ((i * 3) % 250) + 1),
);

const OFF_MINT_A = 40;
const CLMMPOOL_ACCOUNT_SIZE = 748;
const OFF_IS_PAUSE = 747;

const mintBytes = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((i * 11) % 250) + 1;
  return b;
})();
const T22_MINT = getAddressDecoder().decode(mintBytes);

function poolBytes(): Uint8Array {
  const data = new Uint8Array(CLMMPOOL_ACCOUNT_SIZE);
  data.set(CLMMPOOL_DISCRIMINATOR, 0);
  data.set(mintBytes, OFF_MINT_A); // tokenMintA -> the Token-2022 mint
  data[OFF_IS_PAUSE] = 0;
  return data;
}

function loaderWith(mint: Uint8Array | null): OwnedAccountLoader {
  return async (a) => {
    if (a === POOL) return { data: poolBytes(), owner: SYSTEM_PROGRAM };
    if (a === T22_MINT && mint !== null) return { data: mint, owner: TOKEN_2022_PROGRAM_ID };
    return null;
  };
}

describe("crema Token-2022 self-drop", () => {
  it("drops a pool whose mint is a Token-2022 mint", async () => {
    await expect(crema.fetchPoolConfig(loaderWith(makeT22Mint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops a pool whose mint is a Token-2022 mint carrying an extension", async () => {
    await expect(
      crema.fetchPoolConfig(loaderWith(makeT22Mint(NON_TRANSFERABLE_TLV)), POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose mint is 82 bytes but owned by Token-2022 (extensionless)", async () => {
    await expect(crema.fetchPoolConfig(loaderWith(makeLegacyMint()), POOL)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("does NOT drop for an unreadable mint (falls back to the legacy assumption)", async () => {
    // A null mint -> `continue` -> no Token-2022 drop. The fetch then either
    // resolves or fails for an unrelated reason, but NEVER with a T22 message.
    await crema.fetchPoolConfig(loaderWith(null), POOL).catch((e: unknown) => {
      expect(String(e)).not.toMatch(/Token-2022|un-routable/);
    });
  });
});
