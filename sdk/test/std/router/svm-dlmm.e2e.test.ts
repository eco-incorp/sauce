/**
 * `@sauce/router`'s Meteora DLMM swap from a slot, executed: `meteoraDlmm` compiled into a program
 * calling it once on one pool's slot, staged and cooked through the released Kitchen on the harness
 * Pot, against Meteora DLMM's mainnet program (`test/fixtures/svm-exact-in-programs/`) and the
 * SOL/USDC pool's mainnet accounts (`test/svm/fixtures/meteora-dlmm/`). It is an exact input, the
 * venue's own swap with no price limit, and this suite holds it to that:
 *
 *   - it pays exactly `amountIn` and receives what the venue's own swap of that amount receives from
 *     the same state (`meteoraDlmmCpi`, its instruction on the accounts listed whole): both ways, and
 *     across into the slot's second bin array;
 *   - a pool of two SPL Token mints is sent `swap`, one with a Token-2022 mint `swap2` on its first
 *     bin array; an input past the bin arrays the slot gives fails the transaction;
 *   - it returns 0 having moved nothing for a missing slot, no input, a pool whose swaps are off and
 *     one not active yet;
 *   - below `minOut` the transaction fails, and a slot whose program is not the pool's owner, or a
 *     floor past 64 bits, is refused.
 *
 * It logs the compute units each cook used: the cook's, the engine's, and the venue's within them.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import type { Address } from "@solana/kit";

import { describeSvm } from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import {
  boot,
  compiled,
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
import type { CpiAccount, SlotAccount, Trade } from "./exact-in-harness.js";

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
  [-89]: "8CRkBdY5RkDRDBAZFKwRBpfe2JSWoPqM8jfr14KUXMpF" as Address,
  [-90]: "EsMdTh8Ce3fdpQoLGhbuqrXKQnZTUQfVpKAbokm6QjYC" as Address,
  [-91]: "BQfCpu2aNw3CXe4SQbDHY6goR6kZgSGakDs9yMqh6Bhv" as Address,
};
/** A little after the pool's last volatility update, at the snapshot. */
const CLOCK = 1_783_355_400n;
/** Paying SOL, token X, the swap walks down -90 then -91; paying USDC, up -90 then -89. */
const DOWN = [-90, -91];
const UP = [-90, -89];

/** The pool's slot: its program, the pool, the event authority, its reserves, its oracle, and the
 *  bin arrays given, the System program past them. */
const slotOf = (arrays: readonly number[]): SlotAccount[] => [
  { address: PROGRAM },
  { address: PAIR, writable: true },
  { address: EVENT_AUTHORITY },
  { address: RESERVE_X, writable: true },
  { address: RESERVE_Y, writable: true },
  { address: ORACLE, writable: true },
  ...[0, 1, 2].map((i) =>
    arrays[i] === undefined
      ? { address: SYSTEM }
      : { address: ARRAYS[arrays[i]!]!, writable: true },
  ),
];

/** The venue's `swap` on its accounts listed whole: the pool, its bitmap extension and host fee
 *  account as the program (none), the reserves, the paying and receiving accounts, the mints, the
 *  oracle, the authority, the token programs, the event authority, the program and `arrays`. */
const listed = (arrays: readonly number[]): CpiAccount[] => [
  { address: PAIR, writable: true },
  { address: PROGRAM },
  { address: RESERVE_X, writable: true },
  { address: RESERVE_Y, writable: true },
  { address: "source", writable: true },
  { address: "recipient", writable: true },
  { address: WSOL },
  { address: USDC },
  { address: ORACLE, writable: true },
  { address: PROGRAM },
  { address: "authority" },
  { address: TOKEN },
  { address: TOKEN },
  { address: EVENT_AUTHORITY },
  { address: PROGRAM },
  ...arrays.map((index): CpiAccount => ({ address: ARRAYS[index]!, writable: true })),
];

describeSvm("@sauce/router's Meteora DLMM swap from a slot, on the venue's own program", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await boot(CLOCK, ["meteora-dlmm"], [[PROGRAM, "meteora-dlmm.so.gz"]]);
  }, 120_000);

  const trade = (paysX: boolean, amountIn: bigint, extra: Partial<Trade> = {}): Trade => ({
    slot: slotOf(paysX ? DOWN : UP),
    pay: paysX ? WSOL : USDC,
    buy: paysX ? USDC : WSOL,
    amountIn,
    minOut: 1n,
    ...extra,
  });
  const run = async (order: Trade, on?: EngineHarness) => {
    const outcome = await cook(on ?? harness, compiled("meteoraDlmm", 9), order, PROGRAM);
    if (outcome.ok)
      console.log(
        `meteoraDlmm: paid ${outcome.paid}, received ${outcome.received}; compute ${outcome.cu}, ` +
          `the engine's ${outcome.engineCu}, the venue's ${outcome.venueCu} within it`,
      );
    return outcome;
  };
  /** The venue's own swap of `amountIn` from the same state, on its accounts listed whole. */
  const own = async (paysX: boolean, amountIn: bigint, on?: EngineHarness) => {
    const arrays = paysX ? DOWN : UP;
    return succeeded(
      await cook(
        on ?? harness,
        instruction("Cpi", "meteoraDlmm", listed(arrays).length),
        {
          ...trade(paysX, amountIn),
          slot: [],
          cpi: { program: PROGRAM, accounts: listed(arrays) },
        },
        PROGRAM,
      ),
    );
  };

  describe.each([
    { paysX: true, way: "paying SOL (token X)", small: 10n ** 9n, across: 10n ** 13n },
    { paysX: false, way: "paying USDC (token Y)", small: 100n * 10n ** 6n, across: 10n ** 12n },
  ])("$way", ({ paysX, small, across }) => {
    it.each([
      ["within the active bin's array", small],
      ["across into the slot's second bin array", across],
    ])(
      "pays exactly the input %s and receives what the venue's own swap does",
      async (_, amount) => {
        const swapped = succeeded(await run(trade(paysX, amount)));
        const venue = await own(paysX, amount);
        expect(swapped.paid).toBe(amount);
        expect(swapped.received).toBeGreaterThan(0n);
        expect([swapped.paid, swapped.received]).toEqual([venue.paid, venue.received]);
        expect(swapped.returned).toBe(swapped.received);
        // Two SPL Token mints: the classic `swap`, and its floor the venue's own.
        expect(swapped.call?.data.slice(0, 16)).toBe("f8c69e91e17587c8");
        expect(swapped.call?.accounts.length).toBe(17);
      },
      120_000,
    );
  });

  it("fails an input past the bin arrays the slot gives", async () => {
    const order = trade(true, 10n ** 13n, { slot: slotOf([-90]) });
    expect((await run(order)).ok).toBe(false);
  }, 120_000);

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
      const order = trade(paysX, paysX ? 10n ** 9n : 100n * 10n ** 6n, {
        payProgram: paysX ? TOKEN : TOKEN_2022,
        buyProgram: paysX ? TOKEN_2022 : TOKEN,
      });
      const outcome = succeeded(await run(order, at));
      expect(outcome.received).toBeGreaterThan(0n);
      expect(outcome.call?.data.slice(0, 16)).toBe("414b3f4ceb5b5b88");
      expect(outcome.call?.accounts.length).toBe(17);
    }
  }, 120_000);

  describe("returns 0 having moved nothing", () => {
    const nothing = async (order: Trade, edits: [number, number[]][] = []) => {
      const restores = edits.map(([offset, bytes]) => editFrozen(harness, PAIR, offset, bytes));
      try {
        const outcome = succeeded(await run(order));
        expect([outcome.returned, outcome.paid, outcome.received]).toEqual([0n, 0n, 0n]);
        expect(outcome.call).toBeUndefined();
      } finally {
        for (const restore of restores.reverse()) restore();
      }
    };
    const point = new Uint8Array(8);
    new DataView(point.buffer).setBigUint64(0, CLOCK + 100n, true);

    it("for a missing slot, and no input", async () => {
      const slot = slotOf(DOWN);
      slot[1] = { address: SYSTEM };
      await nothing(trade(true, 10n ** 9n, { slot }));
      await nothing(trade(true, 0n));
    });
    it("for a pool whose swaps are off", () => nothing(trade(true, 10n ** 9n), [[82, [1]]]));
    it("for a pool not active yet", () =>
      nothing(trade(true, 10n ** 9n), [
        [86, [1]],
        [816, [...point]],
      ]));
  });

  it("fails below minOut, and refuses another program's pool and a floor past 64 bits", async () => {
    const swapped = succeeded(await run(trade(true, 10n ** 9n)));
    expect((await run(trade(true, 10n ** 9n, { minOut: swapped.received + 1n }))).ok).toBe(false);
    const slot = slotOf(DOWN);
    slot[0] = { address: TOKEN };
    expect(refused(await run(trade(true, 10n ** 9n, { slot })))).toBe("not a Meteora DLMM pool");
    expect(refused(await run(trade(true, 10n ** 9n, { minOut: 1n << 64n })))).toBe(
      "minOut past 64 bits",
    );
  }, 120_000);
});
