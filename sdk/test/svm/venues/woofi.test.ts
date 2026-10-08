/**
 * woofi (Solana sPMM) ladder adapter units (no engine, no RPC). See
 * ../../../src/svm/venues/woofi/index.ts for the full math/account-layout
 * citation (source-verified against the audited Anchor program AND
 * cross-checked byte-for-byte against 6 real mainnet swap transactions).
 *
 * THE REAL FIXTURE (SOL/USDC, pool BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs,
 * dumped 2026-07-31) is a live example of the venue's OWN feasibility gate
 * firing FOR REAL: at dump time the keeper-posted `wooracle.price` (from
 * 2026-04-ish) sat ~16% away from the live Pyth cross-price — outside the
 * pool's 1% `bound` — so `get_price_impl` is genuinely infeasible right now
 * (this pool's most recent 10 real on-chain swap attempts are ALL failed
 * transactions, consistent with that). This adapter's job is exactly to
 * self-drop (predict 0) rather than emit a value the real program would
 * revert on — see the first describe block. A SYNTHETIC-but-decode-realistic
 * variant (the SAME fixture with only the Pyth price + timestamps patched so
 * the feasibility gate passes, mirroring obric-v2.test.ts's own "the real
 * fixture happens to be degenerate, so the interesting case uses a patched
 * fixture" precedent) exercises the actual sPMM math, monotonicity, and the
 * live-vault capacity clamp — this venue's real vaults are genuinely thin
 * (2.25 USDC / 0.0049 SOL at dump time), so the clamp is not a hypothetical.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import {
  fetchWoofiConfig,
  OFF_POOL_CAP_BAL,
  OFF_POOL_MIN_SWAP_AMOUNT,
  OFF_POOL_UNCLAIMED_FEE,
  woofi,
} from "../../../src/svm/venues/woofi/index.js";
import * as woofiModule from "../../../src/svm/venues/woofi/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";

const REAL_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/woofi");
const PATCHED_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/woofi-patched");
const POOL = address("BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs");

describe("fetchWoofiConfig: decodes the real WooAmmPool bundle + resolves the base/quote sides", () => {
  it("SOL is base, USDC is quote (matches the official docs’ named Wooracle addresses)", async () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await fetchWoofiConfig(load, POOL);
    expect(cfg.direction).toBe("sellBase");
    expect(cfg.tokenMintBase).toBe(address("So11111111111111111111111111111111111111112"));
    expect(cfg.quoteTokenMint).toBe(address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"));
    // Named in WooFi's own Solana dev docs as "SOL Wooracle" / "USDC Wooracle".
    expect(cfg.wooracleBase).toBe(address("mjkf7dn23RrwPphKvqze2dJcTUAXnXRBSS51qGGLB4Y"));
    expect(cfg.wooracleQuote).toBe(address("Dk1BiYeDuM4PPQDiNNnqaiiKHPEZ65DJSVjdcSwKt4aU"));
    expect(cfg.priceDec).toBe(100_000_000n);
    expect(cfg.quoteDec).toBe(1_000_000n);
    expect(cfg.baseDec).toBe(1_000_000_000n);
    expect(cfg.feeRate).toBe(20n);
    expect(cfg.minSwapAmount).toBe(0n);
  });

  it("rejects a base-to-base bundle (neither/both sides equal quoteTokenMint) — not yet wired, not silently wrong", async () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    const data = new Map(fixtures.map((f) => [f.address, Buffer.from(f.base64Data, "base64")]));
    const poolBuf = Buffer.from(data.get(POOL)!);
    // Overwrite quoteTokenMint@457 with an arbitrary third mint so NEITHER side matches.
    const thirdMint = Buffer.from(address("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"), "utf8");
    void thirdMint; // addresses are base58 strings, not the raw 32 bytes — construct the 32-byte form instead:
    const { getAddressCodec } = await import("@solana/kit");
    const codec = getAddressCodec();
    const raw = codec.encode(address("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"));
    poolBuf.set(new Uint8Array(raw), 457);
    const load = async (addr: string) =>
      addr === POOL
        ? new Uint8Array(poolBuf)
        : data.get(addr)
          ? new Uint8Array(data.get(addr)!)
          : null;
    await expect(fetchWoofiConfig(load as any, POOL)).rejects.toThrow(/base-to-base/);
  });
});

describe("WooPool u128 fields at the deployed layout (state/woopool.rs: cap_bal@139, min_swap_amount@155, unclaimed_fee@171)", () => {
  // WooPool = disc 8 + wooconfig 32 + bump 1 + authority 32 + wooracle 32 + fee_rate 2, then four u128s.
  it("offsets follow the struct order, and no field sits inside min_swap_amount", () => {
    expect(OFF_POOL_CAP_BAL).toBe(8 + 32 + 1 + 32 + 32 + 2 + 16 + 16);
    expect(OFF_POOL_MIN_SWAP_AMOUNT).toBe(OFF_POOL_CAP_BAL + 16);
    expect(OFF_POOL_UNCLAIMED_FEE).toBe(OFF_POOL_MIN_SWAP_AMOUNT + 16);
    // The former OFF_POOL_RESERVE = 157 lay inside min_swap_amount (bytes 155..171).
    expect((woofiModule as Record<string, unknown>).OFF_POOL_RESERVE).toBeUndefined();
  });

  it("minSwapAmount is read at its full u128 width (bytes past the u16 count)", async () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    const base = await fetchWoofiConfig(fixtureLoader(fixtures), POOL);
    const data = new Map(fixtures.map((f) => [f.address, Buffer.from(f.base64Data, "base64")]));
    const poolBuf = Buffer.from(data.get(base.woopoolBase)!);
    // 1e13 at byte 157 (the old patched fixture's bytes) and 1 at byte 163: u128 = 1e13 << 16 | 1 << 64.
    poolBuf.writeBigUInt64LE(10n ** 13n, 157);
    poolBuf[163] = 1;
    const load = async (addr: string) =>
      addr === base.woopoolBase
        ? new Uint8Array(poolBuf)
        : data.get(addr)
          ? new Uint8Array(data.get(addr)!)
          : null;
    const cfg = await fetchWoofiConfig(load as never, POOL);
    let expected = 0n;
    for (let i = 15; i >= 0; i--)
      expected = (expected << 8n) | BigInt(poolBuf[OFF_POOL_MIN_SWAP_AMOUNT + i]!);
    expect(expected.toString()).toBe((((10n ** 13n) << 16n) | (1n << 64n)).toString());
    expect(cfg.minSwapAmount.toString()).toBe(expected.toString());
  });
});

describe("woofi (v1 adapter facade): swap accounts + instruction data", () => {
  it("builds a 17-account swap CPI with the disc + amountIn/minOut u128 LE data shape", async () => {
    const fixtures = loadFixtures(PATCHED_FIXTURES);
    const load = fixtureLoader(fixtures);
    const cfg = await fetchWoofiConfig(load, POOL);
    const user = { inAta: "user:in", outAta: "user:out", owner: "payer" };
    const swap = woofi.buildSwap(cfg, user, 1_000_000n);
    expect(swap.accounts).toHaveLength(17);
    expect(swap.data.length).toBe(8 + 16 + 16);
    expect(Array.from(swap.data.subarray(0, 8))).toEqual([248, 198, 158, 145, 225, 117, 135, 200]);
    expect(swap.accounts.filter((a) => a.signer).map((a) => a.ref)).toEqual(["payer"]);
  });
});
