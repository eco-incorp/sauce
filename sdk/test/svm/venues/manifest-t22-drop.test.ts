/**
 * manifest Token-2022 self-drop: the Swap ix is Tokenkeg-only, so a market whose base or quote mint
 * is a Token-2022 mint must SELF-DROP (fetchManifestConfig throws). Reuses the real market fixture.
 *
 * The mint is classified by its OWNER: an extensionless Token-2022 mint is 82 bytes, byte for byte
 * a legacy one, so only the owner can tell them apart.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { fetchManifestConfig } from "../../../src/svm/venues/manifest/index.js";
import {
  SPL_MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/manifest");
const MARKET = address("ENhU8LsaR7vDD2G1CsWcsuSGNrih9Cv5WZEk7q9kPapQ");

describe("manifest: Token-2022 mint self-drop", () => {
  it("rejects a market whose mint is 82 bytes but owned by Token-2022 (extensionless)", async () => {
    const fixtures = loadFixtures(FIXTURES);
    const mints = fixtures
      .filter((f) => f.owner === TOKEN_PROGRAM_ID && fixtureData(f).length === SPL_MINT_SIZE)
      .map((f) => f.address);
    expect(mints.length).toBe(2);
    const base = fixtureLoader(fixtures);
    for (const mint of mints) {
      const load: OwnedAccountLoader = async (addr) => {
        const account = await base(addr);
        return addr === mint && account !== null
          ? { data: account.data, owner: TOKEN_2022_PROGRAM_ID }
          : account;
      };
      await expect(fetchManifestConfig(load, MARKET)).rejects.toThrow(
        `mint ${mint} is a Token-2022 mint`,
      );
    }
  });

  it("positive control: the real legacy-mint market still resolves", async () => {
    const cfg = await fetchManifestConfig(fixtureLoader(loadFixtures(FIXTURES)), MARKET);
    expect(cfg.venue).toBe("manifest");
  });
});
