/**
 * woofi Token-2022 self-drop: a pool one of whose (quote-paired) mints is a
 * Token-2022 mint must SELF-DROP (fetchWoofiConfig throws — SvmRoute catches
 * the throw and drops the venue) because the swap CPI moves tokens through the
 * classic Tokenkeg program. Reuses the real 617-byte WooAmmPool bundle (so the
 * base/quote resolution + quote-paired check pass) and answers a Token-2022
 * mint for the mint accounts; a legacy positive-control proves the real bundle
 * still resolves.
 *
 * The mint is classified by its OWNER: an extensionless Token-2022 mint is 82 bytes, byte for byte
 * a legacy one, so only the owner can tell them apart. FAILING-FIRST: before the loader carried the
 * owner, that mint passed as legacy and the swap named Tokenkeg.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { fetchWoofiConfig } from "../../../src/svm/venues/woofi/index.js";
import {
  SPL_MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type OwnedAccountLoader,
} from "../../../src/svm/index.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const REAL_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/woofi");
const POOL = address("BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs");

/** The fixture's legacy mints: 82 bytes, owned by the legacy token program. */
function legacyMints(): string[] {
  return loadFixtures(REAL_FIXTURES)
    .filter((f) => f.owner === TOKEN_PROGRAM_ID && fixtureData(f).length === SPL_MINT_SIZE)
    .map((f) => f.address);
}

describe("woofi: Token-2022 mint self-drop", () => {
  it("rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    const poolFix = fixtures.find((f) => f.address === POOL);
    expect(poolFix).toBeDefined();
    const bundle = fixtureData(poolFix!);
    // Real bundle for the pool (so decode + quote-paired check pass); a
    // Token-2022 mint for every other account (the base/quote mints).
    const load: OwnedAccountLoader = async (addr) =>
      addr === POOL
        ? { data: new Uint8Array(bundle), owner: address(poolFix!.owner) }
        : { data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID };
    await expect(fetchWoofiConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("rejects an 82-byte mint owned by Token-2022 (an extensionless Token-2022 mint)", async () => {
    const mints = legacyMints();
    expect(mints.length).toBeGreaterThan(0);
    const base = fixtureLoader(loadFixtures(REAL_FIXTURES));
    for (const mint of mints) {
      const load: OwnedAccountLoader = async (addr) => {
        const account = await base(addr);
        return addr === mint && account !== null
          ? { data: account.data, owner: TOKEN_2022_PROGRAM_ID }
          : account;
      };
      await expect(fetchWoofiConfig(load, POOL)).rejects.toThrow(`mint ${mint} is Token-2022`);
    }
  });

  it("rejects an 82-byte mint owned by neither token program", async () => {
    const foreign = address("11111111111111111111111111111111");
    const mints = legacyMints();
    expect(mints.length).toBeGreaterThan(0);
    const base = fixtureLoader(loadFixtures(REAL_FIXTURES));
    for (const mint of mints) {
      const load: OwnedAccountLoader = async (addr) => {
        const account = await base(addr);
        return addr === mint && account !== null ? { data: account.data, owner: foreign } : account;
      };
      await expect(fetchWoofiConfig(load, POOL)).rejects.toThrow(
        `token-program: mint ${mint} is owned by ${foreign}, neither the legacy nor Token-2022 program`,
      );
    }
  });

  it("positive control: the real legacy-mint fixture bundle still resolves", async () => {
    expect(legacyMints().length).toBeGreaterThan(0);
    const load = fixtureLoader(loadFixtures(REAL_FIXTURES));
    const cfg = await fetchWoofiConfig(load, POOL);
    expect(cfg.venue).toBe("woofi");
  });
});
