/**
 * The `sauce-solana-distributed-swap` skill's program, executed: staged and cooked through the
 * released Kitchen on the harness Pot, against the venues' own mainnet programs and the pools'
 * mainnet accounts (`test/fixtures/svm-venues/`, written by `scripts/dump-svm-venues.mjs`). The
 * program takes its pools as `Address` arguments, and every account it names is derived
 * (`derivedAccounts`): each is filled here from the fixture as the command would read it from the
 * cluster. It proves what the skill says the program does: one exact-input order split over
 * price-limited pools, each stopping exactly at its own fee-adjusted limit; an empty slot, a pool
 * past its limit, an empty pool, a pool whose fee is more than one rate, a paused pool and a market
 * whose book is past the limit skipped; the minimum-output and average-price checks; only the
 * unspent budget refunded and the Pot's other balance untouched; what was bought and the rest kept
 * in the Pot when the recipient and refund are the Pot; and the refusals of a budget the Pot does
 * not hold, a pool that is not the pair, a venue the program does not take, a slot whose program
 * does not own its pool, and a recipient's account another wallet holds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AccountRole, getAddressCodec } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";

import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  getTransactionSize,
} from "../../src/svm/index.js";
import { fetchPhoenixConfig } from "../../src/svm/venues/phoenix/index.js";
import {
  describeSvm,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  setTokenAccount,
  stageProgram,
  startEngine,
  tokenAmount,
} from "./engine-harness.js";
import type { EngineHarness } from "./engine-harness.js";
import {
  allIn,
  BYTES,
  E18,
  key,
  LAYOUT,
  le,
  loadVenues,
  manifest,
  NONE,
  ownLimit,
  pool,
  restoreVenues,
  SYSTEM,
  USDC,
  USDT,
  WSOL,
} from "./venue-fixture.js";
import type { Pool } from "./venue-fixture.js";

/** The skill's program, and the same with a fifth slot. */
const PROGRAM = fileURLToPath(
  new URL(
    "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
);
const PROGRAM_5 = fileURLToPath(
  new URL(
    "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap-5.sauce.ts",
    import.meta.url,
  ),
);

/** A slot's nine accounts, in the order its derivations name them. */
const PARTS = [
  "program",
  "pool",
  "config",
  "vaultA",
  "vaultB",
  "extra",
  "ticks0",
  "ticks1",
  "ticks2",
];

interface Order {
  slots: Pool[];
  pay: Address;
  buy: Address;
  budget: bigint;
  maxPrice: bigint;
  minTokens?: bigint;
  maxAvgPrice?: bigint;
  /** Of the pay token, in the Pot's account beside the budget: never spent, never refunded. */
  kept?: bigint;
  /** Less than the budget in the Pot's account. */
  short?: boolean;
  /** The recipient and the refund are the Pot itself: what was bought and the rest stay there. */
  keepInPot?: boolean;
  /** The recipient's token account held by another wallet than the recipient. */
  strangerRecipient?: boolean;
  /** Bytes to change in an account before the cook, for one case: a pool emptied, paused. */
  edit?: { address: Address; offset: number; bytes: number[] };
}

type Outcome =
  | {
      ok: true;
      spent: bigint;
      bought: bigint;
      unspent: bigint;
      refunded: bigint;
      received: bigint;
      /** What stays in the Pot's account of the bought token: nothing, unless it is kept there. */
      kept: bigint;
      left: bigint;
      units: bigint;
      size: number;
      accounts: number;
    }
  | { ok: false; reason: string; logs: string[] };

/** A key as the engine reads an `Address` argument on Solana: its 32 bytes, as one word. */
const word = (at: Address): bigint => key(at);

describeSvm("the Solana distributed swap, on the venues' own programs and pools", () => {
  const source = readFileSync(PROGRAM, "utf8");
  const program = compileSauceProgram("solana", source);
  const program5 = compileSauceProgram("solana", readFileSync(PROGRAM_5, "utf8"));
  let harness: EngineHarness;
  let nonce = 0n;

  beforeAll(async () => {
    // A little after the snapshot: a whirlpool refuses a clock before its last update.
    harness = await startEngine(BigInt(manifest.unixTimestamp) + 60n);
    loadVenues(harness.svm);
  }, 120_000);

  const cook = async (order: Order, compiled = program): Promise<Outcome> => {
    restoreVenues(harness.svm, order.edit);
    const kept = order.kept ?? 0n;
    const programOf = (mint: Address): Address => {
      const account = harness.svm.getAccount(mint);
      if (!account.exists) throw new Error(`the fixture has no mint ${mint}`);
      return account.programAddress;
    };
    // The Pot's accounts for the two tokens, and the recipient's and the refund's: any token
    // account of the right holder, which the program checks.
    const potPay = setTokenAccount(
      harness,
      randomAddress(),
      order.pay,
      harness.pot,
      (order.short ? order.budget - 1n : order.budget) + kept,
      programOf(order.pay),
    );
    const potBuy = setTokenAccount(
      harness,
      randomAddress(),
      order.buy,
      harness.pot,
      0n,
      programOf(order.buy),
    );
    const to = order.keepInPot ? harness.pot : randomAddress();
    const back = order.keepInPot ? harness.pot : randomAddress();
    const recipient = order.keepInPot
      ? potBuy
      : setTokenAccount(
          harness,
          randomAddress(),
          order.buy,
          order.strangerRecipient ? randomAddress() : to,
          0n,
          programOf(order.buy),
        );
    const refund = order.keepInPot
      ? potPay
      : setTokenAccount(harness, randomAddress(), order.pay, back, 0n, programOf(order.pay));
    const paysA = key(order.pay) < key(order.buy);
    const slotCount = compiled.entryParams.filter((param) => /^pool\d+$/.test(param.name)).length;
    const slots = [...order.slots];
    while (slots.length < slotCount) slots.push(NONE);

    // Each account the program names, from its derivation: what the command reads from the cluster.
    const resolve = (derivation: string): Address => {
      const slot = /^slot:@pool(\d+):@pay\.(\w+)$/.exec(derivation);
      if (slot !== null) {
        const p = slots[Number(slot[1])]!;
        const each = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra];
        return [...each, ...(paysA ? p.payA : p.payB)][PARTS.indexOf(slot[2]!)]!;
      }
      const fixed: Record<string, Address> = {
        self: harness.pot,
        "self:@pay": potPay,
        "self:@buy": potBuy,
        "mint:@pay": order.pay,
        "mint:@buy": order.buy,
        "program:@pay": programOf(order.pay),
        "program:@buy": programOf(order.buy),
        "@recipient:@buy": recipient,
        "@refund:@pay": refund,
      };
      if (fixed[derivation] !== undefined) return fixed[derivation];
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(derivation)) return derivation as Address;
      throw new Error(`no account for the derivation ${derivation}`);
    };
    const derived = compiled.derivedAccounts as Readonly<Record<string, string>>;
    const tail = compiled.manifest!.accounts.map((entry) => {
      if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
      const derivation = derived[entry.name];
      if (derivation === undefined) throw new Error(`${entry.name} is not derived`);
      const at = resolve(derivation);
      // The Kitchen signs for the Pot; the System program, which stands in for every account a
      // slot does not use, is never writable.
      const writable = entry.requires === "writable" && at !== SYSTEM;
      return { address: at, role: writable ? AccountRole.WRITABLE : AccountRole.READONLY };
    });

    // The cook carries the program and its arguments staged in a code buffer, and its accounts
    // through a lookup table: as `sauce run` stages a program too large for one transaction. An
    // `Address` argument is its key's 32 bytes, one word, as the command encodes it.
    const keyed = {
      ...compiled,
      entryParams: compiled.entryParams.map((param) => ({
        ...param,
        type: param.type.replace(/\bAddress\b/g, "Uint256"),
      })),
    };
    const args = encodeEntryArguments(keyed, [
      word(order.pay),
      word(order.buy),
      ...slots.map((p) => word(p.pool)),
      order.budget,
      order.maxPrice,
      order.minTokens ?? 0n,
      order.maxAvgPrice ?? 0n,
      word(to),
      word(back),
    ]);
    const payload = new Uint8Array(compiled.bytecode.length + args.length);
    payload.set(compiled.bytecode);
    payload.set(args, compiled.bytecode.length);
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
    const returned = result.returnData().data();
    const at = (i: number): bigint =>
      BigInt(`0x${Buffer.from(returned.subarray(32 * i, 32 * i + 32)).toString("hex")}`);

    return {
      ok: true,
      spent: at(0),
      bought: at(1),
      unspent: at(2),
      refunded: order.keepInPot ? 0n : tokenAmount(harness, refund),
      received: order.keepInPot ? 0n : tokenAmount(harness, recipient),
      kept: tokenAmount(harness, potBuy),
      left: tokenAmount(harness, potPay),
      units: result.computeUnitsConsumed(),
      size: getTransactionSize(transaction),
      // The payer, the compute-budget program, the lookup table and every key it holds.
      accounts: keys.length + 3,
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
  const priceOf = (p: Pool): bigint => {
    const account = harness.svm.getAccount(p.pool);
    if (!account.exists) throw new Error(`pool ${p.pool} is gone`);
    return le(account.data, LAYOUT[p.venue]!.price, 16);
  };
  const snapshotPrice = (p: Pool): bigint => le(BYTES.get(p.pool)!, LAYOUT[p.venue]!.price, 16);

  // Buying SOL with USDC: USDC is the higher key, so every pool's price rises as it sells.
  const DEEP = [
    pool("orca-whirlpool-sol-usdc"),
    pool("raydium-clmm-sol-usdc"),
    pool("pancakeswap-clmm-sol-usdc"),
    pool("defituna-sol-usdc"),
  ];
  const dearest = DEEP.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b));
  // 3 bps above the dearest pool's price, fee included: every pool has room to trade.
  const maxPrice = (dearest * 10003n) / 10000n;

  it("splits one order over four venues, each pool stopping exactly at its own limit", async () => {
    const budget = 1_000_000n * 10n ** 6n; // 1,000,000 USDC: more than the four take within maxPrice
    const outcome = succeeded(
      await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, kept: 7n }),
    );
    for (const p of DEEP) {
      expect(priceOf(p)).not.toBe(snapshotPrice(p));
      expect(priceOf(p)).toBe(ownLimit(p, maxPrice, false));
    }
    expect(outcome.bought).toBe(outcome.received);
    expect(outcome.kept).toBe(0n);
    expect(outcome.spent + outcome.unspent).toBe(budget);
    expect(outcome.refunded).toBe(outcome.unspent);
    expect(outcome.left).toBe(7n); // the paying account's own USDC, never spent or refunded
    expect(outcome.spent * E18).toBeLessThanOrEqual(maxPrice * outcome.bought);
    expect(outcome.units).toBeLessThan(1_400_000);
    expect(outcome.accounts).toBeLessThanOrEqual(64);
    expect(outcome.size).toBeLessThanOrEqual(1232);
    console.log(
      `four pools: ${outcome.units} compute units, ${outcome.size}-byte transaction, ${outcome.accounts} accounts, ${program.bytecode.length}-byte program`,
    );
  }, 120_000);

  it("takes a fifth slot in one cook: each pool trades to its own limit or, past it, sits out", async () => {
    const cropper = pool("cropper-sol-usdc");
    const five = [...DEEP, cropper];
    const budget = 1_000_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({ slots: five, pay: USDC, buy: WSOL, budget, maxPrice }, program5),
    );
    for (const p of DEEP) expect(priceOf(p)).toBe(ownLimit(p, maxPrice, false));
    // The fifth, read and decided as the others: at its own limit, or untouched past it.
    const pastLimit = allIn(cropper, false) > maxPrice;
    expect(priceOf(cropper)).toBe(
      pastLimit ? snapshotPrice(cropper) : ownLimit(cropper, maxPrice, false),
    );
    expect(outcome.spent + outcome.unspent).toBe(budget);
    expect(outcome.spent * E18).toBeLessThanOrEqual(maxPrice * outcome.bought);
    expect(outcome.units).toBeLessThan(1_400_000);
    expect(outcome.accounts).toBeLessThanOrEqual(64);
    expect(outcome.size).toBeLessThanOrEqual(1232);
    console.log(
      `five pools (the fifth ${pastLimit ? "past its limit" : "trading"}): ${outcome.units} compute units, ${outcome.size}-byte transaction, ${outcome.accounts} accounts, ${program5.bytecode.length}-byte program`,
    );
  }, 120_000);

  it("gives the budget to the slots in order, and stops when it is spent", async () => {
    const budget = 100n * 10n ** 6n;
    const outcome = succeeded(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice }));
    expect(outcome.spent).toBe(budget);
    expect(outcome.unspent).toBe(0n);
    expect(outcome.refunded).toBe(0n);
    expect(priceOf(DEEP[0]!)).not.toBe(snapshotPrice(DEEP[0]!));
    for (const p of DEEP.slice(1)) expect(priceOf(p)).toBe(snapshotPrice(p));
  }, 120_000);

  it("skips the slots a pool before them left only dust, and completes", async () => {
    const raydium = pool("raydium-clmm-sol-usdc");
    // What Raydium's pool takes before its price reaches its own limit, on its own.
    const alone = succeeded(
      await cook({
        slots: [raydium],
        pay: USDC,
        buy: WSOL,
        budget: 1_000_000n * 10n ** 6n,
        maxPrice,
      }),
    );
    expect(priceOf(raydium)).toBe(ownLimit(raydium, maxPrice, false));
    // One atom more: each slot after it is offered one atom of USDC, which its fee takes whole, so
    // it buys nothing there, and the slot is skipped rather than the cook reverted.
    const after = [
      pool("orca-whirlpool-sol-usdc"),
      pool("pancakeswap-clmm-sol-usdc"),
      pool("defituna-sol-usdc"),
    ];
    const outcome = succeeded(
      await cook({
        slots: [raydium, ...after],
        pay: USDC,
        buy: WSOL,
        budget: alone.spent + 1n,
        maxPrice,
      }),
    );
    expect(outcome.spent).toBe(alone.spent);
    expect(outcome.bought).toBe(alone.bought);
    expect(outcome.unspent).toBe(1n);
    expect(outcome.refunded).toBe(1n);
    for (const p of after) expect(priceOf(p)).toBe(snapshotPrice(p));
  }, 120_000);

  it("skips a missing slot, a pool past its limit, a pool with fees past its rate and an empty pool", async () => {
    const crema = pool("crema-sol-usdc");
    const byreal = pool("byreal-sol-usdc");
    const raydium = pool("raydium-clmm-sol-usdc");
    expect(allIn(crema, false)).toBeGreaterThan(maxPrice); // already past the limit
    const budget = 1_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({
        slots: [NONE, crema, byreal, raydium],
        pay: USDC,
        buy: WSOL,
        budget,
        maxPrice,
        kept: 5n,
        // Raydium's pool emptied: no liquidity at its price.
        edit: { address: raydium.pool, offset: 237, bytes: Array(16).fill(0) },
      }),
    );
    expect(outcome.spent).toBe(0n);
    expect(outcome.bought).toBe(0n);
    expect(outcome.refunded).toBe(budget);
    expect(outcome.left).toBe(5n);
    for (const p of [crema, byreal]) expect(priceOf(p)).toBe(snapshotPrice(p));
  }, 120_000);

  it("skips a paused pool and an order book whose offers are past the limit", async () => {
    const phoenix = pool("phoenix-sol-usdc");
    const raydium = pool("raydium-clmm-sol-usdc");
    const orca = pool("orca-whirlpool-sol-usdc");
    const budget = 1_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({
        slots: [phoenix, raydium, orca],
        pay: USDC,
        buy: WSOL,
        budget,
        maxPrice,
        // Raydium's swaps switched off: status bit 4.
        edit: { address: raydium.pool, offset: 389, bytes: [16] },
      }),
    );
    // The market took the order and filled none of it: its vaults hold what they held.
    for (const vault of [phoenix.vaultA, phoenix.vaultB])
      expect(tokenAmount(harness, vault)).toBe(le(BYTES.get(vault)!, 64, 8));
    expect(priceOf(raydium)).toBe(snapshotPrice(raydium));
    expect(priceOf(orca)).not.toBe(snapshotPrice(orca));
    expect(outcome.spent).toBe(budget);
  }, 120_000);

  it("trades the thin venues to their own limits: Cropper and Crema", async () => {
    const thin = [pool("cropper-sol-usdc"), pool("crema-sol-usdc")];
    const top = thin.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b));
    const thinMax = (top * 10005n) / 10000n;
    const budget = 100_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({ slots: thin, pay: USDC, buy: WSOL, budget, maxPrice: thinMax }),
    );
    for (const p of thin) expect(priceOf(p)).toBe(ownLimit(p, thinMax, false));
    expect(outcome.spent * E18).toBeLessThanOrEqual(thinMax * outcome.bought);
    expect(outcome.refunded).toBe(outcome.unspent);
  }, 120_000);

  it("takes an order book's offers up to the limit, fee included, and no further", async () => {
    const phoenix = pool("phoenix-sol-usdc");
    const loader = async (at: Address) => (BYTES.has(at) ? new Uint8Array(BYTES.get(at)!) : null);
    const market = await fetchPhoenixConfig(loader, phoenix.pool);
    const data = BYTES.get(phoenix.pool)!;
    const offers = market.windows.quoteIn.orders.map((o) => {
      const node = market.asksNodesBase + (o.nodeIndex - 1) * 64;
      return { ticks: le(data, node + 16, 8), lots: le(data, node + 40, 8) };
    });
    const fee = le(data, 856, 8);
    // A tick in maxPrice's units: quote atoms per base atom, × 1e18.
    const tick =
      (market.tickSizeInQuoteLotsPerBaseUnit * market.quoteLotSize * E18) /
      (market.baseLotsPerBaseUnit * market.baseLotSize);
    // A limit just past the first price level, fee included.
    const first = offers[0]!.ticks;
    const limitTicks = first;
    const bookMax = (limitTicks * tick * (10000n + fee)) / 10000n + tick / 2n;
    const expected = offers.filter((o) => o.ticks <= limitTicks).reduce((n, o) => n + o.lots, 0n);
    expect(offers.some((o) => o.ticks > limitTicks)).toBe(true);
    const budget = 10_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({ slots: [phoenix], pay: USDC, buy: WSOL, budget, maxPrice: bookMax }),
    );
    expect(outcome.bought).toBe(expected * market.baseLotSize);
    expect(outcome.spent * E18).toBeLessThanOrEqual(bookMax * outcome.bought);
    expect(outcome.refunded).toBe(outcome.unspent);
  }, 120_000);

  it("sells the other way: paying the lower-key token, each price falls to its own limit", async () => {
    // Selling SOL for USDC: maxPrice is SOL per USDC, the order's floor seen from the other side.
    const cheapest = DEEP.map((p) => allIn(p, true)).reduce((a, b) => (a > b ? a : b));
    const sellMax = (cheapest * 10003n) / 10000n;
    const budget = 100_000n * 10n ** 9n; // 100,000 SOL
    const outcome = succeeded(
      await cook({ slots: DEEP, pay: WSOL, buy: USDC, budget, maxPrice: sellMax }),
    );
    for (const p of DEEP) expect(priceOf(p)).toBe(ownLimit(p, sellMax, true));
    expect(outcome.spent * E18).toBeLessThanOrEqual(sellMax * outcome.bought);
    expect(outcome.refunded).toBe(outcome.unspent);
  }, 120_000);

  it("runs Byreal's and Stabble's own swaps", async () => {
    const byreal = pool("byreal-usdc");
    const mint = getAddressCodec().decode(BYTES.get(byreal.pool)!.subarray(73, 105));
    const byrealMax = (allIn(byreal, false) * 10003n) / 10000n;
    const first = succeeded(
      await cook({
        slots: [byreal],
        pay: USDC,
        buy: mint,
        budget: 100_000n * 10n ** 6n,
        maxPrice: byrealMax,
      }),
    );
    expect(priceOf(byreal)).toBe(ownLimit(byreal, byrealMax, false));
    expect(first.bought).toBeGreaterThan(0n);

    const stabble = pool("stabble-clmm-usdc-usdt");
    const stabbleMax = (allIn(stabble, true) * 10003n) / 10000n;
    const second = succeeded(
      await cook({
        slots: [stabble],
        pay: USDC,
        buy: USDT,
        budget: 100_000n * 10n ** 6n,
        maxPrice: stabbleMax,
      }),
    );
    expect(priceOf(stabble)).toBe(ownLimit(stabble, stabbleMax, true));
    expect(second.bought).toBeGreaterThan(0n);
  }, 120_000);

  it("reverts below minTokens and above maxAvgPrice", async () => {
    const budget = 1_000n * 10n ** 6n;
    const rehearsed = succeeded(
      await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice }),
    );
    expect(
      refused(
        await cook({
          slots: DEEP,
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
          minTokens: rehearsed.bought + 1n,
        }),
      ),
    ).toBe("bought below minTokens");
    const average = (rehearsed.spent * E18) / rehearsed.bought;
    expect(
      refused(
        await cook({
          slots: DEEP,
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
          maxAvgPrice: average - 1n,
        }),
      ),
    ).toBe("average too high");
    // At the average, both checks pass.
    succeeded(
      await cook({
        slots: DEEP,
        pay: USDC,
        buy: WSOL,
        budget,
        maxPrice,
        minTokens: rehearsed.bought,
        maxAvgPrice: average + 1n,
      }),
    );
  }, 180_000);

  it("keeps what was bought and the rest of the budget in the Pot when recipient and refund are the Pot", async () => {
    const budget = 1_000_000n * 10n ** 6n;
    const outcome = succeeded(
      await cook({
        slots: DEEP,
        pay: USDC,
        buy: WSOL,
        budget,
        maxPrice,
        kept: 7n,
        keepInPot: true,
      }),
    );
    expect(outcome.bought).toBeGreaterThan(0n);
    expect(outcome.unspent).toBeGreaterThan(0n);
    // Nothing moved on: the Pot holds what it bought, and its USDC is the rest and its own 7.
    expect(outcome.kept).toBe(outcome.bought);
    expect(outcome.left).toBe(outcome.unspent + 7n);
  }, 120_000);

  it("refuses a budget not in the Pot, a pool that is not the pair, and a venue it does not take", async () => {
    const budget = 1_000n * 10n ** 6n;
    expect(
      refused(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, short: true })),
    ).toBe("budget is not in the Pot");
    expect(
      refused(
        await cook({
          slots: [pool("stabble-clmm-usdc-usdt")],
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
        }),
      ),
    ).toBe("pool is not the pair");
    expect(
      refused(
        await cook({
          slots: [pool("meteora-dlmm-sol-usdc")],
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
        }),
      ),
    ).toBe("not a supported venue's pool");
    const orca = pool("orca-whirlpool-sol-usdc");
    expect(
      refused(
        await cook({
          slots: [{ ...orca, program: pool("raydium-clmm-sol-usdc").program }],
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
        }),
      ),
    ).toBe("a pool's program is not its owner");
    // A recipient's token account another wallet holds: the transfer is refused after it, by the
    // check that binds the account to the recipient.
    expect(
      refused(
        await cook({
          slots: DEEP,
          pay: USDC,
          buy: WSOL,
          budget,
          maxPrice,
          strangerRecipient: true,
        }),
      ),
    ).toBe("wrong recipient account");
  }, 180_000);
});
