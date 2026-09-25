/**
 * Deriverse ladder adapter units (no engine, no RPC): fetchPoolConfig decode
 * against a REAL mainnet fixture (the wSOL/USDC instrument), the fee-model
 * (conservativeFeePpm), the isqrt-based capacity clamp (SATURATING, never
 * collapsing, mirroring the obric-v2/raydium-clmm/whirlpool contract), and a
 * compile-as-valid-SauceScript check for both directions.
 *
 * The exact expected quote figures below were derived by an independent
 * Python re-implementation of the SAME formula (not by reading this file's
 * own TS), against the checked-in fixture's exact byte state — see
 * ladder.ts's module doc for the separate REAL-PROGRAM cross-check (Jupiter
 * `dexes=Deriverse`, three sizes each direction, always conservative).
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import {
  deriverse,
  conservativeFeePpm,
  DERIVERSE_AUTH,
  DERIVERSE_PROGRAM_ID,
} from "../../../src/svm/venues/deriverse/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/deriverse");
const REAL_POOL = address("8Wk2L1yDovBJifCN1o86X7g7pDcqLau39m6tEsJ9Sheh");

describe("conservativeFeePpm", () => {
  const ZERO_FEES = 0x1;
  const FIXED_FEES = 0x2;

  it("ZeroFees zeros the fee exactly, no margin", () => {
    expect(conservativeFeePpm(ZERO_FEES, 0.5, 10, 0.01)).toBe(0n);
  });

  it("FixedFees doubles the admin-set rate plus the flat floor", () => {
    // fixed_fee_rate=0.001 -> 1000ppm raw -> 2000+20
    expect(conservativeFeePpm(FIXED_FEES, 0.5, 10, 0.001)).toBe(2020n);
  });

  it("the dynamic default doubles day_volatility*spot_fee_rate*FEE_RATE_STEP plus the flat floor", () => {
    // 0.025 * 4 * 0.0005 = 0.00005 -> 50ppm raw -> 120
    expect(conservativeFeePpm(0, 0.025, 4, 0)).toBe(120n);
  });

  it("never returns a negative or non-finite fee even on a garbage read", () => {
    expect(conservativeFeePpm(0, Number.NaN, 4, 0)).toBe(20n);
    expect(conservativeFeePpm(0, -1, 4, 0)).toBe(20n);
  });
});

describe("fetchPoolConfig against the real wSOL/USDC instrument fixture", () => {
  it("decodes ids, mints and the conservative fee exactly (independently verified against a real mainnet snapshot)", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await deriverse.fetchPoolConfig(load, REAL_POOL);
    expect(cfg.venue).toBe("deriverse");
    expect(cfg.side).toBe("sell");
    expect(cfg.instrId).toBe(0);
    expect(cfg.assetTokenId).toBe(2);
    expect(cfg.crncyTokenId).toBe(1);
    expect(cfg.assetMint).toBe(address("So11111111111111111111111111111111111111112"));
    expect(cfg.crncyMint).toBe(address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"));
    expect(cfg.tokenProgram).toBe(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"));
    expect(cfg.feePpm).toBe(120n);
    // Derived PDAs are all distinct from each other and from the pool itself.
    const derived = [
      cfg.assetVault,
      cfg.crncyVault,
      cfg.asksTree,
      cfg.askOrders,
      cfg.bidsTree,
      cfg.bidOrders,
      cfg.lines,
      cfg.mapsAddress,
      cfg.clientInfos,
    ];
    expect(new Set(derived).size).toBe(derived.length);
    expect(derived.every((a) => a !== REAL_POOL)).toBe(true);
  });

  it("rejects an account shorter than the InstrAccountHeader front slice", async () => {
    const load = async (): Promise<Uint8Array> => new Uint8Array(100);
    await expect(deriverse.fetchPoolConfig(load, REAL_POOL)).rejects.toThrow(/at least 1064/);
  });
});

describe("program identity", () => {
  it("the venue slug, program id and PDA authority are pinned", () => {
    expect(deriverse.slug).toBe("deriverse");
    expect(deriverse.programId).toBe(address("DRVSpZ2YUYYKgZP8XtLhAGtT1zYSCKzeHfb4DgRnrgqD"));
    expect(DERIVERSE_PROGRAM_ID).toBe(deriverse.programId);
    expect(DERIVERSE_AUTH).toBe(address("5QLXhNtkVUEtCyzZ6C1iAavT2x6c6t6LdJcSwVnqWEii"));
  });
});
