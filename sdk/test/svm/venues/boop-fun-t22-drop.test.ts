/**
 * boop-fun Token-2022 self-drop: a BondingCurve whose base mint is a Token-2022
 * mint (or one carrying a blocking extension) must REJECT at fetchPoolConfig.
 * The CPI supplies exactly ONE token_program account, so a Token-2022 base mint
 * has no correct program to route its transfer through — legacy-SPL only.
 */
import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { boopFun, BOOP_FUN_PROGRAM_ID } from "../../../src/svm/venues/boop-fun/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

/** PDA(["config"], PROGRAM) — the fixed config account the fetch loads. */
const CONFIG = address("AbgFqRWjGWgUaVrZrLLWU5HDY5dktmAL6zT9aacQW7y1");
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

const mintBytes = (() => {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = ((i * 23) % 250) + 1;
  return b;
})();
const T22_MINT = getAddressDecoder().decode(mintBytes);

// The bonding-curve account must be its own mint's canonical PDA.
async function deriveBondingCurve(): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: BOOP_FUN_PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("bonding_curve"),
      new Uint8Array(getAddressEncoder().encode(T22_MINT)),
    ],
  });
  return pda;
}

function bondingCurveBytes(): Uint8Array {
  const data = new Uint8Array(125);
  data.set(BONDING_CURVE_DISCRIMINATOR, 0);
  data.set(mintBytes, 40); // mint @40 -> the Token-2022 mint
  data[120] = 31; // damping_term (not the legacy 30)
  data[124] = 0; // status = Trading
  return data;
}

function loaderWith(
  pool: string,
  mint: Uint8Array | null,
  mintOwner: Address = TOKEN_2022_PROGRAM_ID,
): OwnedAccountLoader {
  return async (a) => {
    if (a === pool) return { data: bondingCurveBytes(), owner: BOOP_FUN_PROGRAM_ID };
    if (a === T22_MINT) return mint === null ? null : { data: mint, owner: mintOwner };
    // non-null; disc/pause checks run AFTER the mint block
    if (a === CONFIG) return { data: new Uint8Array(16), owner: BOOP_FUN_PROGRAM_ID };
    return null;
  };
}

describe("boop-fun Token-2022 self-drop", () => {
  it("drops a pool whose base mint is a Token-2022 mint", async () => {
    const pool = await deriveBondingCurve();
    await expect(
      boopFun.fetchPoolConfig(loaderWith(pool, makeT22Mint()), address(pool)),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose base mint is a Token-2022 mint carrying an extension", async () => {
    const pool = await deriveBondingCurve();
    await expect(
      boopFun.fetchPoolConfig(loaderWith(pool, makeT22Mint(NON_TRANSFERABLE_TLV)), address(pool)),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops a pool whose base mint is an extensionless 82-byte mint owned by Token-2022", async () => {
    const pool = await deriveBondingCurve();
    await expect(
      boopFun.fetchPoolConfig(
        loaderWith(pool, makeLegacyMint(), TOKEN_2022_PROGRAM_ID),
        address(pool),
      ),
    ).rejects.toThrow(/Token-2022/);
  });
});
