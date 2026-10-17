/**
 * The cook's builder's model of a swap at a price (`svm/compute-stops.ts`), offline: its cost table's
 * fallback, its tick-array reader on each layout, a walk inside the price's own tick and one falling
 * to its own limit, the order it gives the pools, and a swap in a loop. Its costs and walks are held to the venues' own programs in the router suite.
 */
import { address, type Address } from "@solana/kit";

import { requireChain } from "../src/chains/canonical.js";
import { svmRanOutOfUnits, svmStopLines, svmStopsJson } from "../src/cli/svm-stops.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { resolveSvmAccountName } from "../src/svm/account-names.js";
import {
  SVM_COOK_FIXED,
  SVM_HEADROOM_TICKS,
  SVM_SWAP_COSTS,
  SVM_SWAP_FIXED,
  svmComputeStops,
  svmPoolWalk,
  svmProgramStops,
  svmSwapCost,
  svmTickArray,
  type SvmStopPool,
} from "../src/svm/compute-stops.js";
import type { OwnedAccountLoader } from "../src/svm/venues/types.js";
import { ORCA_WHIRLPOOL_PROGRAM_ID } from "../src/svm/venues/index.js";
import { allIn, BYTES, LAYOUT, pool, SNAPSHOT, type Pool } from "./svm/venue-fixture.js";

const fromFixture = (p: Pool, priceLimit: bigint): SvmStopPool => ({
  name: p.name,
  program: p.program,
  layout: "whirlpool",
  pool: BYTES.get(p.pool)!,
  fee: LAYOUT[p.venue]!.fee(p),
  // Paying USDC for WSOL: WSOL is the lower key, so USDC is token B and the price rises.
  arrays: p.payB.map((at) => BYTES.get(at)),
  paysA: false,
  priceLimit,
});

describe("the cook's builder's model of a swap at a price", () => {
  it("prices a program its table does not hold at the table's dearest, never at nothing", () => {
    const dearest = {
      base: Math.max(...Object.values(SVM_SWAP_COSTS).map((cost) => cost.base)),
      tick: Math.max(...Object.values(SVM_SWAP_COSTS).map((cost) => cost.tick)),
    };
    expect(svmSwapCost(address("11111111111111111111111111111111"))).toEqual(dearest);
    // A pool on such a program is charged that, and held where a known one would walk.
    const orca = pool("orca-whirlpool-sol-usdc");
    const known = fromFixture(orca, (allIn(orca, false) * 10300n) / 10000n);
    const unknown = { ...known, program: address("11111111111111111111111111111111") };
    const budget = 300_000;
    const [walked] = svmComputeStops([known], budget);
    const [held] = svmComputeStops([unknown], budget);
    expect(held!.estimatedUnits).toBeGreaterThan(walked!.estimatedUnits);
    expect(held!.stop).not.toBe(0n);
  });

  it("trades a walk whose limit lies inside the price's own tick, charging its swap", () => {
    const orca = pool("orca-whirlpool-sol-usdc");
    const walk = svmPoolWalk(fromFixture(orca, (allIn(orca, false) * 100001n) / 100000n));
    expect(walk.none).toBeUndefined();
    expect(walk.crossed).toEqual([]);
    expect(walk.units).toBe(SVM_SWAP_COSTS[ORCA_WHIRLPOOL_PROGRAM_ID]!.base);
    expect(walk.output).toBeGreaterThan(0n);
  });

  // Paying WSOL the price falls to its own limit's sqrt price. Both limits here lie in the tick just
  // above the initialized tick -21400, which the walk never reaches: it crosses none, and buys the
  // USDC the swap paid out on the venue's program (the router suite cooks both).
  it("ends a falling walk at its own limit, crossing no tick below it", () => {
    const orca = pool("orca-whirlpool-sol-usdc");
    const sell = (priceLimit: bigint): SvmStopPool => ({
      ...fromFixture(orca, priceLimit),
      arrays: orca.payA.map((at) => BYTES.get(at)),
      paysA: true,
    });
    const far = svmPoolWalk(sell(8501716531025289579n));
    const near = svmPoolWalk(sell(8501291477077584537n));
    expect([far.crossed, far.output]).toEqual([[], 43_059_351_872n]);
    expect([near.crossed, near.output]).toEqual([[], 36_752_743_565n]);
  });

  // Where a cook's last unit goes decides what the runtime logs: inside a program's instructions,
  // or inside a call into the runtime. Both are Byreal's swap at three times its price, cooked under
  // limits 6,000 units apart.
  it("tells a cook that ran out of units by either message the runtime logs", () => {
    const program = "Program REALQqNEomY6cQGZJUGwywTBD2UmDT32rZcNnfxQ5N2 failed: ";
    expect(svmRanOutOfUnits([`${program}exceeded CUs meter at BPF instruction`])).toBe(true);
    expect(svmRanOutOfUnits([`${program}Computational budget exceeded`])).toBe(true);
    expect(svmRanOutOfUnits([`${program}custom program error: 0x1771`])).toBe(false);
  });

  it("reads Orca's dynamic tick arrays: their start, then each tick tagged, its net first", () => {
    const data = new Uint8Array(8 + 4 + 32 + 16 + 88 + 2 * 112);
    data.set([0x11, 0xd8, 0xf6, 0x8e, 0xe1, 0xc7, 0xda, 0x38]);
    new DataView(data.buffer).setInt32(8, -704, true);
    // Ticks 3 and 7 initialized, a net of 5 and of -9; every other place one byte.
    let at = 60;
    for (let offset = 0; offset < 88; offset++) {
      if (offset === 3 || offset === 7) {
        data[at] = 1;
        const net = offset === 3 ? 5n : (1n << 128n) - 9n;
        for (let i = 0; i < 16; i++) data[at + 1 + i] = Number((net >> BigInt(8 * i)) & 0xffn);
        at += 113;
      } else at += 1;
    }
    expect(svmTickArray("whirlpool", data, 8)).toEqual({
      start: -704,
      span: 704,
      ticks: [
        { tick: -680, net: 5n },
        { tick: -648, net: -9n },
      ],
    });
  });

  it("charges every pool that trades its headroom's crossings past its walk", () => {
    const orca = pool("orca-whirlpool-sol-usdc");
    const p = fromFixture(orca, (allIn(orca, false) * 10030n) / 10000n);
    const walk = svmPoolWalk(p);
    const [stop] = svmComputeStops([p], 10_000_000);
    const cost = SVM_SWAP_COSTS[ORCA_WHIRLPOOL_PROGRAM_ID]!;
    expect(stop!.estimatedUnits).toBe(
      cost.base + cost.tick * (walk.crossed.length + SVM_HEADROOM_TICKS),
    );
  });

  // A swap in a loop runs as many times as the loop does: each run is the router's work and the
  // swap's own units again, and every run walks the one way to the same limit, so the crossings and
  // their headroom are charged once. A loop whose count is a value leaves no stop worked out.
  describe("a swap in a loop, read from Orca's SOL/USDC pool as the cook's builder reads it", () => {
    const orca = pool("orca-whirlpool-sol-usdc");
    const swap =
      "Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0)";
    const priceLimit = (allIn(orca, false) * 10300n) / 10000n;
    const load: OwnedAccountLoader = async (at) => {
      const account = SNAPSHOT.get(at);
      return account === undefined
        ? null
        : { data: BYTES.get(at)!, owner: account.owner as Address };
    };
    const stopsOf = async (body: string) => {
      const program = compileSauceProgram(
        "solana",
        "function main(amountIn: Uint256, priceLimit: Uint256, n: Uint256): Uint256 {\n" +
          `  let got = 0;\n  ${body.replaceAll("SWAP", swap)}\n  return got;\n}\n`,
      );
      const accounts: Record<string, string> = {};
      for (const [name, derive] of Object.entries(program.derivedAccounts ?? {})) {
        if (!derive.startsWith("slot:") && !derive.startsWith("mint:")) continue;
        const { value } = await resolveSvmAccountName(derive, {
          chain: requireChain("solana"),
          owner: orca.config,
          pot: orca.config,
          load,
        });
        accounts[name] = value;
      }
      return svmProgramStops(program, requireChain("solana"), accounts, { priceLimit }, load);
    };
    const cost = SVM_SWAP_COSTS[ORCA_WHIRLPOOL_PROGRAM_ID]!;

    it("charges a counted loop's swap for each run, its walk once", async () => {
      const looped = (await stopsOf("for (let i = 0; i < 2; i++) { got += SWAP; }"))!;
      const twice = (await stopsOf("got += SWAP;\n  got += SWAP;"))!;
      const once = (await stopsOf("got += SWAP;"))!;
      const ticks = once.stops[0]!.ticksToLimit;
      expect(ticks).toBeGreaterThan(0);
      // The router's work for each run, as two calls written out are charged.
      expect(looped.fixed.units).toBe(SVM_COOK_FIXED + 2 * SVM_SWAP_FIXED);
      expect(twice.fixed.units).toBe(looped.fixed.units);
      // The swap's own units twice; its crossings and their headroom once, where two calls written
      // out are each worked out as a walk of their own.
      expect(looped.stops.map((stop) => stop.estimatedUnits)).toEqual([
        2 * cost.base + cost.tick * (ticks + SVM_HEADROOM_TICKS),
      ]);
      expect([looped.headroom, twice.headroom]).toEqual([
        cost.tick * SVM_HEADROOM_TICKS,
        2 * cost.tick * SVM_HEADROOM_TICKS,
      ]);
      expect(looped.budget).toBe(once.budget - SVM_SWAP_FIXED);
    });

    it("works out no stop where a loop's count is a value, and none for a loop that never runs", async () => {
      const uncounted = (await stopsOf("for (let i = 0; i < n; i++) { got += SWAP; }"))!;
      expect([uncounted.stops, uncounted.binding]).toEqual([[], []]);
      const label = "Orca.Whirlpool.pool(USDC, WSOL, 4)";
      expect(uncounted.unbounded).toEqual({ label, runs: null });
      // The command says so, and gives the plain cook.
      const [line] = svmStopLines(uncounted);
      expect(line).toMatch(/^No pool is held to a stop: the swap in Orca\.Whirlpool\.pool\(USDC/);
      expect(line).toContain("whose count the program does not write out");
      expect(svmStopsJson(uncounted)).toEqual({ computeStops: [], noComputeStops: line });
      // A negative start is 2^256 less it to the compiler, so `-1` down to `-4` is three runs there,
      // which only the `break` cuts short: no count is read from it, and no stop worked out.
      const negative = (await stopsOf(
        "let count = 0;\n  for (let i = -1; i > -4; i--) {\n" +
          "    got += SWAP;\n    count += 1;\n    if (count == 2) { break; }\n  }",
      ))!;
      expect([negative.unbounded, negative.binding]).toEqual([{ label, runs: null }, []]);
      expect(await stopsOf("for (let i = 0; i < 0; i++) { got += SWAP; }")).toBeUndefined();
    });

    // Four runs of the swap's own work fit one cook; five do not, so a loop written to run it five
    // times or more leaves sooner (here at a `break`), at a point the count does not tell.
    it("works out no stop where a loop's count is more than the cook pays for", async () => {
      const counted = (await stopsOf("for (let i = 0; i < 4; i++) { got += SWAP; }"))!;
      expect([counted.unbounded, counted.fixed.units]).toEqual([
        undefined,
        SVM_COOK_FIXED + 4 * SVM_SWAP_FIXED,
      ]);
      const unpaid = (await stopsOf(
        "for (let i = 0; i < 1000; i++) { got += SWAP; if (got > 0) { break; } }",
      ))!;
      expect([unpaid.unbounded, unpaid.stops]).toEqual([
        { label: "Orca.Whirlpool.pool(USDC, WSOL, 4)", runs: 1000 },
        [],
      ]);
      expect(svmStopLines(unpaid)[0]).toContain(
        "runs in a loop written to run it more times than one cook's compute units pay for",
      );
    });
  });
});
