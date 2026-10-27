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
 * adapter's own PDA check passes and control reaches detectTokenProgram. A
 * mint's token program is its OWNER (an extensionless Token-2022 mint is 82
 * bytes, byte for byte a legacy one); with a synthetic Global and FeeConfig the
 * fetch completes and the resolved base token program is asserted.
 */
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
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
const GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127];
const FEE_CONFIG_DISCRIMINATOR = [143, 52, 146, 187, 219, 123, 76, 155];
const FEE_PROGRAM = address("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

type Mint = { data: Uint8Array; owner: Address };
const t22 = (data = makeT22Mint()): Mint => ({ data, owner: TOKEN_2022_PROGRAM_ID });
const legacy = (): Mint => ({ data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID });

/** A Global with its discriminator and zeroed fee recipients (read up to byte 773). */
function makeGlobal(): Uint8Array {
  const buf = new Uint8Array(773);
  buf.set(GLOBAL_DISCRIMINATOR, 0);
  return buf;
}

/** A FeeConfig with its discriminator and one all-zero fee tier (count u32 @65, 40-byte tier @69). */
function makeFeeConfig(): Uint8Array {
  const buf = new Uint8Array(69 + 40);
  buf.set(FEE_CONFIG_DISCRIMINATOR, 0);
  buf[65] = 1;
  return buf;
}

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

/**
 * The bonding curve and `mint` (with its owner); Global and FeeConfig are present but carry the
 * wrong discriminator unless `configs`, which makes them valid so the fetch completes.
 */
function loaderWith(pool: Address, mint: Mint, configs = false): OwnedAccountLoader {
  const bc = makeBondingCurve();
  return async (addr) => {
    if (addr === pool) return { data: new Uint8Array(bc), owner: PROGRAM };
    if (addr === MINT) return { data: new Uint8Array(mint.data), owner: mint.owner };
    if (addr === GLOBAL)
      return { data: configs ? makeGlobal() : new Uint8Array(8), owner: PROGRAM };
    if (addr === FEE_CONFIG)
      return { data: configs ? makeFeeConfig() : new Uint8Array(8), owner: FEE_PROGRAM };
    return null;
  };
}

describe("pumpfun-bonding-curve Token-2022 handling", () => {
  it("passes the token gate for a zero-fee (extensionless) Token-2022 base mint", async () => {
    const pool = await bondingCurvePda(MINT);
    // Passing detectTokenProgram surfaces the (deliberately wrong) global-config
    // discriminator — proof the Token-2022 base mint was NOT dropped.
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(loaderWith(pool, t22()), pool, MINT),
    ).rejects.toThrow(`pumpfun-bonding-curve global ${GLOBAL} discriminator mismatch`);
  });

  it("passes the token gate for a legacy 82-byte base mint (byte-identical legacy path)", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(loaderWith(pool, legacy()), pool, MINT),
    ).rejects.toThrow(`pumpfun-bonding-curve global ${GLOBAL} discriminator mismatch`);
  });

  it("resolves an extensionless (82-byte) Token-2022 base mint to Token-2022, by its owner", async () => {
    const pool = await bondingCurvePda(MINT);
    const cfg = await pumpfunBondingCurve.fetchPoolConfig(
      loaderWith(pool, t22(makeLegacyMint()), true),
      pool,
      MINT,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("resolves a Tokenkeg-owned 82-byte base mint to Tokenkeg (control)", async () => {
    const pool = await bondingCurvePda(MINT);
    const cfg = await pumpfunBondingCurve.fetchPoolConfig(
      loaderWith(pool, legacy(), true),
      pool,
      MINT,
    );
    expect(cfg.baseTokenProgram).toBe(TOKEN_PROGRAM_ID);
  });

  it("drops the pool when the base mint carries a blocking NonTransferable extension", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(
        loaderWith(pool, t22(makeT22Mint(NON_TRANSFERABLE_TLV))),
        pool,
        MINT,
      ),
    ).rejects.toThrow(/un-routable/);
  });

  it("still rejects a TransferFeeConfig base mint (fee-netting is a documented follow-up)", async () => {
    const pool = await bondingCurvePda(MINT);
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(
        loaderWith(pool, t22(makeT22Mint(tlvEntry(1, new Uint8Array(108))))),
        pool,
        MINT,
      ),
    ).rejects.toThrow(/TransferFeeConfig/);
  });

  it("refuses an 82-byte base mint owned by neither token program", async () => {
    const pool = await bondingCurvePda(MINT);
    const foreign = address("11111111111111111111111111111111");
    await expect(
      pumpfunBondingCurve.fetchPoolConfig(
        loaderWith(pool, { data: makeLegacyMint(), owner: foreign }, true),
        pool,
        MINT,
      ),
    ).rejects.toThrow(
      `token-program: mint ${MINT} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
    );
  });
});
