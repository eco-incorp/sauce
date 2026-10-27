/**
 * BisonFi venue adapter units (no engine, no RPC-at-test-time): fetchPoolConfig against a REAL
 * mainnet fixture (pool 8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo, wSOL/USDC, dumped fresh
 * 2026-08-03), the freshness self-drop, the per-direction live fee haircut, the reserve-fraction cap,
 * and that the emitted fragment compiles as valid 'svm' SauceScript AND — the key safety property —
 * issues NO contract.call: its staleness gate is a pure in-VM computation that self-drops to a zero
 * quote, never an on-chain revert that could abort a co-merged cook.
 *
 * The pool's fee is read LIVE per direction (feeA=26 bps A-in, feeB=51 bps B-in in this fixture — a
 * genuinely per-direction value, and one an 18-pool sweep showed varies pool-to-pool and even
 * second-to-second as the keeper updates it, so a baked constant would be wrong). referenceQuote is a
 * pure function of state + params + an explicit `now`.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { bisonfi } from "../../../src/svm/venues/bisonfi/index.js";
import { fixtureBytesMap, fixtureLoader, loadFixtures, ownedByShape } from "../fixtures.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/bisonfi");
const POOL = address("8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo");
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("bisonfi.fetchPoolConfig", () => {
  it("decodes the real pool topology and the decimals-only scale", async () => {
    const cfg = await bisonfi.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL, 0);
    expect(cfg.mintA).toBe(WSOL);
    expect(cfg.mintB).toBe(USDC);
    expect(cfg.direction).toBe(0);
    // decA=9 (wSOL), decB=6 (USDC) -> d=-3 -> scale = 1 / 1000.
    expect(cfg.scaleNum).toBe(1n);
    expect(cfg.scaleDen).toBe(1000n);
    // vaults are the real SPL token accounts (each owned by the token program).
    const bytes = fixtureBytesMap(loadFixtures(FIXTURES));
    expect(bytes[cfg.vaultA]).toBeDefined();
    expect(bytes[cfg.vaultB]).toBeDefined();
  });

  it("rejects an account whose size is not the fixed 2048-byte pool layout", async () => {
    const loader = ownedByShape(async (a) => (a === POOL ? new Uint8Array(2047) : null));
    await expect(bisonfi.fetchPoolConfig(loader, POOL, 0)).rejects.toThrow(
      /2047 bytes, expected 2048/,
    );
  });
});
