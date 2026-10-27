/**
 * Deriverse Token-2022 self-drop: this venue's Swap ix is legacy-SPL (Tokenkeg)
 * only, so fetchPoolConfig must DROP an instrument whose asset or crncy mint is
 * a Token-2022 mint (a thrown error the SvmRoute orchestrator catches). Reuses
 * the REAL mainnet instrument fixture for the pool bytes and vends a synthesized
 * Token-2022 mint for one side. The unmodified fixture does not vendor the mint
 * accounts at all — so the drop path is only reachable when a mint account is
 * actually present AND is Token-2022, exactly the null-fallback that keeps the
 * base deriverse.test.ts green.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { deriverse } from "../../../src/svm/venues/deriverse/index.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/deriverse");
const REAL_POOL = address("8Wk2L1yDovBJifCN1o86X7g7pDcqLau39m6tEsJ9Sheh");
const ASSET_MINT = address("So11111111111111111111111111111111111111112"); // wSOL
const CRNCY_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC

/** The real fixture loader, but also vending a Token-2022-owned mint at `t22Mint`. */
function loaderWithT22Mint(t22Mint: Address, data: Uint8Array = makeT22Mint()): OwnedAccountLoader {
  const base = fixtureLoader(loadFixtures(FIXTURES));
  return async (addr: Address) =>
    addr === t22Mint ? { data, owner: TOKEN_2022_PROGRAM_ID } : base(addr);
}

describe("deriverse Token-2022 self-drop", () => {
  it("drops the instrument when the asset mint is Token-2022", async () => {
    await expect(
      deriverse.fetchPoolConfig(loaderWithT22Mint(ASSET_MINT), REAL_POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops the instrument when the crncy mint is Token-2022", async () => {
    await expect(
      deriverse.fetchPoolConfig(loaderWithT22Mint(CRNCY_MINT), REAL_POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("drops the instrument when a mint is an extensionless (82-byte) Token-2022 mint", async () => {
    await expect(
      deriverse.fetchPoolConfig(loaderWithT22Mint(ASSET_MINT, makeLegacyMint()), REAL_POOL),
    ).rejects.toThrow(/Token-2022/);
  });

  it("legacy control: the unmodified fixture (mints not vendored → legacy assumption) builds a config", async () => {
    const cfg = await deriverse.fetchPoolConfig(fixtureLoader(loadFixtures(FIXTURES)), REAL_POOL);
    expect(cfg.venue).toBe("deriverse");
    expect(cfg.assetMint).toBe(ASSET_MINT);
    expect(cfg.crncyMint).toBe(CRNCY_MINT);
  });

  it("legacy control: both mints served as 82-byte Tokenkeg-owned mints pass the owner gate", async () => {
    // The gate (fetchPoolConfig's mint loop) runs before the TokenState reads and the return, so a
    // config built here means both mints were classified by their legacy owner and passed.
    const base = fixtureLoader(loadFixtures(FIXTURES));
    const mintsServed: Address[] = [];
    const owned: OwnedAccountLoader = async (addr: Address) => {
      if (addr === ASSET_MINT || addr === CRNCY_MINT) {
        mintsServed.push(addr);
        return { data: makeLegacyMint(), owner: TOKEN_PROGRAM_ID };
      }
      return base(addr);
    };
    const cfg = await deriverse.fetchPoolConfig(owned, REAL_POOL);
    expect(mintsServed).toEqual([ASSET_MINT, CRNCY_MINT]);
    expect(cfg).toEqual(await deriverse.fetchPoolConfig(base, REAL_POOL));
    expect(cfg.assetMint).toBe(ASSET_MINT);
    expect(cfg.crncyMint).toBe(CRNCY_MINT);
  });

  it("refuses the instrument when an 82-byte mint is owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    for (const mint of [ASSET_MINT, CRNCY_MINT]) {
      const base = fixtureLoader(loadFixtures(FIXTURES));
      const owned: OwnedAccountLoader = async (addr: Address) =>
        addr === mint ? { data: makeLegacyMint(), owner: foreign } : base(addr);
      await expect(deriverse.fetchPoolConfig(owned, REAL_POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });
});
