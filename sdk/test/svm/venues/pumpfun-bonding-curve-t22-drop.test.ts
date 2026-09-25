/**
 * pumpfun-bonding-curve Token-2022 handling. The base mint's token program is
 * resolved per mint (the quote side is always native-SOL/wSOL = legacy). A
 * zero-fee / advisory-only Token-2022 base mint must PASS the token gate (it
 * then reaches the global-config discriminator check — surfaced here as the
 * "passed the gate" signal, mirroring the perena-star self-drop test), a legacy
 * mint reaches the same point, and only a blocking (NonTransferable / frozen)
 * mint self-drops. A TransferFeeConfig mint stays rejected (fee netting is a
 * documented follow-up — see TODO(t22-fee-netting) in the adapter).
 *
 * No mainnet fixture is vendored, so this builds a minimal synthetic
 * BondingCurve account and derives its ["bonding-curve", mint] PDA so the
 * adapter's own PDA check passes and control reaches detectTokenProgram.
 */
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import type { AccountLoader } from "../../../src/svm/index.js";
import { pumpfunBondingCurve } from "../../../src/svm/venues/pumpfun-bonding-curve/index.js";
import {
  makeT22Mint,
  makeLegacyMint,
  tlvEntry,
  NON_TRANSFERABLE_TLV,
} from "../fixtures/token-2022/synth.js";

const PROGRAM = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const GLOBAL = address("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");
const FEE_CONFIG = address("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
const MINT = address("BXZc6HkQFPZBTbCt1wawvLAsYyH7vEGCY4u8DCwEpump");
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];

/** A minimal 115-byte BondingCurve: disc + not-complete/mayhem/cashback + native-SOL sentinel quote_mint. */
function makeBondingCurve(): Uint8Array {
  const buf = new Uint8Array(115);
  buf.set(BONDING_CURVE_DISCRIMINATOR, 0);
  // complete@48, is_mayhem_mode@81, is_cashback_coin@82, quote_mint@83 all stay 0
  // (0 == false, and an all-zero quote_mint is the required native-SOL sentinel).
  return buf;
}

async function bondingCurvePda(mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: [new TextEncoder().encode("bonding-curve"), new Uint8Array(enc.encode(mint))],
  });
  return pda;
}

function loaderWith(pool: Address, mintData: Uint8Array): AccountLoader {
  const bc = makeBondingCurve();
  return async (addr) => {
    if (addr === pool) return new Uint8Array(bc);
    if (addr === MINT) return new Uint8Array(mintData);
    if (addr === GLOBAL) return new Uint8Array(8); // present but wrong discriminator
    if (addr === FEE_CONFIG) return new Uint8Array(8);
    return null;
  };
}

describe("pumpfun-bonding-curve Token-2022 handling", () => {
  it("passes the token gate for a zero-fee (extensionless) Token-2022 base mint", async () => {
    const pool = await bondingCurvePda(MINT);
    // Passing detectTokenProgram surfaces the (deliberately wrong) global-config
    // discriminator — proof the Token-2022 base mint was NOT dropped.
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(loaderWith(pool, makeT22Mint()), pool, MINT),
    ).rejects.toThrow(`pumpfun-bonding-curve global ${GLOBAL} discriminator mismatch`);
  });

  it("passes the token gate for a legacy 82-byte base mint (byte-identical legacy path)", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(loaderWith(pool, makeLegacyMint()), pool, MINT),
    ).rejects.toThrow(`pumpfun-bonding-curve global ${GLOBAL} discriminator mismatch`);
  });

  it("drops the pool when the base mint carries a blocking NonTransferable extension", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(
        loaderWith(pool, makeT22Mint(NON_TRANSFERABLE_TLV)),
        pool,
        MINT,
      ),
    ).rejects.toThrow(/un-routable/);
  });

  it("still rejects a TransferFeeConfig base mint (fee-netting is a documented follow-up)", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(
        loaderWith(pool, makeT22Mint(tlvEntry(1, new Uint8Array(108)))),
        pool,
        MINT,
      ),
    ).rejects.toThrow(/TransferFeeConfig/);
  });
});
