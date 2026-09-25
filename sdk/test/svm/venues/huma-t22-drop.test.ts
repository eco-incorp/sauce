/**
 * Huma Token-2022 self-drop: the deposit/instant_withdraw ix moves both the
 * underlying mint and the mode share mint through legacy-SPL (Tokenkeg)
 * transfers only, so fetchPoolConfig must DROP the pool when either mint is a
 * Token-2022 mint (a thrown error the SvmRoute orchestrator catches). Reuses the
 * REAL mainnet Genesis-pool fixture and vends a synthesized Token-2022 mint for
 * one side. The unmodified fixture (both mints legacy) is the control.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { huma } from "../../../src/svm/venues/huma/index.js";
import type { HumaPoolConfig } from "../../../src/svm/venues/huma/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIXTURE_DIR = resolve(process.cwd(), "test", "svm", "fixtures", "huma");
const CLASSIC_MODE_CONFIG = address("3FhoMDyKzQqxtGxnz9DfysfoGQKvgDnSFjoDGgguDCQN");
const CLASSIC_MODE_MINT = address("59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw");
const UNDERLYING_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

/** The real fixture loader, but also vending a Token-2022 mint at `t22Mint`. */
function loaderWithT22Mint(t22Mint: Address): AccountLoader {
  const base = fixtureLoader(loadFixtures(FIXTURE_DIR));
  return async (addr: Address) => (addr === t22Mint ? makeT22Mint() : base(addr));
}

describe("huma Token-2022 self-drop", () => {
  it("drops the pool when the underlying mint is Token-2022", async () => {
    await expect(
      huma.fetchPoolConfig(loaderWithT22Mint(UNDERLYING_MINT), CLASSIC_MODE_CONFIG),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops the pool when the mode share mint is Token-2022", async () => {
    await expect(
      huma.fetchPoolConfig(loaderWithT22Mint(CLASSIC_MODE_MINT), CLASSIC_MODE_CONFIG),
    ).rejects.toThrow(/Token-2022/);
  });

  it("legacy control: the unmodified real fixture builds a config (no drop)", async () => {
    const cfg = (await huma.fetchPoolConfig(
      fixtureLoader(loadFixtures(FIXTURE_DIR)),
      CLASSIC_MODE_CONFIG,
    )) as HumaPoolConfig;
    expect(cfg.venue).toBe("huma");
    expect(cfg.modeMint).toBe(CLASSIC_MODE_MINT);
    expect(cfg.underlyingMint).toBe(UNDERLYING_MINT);
  });
});
