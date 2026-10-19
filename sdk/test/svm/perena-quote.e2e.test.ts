/**
 * Perena's emitted quote, EXECUTED on the released engine against the real USDC/USDT/PYUSD pool
 * account (test/svm/fixtures/perena), and held to `referenceQuote`, the TypeScript mirror of the same
 * closed form. `venues/perena.test.ts` only compiles the fragment; compiling proves nothing about
 * its signed arithmetic: the solver's constant D and its intermediate K are NEGATIVE in parts of
 * the domain (`Int256`), while the reserves they come back to are not (`Uint256`).
 *
 * D is positive for this pool's curve and negative for a steep one (A=100, a=1: -96 WAD). K is
 * negative for a steep curve everywhere, and for this pool's curve once a trade pushes the in-side
 * past D, where the closed form has no root and the quote is 0 rather than a revert.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI (`engine-harness.ts`).
 */
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { address } from "@solana/kit";
import { perena } from "../../src/svm/venues/perena/index.js";
import type { PerenaPoolConfig } from "../../src/svm/venues/perena/index.js";
import { compileSvm, wrapQuoteMain } from "./rs-compile.js";
import { fixtureBytesMap, fixtureData, fixtureLoader, loadFixtures } from "./fixtures.js";
import type { AccountFixture } from "./fixtures.js";
import {
  describeSvm,
  execute,
  expectOk,
  loadFixtureAccounts,
  startEngine,
  toBigInt,
} from "./engine-harness.js";
import type { EngineHarness, ExecutableOutput } from "./engine-harness.js";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "perena");
const POOL = address("2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ");
const fixtures = loadFixtures(FIXTURE_DIR);
const poolFixture = fixtures.find((fixture) => fixture.address === POOL) as AccountFixture;

// StablePool offsets (module header of venues/perena): each pair is 368 bytes from 152.
const pairOffset = (pair: 0 | 1, field: number): number => 152 + pair * 368 + field;
const Y_RESERVE = 40;
const INV_L = 96;

function withPairU64(pair: 0 | 1, field: number, value: bigint): (data: Uint8Array) => void {
  return (data) => new DataView(data.buffer).setBigUint64(pairOffset(pair, field), value, true);
}

describeSvm("perena emitQuote, executed on the engine", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  /** The pool's account bytes with each mutation applied, loaded into the bank in place. */
  const loadPool = (...mutations: Array<(data: Uint8Array) => void>): Uint8Array => {
    const data = fixtureData(poolFixture);
    for (const mutate of mutations) mutate(data);
    const doctored: AccountFixture = {
      ...poolFixture,
      base64Data: Buffer.from(data).toString("base64"),
    };
    loadFixtureAccounts(harness, [doctored]);
    return data;
  };

  const executed = async (cfg: PerenaPoolConfig, amountIn: bigint): Promise<bigint> => {
    const { bytecode, manifest } = compileSvm(
      wrapQuoteMain(1, perena.emitQuote(cfg, 0, amountIn), "q0"),
    );
    const result = expectOk(
      await execute(harness, { bytecode, manifest } as ExecutableOutput, { acc0: POOL }),
    );
    return toBigInt(result.returnData);
  };

  const fetched = async (direction: "aToB" | "bToA"): Promise<PerenaPoolConfig> =>
    ({
      ...(await perena.fetchPoolConfig(fixtureLoader(fixtures), POOL)),
      direction,
    }) as PerenaPoolConfig;

  const mirror = (cfg: PerenaPoolConfig, pool: Uint8Array, amountIn: bigint): bigint =>
    perena.referenceQuote!(cfg, { ...fixtureBytesMap(fixtures), [POOL]: pool }, amountIn, 0n);

  it("quotes the real pool at the sizes its module header validated against the program", async () => {
    loadPool();
    const aToB = await fetched("aToB");
    expect(await executed(aToB, 1_000_000n)).toBe(1_000_243n);
    expect(await executed(aToB, 10_000_000n)).toBe(10_002_417n);
    expect(await executed(aToB, 100_000_000n)).toBe(100_023_811n);

    const bToA = await fetched("bToA");
    expect(await executed(bToA, 1_000_000n)).toBe(998_562n);
    expect(await executed(bToA, 10_000_000n)).toBe(9_985_605n);
    expect(await executed(bToA, 100_000_000n)).toBe(99_855_698n);
  });

  it("quotes zero, and does not revert, for a trade past the curve's domain, where K and w are negative", async () => {
    // About 3x the pool's scale in one trade: the in-side ratio passes D, so K = D - P + A*WAD/P is
    // negative and the solved liability is below zero. The quote is 0 (no root on the curve), never
    // a revert: an unsigned K would underflow here.
    const pool = loadPool();
    for (const direction of ["aToB", "bToA"] as const) {
      const cfg = await fetched(direction);
      expect(mirror(cfg, pool, 452_519_418_750n)).toBe(0n);
      expect(await executed(cfg, 452_519_418_750n)).toBe(0n);
    }
  });

  it("quotes a steep curve, whose D and K are negative, as the mirror does, in both directions", async () => {
    // A=100, a=1: D = -96 WAD, so K is negative at both hops of every trade. Large trades, because
    // the reserves of this fixture lie on the pool's own curve, not on this one: a small trade here
    // would have nothing to release.
    const pool = loadPool();
    for (const direction of ["aToB", "bToA"] as const) {
      const cfg = { ...(await fetched(direction)), ampRaw: 100_000_000n, aRaw: 1_000_000n };
      expect(perena.emitQuote(cfg, 0, 1_000_000n)).toContain("-96000000000000000000");
      for (const amountIn of [150_000_000_000n, 452_519_418_750n]) {
        const expected = mirror(cfg, pool, amountIn);
        expect(expected).toBeGreaterThan(0n);
        expect(await executed(cfg, amountIn)).toBe(expected);
      }
    }
    const aToB = { ...(await fetched("aToB")), ampRaw: 100_000_000n, aRaw: 1_000_000n };
    expect(await executed(aToB, 150_000_000_000n)).toBe(57_298_901_351n);
  });

  it("quotes zero, and does not revert, where the closed form has no root", async () => {
    // Nothing owed on the in-side (y = 0): the numeraire released cannot be positive.
    const cfg = await fetched("aToB");
    const noLiability = loadPool(withPairU64(0, Y_RESERVE, 0n));
    expect(mirror(cfg, noLiability, 1_000_000n)).toBe(0n);
    expect(await executed(cfg, 1_000_000n)).toBe(0n);

    // A pair with no scale (L = 0) is skipped by the quote's own guard.
    const noScale = loadPool(withPairU64(1, INV_L, 0n));
    expect(mirror(cfg, noScale, 1_000_000n)).toBe(0n);
    expect(await executed(cfg, 1_000_000n)).toBe(0n);
  });
});
