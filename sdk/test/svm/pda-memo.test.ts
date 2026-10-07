/**
 * Shared PDA-derivation memo (../../src/svm/venues/pda-memo.ts) — proves,
 * across real families that route their tick-array/bin-array derivation
 * through it:
 *
 *  (a) MEMO HIT — a warm repeat of the SAME derivation set costs zero fresh
 *      derivations (every one resolves via the Map, not a fresh
 *      getProgramDerivedAddress call);
 *  (b) ADDRESS CORRECTNESS — every memoized address is byte-identical to a
 *      DIRECT, un-memoized getProgramDerivedAddress call over the exact same
 *      (programAddress, seeds) — covering raydium-clmm's BE-i32 seed shape,
 *      orca-whirlpool's ASCII shape, meteora-dlmm's LE-i64 shape and
 *      saros-dlmm's LE-u32 shape — plus a shared-seed-shape/distinct-
 *      program-id pair (raydium-clmm vs. pancakeswap-clmm, a verbatim fork
 *      that reuses raydium's exact seed shape under its OWN program id)
 *      proving the memo can never alias one family's PDA onto another's;
 *  (c) WINDOW-SHIFT = FRESH MISS, CORRECT NEW ADDRESS — a live-spot window
 *      shift changes the seed (and therefore the memo key), producing a
 *      fresh miss that resolves to the correct new PDA, never a stale hit;
 *  (d) NO STATE CACHED — the AccountLoader is still invoked on every
 *      fetchPoolConfig call regardless of memo hits; this module never
 *      caches account bytes, only the pure address computation.
 */
import { resolve } from "path";
import { address, getAddressCodec, getProgramDerivedAddress } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  __pdaMemoSize,
  __pdaMemoStats,
  __resetPdaMemoForTest,
  configurePdaMemo,
  DEFAULT_PDA_MEMO_MAX_ENTRIES,
  getPdaMemoMaxEntries,
  memoizedCreateProgramAddress,
  memoizedGetProgramDerivedAddress,
} from "../../src/svm/venues/pda-memo.js";
import {
  raydiumClmm,
  RAYDIUM_CLMM_PROGRAM_ID,
  windowStartTicks as raydiumWindowStartTicks,
} from "../../src/svm/venues/raydium-clmm/index.js";
import {
  pancakeswapClmm,
  PANCAKESWAP_CLMM_PROGRAM_ID,
} from "../../src/svm/venues/pancakeswap-clmm/index.js";
import {
  orcaWhirlpool,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  windowStartTicks as orcaWindowStartTicks,
} from "../../src/svm/venues/orca-whirlpool/index.js";
import {
  meteoraDlmm,
  METEORA_DLMM_PROGRAM_ID,
  windowArrayIndexes as meteoraWindowArrayIndexes,
} from "../../src/svm/venues/meteora-dlmm/index.js";
import {
  sarosDlmm,
  SAROS_DLMM_PROGRAM_ID,
  pairArrayIndexes as sarosPairArrayIndexes,
} from "../../src/svm/venues/saros-dlmm/index.js";
import type { AccountLoader } from "../../src/svm/index.js";
import { fixtureLoader, loadFixtures } from "./fixtures.js";

const RAYDIUM_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/raydium-clmm");
const RAYDIUM_POOL = address("3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv");
const ORCA_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/orca-whirlpool");
const ORCA_POOL = address("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
const METEORA_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/meteora-dlmm");
const METEORA_PAIR = address("5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6");
const SAROS_FIXTURES = resolve(process.cwd(), "test/svm/fixtures/saros-dlmm");
const SAROS_PAIR = address("DHXKB9fSff4LjubMFieKxaBrvNY6AzXVwaRLk5N2vs87");

function addressBytes(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

/** The un-memoized primitive every venue's local deriver used to call directly. */
async function directPda(
  programAddress: Address,
  seeds: readonly (Uint8Array | string)[],
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds: seeds as (Uint8Array | string)[],
  });
  return pda;
}

beforeEach(() => {
  __resetPdaMemoForTest();
});

describe("PDA-derivation memo", () => {
  describe("memo hit: a warm repeat costs zero fresh derivations", () => {
    it("raydium-clmm: second fetchPoolConfig call is all hits", async () => {
      const load = fixtureLoader(loadFixtures(RAYDIUM_FIXTURES));

      await raydiumClmm.fetchPoolConfig(load, RAYDIUM_POOL);
      const afterFirst = __pdaMemoStats();
      expect(afterFirst.misses).toBeGreaterThan(0);
      expect(afterFirst.hits).toBe(0);

      await raydiumClmm.fetchPoolConfig(load, RAYDIUM_POOL);
      const afterSecond = __pdaMemoStats();
      expect(afterSecond.misses).toBe(afterFirst.misses); // zero fresh derivations on the repeat
      expect(afterSecond.hits).toBe(afterFirst.misses); // every derivation of the repeat was a memo hit
    });

    it("is shared across families: orca-whirlpool also warms to all-hits on a repeat", async () => {
      const load = fixtureLoader(loadFixtures(ORCA_FIXTURES));

      await orcaWhirlpool.fetchPoolConfig(load, ORCA_POOL);
      const afterFirst = __pdaMemoStats();
      expect(afterFirst.misses).toBeGreaterThan(0);

      await orcaWhirlpool.fetchPoolConfig(load, ORCA_POOL);
      const afterSecond = __pdaMemoStats();
      expect(afterSecond.misses).toBe(afterFirst.misses);
      expect(afterSecond.hits).toBe(afterFirst.misses);
    });
  });

  describe("address correctness: memoized == direct un-memoized derive", () => {
    it("raydium-clmm tick-array PDAs (BE i32 seed shape)", async () => {
      const load = fixtureLoader(loadFixtures(RAYDIUM_FIXTURES));
      const config = await raydiumClmm.fetchPoolConfig(load, RAYDIUM_POOL);
      const starts = raydiumWindowStartTicks(config.tickCurrentIndex, config.tickSpacing, true);

      for (let i = 0; i < starts.length; i++) {
        const be = new Uint8Array(4);
        new DataView(be.buffer).setInt32(0, starts[i], false);
        const expected = await directPda(RAYDIUM_CLMM_PROGRAM_ID, [
          new TextEncoder().encode("tick_array"),
          addressBytes(RAYDIUM_POOL),
          be,
        ]);
        expect(config.windows["0to1"].tickArrays[i]).toBe(expected);
      }
    });

    it("orca-whirlpool tick-array PDAs (ASCII seed shape)", async () => {
      const load = fixtureLoader(loadFixtures(ORCA_FIXTURES));
      const config = await orcaWhirlpool.fetchPoolConfig(load, ORCA_POOL);
      const starts = orcaWindowStartTicks(config.tickCurrentIndex, config.tickSpacing, true);

      for (let i = 0; i < starts.length; i++) {
        const expected = await directPda(ORCA_WHIRLPOOL_PROGRAM_ID, [
          new TextEncoder().encode("tick_array"),
          addressBytes(ORCA_POOL),
          new TextEncoder().encode(String(starts[i])),
        ]);
        expect(config.windows.aToB.tickArrays[i]).toBe(expected);
      }
    });

    it("meteora-dlmm bin-array PDAs (LE i64 seed shape)", async () => {
      const load = fixtureLoader(loadFixtures(METEORA_FIXTURES));
      const config = await meteoraDlmm.fetchPoolConfig(load, METEORA_PAIR);
      const indexes = meteoraWindowArrayIndexes(config.activeId, true);

      for (let i = 0; i < indexes.length; i++) {
        const le = new Uint8Array(8);
        new DataView(le.buffer).setBigInt64(0, BigInt(indexes[i]), true);
        const expected = await directPda(METEORA_DLMM_PROGRAM_ID, [
          new TextEncoder().encode("bin_array"),
          addressBytes(METEORA_PAIR),
          le,
        ]);
        expect(config.windows.xToY.binArrays[i]).toBe(expected);
      }
    });

    it("saros-dlmm bin-array PDAs (LE u32 seed shape)", async () => {
      const load = fixtureLoader(loadFixtures(SAROS_FIXTURES));
      const config = await sarosDlmm.fetchPoolConfig(load, SAROS_PAIR);
      const [lowerIndex, upperIndex] = sarosPairArrayIndexes(config.activeId);

      const window = config.windows.xToY;
      for (const [index, actual] of [
        [lowerIndex, window.binArrayLower],
        [upperIndex, window.binArrayUpper],
      ] as const) {
        const le = new Uint8Array(4);
        new DataView(le.buffer).setUint32(0, index, true);
        const expected = await directPda(SAROS_DLMM_PROGRAM_ID, [
          new TextEncoder().encode("bin_array"),
          addressBytes(SAROS_PAIR),
          le,
        ]);
        expect(actual).toBe(expected);
      }
    });

    it("no cross-family collision: identical seed bytes under two distinct program ids derive DIFFERENT PDAs", async () => {
      const seeds = [
        new TextEncoder().encode("tick_array"),
        addressBytes(RAYDIUM_POOL),
        new Uint8Array(4),
      ] as const;

      const raydiumPda = await memoizedGetProgramDerivedAddress(RAYDIUM_CLMM_PROGRAM_ID, seeds);
      const pancakePda = await memoizedGetProgramDerivedAddress(PANCAKESWAP_CLMM_PROGRAM_ID, seeds);

      expect(raydiumPda).not.toBe(pancakePda);
      expect(raydiumPda).toBe(await directPda(RAYDIUM_CLMM_PROGRAM_ID, seeds));
      expect(pancakePda).toBe(await directPda(PANCAKESWAP_CLMM_PROGRAM_ID, seeds));
    });

    it("pancakeswap-clmm (raydium-clmm-shaped fork) wired through fetchPoolConfig never aliases raydium-clmm's own derivation", async () => {
      // pancakeswap-clmm has no fixture of its own; its PoolState layout is
      // byte-identical to raydium-clmm's (a verbatim Anchor fork), so this
      // reads the SAME real account bytes through BOTH families' fetchPoolConfig
      // — same live tick/spacing, but each family derives under its OWN
      // program id, exercising the exact shared-shape/distinct-program
      // scenario the memo key must never collide on.
      const load = fixtureLoader(loadFixtures(RAYDIUM_FIXTURES));
      const raydiumConfig = await raydiumClmm.fetchPoolConfig(load, RAYDIUM_POOL);
      const pancakeConfig = await pancakeswapClmm.fetchPoolConfig(load, RAYDIUM_POOL);

      expect(pancakeConfig.tickCurrentIndex).toBe(raydiumConfig.tickCurrentIndex);
      expect(pancakeConfig.tickSpacing).toBe(raydiumConfig.tickSpacing);
      for (let i = 0; i < raydiumConfig.windows["0to1"].tickArrays.length; i++) {
        expect(pancakeConfig.windows["0to1"].tickArrays[i]).not.toBe(
          raydiumConfig.windows["0to1"].tickArrays[i],
        );
      }
    });
  });

  describe("window shift -> fresh miss, correct new address", () => {
    it("raydium-clmm: a live tick shifted well outside the shipped window re-derives a genuinely new PDA", async () => {
      const load = fixtureLoader(loadFixtures(RAYDIUM_FIXTURES));
      const config = await raydiumClmm.fetchPoolConfig(load, RAYDIUM_POOL);
      const before = __pdaMemoStats();

      // TICK_ARRAY_SIZE=60 for raydium-clmm; the fetched windows only ever
      // reach +-2 array-spans from the live tick (2 directions x 3 starts
      // each). Shifting the simulated live spot by 5 spans guarantees the
      // resulting start-tick is one this fetch never derived, so the memo
      // MUST see it as a fresh key.
      const span = 60 * config.tickSpacing;
      const shiftedTick = config.tickCurrentIndex + 5 * span;
      const originalStarts = raydiumWindowStartTicks(
        config.tickCurrentIndex,
        config.tickSpacing,
        true,
      );
      const shiftedStarts = raydiumWindowStartTicks(shiftedTick, config.tickSpacing, true);
      expect(shiftedStarts).not.toEqual(originalStarts);

      const be = new Uint8Array(4);
      new DataView(be.buffer).setInt32(0, shiftedStarts[0], false);
      const seeds = [
        new TextEncoder().encode("tick_array"),
        addressBytes(RAYDIUM_POOL),
        be,
      ] as const;

      const shiftedPda = await memoizedGetProgramDerivedAddress(RAYDIUM_CLMM_PROGRAM_ID, seeds);
      const after = __pdaMemoStats();

      expect(after.misses).toBe(before.misses + 1); // a genuinely new key -> exactly one fresh miss
      expect(shiftedPda).not.toBe(config.windows["0to1"].tickArrays[0]);
      expect(shiftedPda).toBe(await directPda(RAYDIUM_CLMM_PROGRAM_ID, seeds));
    });
  });

  describe("no state cached: the AccountLoader still runs on every call", () => {
    it("raydium-clmm: an all-memo-hit second fetchPoolConfig still re-reads every account", async () => {
      const fixtures = loadFixtures(RAYDIUM_FIXTURES);
      const base = fixtureLoader(fixtures);
      let calls = 0;
      const counting: AccountLoader = async (addr) => {
        calls += 1;
        return base(addr);
      };

      await raydiumClmm.fetchPoolConfig(counting, RAYDIUM_POOL);
      const firstCallCount = calls;
      expect(firstCallCount).toBeGreaterThan(0);

      calls = 0;
      await raydiumClmm.fetchPoolConfig(counting, RAYDIUM_POOL); // second pass: every PDA derivation is now a memo HIT
      expect(__pdaMemoStats().hits).toBeGreaterThan(0);
      expect(calls).toBe(firstCallCount); // ...yet every account read happened again, unchanged
    });
  });

  describe("LRU: bounded size, evicts least-recently-used, keeps recency on hit", () => {
    // A distinct single-byte seed per index → a distinct memo key per call.
    const PROGRAM = RAYDIUM_CLMM_PROGRAM_ID;
    const seedFor = (i: number): readonly Uint8Array[] => [new Uint8Array([i])];

    it("never exceeds the cap and evicts the oldest entry on overflow", async () => {
      configurePdaMemo({ maxEntries: 3 });

      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(0)); // [0]
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(1)); // [0,1]
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(2)); // [0,1,2]
      expect(__pdaMemoSize()).toBe(3);

      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(3)); // evicts oldest (0) -> [1,2,3]
      expect(__pdaMemoSize()).toBe(3);

      const before = __pdaMemoStats();
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(1)); // still cached -> HIT
      expect(__pdaMemoStats().hits).toBe(before.hits + 1);

      const afterHit = __pdaMemoStats();
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(0)); // evicted -> MISS (re-derive)
      expect(__pdaMemoStats().misses).toBe(afterHit.misses + 1);
      expect(__pdaMemoSize()).toBe(3);
    });

    it("a hit refreshes recency, so a since-touched entry survives the next eviction", async () => {
      configurePdaMemo({ maxEntries: 2 });

      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(10)); // [10]
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(11)); // [10,11]
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(10)); // hit -> recency [11,10]
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(12)); // evicts 11 (now oldest) -> [10,12]

      const before = __pdaMemoStats();
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(10)); // 10 survived -> HIT
      expect(__pdaMemoStats().hits).toBe(before.hits + 1);

      const afterHit = __pdaMemoStats();
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(11)); // 11 was evicted -> MISS
      expect(__pdaMemoStats().misses).toBe(afterHit.misses + 1);
    });
  });

  describe("configurePdaMemo: consumer-tunable cap", () => {
    const PROGRAM = RAYDIUM_CLMM_PROGRAM_ID;
    const seedFor = (i: number): readonly Uint8Array[] => [new Uint8Array([i])];

    it("defaults to DEFAULT_PDA_MEMO_MAX_ENTRIES (100k) and reflects a raised cap", () => {
      expect(DEFAULT_PDA_MEMO_MAX_ENTRIES).toBe(100_000);
      expect(getPdaMemoMaxEntries()).toBe(DEFAULT_PDA_MEMO_MAX_ENTRIES);

      configurePdaMemo({ maxEntries: 500_000 });
      expect(getPdaMemoMaxEntries()).toBe(500_000);
    });

    it("a raised cap retains entries that the default-small cap would have evicted", async () => {
      configurePdaMemo({ maxEntries: 5 }); // simulate a raised cap relative to the working set
      for (let i = 0; i < 5; i++) await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(i));
      expect(__pdaMemoSize()).toBe(5);

      // Every one of the 5 is still warm — a repeat pass is all hits, none evicted.
      const before = __pdaMemoStats();
      for (let i = 0; i < 5; i++) await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(i));
      expect(__pdaMemoStats().hits).toBe(before.hits + 5);
      expect(__pdaMemoStats().misses).toBe(before.misses); // zero fresh derivations
    });

    it("lowering the cap below the current population evicts the oldest eagerly", async () => {
      configurePdaMemo({ maxEntries: 10 });
      for (let i = 0; i < 6; i++) await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(i)); // [0..5]
      expect(__pdaMemoSize()).toBe(6);

      configurePdaMemo({ maxEntries: 2 }); // eager shrink -> keeps the 2 most-recent (4,5)
      expect(__pdaMemoSize()).toBe(2);

      const before = __pdaMemoStats();
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(5)); // most-recent survivor -> HIT
      await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(0)); // evicted -> MISS
      expect(__pdaMemoStats().hits).toBe(before.hits + 1);
      expect(__pdaMemoStats().misses).toBe(before.misses + 1);
    });

    it("rejects a non-positive or non-integer cap", () => {
      expect(() => configurePdaMemo({ maxEntries: 0 })).toThrow(/positive integer/);
      expect(() => configurePdaMemo({ maxEntries: -1 })).toThrow(/positive integer/);
      expect(() => configurePdaMemo({ maxEntries: 1.5 })).toThrow(/positive integer/);
      expect(() => configurePdaMemo({ maxEntries: Number.NaN })).toThrow(/positive integer/);
      expect(getPdaMemoMaxEntries()).toBe(DEFAULT_PDA_MEMO_MAX_ENTRIES); // unchanged after a rejected call
    });
  });

  describe("memoizedCreateProgramAddress: the known-bump map", () => {
    const PROGRAM = RAYDIUM_CLMM_PROGRAM_ID;
    const seedFor = (i: number): readonly Uint8Array[] => [new Uint8Array([i])];

    it("keeps its own entries: a find under the same key is not a hit for it", async () => {
      const found = await memoizedGetProgramDerivedAddress(PROGRAM, seedFor(1));
      const created = memoizedCreateProgramAddress(PROGRAM, seedFor(1));
      expect(created.address).not.toBe(found);
      expect(__pdaMemoStats()).toEqual({ hits: 0, misses: 2 });
    });

    it("evicts at the same cap, and a lowered cap trims it eagerly", () => {
      configurePdaMemo({ maxEntries: 3 });
      for (let i = 0; i < 4; i++) memoizedCreateProgramAddress(PROGRAM, seedFor(i)); // evicts 0 -> [1,2,3]
      configurePdaMemo({ maxEntries: 1 }); // eager shrink -> [3]

      const before = __pdaMemoStats();
      memoizedCreateProgramAddress(PROGRAM, seedFor(3)); // survivor -> HIT
      memoizedCreateProgramAddress(PROGRAM, seedFor(2)); // trimmed -> MISS
      memoizedCreateProgramAddress(PROGRAM, seedFor(0)); // evicted -> MISS
      expect(__pdaMemoStats()).toEqual({ hits: before.hits + 1, misses: before.misses + 2 });
    });
  });
});
