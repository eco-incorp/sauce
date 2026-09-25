/**
 * woofi Token-2022 self-drop: a pool one of whose (quote-paired) mints is a
 * Token-2022 mint must SELF-DROP (fetchWoofiConfig throws — SvmRoute catches
 * the throw and drops the venue) because the swap CPI moves tokens through the
 * classic Tokenkeg program. Reuses the real 617-byte WooAmmPool bundle (so the
 * base/quote resolution + quote-paired check pass) and answers a Token-2022
 * mint for the mint accounts; a legacy positive-control proves the real bundle
 * still resolves.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { fetchWoofiConfig } from "../../../src/svm/venues/woofi/index.js";
import type { AccountLoader } from "../../../src/svm/index.js";
import { fixtureData, fixtureLoader, loadFixtures } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const REAL_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/woofi");
const POOL = address("BEz2Suv2WvGKWouU1srbhZfudBGuw9v2VzkhMZHFBdvs");

describe("woofi: Token-2022 mint self-drop", () => {
  it("rejects a pool whose mint is a Token-2022 mint (legacy-SPL swap only)", async () => {
    const fixtures = loadFixtures(REAL_FIXTURES);
    const poolFix = fixtures.find((f) => f.address === POOL);
    expect(poolFix).toBeDefined();
    const bundle = fixtureData(poolFix!);
    // Real bundle for the pool (so decode + quote-paired check pass); a
    // Token-2022 mint for every other account (the base/quote mints).
    const load: AccountLoader = async (addr) =>
      addr === POOL ? new Uint8Array(bundle) : makeT22Mint();
    await expect(fetchWoofiConfig(load, POOL)).rejects.toThrow(/Token-2022/);
  });

  it("positive control: the real legacy-mint fixture bundle still resolves", async () => {
    const load = fixtureLoader(loadFixtures(REAL_FIXTURES));
    const cfg = await fetchWoofiConfig(load, POOL);
    expect(cfg.venue).toBe("woofi");
  });
});
