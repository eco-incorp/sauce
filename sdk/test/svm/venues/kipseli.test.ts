/**
 * Kipseli venue adapter units (no engine, no RPC-at-test-time). Covers the 840-byte `Pool` layout —
 * a later realloc of the SAME `account:Pool` type (disc `f19a6d0411b16dbc`) that APPENDS 344 trailing
 * bytes onto the original 496-byte layout. The fixture is the real live mainnet pool
 * `7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG` (wSOL/USDC, ~47.5 SOL / ~26k USDC, dumped 2026-09-14),
 * plus its two derived ATA vaults and the wSOL/USDC mints.
 *
 * The point of the layout widening: every field this adapter reads (base_token @72, quote_token @104,
 * price @136, expiry @144, fee @152) lives in the first 496 bytes, so the decode is identical for both
 * the 496 and 840 sizes and the appended region is never touched — a `fetchPoolConfig` that once threw
 * "out of scope" on this real, liquid pool (crashing a live wSOL/USDC resolve) now decodes it. Strict
 * per-size gating is preserved: an off-set size still self-drops via a thrown error (the graceful-drop
 * signal the SvmRoute orchestrator relies on).
 */
import { resolve } from "path";
import { address, getAddressEncoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { kipseli } from "../../../src/svm/venues/kipseli/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureBytesMap, fixtureLoader, loadFixtures } from "../fixtures.js";
import { readUintLE } from "../../../src/svm/venues/math.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/kipseli");
const POOL = address("7yD7gfXv49SFxhx9uTc11dEd7Nj98rGWeYMdZJgheZbG"); // 840-byte layout
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_VAULT = "HgFLBWQugxt6qbPaWiwXjrqauXdQmcpMV6H6t8ttD8s1";
const QUOTE_VAULT = "FzvRbXDdrsYVMa9KohXyQytWNAZAo4PsF8yujDH7KCfG";
const OFF_EXPIRY_MS = 144;

// Anchor sha256("account:Pool")[:8], shared by every Kipseli Pool size.
const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];

/** expiry the raw fixture bytes carry at offset 144 (this venue's keeper refreshes it ~every 1-2s,
 * so it is read from the frozen fixture rather than pinned to a literal). */
function fixtureExpiryMs(): bigint {
  return readUintLE(fixtureBytesMap(loadFixtures(FIXTURES))[POOL]!, OFF_EXPIRY_MS, 8);
}

describe("kipseli.fetchPoolConfig — 840-byte realloc layout", () => {
  it("decodes the real 840-byte live pool from its shared first-496 prefix", async () => {
    const cfg = await kipseli.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL);
    expect(cfg.venue).toBe("kipseli");
    expect(cfg.pool).toBe(POOL);
    expect(cfg.direction).toBe("quoteToBase");
    expect(cfg.baseMint).toBe(WSOL);
    expect(cfg.quoteMint).toBe(USDC);
    // Vaults are the canonical ATAs of (owner=pool, mint) under the classic Token program.
    expect(cfg.baseVault).toBe(BASE_VAULT);
    expect(cfg.quoteVault).toBe(QUOTE_VAULT);
    // wSOL decimals=9, USDC decimals=6 -> delta=+3 -> adjNum=10^3, adjDen=1.
    // (bigint compared as string to sidestep a jest-worker BigInt-over-IPC crash on any mismatch.)
    expect(cfg.adjNum.toString()).toBe("1000");
    expect(cfg.adjDen.toString()).toBe("1");
    // expiry @144 (ms) decodes at its 496-layout offset — proving the prefix is genuinely shared.
    expect(cfg.expiryMs.toString()).toBe(fixtureExpiryMs().toString());
  });

  it("exposes the two live vaults as the quote-time accounts", async () => {
    const cfg = await kipseli.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL);
    const accts = kipseli.quoteAccounts(cfg);
    expect(accts.map((a) => a.address)).toEqual([BASE_VAULT, QUOTE_VAULT]);
  });
});

describe("kipseli.fetchPoolConfig — strict per-size gate", () => {
  const enc = getAddressEncoder();

  /** A minimal well-formed Pool of `size` bytes: correct disc + wSOL/USDC at their offsets. */
  function synthPool(size: number): Uint8Array {
    const data = new Uint8Array(size);
    data.set(POOL_DISCRIMINATOR, 0);
    if (size >= 104 + 32) {
      data.set(enc.encode(address(WSOL)), 72);
      data.set(enc.encode(address(USDC)), 104);
    }
    return data;
  }

  function sizedLoader(size: number): AccountLoader {
    const pool = synthPool(size);
    return async (a: Address) => (a === POOL ? new Uint8Array(pool) : null);
  }

  // 840 and 496 both clear the SIZE gate (they fail later at the vault reads this loader doesn't
  // serve — never on size). The message asserts the gate lists BOTH accepted sizes.
  it.each([496, 840])("accepts the %d-byte layout at the size gate", async (size) => {
    let message = "";
    try {
      await kipseli.fetchPoolConfig(sizedLoader(size), POOL);
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toMatch(/out of scope/);
  });

  it.each([162, 168, 456, 495, 841])(
    "self-drops an out-of-scope %d-byte Pool with a listing error",
    async (size) => {
      await expect(kipseli.fetchPoolConfig(sizedLoader(size), POOL)).rejects.toThrow(
        new RegExp(`${size} bytes, expected one of 496/840 \\(out of scope`),
      );
    },
  );
});
