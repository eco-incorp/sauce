/**
 * Metric Token-2022 self-drop: the swap ix is legacy-SPL (Tokenkeg) only, so a
 * Token-2022 mint must make fetchPoolConfig THROW (the SvmRoute orchestrator's
 * graceful-drop signal). Built on the real mainnet metric fixture with one mint
 * account swapped for a synthesized Token-2022 mint; the unmodified fixtures
 * still resolve (legacy path byte-identical).
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { metric } from "../../../src/svm/venues/metric/index.js";
import { loadFixtures, fixtureLoader } from "../fixtures.js";
import type { AccountFixture } from "../fixtures.js";
import { makeLegacyMint, makeT22Mint } from "../fixtures/token-2022/synth.js";
import { TOKEN_2022_PROGRAM_ID } from "../../../src/svm/index.js";

const FIXTURES = resolve(process.cwd(), "test/svm/fixtures/metric");
const POOL = address("G5B2Ws2DKattHTm75AoANWCpbQ48R9n8ZJur42RLYRYF");
const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC (mintA)
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"; // USDT (mintB)

const REAL_BID = 18461132534087045066n;
const REAL_ASK = 18461317001527782162n;
function realOracleQuoteBytes(): Uint8Array {
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, REAL_BID & 0xffffffffffffffffn, true);
  view.setBigUint64(8, REAL_BID >> 64n, true);
  view.setBigUint64(16, REAL_ASK & 0xffffffffffffffffn, true);
  view.setBigUint64(24, REAL_ASK >> 64n, true);
  return out;
}

/** The real fixtures with `target` replaced by a Token-2022-owned mint (`data`, default an extension mint). */
function withT22(target: string, data: Uint8Array = makeT22Mint()): AccountFixture[] {
  return loadFixtures(FIXTURES).map((f) =>
    f.address === target
      ? { ...f, owner: TOKEN_2022_PROGRAM_ID, base64Data: Buffer.from(data).toString("base64") }
      : f,
  );
}

describe("metric Token-2022 self-drop", () => {
  it("drops the pool when mintA is Token-2022", async () => {
    const load = fixtureLoader(withT22(MINT_A));
    await expect(
      metric.fetchPoolConfig(load, POOL, 0, async () => realOracleQuoteBytes()),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when mintB is Token-2022", async () => {
    const load = fixtureLoader(withT22(MINT_B));
    await expect(
      metric.fetchPoolConfig(load, POOL, 0, async () => realOracleQuoteBytes()),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("drops the pool when a mint is an extensionless (82-byte) Token-2022 mint", async () => {
    const load = fixtureLoader(withT22(MINT_A, makeLegacyMint()));
    await expect(
      metric.fetchPoolConfig(load, POOL, 0, async () => realOracleQuoteBytes()),
    ).rejects.toThrow(/is Token-2022/);
  });

  it("still resolves for the unmodified (legacy) fixtures — byte-identical legacy path", async () => {
    const load = fixtureLoader(loadFixtures(FIXTURES));
    const cfg = await metric.fetchPoolConfig(load, POOL, 0, async () => realOracleQuoteBytes());
    expect(cfg.venue).toBe("metric");
    expect(cfg.mintA).toBe(MINT_A);
    expect(cfg.mintB).toBe(MINT_B);
  });
});
