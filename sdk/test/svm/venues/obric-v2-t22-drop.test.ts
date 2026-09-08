/**
 * Obric V2 Token-2022 self-drop: the unified swap carries one token program
 * (Tokenkeg), so a Token-2022 mint must make fetchPoolConfig THROW. Built on the
 * real mainnet SSTradingPair fixture with one mint swapped for a synthesized
 * Token-2022 mint; the unmodified fixtures still resolve.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { obricV2 } from "../../../src/svm/venues/obric-v2/index.js";
import { loadFixtures, fixtureLoader } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/obric-v2");
const POOL = address("AJ5HfGY32igLgUbDtfNRdrkjTSYkCVKdhmnFFfcZMJ1E");
const MINT_X = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";
const MINT_Y = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

/** The aj5-* fixtures with `target`'s account data replaced by a Token-2022 mint. */
function withT22(target: string): AccountFixture[] {
  return loadFixtures(FIXTURES).map((f) =>
    f.address === target ? { ...f, base64Data: Buffer.from(makeT22Mint()).toString("base64") } : f,
  );
}

describe("obric-v2 Token-2022 self-drop", () => {
  it("drops the pool when mintX is Token-2022", async () => {
    const load = fixtureLoader(withT22(MINT_X));
    await expect(obricV2.fetchPoolConfig(load, POOL)).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when mintY is Token-2022", async () => {
    const load = fixtureLoader(withT22(MINT_Y));
    await expect(obricV2.fetchPoolConfig(load, POOL)).rejects.toThrow(/is Token-2022/);
  });

  it("still resolves for the unmodified (legacy) fixtures — byte-identical legacy path", async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    const cfg = await obricV2.fetchPoolConfig(load, POOL);
    expect(cfg.venue).toBe("obric-v2");
    expect(cfg.mintX).toBe(MINT_X);
    expect(cfg.mintY).toBe(MINT_Y);
  });
});
