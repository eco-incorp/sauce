/**
 * Token-2022 SELF-DROP pin for the stabble-weighted-swap adapter. The venue's
 * v1 `swap` entry point is legacy-SPL (Tokenkeg) only, so a Token-2022 mint on
 * either side must GRACEFULLY SELF-DROP (fetchPoolConfig throws — the SvmRoute
 * orchestrator treats that as a dropped venue).
 *
 * Reuses the checked-in real pool/vault fixtures; the base loader does not
 * vendor the mint accounts (so the legacy path falls back cleanly), and this
 * test overrides ONE side's mint to a synthesized Token-2022 mint, owned by the
 * Token-2022 program. A mint is classified by its OWNER: an extensionless
 * Token-2022 mint is 82 bytes, byte for byte a legacy one, so only the owner
 * can tell them apart.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { stabbleWeightedSwap } from "../../../src/svm/index.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import type { StabbleWeightedSwapPoolConfig } from "../../../src/svm/venues/stabble-weighted-swap/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint, NON_TRANSFERABLE_TLV } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/stabble-weighted-swap");
const POOL = "JV4MkRFn58xpyrhF2oDxQYwnq5jFVzTQUKcUzce1FQA" as never;

async function poolMints(): Promise<{ base: OwnedAccountLoader; mintA: string; mintB: string }> {
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
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === mintA ? { data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID } : base(addr);
    await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/dropping pool/);
  });

  test("an extensionless (82-byte) Token-2022 mint on side A self-drops as Token-2022", async () => {
    const { base, mintA } = await poolMints();
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === mintA
        ? { data: makeLegacyMint(), owner: TOKEN_2022_PROGRAM_ID }
        : base(addr);
    await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  test("a NonTransferable mint on side B self-drops as un-routable", async () => {
    const { base, mintB } = await poolMints();
    const load: OwnedAccountLoader = async (addr) =>
      String(addr) === mintB
        ? { data: makeT22Mint(NON_TRANSFERABLE_TLV), owner: TOKEN_2022_PROGRAM_ID }
        : base(addr);
    await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(/dropping pool/);
  });

  test("an 82-byte mint owned by neither token program is refused", async () => {
    const foreign = address("11111111111111111111111111111111");
    const { base, mintA, mintB } = await poolMints();
    for (const mint of [mintA, mintB]) {
      const load: OwnedAccountLoader = async (addr) =>
        String(addr) === mint ? { data: makeLegacyMint(), owner: foreign } : base(addr);
      await expect(stabbleWeightedSwap.fetchPoolConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
