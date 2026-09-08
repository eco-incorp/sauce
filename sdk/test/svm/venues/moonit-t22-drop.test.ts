/**
 * Moonit Token-2022 self-drop: the moon.it bonding-curve buy/sell ix is
 * legacy-SPL (Tokenkeg) only, so a Token-2022 token mint must make
 * fetchPoolConfig THROW. No mainnet fixture is vendored for this venue, so this
 * builds a minimal synthetic CurveAccount (only the fields read before the mint
 * safety gate need be valid) and a Token-2022 mint account for its mint. A
 * legacy mint passes the gate (control: it reaches the later curve_type gate).
 */
import { address, getAddressCodec } from "@solana/kit";
import type { AccountLoader } from "../../../src/svm/index.js";
import { moonit } from "../../../src/svm/venues/moonit/index.js";
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

function loaderWith(mintData: Uint8Array | null, curveType = 0): AccountLoader {
  const curve = makeCurve(curveType);
  return async (addr) => {
    if (addr === POOL) return new Uint8Array(curve);
    if (addr === MINT) return mintData === null ? null : new Uint8Array(mintData);
    return null;
  };
}

describe("moonit Token-2022 self-drop", () => {
  it("drops the pool when the token mint is Token-2022", async () => {
    await expect(moonit.fetchPoolConfig(loaderWith(makeT22Mint()), POOL)).rejects.toThrow(
      /is Token-2022/,
    );
  });

  it("passes the Token-2022 gate for a legacy mint (reaches the curve_type gate)", async () => {
    // curve_type 1 (ConstantProductV1) is unimplemented — reaching that gate
    // proves the legacy mint got PAST the Token-2022 safety block unchanged.
    await expect(moonit.fetchPoolConfig(loaderWith(makeLegacyMint(), 1), POOL)).rejects.toThrow(
      /not LinearV1/,
    );
  });
});
