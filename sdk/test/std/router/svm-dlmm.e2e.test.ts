/**
 * `@sauce/router`'s Meteora DLMM swap at a price, executed: `meteoraDlmm` and `swap` compiled into a
 * program calling one of them once on one pool's slot, staged and cooked through the released
 * Kitchen on the harness Pot, against Meteora DLMM's mainnet program
 * (`test/fixtures/svm-exact-in-programs/`) and the SOL/USDC pool's mainnet accounts
 * (`test/svm/fixtures/meteora-dlmm/`). Its swap takes no price limit, so the library walks the bins
 * itself and offers the swap only what the bins within `maxPrice` take. This suite holds that walk
 * to the venue's own, through a model written here from the venue's rules (`walk`, below):
 *
 *   - a swap whose input the bins within `maxPrice` cannot all take pays exactly what drains them,
 *     fee and all, receives at least every unit they held, and leaves the pool at the last of them,
 *     the next bin untouched: both ways, into the second bin array, at three clocks (the
 *     volatility's reference kept, its floor decayed, and reset), and through `swap`;
 *   - what a swap stopped at maxPrice receives is what the venue's own swap of the amount it paid
 *     receives, from the same state (`meteoraDlmmCpi`, its exact input);
 *   - a smaller input is swapped whole; the walk stops after eight bins;
 *   - a pool of two SPL Token mints is swapped through `swap`, and one with a Token-2022 mint
 *     through `swap2`, on its first bin array;
 *   - it returns 0 having moved nothing for every skip its comment names, and stops before a bin
 *     array the slot skips;
 *   - a swap that ran below its floor reverts, and a slot that is not the pair or whose program is
 *     not its pool's owner is refused.
 *
 * It logs the compute units each cook used: the cook's, the engine's, and the venue's within them.
 *
 * The walk is the one eco-incorp/sauce-recipes' Meteora DLMM ladder replicates for its quotes
 * (`update_references`, then each bin's volatility from its distance to the reference).
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Address } from "@solana/kit";

import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import { describeSvm } from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import {
  boot,
  cook,
  editFrozen,
  freeze,
  instruction,
  refused,
  succeeded,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
} from "./exact-in-harness.js";
import type { Compiled, CpiAccount, SlotAccount, Trade } from "./exact-in-harness.js";
import { SVM_TRADER } from "./harness.js";

const PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" as Address;
const PAIR = "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6" as Address;
const EVENT_AUTHORITY = "D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6" as Address;
const RESERVE_X = "EYj9xKw6ZszwpyNibHY7JD5o3QgTVrSdcBp1fMJhrR9o" as Address;
const RESERVE_Y = "CoaxzEh8p5YyGLcj36Eo3cUThVJxeKCs7qvLAGDYwBcz" as Address;
const ORACLE = "59YuGWPunbchD2mbi9U7qvjWQKQReGeepn4ZSr9zz9Li" as Address;
const WSOL = "So11111111111111111111111111111111111111112" as Address;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
/** The pool's bin arrays in the fixture, by index: its active bin, -6260, is in -90. */
const ARRAYS: Record<number, Address> = {
  [-88]: "88CrJuawxX8QQETR5U8gMrjP6fftzUYwSYJyeXBXmU2g" as Address,
  [-89]: "8CRkBdY5RkDRDBAZFKwRBpfe2JSWoPqM8jfr14KUXMpF" as Address,
  [-90]: "EsMdTh8Ce3fdpQoLGhbuqrXKQnZTUQfVpKAbokm6QjYC" as Address,
  [-91]: "BQfCpu2aNw3CXe4SQbDHY6goR6kZgSGakDs9yMqh6Bhv" as Address,
  [-92]: "CqpVWqcMyDGaoH8HWXhEfVo9Xd2i6Ljspvja3Fy6Ye7j" as Address,
};
/** The pool's last volatility update, at the snapshot. */
const LAST_UPDATE = 1_783_355_346n;
/** Past the filter period and within the decay period: the reference reset to the active bin, the
 *  volatility's floor decayed by half. */
const CLOCK = LAST_UPDATE + 54n;
/** The most bins one swap walks. */
const BUDGET = 8;

const FIXTURE = new URL("../../svm/fixtures/meteora-dlmm/", import.meta.url);
const ACCOUNTS = new Map(
  readdirSync(FIXTURE).map((file) => {
    const json = JSON.parse(readFileSync(new URL(file, FIXTURE), "utf8")) as {
      address: Address;
      base64Data: string;
    };
    return [json.address, new Uint8Array(Buffer.from(json.base64Data, "base64"))] as const;
  }),
);

const le = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
};
const i32 = (data: Uint8Array, offset: number): number =>
  Number(BigInt.asIntN(32, le(data, offset, 4)));
const i32Bytes = (value: number): number[] => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return [...bytes];
};

/** One bin the venue's swap would drain, from the venue's rules. */
interface Bin {
  id: number;
  /** What it holds of the token bought. */
  amount: bigint;
  /** What drains it, the fee included. */
  drains: bigint;
  /** What a unit bought here costs, fee paid, in maxPrice's units: what drains it over its amount,
   *  rounded up. */
  cost: bigint;
}

/**
 * The bins a swap paying X (or Y) walks at `now`, nearest first, through `arrays` in walk order,
 * from `active` (the pool's own unless given), at most `BUDGET` of them: `update_references`, then
 * each bin's fee from its distance to the reference, and what drains it, as the venue rounds. The
 * model the suite holds the library to, written from the venue's rules.
 */
function walk(
  paysX: boolean,
  now: bigint,
  arrays: readonly number[],
  active = i32(ACCOUNTS.get(PAIR)!, 76),
): Bin[] {
  const pair = ACCOUNTS.get(PAIR)!;
  const step = le(pair, 80, 2);
  const [filter, decay, reduction] = [le(pair, 10, 2), le(pair, 12, 2), le(pair, 14, 2)];
  const [control, most] = [le(pair, 16, 4), le(pair, 20, 4)];
  const vacc = le(pair, 40, 4);
  let floor = le(pair, 44, 4);
  let reference = BigInt(i32(pair, 48));
  const last = le(pair, 56, 8);
  const elapsed = now > last ? now - last : 0n;
  if (elapsed >= filter) {
    reference = BigInt(active);
    floor = elapsed < decay ? (vacc * reduction) / 10_000n : 0n;
  }
  const base = le(pair, 8, 2) * step * 10n * 10n ** le(pair, 34, 1);
  const bins: Bin[] = [];
  let visited = 0;
  let at = active;
  for (const index of arrays) {
    const data = ACCOUNTS.get(ARRAYS[index]!)!;
    const lo = index * 70;
    if (paysX ? at < lo : at > lo + 69) continue;
    if (paysX ? at > lo + 69 : at < lo) at = paysX ? lo + 69 : lo;
    for (; at >= lo && at <= lo + 69 && visited < BUDGET; at += paysX ? -1 : 1, visited++) {
      const cell = 56 + (at - lo) * 144;
      const amount = le(data, cell + (paysX ? 8 : 0), 8);
      if (amount === 0n) continue;
      const price = le(data, cell + 16, 16);
      const distance = reference > BigInt(at) ? reference - BigInt(at) : BigInt(at) - reference;
      const volatility = floor + distance * 10_000n > most ? most : floor + distance * 10_000n;
      const crossed = volatility * step;
      let fee = base + (control * crossed * crossed + 99_999_999_999n) / 100_000_000_000n;
      if (fee > 100_000_000n) fee = 100_000_000n;
      const drain = paysX
        ? ((amount << 64n) + price - 1n) / price
        : (amount * price + (1n << 64n) - 1n) >> 64n;
      const drains = drain + (drain * fee + 999_999_999n - fee) / (1_000_000_000n - fee);
      bins.push({ id: at, amount, drains, cost: (drains * 10n ** 18n + amount - 1n) / amount });
    }
    at = paysX ? lo - 1 : lo + 70;
  }
  return bins;
}
const sum = (bins: readonly Bin[], field: "drains" | "amount"): bigint =>
  bins.reduce((total, bin) => total + bin[field], 0n);
/** A maxPrice between bin k's cost and the next one's. */
const between = (bins: readonly Bin[], k: number): bigint => {
  expect(bins[k + 1]!.cost).toBeGreaterThan(bins[k]!.cost);
  return (bins[k]!.cost + bins[k + 1]!.cost) / 2n;
};

/** A slot of the pool, its bin arrays as given (null the System program). */
const slotOf = (arrays: readonly (number | null)[]): SlotAccount[] => [
  { address: PROGRAM },
  { address: PAIR, writable: true },
  { address: EVENT_AUTHORITY },
  { address: RESERVE_X, writable: true },
  { address: RESERVE_Y, writable: true },
  { address: ORACLE, writable: true },
  ...arrays.map((index) =>
    index === null ? { address: SYSTEM } : { address: ARRAYS[index]!, writable: true },
  ),
];
/** Paying X the swap walks down, through -90 and -91; paying Y, up through -90 and -89. */
const DOWN = [-90, -91, null];
const UP = [-90, -89, null];
const NO_LIMIT = 1n << 200n;

const programs = new Map<string, Compiled>();
/** A program calling `name` once on the slot `s0`…`s8`, at a price. */
const calling = (name: string): Compiled => {
  let program = programs.get(name);
  if (program === undefined) {
    const slot = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const role = (account: string): string =>
      account === "authority"
        ? "Account<Signer>"
        : ["s0", "s2", "payMint", "buyMint", "tokenProgram", "token2022", "memo"].includes(account)
          ? "Account"
          : "Account<Writable>";
    const accounts = [...slot, ...SVM_TRADER, "recipient"]
      .map((account) => `  ${account}: ${role(account)},`)
      .join("\n");
    program = compileSauceProgram(
      "solana",
      `import { ${name} } from "@sauce/router";\n` +
        `function main(\n${accounts}\n  amountIn: Uint256,\n  maxPrice: Uint256,\n  minOut: Uint256,\n): Uint256 {\n` +
        `  return ${name}([${slot.join(", ")}], [${SVM_TRADER.join(", ")}], amountIn, maxPrice, minOut, recipient);\n}\n`,
    );
    programs.set(name, program);
  }
  return program;
};

describeSvm("@sauce/router's Meteora DLMM swap at a price, on the venue's own program", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await boot(CLOCK, ["meteora-dlmm"], [[PROGRAM, "meteora-dlmm.so.gz"]]);
  }, 120_000);

  const trade = (
    paysX: boolean,
    amountIn: bigint,
    maxPrice: bigint,
    extra: Partial<Trade> = {},
  ): Trade => ({
    slot: slotOf(paysX ? DOWN : UP),
    pay: paysX ? WSOL : USDC,
    buy: paysX ? USDC : WSOL,
    amountIn,
    maxPrice,
    ...extra,
  });
  const run = async (name: string, order: Trade, on?: EngineHarness) => {
    const outcome = await cook(on ?? harness, calling(name), order, PROGRAM);
    if (outcome.ok)
      console.log(
        `${name}: paid ${outcome.paid}, received ${outcome.received}; compute ${outcome.cu}, ` +
          `the engine's ${outcome.engineCu}, the venue's ${outcome.venueCu} within it`,
      );
    return outcome;
  };

  /** An account's data as the bank holds it now. */
  const dataOf = (at: Address): Uint8Array => {
    const account = harness.svm.getAccount(at);
    if (!account.exists) throw new Error(`no account ${at}`);
    return account.data;
  };
  /** The pool's active bin, and a bin's amount of token X or Y. */
  const activeId = (): number => i32(dataOf(PAIR), 76);
  const held = (id: number, x: boolean): bigint => {
    const index = Math.floor(id / 70);
    return le(dataOf(ARRAYS[index]!), 56 + (id - index * 70) * 144 + (x ? 0 : 8), 8);
  };

  describe.each([
    { paysX: true, way: "paying SOL (token X), down" },
    { paysX: false, way: "paying USDC (token Y), up" },
  ])("$way", ({ paysX }) => {
    const arrays = (paysX ? DOWN : UP).filter((index): index is number => index !== null);
    const bins = walk(paysX, CLOCK, arrays);

    it.each([0, 3, 6])(
      "stops at maxPrice with bin %i the last drained, the next untouched",
      async (k) => {
        const maxPrice = between(bins, k);
        for (const name of ["meteoraDlmm", "swap"]) {
          const outcome = succeeded(await run(name, trade(paysX, 10n ** 15n, maxPrice)));
          const drained = bins.slice(0, k + 1);
          expect({ name, paid: outcome.paid }).toEqual({ name, paid: sum(drained, "drains") });
          // Every unit the bins held, and a little more where a bin holds an order beside them.
          expect(outcome.received).toBeGreaterThanOrEqual(sum(drained, "amount"));
          expect(outcome.returned).toBe(outcome.received);
          expect(outcome.paid * 10n ** 18n).toBeLessThanOrEqual(maxPrice * outcome.received);
          expect(activeId()).toBe(bins[k]!.id);
          expect(held(bins[k + 1]!.id, !paysX)).toBe(bins[k + 1]!.amount);
          // Two SPL Token mints: the classic `swap`.
          expect(outcome.call?.data.slice(0, 16)).toBe("f8c69e91e17587c8");
        }
      },
      120_000,
    );

    it("receives at maxPrice what the venue's own swap of the amount it paid does", async () => {
      const stopped = succeeded(
        await run("meteoraDlmm", trade(paysX, 10n ** 15n, between(bins, 4))),
      );
      expect(stopped.paid).toBe(sum(bins.slice(0, 5), "drains"));
      // The venue's `swap` of exactly that amount, from the same state, its accounts listed whole.
      const w = true;
      const list: CpiAccount[] = [
        { address: PAIR, writable: w },
        { address: PROGRAM },
        { address: RESERVE_X, writable: w },
        { address: RESERVE_Y, writable: w },
        { address: "source", writable: w },
        { address: "recipient", writable: w },
        { address: WSOL },
        { address: USDC },
        { address: ORACLE, writable: w },
        { address: PROGRAM },
        { address: "authority" },
        { address: TOKEN },
        { address: TOKEN },
        { address: EVENT_AUTHORITY },
        { address: PROGRAM },
        ...arrays.map((index): CpiAccount => ({ address: ARRAYS[index]!, writable: w })),
      ];
      const own = succeeded(
        await cook(
          harness,
          instruction("Cpi", "meteoraDlmm", list.length),
          {
            ...trade(paysX, stopped.paid, 0n),
            minOut: 1n,
            slot: [],
            cpi: { program: PROGRAM, accounts: list },
          },
          PROGRAM,
        ),
      );
      expect([own.paid, own.received]).toEqual([stopped.paid, stopped.received]);
      expect(activeId()).toBe(bins[4]!.id);
    }, 120_000);

    it("swaps a smaller input whole", async () => {
      const amountIn = bins[0]!.drains + bins[1]!.drains / 2n;
      const outcome = succeeded(await run("meteoraDlmm", trade(paysX, amountIn, bins[5]!.cost)));
      expect(outcome.paid).toBe(amountIn);
      expect(outcome.received).toBeGreaterThan(bins[0]!.amount);
      expect(outcome.received).toBeLessThan(bins[0]!.amount + bins[1]!.amount);
      expect(activeId()).toBe(bins[1]!.id);
    }, 120_000);

    it("stops after eight bins", async () => {
      expect(bins.length).toBe(BUDGET);
      const outcome = succeeded(await run("meteoraDlmm", trade(paysX, 10n ** 15n, NO_LIMIT)));
      expect(outcome.paid).toBe(sum(bins, "drains"));
      expect(activeId()).toBe(bins[BUDGET - 1]!.id);
    }, 120_000);

    it("walks into the second bin array, and stops before one the slot skips", async () => {
      // The active bin moved to four bins from its array's end.
      const active = paysX ? -6297 : -6234;
      const restore = editFrozen(harness, PAIR, 76, i32Bytes(active));
      try {
        const into = walk(paysX, CLOCK, arrays, active);
        expect(Math.floor(into[6]!.id / 70)).toBe(arrays[1]);
        const outcome = succeeded(
          await run("meteoraDlmm", trade(paysX, 10n ** 15n, between(into, 6))),
        );
        expect(outcome.paid).toBe(sum(into.slice(0, 7), "drains"));
        expect(activeId()).toBe(into[6]!.id);
        // A slot that skips the array after it: the swap would go there, so the walk stops at the
        // end of the first.
        const skipping = paysX ? [-90, -92, null] : [-90, -88, null];
        const stopped = succeeded(
          await run("meteoraDlmm", trade(paysX, 10n ** 15n, NO_LIMIT, { slot: slotOf(skipping) })),
        );
        expect(stopped.paid).toBe(sum(into.slice(0, 4), "drains"));
      } finally {
        restore();
      }
    }, 120_000);

    it("passes over a bin array behind the walk", async () => {
      const behind = paysX ? [-89, -90, null] : [-91, -90, null];
      const order = trade(paysX, 10n ** 15n, between(bins, 3), { slot: slotOf(behind) });
      const outcome = succeeded(await run("meteoraDlmm", order));
      expect(outcome.paid).toBe(sum(bins.slice(0, 4), "drains"));
    }, 120_000);
  });

  it.each([
    { after: 10, when: "within the filter period: the stored reference kept" },
    { after: 54, when: "within the decay period: the floor decayed" },
    { after: 900, when: "past the decay period: no floor" },
  ])(
    "drains exactly to maxPrice $when",
    async ({ after }) => {
      const clock = LAST_UPDATE + BigInt(after);
      const at = await boot(clock, ["meteora-dlmm"], [[PROGRAM, "meteora-dlmm.so.gz"]]);
      const bins = walk(true, clock, [-90, -91]);
      const order = trade(true, 10n ** 15n, between(bins, 5));
      const outcome = succeeded(await run("meteoraDlmm", order, at));
      expect(outcome.paid).toBe(sum(bins.slice(0, 6), "drains"));
      expect(outcome.received).toBeGreaterThanOrEqual(sum(bins.slice(0, 6), "amount"));
    },
    120_000,
  );

  it("swaps a pool with a Token-2022 mint through `swap2`, on its first bin array", async () => {
    // USDC as a Token-2022 mint: its account and the pool's reserve of it held by Token-2022, whose
    // base layouts are SPL Token's.
    const at = await boot(CLOCK, ["meteora-dlmm"], [[PROGRAM, "meteora-dlmm.so.gz"]]);
    for (const account of [USDC, RESERVE_Y]) {
      const now = at.svm.getAccount(account);
      if (!now.exists) throw new Error(`no ${account}`);
      at.svm.setAccount({ ...now, programAddress: TOKEN_2022 });
    }
    freeze(at, [USDC, RESERVE_Y]);
    for (const paysX of [true, false]) {
      const bins = walk(paysX, CLOCK, [-90]);
      const order = trade(paysX, 10n ** 15n, between(bins, 3), {
        payProgram: paysX ? TOKEN : TOKEN_2022,
        buyProgram: paysX ? TOKEN_2022 : TOKEN,
      });
      const outcome = succeeded(await run("meteoraDlmm", order, at));
      expect(outcome.paid).toBe(sum(bins.slice(0, 4), "drains"));
      expect(outcome.call?.data.slice(0, 16)).toBe("414b3f4ceb5b5b88");
      expect(outcome.call?.accounts.length).toBe(17);
    }
  }, 120_000);

  describe("returns 0 having moved nothing", () => {
    const bins = walk(true, CLOCK, [-90, -91]);
    const nothing = async (order: Trade, edits: [number, number[]][] = []) => {
      const restores = edits.map(([offset, bytes]) => editFrozen(harness, PAIR, offset, bytes));
      try {
        const outcome = succeeded(await run("meteoraDlmm", order));
        expect([outcome.returned, outcome.paid, outcome.received]).toEqual([0n, 0n, 0n]);
        expect(outcome.call).toBeUndefined();
      } finally {
        for (const restore of restores.reverse()) restore();
      }
    };
    const point = new Uint8Array(8);
    new DataView(point.buffer).setBigUint64(0, CLOCK + 100n, true);

    it("for a pool whose first bin is past maxPrice", () =>
      nothing(trade(true, 10n ** 12n, bins[0]!.cost - 1n)));
    it("for an input that buys nothing in the first bin", () => nothing(trade(true, 1n, NO_LIMIT)));
    it("for a missing slot, and no input", async () => {
      const slot = slotOf(DOWN);
      slot[1] = { address: SYSTEM };
      await nothing(trade(true, 10n ** 12n, NO_LIMIT, { slot }));
      await nothing(trade(true, 0n, NO_LIMIT));
    });
    it("for a pool whose swaps are off", () =>
      nothing(trade(true, 10n ** 12n, NO_LIMIT), [[82, [1]]]));
    it("for a pool that takes its fee from the token bought", () =>
      nothing(trade(true, 10n ** 12n, NO_LIMIT), [[36, [1]]]));
    it("for a pool not active yet", () =>
      nothing(trade(true, 10n ** 12n, NO_LIMIT), [
        [86, [1]],
        [816, [...point]],
      ]));
    // Its active bin in array -515, past the bitmap's -512 to 511: its swap would read the bitmap
    // extension, which the slot does not give.
    it("for a pool whose active bin is past its own bitmap", () =>
      nothing(trade(true, 10n ** 12n, NO_LIMIT), [[76, i32Bytes(-515 * 70)]]));
  });

  it("reverts below minOut", async () => {
    const bins = walk(true, CLOCK, [-90, -91]);
    const minOut = sum(bins.slice(0, 4), "amount") * 2n;
    const order = trade(true, 10n ** 15n, between(bins, 3), { minOut });
    expect(refused(await run("meteoraDlmm", order))).toBe("below minOut");
  }, 120_000);

  it("refuses a slot that is not the pair, and one whose program is not its pool's owner", async () => {
    const pair = trade(true, 10n ** 12n, NO_LIMIT, { buy: RESERVE_X });
    expect(refused(await run("meteoraDlmm", pair))).toBe("pool is not the pair");
    const slot = slotOf(DOWN);
    slot[0] = { address: TOKEN };
    const owner = trade(true, 10n ** 12n, NO_LIMIT, { slot });
    expect(refused(await run("meteoraDlmm", owner))).toBe("not a Meteora DLMM pool");
    expect(refused(await run("swap", owner))).toBe("a pool's program is not its owner");
  }, 120_000);
});
