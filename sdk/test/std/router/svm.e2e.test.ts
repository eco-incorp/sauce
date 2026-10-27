/**
 * `@sauce/router`'s Solana arm, executed: each function compiled into a program that calls it once
 * on one pool, staged and cooked through the released Kitchen on the harness Pot, against the venues'
 * own mainnet programs and the pools' mainnet accounts (`svm/venue-fixture.ts`). It proves what the
 * library's header says each function does:
 *
 *   - a paid swap is the swap the Solana distributed swap's per-pool helper made before the library
 *     took its venue code (`fixtures/inline-trade.svm.sauce.ts`, run from the same state): the same
 *     amount received, the same input taken, the pool left at the same price — its own limit, for
 *     an order large enough to reach it — through the venue's own function, both ways for the deep
 *     pools;
 *   - each function returns 0 having moved nothing for every skip its header names (an input too
 *     small to buy one unit and a Phoenix limit too large for an order among them); the smallest
 *     input the estimate lets through delivers at least one unit;
 *   - a swap that ran below its floor reverts;
 *   - on Raydium's code and Crema, a Stopped form given a deep tick walks on into the furthest tick
 *     array its slot gives, to a tick inside it, and refuses a tick its array does not hold as read;
 *   - a slot that is not the pair, whose program is not the venue's, or whose pool is another venue's
 *     or no venue's, is refused.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { readFileSync } from "node:fs";
import { AccountRole, getAddressCodec } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";

import { svmRanOutOfUnits } from "../../../src/cli/svm-stops.js";
import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
} from "../../../src/svm/index.js";
import { fetchPhoenixConfig } from "../../../src/svm/venues/phoenix/index.js";
import { raydiumSqrtPriceAtTick } from "../../../src/svm/venues/raydium-clmm/tick-math.js";
import {
  SVM_COOK_FIXED,
  SVM_COOK_UNITS,
  SVM_SWAP_COSTS,
  SVM_SWAP_FIXED,
  svmComputeStops,
  svmPoolWalk,
  svmSkipStop,
  type SvmComputeStop,
  type SvmStopPool,
} from "../../../src/svm/compute-stops.js";
import {
  describeSvm,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  setTokenAccount,
  stageProgram,
  startEngine,
  tokenAmount,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import {
  allIn,
  BYTES,
  E18,
  key,
  LAYOUT,
  le,
  loadVenues,
  manifest,
  MEMO,
  NONE,
  ownLimit,
  pool,
  restoreVenues,
  SNAPSHOT,
  windowBound,
  windowStop,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  USDC,
  USDT,
  WSOL,
} from "../../svm/venue-fixture.js";
import type { Pool } from "../../svm/venue-fixture.js";
import { SVM_SLOT, svmProgramCalling } from "./harness.js";

type Compiled = ReturnType<typeof compileSauceProgram>;

interface Order {
  pool: Pool;
  pay: Address;
  buy: Address;
  amountIn: bigint;
  priceLimit: bigint;
  minOut?: bigint;
  /** Bytes to change in an account before the cook, for one case: a pool emptied, paused. */
  edit?: { address: Address; offset: number; bytes: number[] };
  /** The slot's tick arrays, where a case names fewer than the pool's three. */
  ticks?: Address[];
  /** The swap's `stop`: 0 none (the default), 1 skip, else a sqrt price it goes no further than. */
  stop?: bigint;
}

type Outcome =
  | {
      ok: true;
      /** What `main` returned: the function's own count. */
      returned: bigint;
      /** What the recipient's balance gained, and the paying account's lost, read from the bank. */
      received: bigint;
      paid: bigint;
      /** The pool's sqrt price after the cook, for the concentrated-liquidity venues. */
      price?: bigint;
      /** Every fixture account the cook changed. */
      changed: Address[];
      /** The units the venue's own program spent. */
      venueUnits?: number;
    }
  | { ok: false; reason: string; logs: string[] };

/** A signed i32 at `at` of an account's data. */
const i32 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset).getInt32(at, true);

/** What the paying account holds beside the amount offered: never offered, never spent. */
const KEPT = 7n;
/** A venue's own function, by the name its venue carries. */
const lower = (venue: string): string => venue.charAt(0).toLowerCase() + venue.slice(1);

describeSvm("@sauce/router's Solana arm, on the venues' own programs and pools", () => {
  const programs = new Map<string, Compiled>();
  const compiled = (name: string): Compiled => {
    let program = programs.get(name);
    if (program === undefined) {
      program = compileSauceProgram("solana", svmProgramCalling(name));
      programs.set(name, program);
    }
    return program;
  };
  const inline = compileSauceProgram(
    "solana",
    readFileSync(new URL("./fixtures/inline-trade.svm.sauce.ts", import.meta.url), "utf8"),
  );
  let harness: EngineHarness;
  let nonce = 0n;

  beforeAll(async () => {
    // A little after the snapshot: a whirlpool refuses a clock before its last update.
    harness = await startEngine(BigInt(manifest.unixTimestamp) + 60n);
    loadVenues(harness.svm);
  }, 120_000);

  const cook = async (program: Compiled, order: Order): Promise<Outcome> => {
    restoreVenues(harness.svm, order.edit);
    const source = setTokenAccount(
      harness,
      randomAddress(),
      order.pay,
      harness.pot,
      order.amountIn + KEPT,
    );
    // The Pot's own: Crema and Phoenix pay only into the trader's account.
    const recipient = setTokenAccount(harness, randomAddress(), order.buy, harness.pot, 0n);
    const p = order.pool;
    const paysA = key(order.pay) < key(order.buy);
    const w = AccountRole.WRITABLE;
    const r = AccountRole.READONLY;
    const slot = [
      p.program,
      p.pool,
      p.config,
      p.vaultA,
      p.vaultB,
      p.extra,
      ...(order.ticks ?? (paysA ? p.payA : p.payB)),
    ];
    const named: Record<string, { address: Address; role: AccountRole }> = {
      authority: { address: harness.pot, role: r }, // the Kitchen signs for the Pot
      source: { address: source, role: w },
      payMint: { address: order.pay, role: r },
      buyMint: { address: order.buy, role: r },
      tokenProgram: { address: TOKEN, role: r },
      token2022: { address: TOKEN_2022, role: r },
      memo: { address: MEMO, role: r },
      recipient: { address: recipient, role: w },
    };
    SVM_SLOT.forEach((name, j) => {
      // The program and config are read; the rest a swap writes. The System program is never
      // writable, and stands in for every account a slot does not use.
      const writable = slot[j] !== SYSTEM && j !== 0 && j !== 2;
      named[name] = { address: slot[j]!, role: writable ? w : r };
    });
    const tail = program.manifest!.accounts.map((entry) => {
      if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
      const meta = named[entry.name];
      if (meta === undefined) throw new Error(`no account for ${entry.name}`);
      return meta;
    });

    // Staged, its accounts through a lookup table: as `sauce run` cooks a program past one
    // transaction.
    const args = encodeEntryArguments(
      program,
      program.entryParams.map(
        (param) =>
          ({
            amountIn: order.amountIn,
            priceLimit: order.priceLimit,
            minOut: order.minOut ?? 0n,
            stop: order.stop ?? 0n,
          })[param.name]!,
      ),
    );
    const payload = new Uint8Array(program.bytecode.length + args.length);
    payload.set(program.bytecode);
    payload.set(args, program.bytecode.length);
    nonce += 1n;
    const staged = await stageProgram(harness, payload, nonce);
    const instructions: Instruction[] = [
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      buildHeapFramePrepend(),
      buildCookFromAccountInstruction({
        kitchen: harness.kitchen,
        owner: harness.payer.address,
        codeBuffer: staged.codeBuffer,
        code: staged.code,
        engineProgram: harness.programId,
        potSalt: HARNESS_POT_SALT,
        pot: harness.pot,
        feeConfig: harness.feeConfig,
        maxExecutionFee: 0n,
        tail,
      }),
    ];
    const keys = [
      ...new Set([
        harness.kitchen,
        harness.programId,
        harness.pot,
        harness.feeConfig,
        staged.codeBuffer,
        staged.code,
        ...tail.map((meta) => meta.address),
      ]),
    ].filter((at) => at !== harness.payer.address);
    const lookupTables: AddressesByLookupTableAddress = fabricateAlt(harness, keys);
    harness.svm.expireBlockhash();
    const transaction = await buildExecuteTransaction({
      payer: harness.payer,
      instructions,
      latestBlockhash: {
        blockhash: harness.svm.latestBlockhash(),
        lastValidBlockHeight: 1_000_000n,
      },
      lookupTables,
    });
    const result = harness.svm.sendTransaction(transaction);
    if (result instanceof FailedTransactionMetadata) {
      return {
        ok: false,
        reason: new TextDecoder().decode(result.meta().returnData().data()),
        logs: result.meta().logs(),
      };
    }
    const returned = BigInt(
      `0x${Buffer.from(result.returnData().data().subarray(0, 32)).toString("hex")}`,
    );
    // What the venue's own program spent, as its log line says.
    const spent = result
      .logs()
      .map((line) => new RegExp(`^Program ${p.program} consumed (\\d+) of`).exec(line))
      .find((match) => match !== null);
    const layout = LAYOUT[p.venue];
    const priced = harness.svm.getAccount(p.pool);
    const changed = [...BYTES].flatMap(([at, data]) => {
      const now = harness.svm.getAccount(at);
      return now.exists && Buffer.from(now.data).equals(Buffer.from(data)) ? [] : [at];
    });
    return {
      ok: true,
      returned,
      received: tokenAmount(harness, recipient),
      paid: order.amountIn + KEPT - tokenAmount(harness, source),
      ...(layout === undefined || !priced.exists
        ? {}
        : { price: le(priced.data, layout.price, 16) }),
      changed,
      ...(spent === undefined ? {} : { venueUnits: Number(spent![1]) }),
    };
  };

  const succeeded = (outcome: Outcome): Extract<Outcome, { ok: true }> => {
    if (!outcome.ok)
      throw new Error(`the cook failed: ${outcome.reason}\n${outcome.logs.join("\n")}`);
    return outcome;
  };
  const refused = (outcome: Outcome): string => {
    if (outcome.ok) throw new Error("the cook succeeded; expected a refusal");
    return outcome.reason;
  };

  // A Phoenix limit just past its book's first price level, fee included: the order takes that level
  // and leaves the next.
  const phoenixMax = async (p: Pool): Promise<bigint> => {
    const loader = async (at: Address) =>
      BYTES.has(at)
        ? { data: new Uint8Array(BYTES.get(at)!), owner: SNAPSHOT.get(at)!.owner as Address }
        : null;
    const market = await fetchPhoenixConfig(loader, p.pool);
    const data = BYTES.get(p.pool)!;
    const first = market.windows.quoteIn.orders[0]!;
    const ticks = le(data, market.asksNodesBase + (first.nodeIndex - 1) * 64 + 16, 8);
    const tick =
      (market.tickSizeInQuoteLotsPerBaseUnit * market.quoteLotSize * E18) /
      (market.baseLotsPerBaseUnit * market.baseLotSize);
    return (ticks * tick * (10000n + le(data, 856, 8))) / 10000n + tick / 2n;
  };

  // Each venue's function, one of its pools, and the trade: buying with USDC, a priceLimit a few basis
  // points above the pool's own price with its fee, and enough to reach it.
  const VENUES: { venue: string; pool: string; buy: Address; bps: bigint }[] = [
    { venue: "RaydiumClmm", pool: "raydium-clmm-sol-usdc", buy: WSOL, bps: 3n },
    { venue: "PancakeswapClmm", pool: "pancakeswap-clmm-sol-usdc", buy: WSOL, bps: 3n },
    { venue: "Byreal", pool: "byreal-usdc", buy: SYSTEM, bps: 3n },
    { venue: "StabbleClmm", pool: "stabble-clmm-usdc-usdt", buy: USDT, bps: 3n },
    { venue: "OrcaWhirlpool", pool: "orca-whirlpool-sol-usdc", buy: WSOL, bps: 3n },
    { venue: "Cropper", pool: "cropper-sol-usdc", buy: WSOL, bps: 5n },
    { venue: "Defituna", pool: "defituna-sol-usdc", buy: WSOL, bps: 3n },
    { venue: "Crema", pool: "crema-sol-usdc", buy: WSOL, bps: 5n },
    { venue: "Phoenix", pool: "phoenix-sol-usdc", buy: WSOL, bps: 0n },
  ];
  /** The token Byreal's pool trades against USDC: the mint at its first offset. */
  const other = (p: Pool): Address =>
    getAddressCodec().decode(BYTES.get(p.pool)!.subarray(73, 105));
  const orderFor = async (entry: (typeof VENUES)[number]): Promise<Order> => {
    const p = pool(entry.pool);
    const buy = entry.buy === SYSTEM ? other(p) : entry.buy;
    const paysA = key(USDC) < key(buy);
    const priceLimit =
      p.venue === "phoenix"
        ? await phoenixMax(p)
        : (allIn(p, paysA) * (10000n + entry.bps)) / 10000n;
    return { pool: p, pay: USDC, buy, amountIn: 1_000_000n * 10n ** 6n, priceLimit };
  };

  describe("a paid swap is the per-pool helper's swap", () => {
    it.each(VENUES)(
      "$venue: its own function",
      async (entry) => {
        const order = await orderFor(entry);
        const expected = succeeded(await cook(inline, order));
        expect(expected.received).toBeGreaterThan(0n);
        expect(expected.returned).toBe(expected.received);
        const outcome = succeeded(await cook(compiled(lower(entry.venue)), order));
        // The same swap, but for the units its venue spent, which move a little with the accounts.
        expect({ ...outcome, venueUnits: 0 }).toEqual({ ...expected, venueUnits: 0 });
        expect(outcome.paid).toBeLessThanOrEqual(order.amountIn);
        expect(outcome.paid * E18).toBeLessThanOrEqual(order.priceLimit * outcome.received);
        // Each concentrated-liquidity pool stops exactly at its own fee-adjusted limit.
        if (expected.price !== undefined)
          expect(expected.price).toBe(
            ownLimit(order.pool, order.priceLimit, key(USDC) < key(order.buy)),
          );
      },
      120_000,
    );

    it.each([
      "raydium-clmm-sol-usdc",
      "pancakeswap-clmm-sol-usdc",
      "orca-whirlpool-sol-usdc",
      "defituna-sol-usdc",
    ])(
      "%s the other way, paying the lower-key token",
      async (name) => {
        const p = pool(name);
        const order: Order = {
          pool: p,
          pay: WSOL,
          buy: USDC,
          amountIn: 100_000n * 10n ** 9n,
          priceLimit: (allIn(p, true) * 10003n) / 10000n,
        };
        const expected = succeeded(await cook(inline, order));
        expect(expected.received).toBeGreaterThan(0n);
        const venue = {
          "raydium-clmm": "raydiumClmm",
          "pancakeswap-clmm": "pancakeswapClmm",
          "orca-whirlpool": "orcaWhirlpool",
          defituna: "defituna",
        }[p.venue]!;
        const outcome = succeeded(await cook(compiled(venue), order));
        expect(outcome.received).toBe(expected.received);
        expect(outcome.paid).toBe(expected.paid);
        expect(outcome.price).toBe(expected.price);
        expect(outcome.returned).toBe(outcome.received);
        expect(expected.price).toBe(ownLimit(p, order.priceLimit, true));
      },
      120_000,
    );
  });

  // A pool priced past its own tick bitmap takes its bitmap extension among its tick arrays, in the
  // first place (`svm/pool-slot.ts`). Each fork of Raydium's code finds the extension there by its
  // key and reads the arrays after it: a slot whose first place is the extension swaps exactly as
  // the slot of three arrays does.
  it.each([
    "raydium-clmm-sol-usdc",
    "pancakeswap-clmm-sol-usdc",
    "byreal-usdc",
    "stabble-clmm-usdc-usdt",
  ])(
    "%s: its bitmap extension in the first tick-array place is passed over by its key",
    async (name) => {
      const entry = VENUES.find((one) => one.pool === name)!;
      const order = await orderFor(entry);
      const p = order.pool;
      const ticks = key(USDC) < key(order.buy) ? p.payA : p.payB;
      const plain = succeeded(await cook(compiled(lower(entry.venue)), order));
      expect(plain.received).toBeGreaterThan(0n);
      const extended = succeeded(
        await cook(compiled(lower(entry.venue)), {
          ...order,
          ticks: [p.more![0]!, ticks[0]!, ticks[1]!],
        }),
      );
      expect([extended.received, extended.paid, extended.price]).toEqual([
        plain.received,
        plain.paid,
        plain.price,
      ]);
    },
    120_000,
  );

  // A swap walks the tick arrays its slot gives it and no further: past them each program fails the
  // whole transaction (Raydium's code `NotEnoughTickArrayAccount`, or
  // `MissingTickArrayBitmapExtensionAccount` where its lookup runs past the pool's own bitmap; the
  // whirlpools' `TickArraySequenceInvalidIndex`; Crema's `NextTickNotFound`). A swap at a price holds
  // its limit a tick inside its window's last safe tick, so an order with a limit at three times the
  // pool's price and the input to reach it stops there, its pool's price exactly the window's bound.
  // Byreal's fixture pool runs out of compute units walking its own ticks before it reaches its
  // window with no stop (below, with the one the command works out), and stops at its window in the
  // cell for the price's own array below. PancakeSwap's has its own cell, after this one.
  it.each(["RaydiumClmm", "StabbleClmm", "Cropper", "Defituna", "Crema"])(
    "%s: a limit far past its window stops a tick inside it, where the cook used to fail",
    async (venue) => {
      const entry = VENUES.find((one) => one.venue === venue)!;
      const base = await orderFor(entry);
      const paysA = key(USDC) < key(base.buy);
      const order = {
        ...base,
        priceLimit: (allIn(base.pool, paysA) * 3n) / 1n,
        amountIn: 10_000_000_000n * 10n ** 6n,
      };
      const bound = windowBound(order.pool, paysA);
      const own = ownLimit(order.pool, order.priceLimit, paysA);
      expect(paysA ? own < bound : own > bound).toBe(true);
      const outcome = succeeded(await cook(compiled(lower(venue)), order));
      expect(outcome.received).toBeGreaterThan(0n);
      expect(outcome.price).toBe(bound);
    },
    120_000,
  );

  // PancakeSwap's fixture pool walks its whole window of three arrays in about 1,395,000 compute
  // units when the Kitchen finds the Pot address's bump on its first try. It searches for that bump
  // twice in every cook, each further try costing 1,500 units, and the harness draws the Pot's owner
  // at random: about one run in four takes three tries or more and runs past the cook's 1,400,000.
  // So its far limit is cooked on a window of two of those arrays (the third place one behind the
  // price), about 829,000 units at best: the same path, the limit held a tick inside the window's
  // edge, with room to spare.
  it("PancakeswapClmm: a limit far past a window of two arrays stops a tick inside it", async () => {
    const entry = VENUES.find((one) => one.venue === "PancakeswapClmm")!;
    const base = await orderFor(entry);
    const p = base.pool;
    const paysA = key(USDC) < key(base.buy);
    const [walk, behind] = paysA ? [p.payA, p.payB] : [p.payB, p.payA];
    const ticks = [walk[0]!, walk[1]!, behind[1]!];
    const order = {
      ...base,
      priceLimit: allIn(p, paysA) * 3n,
      amountIn: 10_000_000_000n * 10n ** 6n,
      ticks,
    };
    const bound = windowBound(p, paysA, ticks);
    const own = ownLimit(p, order.priceLimit, paysA);
    expect(paysA ? own < bound : own > bound).toBe(true);
    const outcome = succeeded(await cook(compiled(lower("PancakeswapClmm")), order));
    expect(outcome.received).toBeGreaterThan(0n);
    expect(outcome.price).toBe(bound);
  }, 120_000);

  /** A pool's account as the last cook left it. */
  const poolData = (p: Pool): Uint8Array => {
    const account = harness.svm.getAccount(p.pool);
    if (!account.exists) throw new Error(`pool ${p.pool} is gone`);
    return account.data;
  };
  /** A swap's pool as the command reads it for its stop. */
  const poolOf = (order: Order): SvmStopPool => {
    const p = order.pool;
    const paysA = key(order.pay) < key(order.buy);
    const layout = (
      {
        "raydium-clmm": "raydium",
        "pancakeswap-clmm": "raydium",
        byreal: "raydium",
        "stabble-clmm": "raydium",
        "orca-whirlpool": "whirlpool",
        cropper: "whirlpool",
        defituna: "defituna",
        crema: "crema",
      } as const
    )[p.venue as "byreal"];
    return {
      name: "stop",
      program: p.program,
      layout,
      pool: BYTES.get(p.pool)!,
      fee: LAYOUT[p.venue]!.fee(p),
      arrays: (order.ticks ?? (paysA ? p.payA : p.payB)).map((at) => BYTES.get(at)),
      paysA,
      priceLimit: order.priceLimit,
    };
  };
  // A pool's stop, as the command works it out for a cook of this one swap: the venues' share of the
  // cook's compute units, by the cost table, with nothing else to share it with.
  const stopOf = (order: Order): SvmComputeStop =>
    svmComputeStops([poolOf(order)], SVM_COOK_UNITS - SVM_COOK_FIXED - SVM_SWAP_FIXED)[0]!;
  /** The swap's ran out of compute units, as the command tells it: its program, or the engine. */
  const ranOut = (outcome: Outcome): boolean => !outcome.ok && svmRanOutOfUnits(outcome.logs);

  // Pools that cross more initialized ticks on the way to their limit than one cook's compute units
  // pay for: with no stop the whole cook fails, out of units; with the one the command works out
  // they stop a tick inside the first initialized tick their share does not pay to cross, and the
  // cook completes. Orca's SOL/USDC pool at 1.3 times its price, Byreal's at three times.
  it.each([
    ["OrcaWhirlpool", 13000n],
    ["Byreal", 30000n],
  ] as const)(
    "%s: a limit whose walk runs a cook out of compute units completes at the stop the command works out",
    async (venue, times) => {
      const entry = VENUES.find((one) => one.venue === venue)!;
      const base = await orderFor(entry);
      const p = base.pool;
      const paysA = key(USDC) < key(base.buy);
      const order = {
        ...base,
        priceLimit: (allIn(p, paysA) * times) / 10000n,
        amountIn: 10_000_000_000n * 10n ** 6n,
      };
      expect(ranOut(await cook(compiled(lower(venue)), order))).toBe(true);
      const stop = stopOf(order);
      expect(stop.share).toBeLessThan(stop.estimatedUnits);
      const outcome = succeeded(
        await cook(compiled(`${lower(venue)}Stopped`), { ...order, stop: stop.stop }),
      );
      expect(outcome.received).toBeGreaterThan(0n);
      // Its price ends a tick inside the initialized tick it was held short of, past its own.
      const tickAt = p.venue === "orca-whirlpool" ? 81 : 269;
      const tick = i32(BYTES.get(p.pool)!, tickAt);
      const moved = i32(poolData(p), tickAt);
      expect(paysA ? moved >= stop.stopTick! : moved < stop.stopTick!).toBe(true);
      expect(paysA ? moved < tick : moved > tick).toBe(true);
    },
    300_000,
  );

  // The cost table each stop is worked out from (`svm/compute-stops.ts`), held to the venues' own
  // programs: for walks from a few ticks to a few hundred, each walk the command predicts ends where
  // the swap does, crossing the initialized ticks it counts, and its units are at or above what the
  // venue spent, within a tenth. A program upgrade that moves them fails here.
  it.each([
    ["RaydiumClmm", [10003n, 10030n, 10060n, 10100n]],
    ["PancakeswapClmm", [10003n, 10030n, 10300n, 10500n]],
    ["Byreal", [10003n, 10100n, 10500n, 11000n, 13000n]],
    ["StabbleClmm", [10003n, 10100n]],
    ["OrcaWhirlpool", [10003n, 10030n, 10100n, 10300n]],
    ["Cropper", [10003n, 10030n, 10500n]],
    ["Defituna", [10003n, 10300n, 10500n, 11000n]],
    ["Crema", [10003n, 10700n, 11000n, 12000n, 15000n, 20000n]],
  ] as const)(
    "%s: the cost table holds to its program",
    async (venue, multiples) => {
      const entry = VENUES.find((one) => one.venue === venue)!;
      const base = await orderFor(entry);
      const p = base.pool;
      const paysA = key(USDC) < key(base.buy);
      const cost = SVM_SWAP_COSTS[p.program]!;
      const tickAt =
        { "orca-whirlpool": 81, cropper: 81, defituna: 183, crema: 206 }[p.venue as "crema"] ?? 269;
      for (const times of multiples) {
        const order = {
          ...base,
          priceLimit: (allIn(p, paysA) * times) / 10000n,
          amountIn: 10_000_000_000n * 10n ** 6n,
        };
        // A walk that fits: no stop, the plain swap, but for one that walks on into its furthest
        // tick array, which its Stopped form runs with its deep tick alone.
        const walk = svmPoolWalk(poolOf(order));
        const stop = stopOf(order);
        expect([times, stop.stopTick, stop.skipped]).toEqual([times, undefined, undefined]);
        const fn = stop.stop === 0n ? lower(venue) : `${lower(venue)}Stopped`;
        const outcome = succeeded(await cook(compiled(fn), { ...order, stop: stop.stop }));
        const ended = i32(poolData(p), tickAt);
        expect([times, ended]).toEqual([times, walk.limitTick]);
        const estimate = cost.base + cost.tick * walk.crossed.length;
        expect(estimate).toBeGreaterThanOrEqual(outcome.venueUnits!);
        expect(estimate * 10).toBeLessThanOrEqual(outcome.venueUnits! * 11);
        // What it buys, as the walk's liquidity at each stretch says, within a thousandth, and a
        // hundredth on Raydium's code, whose ticks may also hold limit orders the walk fills: the
        // order the pools are given in reads it.
        const gap = walk.output - outcome.received;
        const within = p.venue === "orca-whirlpool" || p.venue === "crema" ? 1000n : 100n;
        expect((gap < 0n ? -gap : gap) * within).toBeLessThanOrEqual(walk.output);
      }
    },
    300_000,
  );

  // Paying the lower-key token the price falls to its own limit's sqrt price. An initialized tick
  // just below that limit is never reached, so never crossed, and the walk's last stretch buys the
  // token the swap pays out. Orca's SOL/USDC pool sold into at two limits a hair apart, both just
  // above the initialized tick -21400: the walk buys what each swap does, the farther limit more,
  // and that one ranks first at the same units.
  it("OrcaWhirlpool: a falling walk ends at its own limit, short of the tick it lies above", async () => {
    const p = pool("orca-whirlpool-sol-usdc");
    const orders = [8501716531025289579n, 8501291477077584537n].map((priceLimit): Order => ({
      pool: p,
      pay: WSOL,
      buy: USDC,
      amountIn: 100_000n * 10n ** 9n,
      priceLimit,
    }));
    const walks = orders.map((order) => svmPoolWalk(poolOf(order)));
    const received: bigint[] = [];
    for (const [i, order] of orders.entries()) {
      const walk = walks[i]!;
      expect(walk.crossed).not.toContain(-21400);
      const outcome = succeeded(await cook(compiled("orcaWhirlpool"), order));
      expect(i32(poolData(p), 81)).toBe(walk.limitTick);
      const gap = walk.output - outcome.received;
      expect((gap < 0n ? -gap : gap) * 1000n).toBeLessThanOrEqual(walk.output);
      received.push(outcome.received);
    }
    expect(received[0]! > received[1]!).toBe(true);
    expect(walks[0]!.output > walks[1]!.output).toBe(true);
    const [far, near] = svmComputeStops(
      orders.map((order, i) => ({ ...poolOf(order), name: `limit ${i}` })),
      SVM_COOK_UNITS - SVM_COOK_FIXED - 2 * SVM_SWAP_FIXED,
    );
    expect([far!.estimatedUnits, far!.rank, near!.rank]).toEqual([near!.estimatedUnits, 0, 1]);
  }, 120_000);

  // The Stopped form's own checks: a pool whose price has moved further from its stop than the
  // start bound the stop carries (from bit 192) is skipped, moving nothing, so a held swap crosses no
  // more than its stop allowed for, and a bound past every tick the walk's way (`svmSkipStop`) skips
  // it whatever its price, paying either token. Where the price has not moved past, it trades as the
  // plain swap would to the same limit.
  it.each(["RaydiumClmm", "PancakeswapClmm", "OrcaWhirlpool", "Cropper", "Defituna", "Crema"])(
    "%s: the Stopped form skips for a skip stop either way, and for a price past its start bound",
    async (venue) => {
      const entry = VENUES.find((one) => one.venue === venue)!;
      const order = await orderFor(entry);
      const p = order.pool;
      const paysA = key(USDC) < key(order.buy);
      const program = compiled(`${lower(venue)}Stopped`);
      const back: Order = {
        ...order,
        pay: order.buy,
        buy: order.pay,
        amountIn: 10n * 10n ** 9n,
        priceLimit: (allIn(p, !paysA) * 10003n) / 10000n,
      };
      for (const [one, lowerKey] of [
        [order, paysA],
        [back, !paysA],
      ] as const) {
        expect(succeeded(await cook(program, { ...one, stop: 0n })).received).toBeGreaterThan(0n);
        const skip = succeeded(await cook(program, { ...one, stop: svmSkipStop(lowerKey) }));
        expect([skip.received, skip.paid, skip.returned]).toEqual([0n, 0n, 0n]);
      }
      const tickAt =
        { "orca-whirlpool": 81, cropper: 81, defituna: 183, crema: 206 }[p.venue as "crema"] ?? 269;
      const tick = BigInt(i32(BYTES.get(p.pool)!, tickAt)) + (1n << 31n);
      // The price as it lies: inside the bound, and one tick past it, the way the walk goes.
      const bound = (from: bigint) => order.priceLimit | (from << 192n);
      const passed = succeeded(
        await cook(program, { ...order, stop: bound(paysA ? tick + 1n : tick - 1n) }),
      );
      expect(passed.received).toBeGreaterThan(0n);
      const moved = succeeded(
        await cook(program, { ...order, stop: bound(paysA ? tick - 1n : tick + 1n) }),
      );
      expect([moved.received, moved.paid]).toEqual([0n, 0n]);
      // The bound unset (0 in its bits): the limit alone, as the plain swap trades to it.
      const plain = succeeded(await cook(compiled(lower(venue)), order));
      const unbounded = succeeded(await cook(program, { ...order, stop: order.priceLimit }));
      expect(unbounded.received).toBe(plain.received);
    },
    300_000,
  );

  // Crema's window is wide: tick spacing 50, arrays of 3,200 ticks, its edge about 6,300 ticks from
  // the price. The limit is held a tick inside that edge, within a millionth of its exact sqrt price
  // and never past it.
  it("Crema: a limit far past its wide window is held within a millionth of its edge", async () => {
    const entry = VENUES.find((one) => one.venue === "Crema")!;
    const base = await orderFor(entry);
    const p = base.pool;
    const paysA = key(USDC) < key(base.buy);
    const data = BYTES.get(p.pool)!;
    const tick = new DataView(data.buffer, data.byteOffset).getInt32(206, true);
    const price = le(data, 190, 16);
    const stop = windowStop(p, paysA)!;
    expect(Math.abs(stop - tick)).toBeGreaterThan(6000);
    // A tick inside the stop, less the part of a tick the price may lie past its own.
    const exact = paysA
      ? (price * raydiumSqrtPriceAtTick(tick)) / raydiumSqrtPriceAtTick(stop + 1)
      : (price * raydiumSqrtPriceAtTick(stop - 2)) / raydiumSqrtPriceAtTick(tick);
    const bound = windowBound(p, paysA);
    expect(paysA ? bound >= exact : bound <= exact).toBe(true);
    const gap = paysA ? bound - exact : exact - bound;
    expect(gap * 1_000_000n).toBeLessThan(exact);
    const order = {
      ...base,
      priceLimit: allIn(p, paysA) * 3n,
      amountIn: 10_000_000_000n * 10n ** 6n,
    };
    const outcome = succeeded(await cook(compiled(lower("Crema")), order));
    expect(outcome.price).toBe(bound);
  }, 120_000);

  // Where the furthest array a slot gives that way is the one holding the price, the window ends at
  // its last initialized tick that way, read from a fixed array (Raydium's) or a dynamic one
  // (Byreal's): the slot here is that array and two from behind the price.
  it.each(["RaydiumClmm", "Byreal"])(
    "%s: a slot of the price's own array stops at its last initialized tick",
    async (venue) => {
      const entry = VENUES.find((one) => one.venue === venue)!;
      const base = await orderFor(entry);
      const p = base.pool;
      const paysA = key(USDC) < key(base.buy);
      const [walk, behind] = paysA ? [p.payA, p.payB] : [p.payB, p.payA];
      const ticks = [walk[0]!, behind[1]!, behind[2]!];
      const order = {
        ...base,
        priceLimit: allIn(p, paysA) * 3n,
        amountIn: 10_000_000_000n * 10n ** 6n,
        ticks,
      };
      const bound = windowBound(p, paysA, ticks);
      expect(bound).not.toBe(le(BYTES.get(p.pool)!, LAYOUT[p.venue]!.price, 16));
      const outcome = succeeded(await cook(compiled(lower(venue)), order));
      expect(outcome.received).toBeGreaterThan(0n);
      expect(outcome.price).toBe(bound);
    },
    120_000,
  );

  // Crema refuses a tick array its map does not mark, so a slot names fewer by the System program,
  // and the swap at a price passes only the arrays before it.
  it("Crema: a slot of one tick array passes one", async () => {
    const order: Order = {
      ...(await orderFor(VENUES.find((v) => v.venue === "Crema")!)),
      amountIn: 10n * 10n ** 6n,
    };
    const all = succeeded(await cook(compiled("crema"), order));
    expect(all.received).toBeGreaterThan(0n);
    const first = (key(order.pay) < key(order.buy) ? order.pool.payA : order.pool.payB)[0]!;
    const one = succeeded(
      await cook(compiled("crema"), { ...order, ticks: [first, SYSTEM, SYSTEM] }),
    );
    expect([one.returned, one.received, one.paid]).toEqual([all.returned, all.received, all.paid]);
  }, 120_000);

  // Raydium's code and Crema walk on into the furthest tick array their slot gives, past where their
  // window ends, with the stop the command works out (`svm/compute-stops.ts`): its deep tick, that
  // array's last initialized tick that way, which the Stopped form reads in the array at the offsets
  // the command read it at, and checks there. The plain swap stops where that array begins; the
  // Stopped form ends a tick inside the deep tick, as the router holds a limit to any edge, past the
  // plain swap's price and having bought more. Each walks its whole way within one cook's units: on
  // fixed arrays (Raydium's, PancakeSwap's, Stabble's), dynamic ones (Byreal's) and Crema's. `near`
  // gives the slot the price's own array, the next one that way and one behind the price.
  const DEEP = [
    { venue: "RaydiumClmm", paysOther: false, near: true },
    { venue: "PancakeswapClmm", paysOther: true, near: true },
    { venue: "Byreal", paysOther: true, near: true },
    { venue: "StabbleClmm", paysOther: false, near: false },
    { venue: "Crema", paysOther: false, near: false },
  ];
  const deepOrder = async ({ venue, paysOther, near }: (typeof DEEP)[number]) => {
    const base = await orderFor(VENUES.find((one) => one.venue === venue)!);
    const p = base.pool;
    const [pay, buy] = paysOther ? [base.buy, base.pay] : [base.pay, base.buy];
    const paysA = key(pay) < key(buy);
    const [walk, behind] = paysA ? [p.payA, p.payB] : [p.payB, p.payA];
    const ticks = near ? [walk[0]!, walk[1]!, behind[1]!] : [...walk];
    const order: Order = {
      ...base,
      pay,
      buy,
      priceLimit: allIn(p, paysA) * 3n,
      amountIn: 10_000_000_000n * 10n ** 6n,
      ticks,
    };
    const stop = stopOf(order);
    return { order, p, paysA, ticks, stop, deep: stop.deepTick! };
  };
  /** A tick as the router reads it, its sign bit flipped, in the stop's deep bits. */
  const deepStop = (tick: number): bigint => (BigInt(tick) + (1n << 31n)) << 224n;
  /** Where `deep`'s state lies in the slot's arrays: the array, the tick's index, and its first byte
   *  that says it is initialized (Raydium's gross liquidity, Crema's flag). */
  const stateOf = (p: Pool, ticks: readonly Address[], deep: number) => {
    const pool = BYTES.get(p.pool)!;
    if (p.venue === "crema") {
      const spacing = Number(le(pool, 168, 2));
      const passed = ticks.filter((at) => at !== SYSTEM);
      const address = passed[passed.length - 1]!;
      const array = BYTES.get(address)!;
      const start = -443636 + (443636 % spacing) + Number(le(array, 8, 2)) * 64 * spacing;
      const flag = 44 + ((deep - start) / spacing) * 133;
      return { address, index: flag + 1, initialized: { at: flag, width: 1 } };
    }
    const spacing = Number(le(pool, 235, 2));
    for (const address of ticks) {
      const array = BYTES.get(address);
      const start = array === undefined ? NaN : i32(array, 40);
      if (!(deep >= start && deep < start + 60 * spacing)) continue;
      const offset = (deep - start) / spacing;
      const fixed = Buffer.from(array!.subarray(0, 8)).toString("hex") === "c09b55cd31f9812a";
      const index = fixed ? 44 + offset * 168 : 216 + (array![48 + offset]! - 1) * 168;
      return { address, index, initialized: { at: index + 20, width: 16 } };
    }
    throw new Error(`no array of the slot holds ${deep}`);
  };

  it.each(DEEP)(
    "$venue: a deep tick walks on into the furthest tick array, a tick inside it",
    async (entry) => {
      const { order, p, paysA, ticks, stop, deep } = await deepOrder(entry);
      // Its whole walk within the cook's units: no limit held, its deep tick alone, past the window.
      expect([stop.stopTick, stop.skipped, String(stop.stop)]).toEqual([
        undefined,
        undefined,
        String(deepStop(deep)),
      ]);
      const window = windowStop(p, paysA, ticks)!;
      expect(paysA ? deep < window : deep > window).toBe(true);
      const plain = succeeded(await cook(compiled(lower(entry.venue)), order));
      expect(String(plain.price)).toBe(String(windowBound(p, paysA, ticks)));
      const deeper = succeeded(
        await cook(compiled(`${lower(entry.venue)}Stopped`), { ...order, stop: stop.stop }),
      );
      expect(String(deeper.price)).toBe(String(windowBound(p, paysA, ticks, deep)));
      expect(deeper.received > plain.received).toBe(true);
    },
    300_000,
  );

  // A walk held inside the furthest array: Raydium's SOL/USDC pool bought with USDC at 3% past its
  // price, on its own slot, crosses more initialized ticks than one cook pays for. The command holds
  // it a tick inside -21264, which lies in the furthest array, past the window's -21300, and its stop
  // carries that array's deep tick, -21241, beside the held limit. The plain swap ends where the
  // window holds it; the Stopped form walks on past the window and stops a tick inside its hold,
  // buying more; the same stop with its deep bits cleared is held to the window again, exactly the
  // plain swap.
  it("RaydiumClmm: a stop held inside the furthest tick array walks on to it with its deep tick", async () => {
    const base = await orderFor(VENUES.find((one) => one.venue === "RaydiumClmm")!);
    const p = base.pool;
    const paysA = key(USDC) < key(base.buy);
    const order = {
      ...base,
      priceLimit: (allIn(p, paysA) * 10300n) / 10000n,
      amountIn: 10_000_000_000n * 10n ** 6n,
    };
    const stop = stopOf(order);
    expect([paysA, windowStop(p, paysA), stop.stopTick, stop.deepTick]).toEqual([
      false,
      -21300,
      -21264,
      -21241,
    ]);
    const plain = succeeded(await cook(compiled("raydiumClmm"), order));
    expect([i32(poolData(p), 269), String(plain.received)]).toEqual([-21302, "1856011235642"]);
    const held = succeeded(
      await cook(compiled("raydiumClmmStopped"), { ...order, stop: stop.stop }),
    );
    expect([i32(poolData(p), 269), String(held.received)]).toEqual([-21266, "2688958699985"]);
    const window = succeeded(
      await cook(compiled("raydiumClmmStopped"), {
        ...order,
        stop: stop.stop & ((1n << 224n) - 1n),
      }),
    );
    expect([i32(poolData(p), 269), String(window.received), String(window.price)]).toEqual([
      -21302,
      String(plain.received),
      String(plain.price),
    ]);
  }, 300_000);

  // The deep tick read where the command read it: a place in its array that holds another tick means
  // the array is not laid out as the Stopped form reads it, and the cook reverts, naming it, rather
  // than walk on a guess; a tick no longer initialized there leaves the window where it was; and a
  // tick no array of the slot holds reverts. On a fixed array (Raydium's), a dynamic one (Byreal's)
  // and Crema's.
  it.each(DEEP.filter((one) => ["RaydiumClmm", "Byreal", "Crema"].includes(one.venue)))(
    "$venue: a deep tick its array does not hold as read reverts, one no longer initialized is not walked to",
    async (entry) => {
      const { order, p, paysA, ticks, stop, deep } = await deepOrder(entry);
      const program = compiled(`${lower(entry.venue)}Stopped`);
      const state = stateOf(p, ticks, deep);
      expect(i32(BYTES.get(state.address)!, state.index)).toBe(deep);
      const other = new Uint8Array(4);
      new DataView(other.buffer).setInt32(0, deep + 1, true);
      const layout = entry.venue === "Crema" ? "Crema's" : "Raydium's";
      expect(
        refused(
          await cook(program, {
            ...order,
            stop: stop.stop,
            edit: { address: state.address, offset: state.index, bytes: [...other] },
          }),
        ),
      ).toBe(`deep: the tick array is not laid out as ${layout}`);
      const cleared = succeeded(
        await cook(program, {
          ...order,
          stop: stop.stop,
          edit: {
            address: state.address,
            offset: state.initialized.at,
            bytes: new Array<number>(state.initialized.width).fill(0),
          },
        }),
      );
      expect(String(cleared.price)).toBe(String(windowBound(p, paysA, ticks)));
      const spacing = Number(le(BYTES.get(p.pool)!, entry.venue === "Crema" ? 168 : 235, 2));
      const nowhere = deepStop(paysA ? deep - 1000 * spacing : deep + 1000 * spacing);
      expect(refused(await cook(program, { ...order, stop: nowhere }))).toBe(
        entry.venue === "Crema"
          ? "deep: its tick is not in the slot's last tick array"
          : "deep: no tick array of the slot holds its tick",
      );
    },
    300_000,
  );

  describe("each function skips, having moved nothing", () => {
    const skips: { why: string; fn: string; order: () => Promise<Order>; numbered: boolean }[] = [];
    const add = (
      why: string,
      venues: string[],
      order: (entry: (typeof VENUES)[number]) => Promise<Order>,
      numbered = false,
    ) => {
      for (const venue of venues) {
        const entry = VENUES.find((v) => v.venue === venue)!;
        skips.push({ why, fn: venue, order: () => order(entry), numbered });
      }
    };
    const ALL = VENUES.map((v) => v.venue);
    const CLMM = ALL.filter((v) => v !== "Phoenix");
    add("a missing slot", ALL, async (entry) => ({ ...(await orderFor(entry)), pool: NONE }));
    add("no input", ALL, async (entry) => ({ ...(await orderFor(entry)), amountIn: 0n }));
    add("a pool already past its own limit", CLMM, async (entry) => {
      const order = await orderFor(entry);
      return {
        ...order,
        priceLimit: (allIn(order.pool, key(USDC) < key(order.buy)) * 9990n) / 10000n,
      };
    });
    add("a pool with no liquidity at its price", CLMM, async (entry) => {
      const order = await orderFor(entry);
      const at = LAYOUT[order.pool.venue]!.liquidity;
      return { ...order, edit: { address: order.pool.pool, offset: at, bytes: Array(16).fill(0) } };
    });
    add("swaps switched off", ["RaydiumClmm", "PancakeswapClmm", "StabbleClmm"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, edit: { address: order.pool.pool, offset: 389, bytes: [16] } };
    });
    add("a Byreal pool's own fee", ["Byreal"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, edit: { address: order.pool.pool, offset: 393, bytes: [1] } };
    });
    add("an adaptive fee", ["OrcaWhirlpool", "Cropper"], async (entry) => {
      const order = await orderFor(entry);
      const spacing = le(BYTES.get(order.pool.pool)!, 41, 2);
      return {
        ...order,
        edit: { address: order.pool.pool, offset: 43, bytes: [Number(spacing + 1n) & 255, 0] },
      };
    });
    add("a paused pool", ["Crema"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, edit: { address: order.pool.pool, offset: 747, bytes: [1] } };
    });
    add("a market not open for taking", ["Phoenix"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, edit: { address: order.pool.pool, offset: 8, bytes: [2] } };
    });
    // The order is placed and fills nothing. The market numbers every order it takes, filled or not
    // (its sequence number, at 272), so that is the one byte the cook writes.
    add(
      "an order book with no offer within the limit",
      ["Phoenix"],
      async (entry) => {
        const order = await orderFor(entry);
        return { ...order, priceLimit: order.priceLimit / 2n };
      },
      true,
    );
    // One atom of USDC buys a few lamports at the pool's price, but the fee, rounded up, takes it:
    // what is left buys nothing, so the pool is not called.
    add("an input too small to buy one unit at the pool's price", CLMM, async (entry) => ({
      ...(await orderFor(entry)),
      amountIn: 1n,
    }));
    // A limit past the order's 64-bit price, both ways: buying at a price no tick reaches, and
    // selling for one so high that no bid could meet it.
    add("a limit too large for an order, buying", ["Phoenix"], async (entry) => ({
      ...(await orderFor(entry)),
      priceLimit: 2n ** 200n,
    }));
    add("a limit too large for an order, selling", ["Phoenix"], async (entry) => ({
      ...(await orderFor(entry)),
      pay: WSOL,
      buy: USDC,
      amountIn: 10n * 10n ** 9n,
      priceLimit: 1n,
    }));
    add("an input smaller than one lot", ["Phoenix"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, amountIn: le(BYTES.get(order.pool.pool)!, 192, 8) - 1n };
    });

    it.each(skips)(
      "$fn: $why",
      async ({ fn, order: make, numbered }) => {
        const order = await make();
        const outcome = succeeded(await cook(compiled(lower(fn)), order));
        expect({
          returned: outcome.returned,
          received: outcome.received,
          paid: outcome.paid,
          changed: outcome.changed,
        }).toEqual({
          returned: 0n,
          received: 0n,
          paid: 0n,
          // Nothing but the edit, which `restoreVenues` wrote before the cook, and a market's order
          // count.
          changed: [
            ...(order.edit === undefined ? [] : [order.edit.address]),
            ...(numbered ? [order.pool.pool] : []),
          ],
        });
      },
      120_000,
    );
  });

  describe("a swap that ran below its floor reverts", () => {
    it.each(VENUES)(
      "$venue",
      async (entry) => {
        const order = await orderFor(entry);
        const { received } = succeeded(await cook(inline, order));
        const name = lower(entry.venue);
        expect(refused(await cook(compiled(name), { ...order, minOut: received + 1n }))).toBe(
          "below minOut",
        );
        succeeded(await cook(compiled(name), { ...order, minOut: received }));
      },
      120_000,
    );
  });

  // A `priceLimit` of 0 is no limit only in the `…AtLimit` forms. At a price it is a price of
  // nothing: paying the token it is upside down for (the lower-key one on a concentrated-liquidity
  // pool, the base on Phoenix) the limit divides by it and the cook fails; paying the other, the pool
  // is already past it and is skipped, returning 0 having moved nothing, which `minOut` does not catch.
  describe("a priceLimit of 0 fails one way and skips the other", () => {
    it.each(VENUES)(
      "$venue",
      async (entry) => {
        const order = { ...(await orderFor(entry)), priceLimit: 0n, minOut: 1n };
        const back: Order = { ...order, pay: order.buy, buy: order.pay, amountIn: 10n * 10n ** 9n };
        const program = compiled(lower(entry.venue));
        // Phoenix's SOL/USDC market's base, SOL, is its lower-key token too.
        for (const one of [order, back]) {
          const outcome = await cook(program, one);
          if (key(one.pay) < key(one.buy)) {
            if (outcome.ok) throw new Error("the cook succeeded; expected it to fail");
            // The engine's DivisionByZero.
            expect(outcome.logs).toContainEqual(
              expect.stringMatching(/ failed: custom program error: 0x32$/),
            );
          } else {
            const skip = succeeded(outcome);
            expect([skip.returned, skip.received, skip.paid]).toEqual([0n, 0n, 0n]);
          }
        }
      },
      120_000,
    );
  });

  // The estimate lets through the smallest input that buys one unit at the pool's price, and the
  // pool delivers it.
  it.each(VENUES.filter((v) => v.venue !== "Phoenix"))(
    "$venue: two atoms pass the estimate and deliver at least one",
    async (entry) => {
      const order = { ...(await orderFor(entry)), amountIn: 2n };
      const outcome = succeeded(await cook(compiled(lower(entry.venue)), order));
      expect(outcome.paid).toBe(2n);
      expect(outcome.returned).toBe(outcome.received);
      expect(outcome.received).toBeGreaterThan(0n);
    },
    120_000,
  );

  describe("the caller's accounts, refused", () => {
    it("a pool that is not the pair, and a market that is not", async () => {
      const stabble = { ...(await orderFor(VENUES[3]!)), buy: WSOL };
      expect(refused(await cook(compiled("stabbleClmm"), stabble))).toBe("pool is not the pair");
      const phoenix = { ...(await orderFor(VENUES[8]!)), buy: USDT };
      expect(refused(await cook(compiled("phoenix"), phoenix))).toBe("market is not the pair");
    }, 120_000);

    // Each venue's function refuses any pool but its venue's, by the program it would call.
    const REASONS: Record<string, string> = {
      RaydiumClmm: "not a Raydium CLMM pool",
      PancakeswapClmm: "not a PancakeSwap CLMM pool",
      Byreal: "not a Byreal pool",
      StabbleClmm: "not a Stabble CLMM pool",
      OrcaWhirlpool: "not an Orca whirlpool",
      Cropper: "not a Cropper pool",
      Defituna: "not a DefiTuna pool",
      Crema: "not a Crema pool",
      Phoenix: "not a Phoenix market",
    };

    // The authority signs the swap, so the program a slot names must be the venue's own: each
    // venue's function checks its venue's id itself.
    it.each(VENUES)(
      "$venue: a slot naming another program reverts",
      async (entry) => {
        const order = await orderFor(entry);
        const another =
          entry.venue === "RaydiumClmm"
            ? pool("orca-whirlpool-sol-usdc").program
            : pool("raydium-clmm-sol-usdc").program;
        const misnamed = { ...order, pool: { ...order.pool, program: another } };
        expect(refused(await cook(compiled(lower(entry.venue)), misnamed))).toBe(
          REASONS[entry.venue],
        );
      },
      120_000,
    );

    it("another venue's pool, through each venue's function", async () => {
      const orca = await orderFor(VENUES[4]!);
      for (const [venue, reason] of Object.entries(REASONS))
        if (venue !== "OrcaWhirlpool")
          expect(refused(await cook(compiled(lower(venue)), orca))).toBe(reason);
    }, 120_000);

    // A pool no venue here owns is the caller's mistake, never a skip: a Meteora pool under its own
    // program, and an account the System program owns that is not the System program itself, which
    // alone stands for a missing slot.
    it("a pool no venue here owns reverts, through every function", async () => {
      const orca = await orderFor(VENUES[4]!);
      const dlmm = { ...orca, pool: pool("meteora-dlmm-sol-usdc") };
      const nobody = { ...orca, pool: { ...NONE, pool: randomAddress() } };
      for (const order of [dlmm, nobody]) {
        for (const [venue, reason] of Object.entries(REASONS))
          expect(refused(await cook(compiled(lower(venue)), order))).toBe(reason);
      }
    }, 180_000);
  });
});
