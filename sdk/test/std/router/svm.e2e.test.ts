/**
 * `@sauce/router`'s Solana arm, executed: each function compiled into a program that calls it once
 * on one pool, staged and cooked through the released Kitchen on the harness Pot, against the venues'
 * own mainnet programs and the pools' mainnet accounts (`svm/venue-fixture.ts`). It proves what the
 * library's header says each function does:
 *
 *   - a paid swap is the swap the Solana distributed swap's per-pool helper made before the library
 *     took its venue code (`fixtures/inline-trade.svm.sauce.ts`, run from the same state): the same
 *     amount received, the same input taken, the pool left at the same price — its own limit, for
 *     an order large enough to reach it — through the venue's `try` form, its plain form and
 *     `trySwap`, both ways for the deep pools;
 *   - each `try` form returns 0 having moved nothing for every skip its header names (an input too
 *     small to buy one unit and a Phoenix limit too large for an order among them), and its plain
 *     form reverts there; the smallest input the estimate lets through delivers at least one unit;
 *   - a swap that ran below its floor reverts, `try` form or not;
 *   - a slot that is not the pair, whose program is not its pool's owner, or whose pool is another
 *     venue's or no venue's, is refused.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI.
 */
import { readFileSync } from "node:fs";
import { AccountRole, getAddressCodec } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";

import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
} from "../../../src/svm/index.js";
import { fetchPhoenixConfig } from "../../../src/svm/venues/phoenix/index.js";
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
  maxPrice: bigint;
  minOut?: bigint;
  /** Bytes to change in an account before the cook, for one case: a pool emptied, paused. */
  edit?: { address: Address; offset: number; bytes: number[] };
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
    }
  | { ok: false; reason: string; logs: string[] };

/** What the paying account holds beside the amount offered: never offered, never spent. */
const KEPT = 7n;

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
      ...(paysA ? p.payA : p.payB),
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
      program.entryParams.length === 3
        ? [order.amountIn, order.maxPrice, order.minOut ?? 0n]
        : [order.amountIn, order.maxPrice],
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
    const loader = async (at: Address) => (BYTES.has(at) ? new Uint8Array(BYTES.get(at)!) : null);
    const market = await fetchPhoenixConfig(loader, p.pool);
    const data = BYTES.get(p.pool)!;
    const first = market.windows.quoteIn.orders[0]!;
    const ticks = le(data, market.asksNodesBase + (first.nodeIndex - 1) * 64 + 16, 8);
    const tick =
      (market.tickSizeInQuoteLotsPerBaseUnit * market.quoteLotSize * E18) /
      (market.baseLotsPerBaseUnit * market.baseLotSize);
    return (ticks * tick * (10000n + le(data, 856, 8))) / 10000n + tick / 2n;
  };

  // Each venue's function, one of its pools, and the trade: buying with USDC, a maxPrice a few basis
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
    const maxPrice =
      p.venue === "phoenix"
        ? await phoenixMax(p)
        : (allIn(p, paysA) * (10000n + entry.bps)) / 10000n;
    return { pool: p, pay: USDC, buy, amountIn: 1_000_000n * 10n ** 6n, maxPrice };
  };

  describe("a paid swap is the per-pool helper's swap", () => {
    it.each(VENUES)(
      "$venue: its try form, its plain form and trySwap",
      async (entry) => {
        const order = await orderFor(entry);
        const expected = succeeded(await cook(inline, order));
        expect(expected.received).toBeGreaterThan(0n);
        expect(expected.returned).toBe(expected.received);
        const base = entry.venue.charAt(0).toLowerCase() + entry.venue.slice(1);
        for (const name of [`try${entry.venue}`, base, "trySwap", "swap"]) {
          const outcome = succeeded(await cook(compiled(name), order));
          expect({ name, ...outcome }).toEqual({ name, ...expected });
          expect(outcome.paid).toBeLessThanOrEqual(order.amountIn);
          expect(outcome.paid * E18).toBeLessThanOrEqual(order.maxPrice * outcome.received);
        }
        // Each concentrated-liquidity pool stops exactly at its own fee-adjusted limit.
        if (expected.price !== undefined)
          expect(expected.price).toBe(
            ownLimit(order.pool, order.maxPrice, key(USDC) < key(order.buy)),
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
          maxPrice: (allIn(p, true) * 10003n) / 10000n,
        };
        const expected = succeeded(await cook(inline, order));
        expect(expected.received).toBeGreaterThan(0n);
        const venue = {
          "raydium-clmm": "tryRaydiumClmm",
          "pancakeswap-clmm": "tryPancakeswapClmm",
          "orca-whirlpool": "tryOrcaWhirlpool",
          defituna: "tryDefituna",
        }[p.venue]!;
        for (const fn of [venue, "trySwap"]) {
          const outcome = succeeded(await cook(compiled(fn), order));
          expect(outcome.received).toBe(expected.received);
          expect(outcome.paid).toBe(expected.paid);
          expect(outcome.price).toBe(expected.price);
          expect(outcome.returned).toBe(outcome.received);
        }
        expect(expected.price).toBe(ownLimit(p, order.maxPrice, true));
      },
      120_000,
    );
  });

  describe("a try form skips, having moved nothing; its plain form reverts", () => {
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
        maxPrice: (allIn(order.pool, key(USDC) < key(order.buy)) * 9990n) / 10000n,
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
        return { ...order, maxPrice: order.maxPrice / 2n };
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
      maxPrice: 2n ** 200n,
    }));
    add("a limit too large for an order, selling", ["Phoenix"], async (entry) => ({
      ...(await orderFor(entry)),
      pay: WSOL,
      buy: USDC,
      amountIn: 10n * 10n ** 9n,
      maxPrice: 1n,
    }));
    add("an input smaller than one lot", ["Phoenix"], async (entry) => {
      const order = await orderFor(entry);
      return { ...order, amountIn: le(BYTES.get(order.pool.pool)!, 192, 8) - 1n };
    });

    it.each(skips)(
      "$fn: $why",
      async ({ fn, order: make, numbered }) => {
        const order = await make();
        const base = fn.charAt(0).toLowerCase() + fn.slice(1);
        for (const name of [`try${fn}`, "trySwap"]) {
          const outcome = succeeded(await cook(compiled(name), order));
          expect({
            name,
            returned: outcome.returned,
            received: outcome.received,
            paid: outcome.paid,
            changed: outcome.changed,
          }).toEqual({
            name,
            returned: 0n,
            received: 0n,
            paid: 0n,
            // Nothing but the edit, which `restoreVenues` wrote before the cook, and a market's
            // order count.
            changed: [
              ...(order.edit === undefined ? [] : [order.edit.address]),
              ...(numbered ? [order.pool.pool] : []),
            ],
          });
        }
        for (const name of [base, "swap"])
          expect(refused(await cook(compiled(name), order))).toBe("nothing swapped");
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
        const base = entry.venue.charAt(0).toLowerCase() + entry.venue.slice(1);
        for (const name of [`try${entry.venue}`, base, "trySwap"]) {
          expect(refused(await cook(compiled(name), { ...order, minOut: received + 1n }))).toBe(
            "below minOut",
          );
          succeeded(await cook(compiled(name), { ...order, minOut: received }));
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
      for (const name of [`try${entry.venue}`, "trySwap"]) {
        const outcome = succeeded(await cook(compiled(name), order));
        expect(outcome.paid).toBe(2n);
        expect(outcome.returned).toBe(outcome.received);
        expect(outcome.received).toBeGreaterThan(0n);
      }
    },
    120_000,
  );

  describe("the caller's accounts, refused", () => {
    it("a pool that is not the pair, and a market that is not", async () => {
      const stabble = { ...(await orderFor(VENUES[3]!)), buy: WSOL };
      for (const name of ["tryStabbleClmm", "trySwap"])
        expect(refused(await cook(compiled(name), stabble))).toBe("pool is not the pair");
      const phoenix = { ...(await orderFor(VENUES[8]!)), buy: USDT };
      for (const name of ["tryPhoenix", "trySwap"])
        expect(refused(await cook(compiled(name), phoenix))).toBe("market is not the pair");
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
    const plainOf = (venue: string): string => venue.charAt(0).toLowerCase() + venue.slice(1);

    // The authority signs the swap, so the program a slot names must be the venue's own: a direct
    // call checks its venue's id itself, and `trySwap` that the slot's program owns the pool.
    it.each(VENUES)(
      "$venue: a slot naming another program reverts, through its function and through trySwap",
      async (entry) => {
        const order = await orderFor(entry);
        const another =
          entry.venue === "RaydiumClmm"
            ? pool("orca-whirlpool-sol-usdc").program
            : pool("raydium-clmm-sol-usdc").program;
        const misnamed = { ...order, pool: { ...order.pool, program: another } };
        for (const name of [`try${entry.venue}`, plainOf(entry.venue)])
          expect(refused(await cook(compiled(name), misnamed))).toBe(REASONS[entry.venue]);
        for (const name of ["trySwap", "swap"])
          expect(refused(await cook(compiled(name), misnamed))).toBe(
            "a pool's program is not its owner",
          );
      },
      120_000,
    );

    it("another venue's pool, through each venue's function", async () => {
      const orca = await orderFor(VENUES[4]!);
      for (const [venue, reason] of Object.entries(REASONS))
        if (venue !== "OrcaWhirlpool")
          expect(refused(await cook(compiled(`try${venue}`), orca))).toBe(reason);
    }, 120_000);

    // A pool no venue here owns is the caller's mistake, never a skip: a Meteora pool under its own
    // program, and an account the System program owns that is not the System program itself, which
    // alone stands for a missing slot.
    it("a pool no venue here owns reverts, through every function", async () => {
      const orca = await orderFor(VENUES[4]!);
      const dlmm = { ...orca, pool: pool("meteora-dlmm-sol-usdc") };
      const nobody = { ...orca, pool: { ...NONE, pool: randomAddress() } };
      for (const order of [dlmm, nobody]) {
        for (const name of ["trySwap", "swap"])
          expect(refused(await cook(compiled(name), order))).toBe("not a supported venue's pool");
        for (const [venue, reason] of Object.entries(REASONS))
          expect(refused(await cook(compiled(`try${venue}`), order))).toBe(reason);
      }
    }, 180_000);
  });
});
