/**
 * Moonit Token-2022 self-drop: the moon.it bonding-curve buy/sell ix is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 token mint must make
 * fetchPoolConfig THROW. No mainnet fixture is vendored for this venue, so this
 * builds a minimal synthetic CurveAccount (only the fields read before the mint
 * safety gate need be valid) and a Token-2022 mint account for its mint. A
 * legacy mint passes the gate (control: it reaches the later curve_type gate).
 * A mint is classified by its OWNER: an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one, so only the owner can tell them apart.
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { MOONIT_PROGRAM_ID, moonit } from "../../../src/svm/venues/moonit/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { makeT22Mint, makeLegacyMint } from "../fixtures/token-2022/synth.js";

const POOL = address("GnM6fY3hDnt6fUBrRK89xZQ5cdayvHnz6TWrnYan9Es6");
const MINT = address("8FCTHXhJmkhtYSvapLh4ACCzQEdHf1ab97Mavzac3Y3y");
const CURVE_DISCRIMINATOR = [8, 91, 83, 28, 132, 216, 248, 22];

/** A minimal 84-byte CurveAccount: discriminator + mint@24 + curve_type@58. */
function makeCurve(curveType: number): Uint8Array {
  const buf = new Uint8Array(84);
  buf.set(CURVE_DISCRIMINATOR, 0);
  buf.set(getAddressCodec().encode(MINT), 24);
  buf[58] = curveType;
  return buf;
}

function loaderWith(
  mint: { data: Uint8Array; owner: Address } | null,
  curveType = 0,
): OwnedAccountLoader {
  const curve = makeCurve(curveType);
  return async (addr) => {
    if (addr === POOL) return { data: new Uint8Array(curve), owner: MOONIT_PROGRAM_ID };
    if (addr === MINT)
      return mint === null ? null : { data: new Uint8Array(mint.data), owner: mint.owner };
    return null;
  };
}

describe("moonit Token-2022 self-drop", () => {
  it("drops the pool when the token mint is Token-2022", async () => {
    await expect(
      moonit.fetchPoolConfig(
        loaderWith({ data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID }),
        POOL,
      ),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when the token mint is an extensionless (82-byte) Token-2022 mint", async () => {
    await expect(
      moonit.fetchPoolConfig(
        loaderWith({ data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID }),
        POOL,
      ),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("passes the Token-2022 gate for a legacy mint (reaches the curve_type gate)", async () => {
    // curve_type 1 (ConstantProductV1) is unimplemented — reaching that gate
    // proves the legacy mint got PAST the Token-2022 safety block unchanged.
    await expect(
      moonit.fetchPoolConfig(
        loaderWith({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID }, 1),
        POOL,
      ),
    ).rejects.toThrow(/not LinearV1/);
  });
});
