/**
 * The `sauce-solana-distributed-swap` skill's program, executed: staged and cooked through the
 * released Kitchen on the harness Pot, against the venues' own mainnet programs and the pools'
 * mainnet accounts (`test/fixtures/svm-venues/`, written by `scripts/dump-svm-venues.mjs`). It proves
 * what the skill says the program does: one exact-input order split over price-limited pools, each
 * stopping exactly at its own fee-adjusted limit; a missing slot, a pool past its limit, an empty
 * pool, a pool whose fee is more than one rate, a paused pool and a market whose book is past the
 * limit skipped; the minimum-output and average-price checks; only the unspent budget refunded and
 * the paying account's other balance untouched; and the refusals of a pool that is not the pair, a
 * venue the program does not take, and a slot whose program does not own its pool.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { AccountRole, address, getAddressCodec, lamports } from "@solana/kit";
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

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../fixtures/svm-venues");
const PROGRAM = join(
  HERE,
  "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
);

interface Pool {
  name: string;
  venue: string;
  program: Address;
  pool: Address;
  config: Address;
  vaultA: Address;
  vaultB: Address;
  extra: Address;
  /** The tick arrays a swap paying the lower-key token walks (the price falls), and the other way. */
  payA: Address[];
  payB: Address[];
}
interface Manifest {
  slot: number;
  unixTimestamp: number;
  programs: { name: string; programId: Address; file: string }[];
  pools: Pool[];
  accounts: { address: Address; owner: Address; lamports: string; file: string }[];
}

const manifest = JSON.parse(readFileSync(join(FIXTURE, "manifest.json"), "utf8")) as Manifest;
const unzip = (file: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(join(FIXTURE, file))));
const SNAPSHOT = new Map(manifest.accounts.map((account) => [account.address, account]));
const BYTES = new Map(manifest.accounts.map((account) => [account.address, unzip(account.file)]));

const SYSTEM = address("11111111111111111111111111111111");
const TOKEN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const MEMO = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const WSOL = address("So11111111111111111111111111111111111111112");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const pool = (name: string): Pool => {
  const found = manifest.pools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no pool ${name} in the fixture`);
  return found;
};
const NONE: Pool = {
  name: "none",
  venue: "none",
  program: SYSTEM,
  pool: SYSTEM,
  config: SYSTEM,
  vaultA: SYSTEM,
  vaultB: SYSTEM,
  extra: SYSTEM,
  payA: [SYSTEM, SYSTEM, SYSTEM],
  payB: [SYSTEM, SYSTEM, SYSTEM],
};

const key = (at: Address): bigint =>
  BigInt(`0x${Buffer.from(getAddressCodec().encode(at)).toString("hex")}`);
const le = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
};
const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return x;
};
const E18 = 10n ** 18n;
const Q128 = 1n << 128n;

/** Where each concentrated-liquidity venue keeps its sqrt price, liquidity and fee. */
const LAYOUT: Record<string, { price: number; liquidity: number; fee: (p: Pool) => bigint }> = {
  "raydium-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "pancakeswap-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  byreal: { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "stabble-clmm": { price: 253, liquidity: 237, fee: (p) => le(BYTES.get(p.config)!, 47, 4) },
  "orca-whirlpool": { price: 65, liquidity: 49, fee: (p) => le(BYTES.get(p.pool)!, 45, 2) },
  cropper: { price: 65, liquidity: 49, fee: (p) => le(BYTES.get(p.pool)!, 45, 2) },
  defituna: { price: 167, liquidity: 151, fee: (p) => le(BYTES.get(p.pool)!, 143, 2) },
  crema: { price: 190, liquidity: 174, fee: (p) => le(BYTES.get(p.pool)!, 172, 2) },
};

/** A pool's price, fee included, in maxPrice's units: pay base units per buy base unit, × 1e18. */
const allIn = (p: Pool, paysA: boolean): bigint => {
  const { price, fee } = LAYOUT[p.venue]!;
  const s = le(BYTES.get(p.pool)!, price, 16);
  const kept = 1_000_000n - fee(p);
  return paysA ? (Q128 * E18 * 1_000_000n) / (s * s * kept) : (s * s * E18 * 1_000_000n) / (Q128 * kept);
};

/** The program's arithmetic: maxPrice as a sqrt price, then a pool's own limit for its fee. */
const ownLimit = (p: Pool, maxPrice: bigint, paysA: boolean): bigint => {
  const limit = paysA ? isqrt((Q128 * E18) / maxPrice) : isqrt((maxPrice * Q128) / E18);
  const root = isqrt((1_000_000n - LAYOUT[p.venue]!.fee(p)) * 10n ** 30n);
  return paysA ? (limit * E18) / root : (limit * root) / E18;
};

const SLOT_NAMES = (k: number): string[] => [
  `program${k}`,
  `pool${k}`,
  `config${k}`,
  `vaultA${k}`,
  `vaultB${k}`,
  `extra${k}`,
  `ticks${k}0`,
  `ticks${k}1`,
  `ticks${k}2`,
];

interface Order {
  slots: Pool[];
  pay: Address;
  buy: Address;
  budget: bigint;
  maxPrice: bigint;
  minTokens?: bigint;
  maxAvgPrice?: bigint;
  /** Of the pay token, in the paying account beside the budget: never spent, never refunded. */
  kept?: bigint;
  /** Less than the budget in the paying account. */
  short?: boolean;
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
      /** What stays in the Pot's account of the bought token: nothing, it all went on. */
      kept: bigint;
      left: bigint;
      units: bigint;
      size: number;
      accounts: number;
    }
  | { ok: false; reason: string; logs: string[] };

describeSvm("the Solana distributed swap, on the venues' own programs and pools", () => {
  const source = readFileSync(PROGRAM, "utf8");
  const program = compileSauceProgram("solana", source);
  let harness: EngineHarness;
  let nonce = 0n;

  /** Every fixture account back as the snapshot has it: each cook starts from the same chain. */
  const restore = (): void => {
    for (const [at, data] of BYTES) {
      const account = SNAPSHOT.get(at)!;
      harness.svm.setAccount({
        address: at,
        data: new Uint8Array(data),
        executable: false,
        lamports: lamports(BigInt(account.lamports)),
        programAddress: account.owner,
        space: BigInt(data.length),
      });
    }
  };

  beforeAll(async () => {
    // A little after the snapshot: a whirlpool refuses a clock before its last update.
    harness = await startEngine(BigInt(manifest.unixTimestamp) + 60n);
    for (const venue of manifest.programs) harness.svm.addProgram(venue.programId, unzip(venue.file));
  }, 120_000);

  const cook = async (order: Order): Promise<Outcome> => {
    restore();
    if (order.edit !== undefined) {
      const { address: at, offset, bytes } = order.edit;
      const data = new Uint8Array(BYTES.get(at)!);
      data.set(bytes, offset);
      const account = SNAPSHOT.get(at)!;
      harness.svm.setAccount({
        address: at,
        data,
        executable: false,
        lamports: lamports(BigInt(account.lamports)),
        programAddress: account.owner,
        space: BigInt(data.length),
      });
    }
    const kept = order.kept ?? 0n;
    const source = setTokenAccount(
      harness,
      randomAddress(),
      order.pay,
      harness.pot,
      (order.short ? order.budget - 1n : order.budget) + kept,
    );
    const output = setTokenAccount(harness, randomAddress(), order.buy, harness.pot, 0n);
    const recipient = setTokenAccount(harness, randomAddress(), order.buy, randomAddress(), 0n);
    const refund = setTokenAccount(harness, randomAddress(), order.pay, randomAddress(), 0n);
    const paysA = key(order.pay) < key(order.buy);

    const w = AccountRole.WRITABLE;
    const r = AccountRole.READONLY;
    const named: Record<string, { address: Address; role: AccountRole }> = {
      authority: { address: harness.pot, role: r }, // the Kitchen signs for the Pot
      source: { address: source, role: w },
      output: { address: output, role: w },
      recipient: { address: recipient, role: w },
      refund: { address: refund, role: w },
      payMint: { address: order.pay, role: r },
      buyMint: { address: order.buy, role: r },
      tokenProgram: { address: TOKEN, role: r },
      token2022: { address: TOKEN_2022, role: r },
      memo: { address: MEMO, role: r },
    };
    const slots = [...order.slots];
    while (slots.length < 4) slots.push(NONE);
    slots.forEach((p, k) => {
      const ticks = paysA ? p.payA : p.payB;
      const accounts = [p.program, p.pool, p.config, p.vaultA, p.vaultB, p.extra, ...ticks];
      SLOT_NAMES(k).forEach((name, j) => {
        // The program and config are read; the rest a swap writes. The System program is never
        // writable, and stands in for every account a slot does not use.
        const writable = accounts[j] !== SYSTEM && j !== 0 && j !== 2;
        named[name] = { address: accounts[j]!, role: writable ? w : r };
      });
    });
    const tail = program.manifest!.accounts.map((entry) => {
      if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
      return named[entry.name] ?? (() => { throw new Error(`no account for ${entry.name}`); })();
    });

    // The cook carries the program and its arguments staged in a code buffer, and its accounts
    // through a lookup table: as `sauce run` stages a program too large for one transaction.
    const args = encodeEntryArguments(program, [
      order.budget,
      order.maxPrice,
      order.minTokens ?? 0n,
      order.maxAvgPrice ?? 0n,
    ]);
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
    const returned = result.returnData().data();
    const word = (i: number): bigint =>
      BigInt(`0x${Buffer.from(returned.subarray(32 * i, 32 * i + 32)).toString("hex")}`);

    return {
      ok: true,
      spent: word(0),
      bought: word(1),
      unspent: word(2),
      refunded: tokenAmount(harness, refund),
      received: tokenAmount(harness, recipient),
      kept: tokenAmount(harness, output),
      left: tokenAmount(harness, source),
      units: result.computeUnitsConsumed(),
      size: getTransactionSize(transaction),
      // The payer, the compute-budget program, the lookup table and every key it holds.
      accounts: keys.length + 3,
    };
  };

  const succeeded = (outcome: Outcome): Extract<Outcome, { ok: true }> => {
    if (!outcome.ok) throw new Error(`the cook failed: ${outcome.reason}\n${outcome.logs.join("\n")}`);
    return outcome;
  };
  const refused = (outcome: Outcome): string => {
    if (outcome.ok) throw new Error("the cook succeeded; expected a refusal");
    return outcome.reason;
  };
  const priceOf = (p: Pool): bigint =>
    le(harness.svm.getAccount(p.pool).data as Uint8Array, LAYOUT[p.venue]!.price, 16);
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
    const outcome = succeeded(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, kept: 7n }));
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

  it("gives the budget to the slots in order, and stops when it is spent", async () => {
    const budget = 100n * 10n ** 6n;
    const outcome = succeeded(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice }));
    expect(outcome.spent).toBe(budget);
    expect(outcome.unspent).toBe(0n);
    expect(outcome.refunded).toBe(0n);
    expect(priceOf(DEEP[0]!)).not.toBe(snapshotPrice(DEEP[0]!));
    for (const p of DEEP.slice(1)) expect(priceOf(p)).toBe(snapshotPrice(p));
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
    const outcome = succeeded(await cook({ slots: thin, pay: USDC, buy: WSOL, budget, maxPrice: thinMax }));
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
    const outcome = succeeded(await cook({ slots: DEEP, pay: WSOL, buy: USDC, budget, maxPrice: sellMax }));
    for (const p of DEEP) expect(priceOf(p)).toBe(ownLimit(p, sellMax, true));
    expect(outcome.spent * E18).toBeLessThanOrEqual(sellMax * outcome.bought);
    expect(outcome.refunded).toBe(outcome.unspent);
  }, 120_000);

  it("runs Byreal's and Stabble's own swaps", async () => {
    const byreal = pool("byreal-usdc");
    const mint = getAddressCodec().decode(BYTES.get(byreal.pool)!.subarray(73, 105));
    const byrealMax = (allIn(byreal, false) * 10003n) / 10000n;
    const first = succeeded(
      await cook({ slots: [byreal], pay: USDC, buy: mint, budget: 100_000n * 10n ** 6n, maxPrice: byrealMax }),
    );
    expect(priceOf(byreal)).toBe(ownLimit(byreal, byrealMax, false));
    expect(first.bought).toBeGreaterThan(0n);

    const stabble = pool("stabble-clmm-usdc-usdt");
    const stabbleMax = (allIn(stabble, true) * 10003n) / 10000n;
    const second = succeeded(
      await cook({ slots: [stabble], pay: USDC, buy: USDT, budget: 100_000n * 10n ** 6n, maxPrice: stabbleMax }),
    );
    expect(priceOf(stabble)).toBe(ownLimit(stabble, stabbleMax, true));
    expect(second.bought).toBeGreaterThan(0n);
  }, 120_000);

  it("reverts below minTokens and above maxAvgPrice", async () => {
    const budget = 1_000n * 10n ** 6n;
    const rehearsed = succeeded(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice }));
    expect(
      refused(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, minTokens: rehearsed.bought + 1n })),
    ).toBe("bought below minTokens");
    const average = (rehearsed.spent * E18) / rehearsed.bought;
    expect(
      refused(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, maxAvgPrice: average - 1n })),
    ).toBe("average too high");
    // At the average, both checks pass.
    succeeded(
      await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, minTokens: rehearsed.bought, maxAvgPrice: average + 1n }),
    );
  }, 180_000);

  it("refuses a budget not in the account, a pool that is not the pair, and a venue it does not take", async () => {
    const budget = 1_000n * 10n ** 6n;
    expect(refused(await cook({ slots: DEEP, pay: USDC, buy: WSOL, budget, maxPrice, short: true }))).toBe(
      "budget is not in source",
    );
    expect(
      refused(await cook({ slots: [pool("stabble-clmm-usdc-usdt")], pay: USDC, buy: WSOL, budget, maxPrice })),
    ).toBe("pool is not the pair");
    expect(
      refused(await cook({ slots: [pool("meteora-dlmm-sol-usdc")], pay: USDC, buy: WSOL, budget, maxPrice })),
    ).toBe("not a supported venue's pool");
    const orca = pool("orca-whirlpool-sol-usdc");
    expect(
      refused(
        await cook({ slots: [{ ...orca, program: pool("raydium-clmm-sol-usdc").program }], pay: USDC, buy: WSOL, budget, maxPrice }),
      ),
    ).toBe("a pool's program is not its owner");
  }, 180_000);
});
