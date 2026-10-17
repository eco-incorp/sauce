/**
 * The cook's builder's model of a swap at a price (`svm/compute-stops.ts`), offline: its cost table's
 * fallback, its tick-array reader on each layout, a walk inside the price's own tick, and the order
 * it gives the pools. Its costs and walks are held to the venues' own programs in the router suite.
 */
import { address } from "@solana/kit";

import {
  SVM_HEADROOM_TICKS,
  SVM_SWAP_COSTS,
  svmComputeStops,
  svmPoolWalk,
  svmSwapCost,
  svmTickArray,
  type SvmStopPool,
} from "../src/svm/compute-stops.js";
import { ORCA_WHIRLPOOL_PROGRAM_ID } from "../src/svm/venues/index.js";
import { allIn, BYTES, LAYOUT, pool, type Pool } from "./svm/venue-fixture.js";

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
});
