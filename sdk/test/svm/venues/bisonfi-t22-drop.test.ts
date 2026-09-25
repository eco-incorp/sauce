/**
 * BisonFi Token-2022 self-drop: this venue's on-chain swap ix is legacy-SPL
 * (Tokenkeg) only, so fetchPoolConfig must DROP a pool whose mintA or mintB is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). Reuses
 * the REAL mainnet fixture for the pool bytes and swaps one side's mint account
 * for a synthesized Token-2022 mint. The unmodified fixture (both mints legacy)
 * is covered by bisonfi.test.ts and re-asserted here as the control.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { bisonfi } from "../../../src/svm/venues/bisonfi/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/bisonfi");
const POOL = address("8FnX3xo2yYw3EUE6w3nQA4GfXGS9wpK6oj3veJpbFzLo");
const WSOL = address("So11111111111111111111111111111111111111112"); // mintA
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // mintB

/** The real fixture loader, but with `mint` swapped for a Token-2022 mint. */
function loaderWithT22Mint(t22Mint: Address): AccountLoader {
  const base = fixtureLoader(loadFixtures(FIXTURES));
  return async (addr: Address) => (addr === t22Mint ? makeT22Mint() : base(addr));
}

describe("bisonfi Token-2022 self-drop", () => {
  it("drops the pool when mintA is Token-2022", async () => {
    await expect(bisonfi.fetchPoolConfig(loaderWithT22Mint(WSOL), POOL, 0)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("drops the pool when mintB is Token-2022", async () => {
    await expect(bisonfi.fetchPoolConfig(loaderWithT22Mint(USDC), POOL, 0)).rejects.toThrow(
      /Token-2022/,
    );
  });

  it("legacy control: the unmodified real fixture builds a config (no drop)", async () => {
    const cfg = await bisonfi.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL, 0);
    expect(cfg.venue).toBe("bisonfi");
    expect(cfg.mintA).toBe(WSOL);
    expect(cfg.mintB).toBe(USDC);
  });
});
