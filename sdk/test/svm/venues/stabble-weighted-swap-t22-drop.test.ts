/**
 * Token-2022 SELF-DROP pin for the stabble-weighted-swap adapter. The venue's
 * v1 `swap` entry point is legacy-SPL (Tokenkeg) only, so a Token-2022 mint on
 * either side must GRACEFULLY SELF-DROP (fetchPoolConfig throws — the SvmRoute
 * orchestrator treats that as a dropped venue).
 *
 * Reuses the checked-in real pool/vault fixtures; the base loader does not
 * vendor the mint accounts (so the legacy path falls back cleanly), and this
 * test overrides ONE side's mint to a synthesized Token-2022 mint.
 */
import { resolve } from "path";
import { stabbleWeightedSwap } from "../../../src/svm/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import type { StabbleWeightedSwapPoolConfig } from "../../../src/svm/venues/stabble-weighted-swap/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/stabble-weighted-swap");
const POOL = "JV4MkRFn58xpyrhF2oDxQYwnq5jFVzTQUKcUzce1FQA" as never;

async function poolMints(): Promise<{ base: AccountLoader; mintA: string; mintB: string }> {
  const base = fixtureLoader(loadFixtures(FIXTURES));
  const cfg = (await stabbleWeightedSwap.fetchPoolConfig(
    base,
    POOL,
  )) as StabbleWeightedSwapPoolConfig;
  return {
    base,
    mintA: cfg.tokens[0].mint as unknown as string,
    mintB: cfg.tokens[1].mint as unknown as string,
  };
}

describe("stabble-weighted-swap Token-2022 self-drop", () => {
  test("legacy fixture (no vendored mints) still decodes — legacy path unchanged", async () => {
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const cfg = (await stabbleWeightedSwap.fetchPoolConfig(
      base,
      POOL,
    )) as StabbleWeightedSwapPoolConfig;
    expect(cfg.venue).toBe("stabble-weighted-swap");
    expect(cfg.tokens.length).toBe(2);
  });

  test("a Token-2022 mint on side A self-drops", async () => {
    const { base, mintA } = await poolMints();
    const load: AccountLoader = async (addr) =>
      String(addr) === mintA ? makeT22Mint() : base(addr);
    await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/dropping pool/);
  });

  test("a NonTransferable mint on side B self-drops as un-routable", async () => {
    const { base, mintB } = await poolMints();
    const load: AccountLoader = async (addr) =>
      String(addr) === mintB ? makeT22Mint(NON_TRANSFERABLE_TLV) : base(addr);
    await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/dropping pool/);
  });
});
