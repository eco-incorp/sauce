/**
 * Token-2022 SELF-DROP pin for the tesserav adapter. The swap CPI is
 * legacy-SPL (Tokenkeg) only (its second token-program slot is unused), so a
 * Token-2022 mint on either side must GRACEFULLY SELF-DROP (fetchPoolConfig
 * throws — the SvmRoute orchestrator treats that as a dropped venue).
 *
 * Reuses the checked-in real SOL/USDC pool fixture; the base loader vendors
 * only the pool (mints fall back to the legacy assumption), and this test
 * overrides one mint to a synthesized Token-2022 mint.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { fetchTesseraVConfig } from "../../../src/svm/index.js";
import type { OwnedAccountLoader } from "../../../src/svm/venues/types.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/token-program.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/tesserav");
const POOL = address("FLckHLGMJy5gEoXWwcE68Nprde1D4araK4TGLw4pQq2n");
const MINT_A = "So11111111111111111111111111111111111111112"; // wSOL
const MINT_B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

describe("tesserav Token-2022 self-drop", () => {
  test("legacy fixture still decodes (aToB) — legacy path unchanged", async () => {
    const cfg = await fetchTesseraVConfig(fixtureLoader(loadFixtures(FIXTURES)), POOL, "aToB");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });

  test("a Token-2022 mintA self-drops", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === MINT_A ? { data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID } : base(addr);
    await expect(fetchTesseraVConfig(load, POOL, "aToB")).rejects.toThrow(/dropping pool/);
  });

  test("an extensionless 82-byte mintA owned by Token-2022 self-drops", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === MINT_A
        ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID }
        : base(addr);
    await expect(fetchTesseraVConfig(load, POOL, "aToB")).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable mintB self-drops as un-routable", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === MINT_B
        ? { data: makeT22Mint(NON_TRANSFERABLE_TLV), owner: TOKEN_2022_PROGRAM_ID }
        : base(addr);
    await expect(fetchTesseraVConfig(load, POOL, "aToB")).rejects.toThrow(/dropping pool/);
  });
});
