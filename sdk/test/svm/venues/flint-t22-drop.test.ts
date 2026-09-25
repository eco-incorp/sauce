/**
 * flint Token-2022 threading (no engine, no RPC).
 *
 * flint is a hub AMM whose per-side token programs are threaded from a curated,
 * real-evidence-backed registry (tokenProgramA/tokenProgramB per pair). One
 * shipped pair (pumpCmXq <-> USDT) has a Token-2022 side; the other (USDT <->
 * USDC) is legacy on both. This suite proves the Token-2022 side ROUTES (is not
 * dropped) with the right per-side programs, opposite sides differ, and the
 * legacy pair is unchanged.
 */
import type { Address } from "@solana/kit";
import { flint, FLINT_PAIR_REGISTRY } from "../../../src/svm/venues/flint/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** flint.fetchPoolConfig only requires the pool account to exist. */
const okLoader: AccountLoader = (async () => new Uint8Array(2368)) as unknown as AccountLoader;

/** The registry key whose entry carries a Token-2022 side (has a checkedMint). */
const t22Pool = Object.keys(FLINT_PAIR_REGISTRY).find(
  (k) => FLINT_PAIR_REGISTRY[k]!.checkedMint !== undefined,
);
/** A registry key that is legacy on both sides. */
const legacyPool = Object.keys(FLINT_PAIR_REGISTRY).find(
  (k) =>
    FLINT_PAIR_REGISTRY[k]!.tokenProgramA === (TOKENKEG as Address) &&
    FLINT_PAIR_REGISTRY[k]!.tokenProgramB === (TOKENKEG as Address),
);

describe("flint Token-2022 threading", () => {
  it("has a curated Token-2022 pair (a T22 side is supported, not dropped)", () => {
    expect(t22Pool).toBeDefined();
  });

  it("ROUTES the Token-2022 pair with per-side programs threaded (opposite sides differ)", async () => {
    const cfg = await flint.fetchPoolConfig(okLoader, t22Pool as Address);
    const e = cfg.entry;
    // The Token-2022 side (marketA / pumpCmXq) threads TOKEN_2022; its counterparty is legacy.
    expect(e.tokenProgramA).toBe(TOKEN_2022);
    expect(e.tokenProgramB).toBe(TOKENKEG);
    expect(e.checkedMint).toBe(e.mintA); // the T22 mint drives transferChecked
  });

  it("resolves the legacy pair with both sides Tokenkeg (unchanged)", async () => {
    expect(legacyPool).toBeDefined();
    const cfg = await flint.fetchPoolConfig(okLoader, legacyPool as Address);
    expect(cfg.entry.tokenProgramA).toBe(TOKENKEG);
    expect(cfg.entry.tokenProgramB).toBe(TOKENKEG);
  });
});
