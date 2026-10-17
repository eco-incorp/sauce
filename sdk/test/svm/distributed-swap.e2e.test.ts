/**
 * The `sauce-solana-distributed-swap` skill's program, executed: staged and cooked through the
 * released Kitchen on the harness Pot, against the venues' own mainnet programs and the pools'
 * mainnet accounts (`test/fixtures/svm-venue-programs/`, written by `scripts/dump-svm-venues.mjs`).
 * It buys SPCX_US, a Token-2022 mint with its issuer's extensions as mainnet holds them, with USDC.
 * The program finds its pools by key (`Raydium.CLMM.pool(USDC, SPCX_US, fee)`), and every account
 * it names is derived (`derivedAccounts`): each is resolved here as the command resolves it, by
 * `resolveSvmAccountName` reading the bank, so a key with no pool in the fixture is an empty slot.
 * The Token-2022 accounts are the ones the ATA program creates, sized for the extensions the mint
 * requires. It proves what the skill says the program does: one exact-input order split over the
 * pools its keys find, each stopping exactly at its own fee-adjusted limit; a key with no pool, a
 * pool past its limit, an empty pool and a remainder of dust skipped; the minimum-output and
 * average-price checks; what was bought and what is left of the budget sent to the recipient, and the
 * Pot's other balance untouched; both kept in the Pot when the recipient is the Pot; the refusals of
 * a budget the Pot does not hold and a recipient's account another wallet holds; and Orca's pool of
 * the pair, on an adaptive fee tier, found by its tier and skipped at a price.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AccountRole, address, getAddressCodec } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
} from "@solana-program/token";
import { FailedTransactionMetadata } from "litesvm";

import { requireChain } from "../../src/chains/canonical.js";
import { encodeEntryArguments } from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import { resolveSvmAccountName } from "../../src/svm/account-names.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
  getTransactionSize,
} from "../../src/svm/index.js";
import type { SvmSlot } from "../../src/svm/pool-slot.js";
import { svmTokenAccount } from "../../src/svm/token-accounts.js";
import {
  svmProgramStops,
  svmSkipStop,
  svmStopValues,
  type SvmProgramStops as SvmStops,
} from "../../src/svm/compute-stops.js";
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
import {
  describeSvm,
  fabricateAlt,
  HARNESS_POT_SALT,
  randomAddress,
  sendInstructions,
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
  ownLimit,
  pool,
  restoreVenues,
  windowBound,
  SYSTEM,
  TOKEN,
  TOKEN_2022,
  USDC,
} from "./venue-fixture.js";
import type { Edit, Pool } from "./venue-fixture.js";

/** The skill's program. */
const PROGRAM = fileURLToPath(
  new URL(
    "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
);

/** SpaceX, as Backpack issues it: a Token-2022 mint of 6 decimals. */
const SPCX_US = address("SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb");

/** The pools of the program's keys the fixture holds, in the program's order; its other key, Raydium's
 *  0.18%, finds none there. */
const RAYDIUM = pool("raydium-clmm-spcx-usdc");
const BYREAL = pool("byreal-spcx-usdc");
/** Priced past its own tick bitmap: its slot takes its bitmap extension. */
const PANCAKE = pool("pancakeswap-clmm-spcx-usdc");
const FOUND = [RAYDIUM, BYREAL, PANCAKE];
/** Orca's pool of the pair: on fee tier 1025, an adaptive fee at tick spacing 64. */
const ORCA = pool("orca-whirlpool-spcx-usdc");

/** Each pool's liquidity zeroed: the pool emptied. */
const emptied = (...pools: Pool[]): Edit[] =>
  pools.map((p) => ({
    address: p.pool,
    offset: LAYOUT[p.venue]!.liquidity,
    bytes: Array(16).fill(0),
  }));

interface Order {
  budget: bigint;
  priceLimit: bigint;
  minTokens?: bigint;
  maxAvgPrice?: bigint;
  /** USDC in the Pot's account beside the budget: never spent. */
  kept?: bigint;
  /** Less than the budget in the Pot's account. */
  short?: boolean;
  /** The recipient is the Pot itself: what was bought and the rest of the budget stay there. */
  keepInPot?: boolean;
  /** The recipient's token account held by another wallet than the recipient. */
  strangerRecipient?: boolean;
  /** Bytes to change in fixture accounts before the cook: pools emptied. */
  edit?: Edit[];
  /** The program to cook, when not the skill's: one taking the same arguments. */
  source?: string;
  /** Every swap the plain one, in place of the stops the command works out. */
  unheld?: boolean;
}

type Outcome =
  | {
      ok: true;
      spent: bigint;
      bought: bigint;
      unspent: bigint;
      received: bigint;
      /** The recipient's USDC: what is left of the budget. */
      refunded: bigint;
      /** The Pot's SPCX_US: nothing, unless the recipient is the Pot. */
      kept: bigint;
      /** The Pot's USDC after the cook. */
      left: bigint;
      units: bigint;
      size: number;
      accounts: number;
      /** The swaps' stops the command worked out. */
      stops?: SvmStops;
    }
  | { ok: false; reason: string; logs: string[]; stops?: SvmStops };

/** A key as the engine reads an `Address` argument on Solana: its 32 bytes, as one word. */
const word = (at: Address): bigint => key(at);

describeSvm("the Solana distributed swap, on the venues' own programs and pools", () => {
  const source = readFileSync(PROGRAM, "utf8");
  const program = compileSauceProgram("solana", source);
  let harness: EngineHarness;
  let nonce = 0n;

  beforeAll(async () => {
    // A little after the pools were read: a pool refuses a clock before its last update.
    const read = Math.max(manifest.unixTimestamp, ...FOUND.map((p) => p.unixTimestamp ?? 0));
    harness = await startEngine(BigInt(read) + 60n);
    loadVenues(harness.svm);
  }, 120_000);

  /** The bank's accounts, as the command reads the cluster's. */
  const load: OwnedAccountLoader = async (at) => {
    const account = harness.svm.getAccount(at);
    return account.exists ? { data: account.data, owner: account.programAddress } : null;
  };

  /**
   * A holder's SPCX_US account, as the ATA program creates it for the holder (with the account
   * extensions the mint requires), holding nothing; `owner` written over the holder's in it, for an
   * account at the holder's address that another wallet holds.
   */
  const stockAccount = async (holder: Address, owner: Address = holder): Promise<Address> => {
    const [ata] = await findAssociatedTokenPda({
      owner: holder,
      mint: SPCX_US,
      tokenProgram: TOKEN_2022,
    });
    if (!harness.svm.getAccount(ata).exists) {
      const created = await sendInstructions(harness, [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: harness.payer,
          ata,
          owner: holder,
          mint: SPCX_US,
          tokenProgram: TOKEN_2022,
        }),
      ]);
      if (!created.ok) throw new Error(`the ATA program made no SPCX_US account: ${created.err}`);
    }
    const account = harness.svm.getAccount(ata);
    if (!account.exists) throw new Error(`no SPCX_US account at ${ata}`);
    const data = new Uint8Array(account.data);
    data.set(new Uint8Array(getAddressCodec().encode(owner)), 32);
    data.fill(0, 64, 72); // amount
    harness.svm.setAccount({ ...account, data });

    return ata;
  };

  const cook = async (order: Order): Promise<Outcome> => {
    restoreVenues(harness.svm, order.edit);
    // The program as the command compiles it: plain, then each swap whose stop binds held.
    const text = order.source ?? source;
    const plain = text === source ? program : compileSauceProgram("solana", text);
    const kept = order.kept ?? 0n;
    const ata = (holder: Address, mint: Address) =>
      svmTokenAccount({ mint, tokenProgram: TOKEN }, holder);
    // The Pot's accounts for the two tokens and the recipient's, where the program derives them.
    const potPay = setTokenAccount(
      harness,
      await ata(harness.pot, USDC),
      USDC,
      harness.pot,
      (order.short ? order.budget - 1n : order.budget) + kept,
    );
    const potBuy = await stockAccount(harness.pot);
    const to = order.keepInPot ? harness.pot : randomAddress();
    const recipient = order.keepInPot
      ? potBuy
      : await stockAccount(to, order.strangerRecipient ? randomAddress() : to);
    const refund = order.keepInPot
      ? potPay
      : setTokenAccount(harness, await ata(to, USDC), USDC, to, 0n);

    // Each account the program names, from its derivation, as the command resolves it.
    const slots = new Map<string, Promise<SvmSlot>>();
    const derived = plain.derivedAccounts as Readonly<Record<string, string>>;
    const named: Record<string, string> = {};
    const tail = await Promise.all(
      plain.manifest!.accounts.map(async (entry) => {
        if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
        const derivation = derived[entry.name];
        if (derivation === undefined) throw new Error(`${entry.name} is not derived`);
        const { value } = await resolveSvmAccountName(derivation, {
          chain: requireChain("solana"),
          owner: harness.payer.address,
          pot: harness.pot,
          args: { recipient: to },
          load,
          slots,
        });
        const at =
          value === "pot" ? harness.pot : value === "owner" ? harness.payer.address : value;
        named[entry.name] = at;
        // The Kitchen signs for the Pot; the System program, which stands in for every account a
        // slot does not use, is never writable.
        const writable = entry.requires === "writable" && at !== SYSTEM;
        return { address: at, role: writable ? AccountRole.WRITABLE : AccountRole.READONLY };
      }),
    );

    // Each swap's stop, as the command works it out from the pools it read: a swap it binds
    // compiled to the Stopped form, its stop after main's own arguments.
    const stops = await svmProgramStops(
      plain,
      requireChain("solana"),
      named,
      { priceLimit: order.priceLimit },
      load,
    );
    const cooked =
      order.unheld === true || stops === undefined || stops.binding.length === 0
        ? plain
        : compileSauceProgram("solana", text, { stops: stops.binding });
    // The cook carries the program and its arguments staged in a code buffer, and its accounts
    // through a lookup table: as `sauce run` stages a program too large for one transaction. An
    // `Address` argument is its key's 32 bytes, one word, as the command encodes it.
    const keyed = {
      ...cooked,
      entryParams: cooked.entryParams.map((param) => ({
        ...param,
        type: param.type.replace(/\bAddress\b/g, "Uint256"),
      })),
    };

    const args = encodeEntryArguments(
      {
        ...keyed,
        entryParams: [...keyed.entryParams, ...(cooked.derivedValues ?? [])],
      },
      [
        order.budget,
        order.priceLimit,
        order.minTokens ?? 0n,
        order.maxAvgPrice ?? 0n,
        word(to),
        ...svmStopValues(order.unheld === true ? undefined : stops, cooked),
      ],
    );
    const payload = new Uint8Array(cooked.bytecode.length + args.length);
    payload.set(cooked.bytecode);
    payload.set(args, cooked.bytecode.length);
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
        ...(stops === undefined ? {} : { stops }),
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
      received: order.keepInPot ? 0n : tokenAmount(harness, recipient),
      refunded: order.keepInPot ? 0n : tokenAmount(harness, refund),
      kept: tokenAmount(harness, potBuy),
      left: tokenAmount(harness, potPay),
      units: result.computeUnitsConsumed(),
      ...(stops === undefined ? {} : { stops }),
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

  // Buying SPCX_US with USDC: USDC is the higher key, so every pool's price rises as it sells.
  const dearest = FOUND.map((p) => allIn(p, false)).reduce((a, b) => (a > b ? a : b));
  // 3 bps above the dearer pool's price, fee included: both have room to trade.
  const priceLimit = (dearest * 10003n) / 10000n;

  it("finds its pools by key and splits one order over them, each stopping at its own limit", async () => {
    const budget = 1_000_000n * 10n ** 6n; // 1,000,000 USDC: more than the pools take within it
    const outcome = succeeded(await cook({ budget, priceLimit, kept: 7n }));
    for (const p of FOUND) {
      expect(priceOf(p)).not.toBe(snapshotPrice(p));
      expect(priceOf(p)).toBe(ownLimit(p, priceLimit, false));
    }
    expect(outcome.bought).toBe(outcome.received);
    expect(outcome.kept).toBe(0n);
    expect(outcome.spent + outcome.unspent).toBe(budget);
    // What is left of the budget goes to the recipient; the Pot keeps only its own 7.
    expect(outcome.unspent).toBeGreaterThan(0n);
    expect(outcome.refunded).toBe(outcome.unspent);
    expect(outcome.left).toBe(7n);
    expect(outcome.spent * E18).toBeLessThanOrEqual(priceLimit * outcome.bought);
    expect(outcome.units).toBeLessThan(1_400_000);
    expect(outcome.accounts).toBeLessThanOrEqual(64);
    expect(outcome.size).toBeLessThanOrEqual(1232);
    console.log(
      `${program.entryParams.length} arguments, ${program.manifest!.accounts.length} accounts named, ` +
        `three pools found: ${outcome.units} compute units, ${outcome.size}-byte transaction, ` +
        `${outcome.accounts} accounts, ${program.bytecode.length}-byte program`,
    );
  }, 120_000);

  it("gives the budget to the pools in order, and stops when it is spent", async () => {
    const budget = 100n * 10n ** 6n;
    const outcome = succeeded(await cook({ budget, priceLimit }));
    expect(outcome.spent).toBe(budget);
    expect(outcome.unspent).toBe(0n);
    expect(outcome.refunded).toBe(0n);
    expect(outcome.left).toBe(0n);
    expect(priceOf(RAYDIUM)).not.toBe(snapshotPrice(RAYDIUM));
    for (const p of [BYREAL, PANCAKE]) expect(priceOf(p)).toBe(snapshotPrice(p));
  }, 120_000);

  it("skips a pool past its limit, an empty pool, and a remainder of dust, and completes", async () => {
    const budget = 1_000_000n * 10n ** 6n;
    // A limit between the cheapest pool's price and the dearest's: the dearest sits out, and the
    // middle one, under the limit too, trades up to its own limit as the cheapest does.
    const [cheapest, middle, dearest] = [...FOUND].sort((a, b) =>
      allIn(a, false) < allIn(b, false) ? -1 : 1,
    ) as [Pool, Pool, Pool];
    const between = (allIn(cheapest, false) + allIn(dearest, false)) / 2n;
    expect(allIn(cheapest, false)).toBeLessThan(between);
    expect(allIn(middle, false)).toBeLessThan(between);
    expect(allIn(dearest, false)).toBeGreaterThan(between);
    const one = succeeded(await cook({ budget, priceLimit: between }));
    expect(priceOf(cheapest)).toBe(ownLimit(cheapest, between, false));
    expect(priceOf(middle)).toBe(ownLimit(middle, between, false));
    expect(priceOf(dearest)).toBe(snapshotPrice(dearest));
    expect(one.bought).toBeGreaterThan(0n);

    // Raydium's pool emptied (no liquidity at its price): the others take the order.
    const without = succeeded(await cook({ budget, priceLimit, edit: emptied(RAYDIUM) }));
    expect(priceOf(RAYDIUM)).toBe(snapshotPrice(RAYDIUM));
    for (const p of [BYREAL, PANCAKE]) expect(priceOf(p)).toBe(ownLimit(p, priceLimit, false));
    expect(without.bought).toBeGreaterThan(0n);

    // What Raydium's pool takes on its own, and one atom more: Byreal's pool is offered one atom of
    // USDC, which its fee takes whole, so it buys nothing there and is skipped rather than the cook
    // reverted; PancakeSwap's is offered nothing.
    const alone = succeeded(await cook({ budget, priceLimit, edit: emptied(BYREAL, PANCAKE) }));
    const dust = succeeded(await cook({ budget: alone.spent + 1n, priceLimit }));
    expect(dust.spent).toBe(alone.spent);
    expect(dust.bought).toBe(alone.bought);
    expect(dust.unspent).toBe(1n);
    expect(dust.refunded).toBe(1n);
    for (const p of [BYREAL, PANCAKE]) expect(priceOf(p)).toBe(snapshotPrice(p));
  }, 180_000);

  it("trades PancakeSwap's pool, priced past its own tick bitmap, through its bitmap extension", async () => {
    // Its slot paying USDC: the extension first, then the two arrays it marks above the price.
    expect(PANCAKE.payB[0]).toBe(PANCAKE.more![0]);
    // The other two pools emptied: PancakeSwap's alone takes the order, up to its own limit.
    const alone = succeeded(
      await cook({ budget: 1_000_000n * 10n ** 6n, priceLimit, edit: emptied(RAYDIUM, BYREAL) }),
    );
    expect(alone.bought).toBeGreaterThan(0n);
    expect(priceOf(PANCAKE)).toBe(ownLimit(PANCAKE, priceLimit, false));
    expect(alone.spent * E18).toBeLessThanOrEqual(priceLimit * alone.bought);
  }, 120_000);

  it("stops PancakeSwap's far-priced pool a tick inside the two arrays its slot gives it", async () => {
    // Its slot paying USDC is its bitmap extension and two arrays, which its swap walks and no
    // further: a limit at three times its price, with the budget to reach it, used to fail the cook
    // (`NotEnoughTickArrayAccount`); it stops a tick inside the window, the pool's price exactly the
    // window's bound.
    const wide = allIn(PANCAKE, false) * 3n;
    const bound = windowBound(PANCAKE, false);
    expect(ownLimit(PANCAKE, wide, false)).toBeGreaterThan(bound);
    const alone = succeeded(
      await cook({
        budget: 10_000_000n * 10n ** 6n,
        priceLimit: wide,
        edit: emptied(RAYDIUM, BYREAL),
      }),
    );
    expect(alone.bought).toBeGreaterThan(0n);
    expect(priceOf(PANCAKE)).toBe(bound);
  }, 120_000);

  it("gives the deepest pool its whole walk, holds the next within what is left, and skips the shallowest", async () => {
    // At 1.1 times the dearest pool's price the three pools' walks cost more compute units than the
    // cook has: with no stops it runs out and fails. The deepest pool, Raydium's, walks its whole
    // way; Byreal's is held a tick inside the first initialized tick what is left does not pay to
    // cross; PancakeSwap's, the shallowest, is left too little for its swap and is skipped, its price
    // where it was.
    const wide = (dearest * 11000n) / 10000n;
    const budget = 10_000_000n * 10n ** 6n;
    const unheld = await cook({
      budget,
      priceLimit: wide,
      unheld: true,
    });
    expect(!unheld.ok && unheld.logs.some((line) => line.includes("exceeded CUs meter"))).toBe(
      true,
    );
    const outcome = succeeded(await cook({ budget, priceLimit: wide }));
    const of = (p: Pool) => outcome.stops!.stops.find((stop) => stop.pool === p.pool)!;
    expect([of(RAYDIUM).rank, of(BYREAL).rank, of(PANCAKE).rank]).toEqual([0, 1, 2]);
    expect(of(RAYDIUM).share).toBe(of(RAYDIUM).estimatedUnits);
    expect(of(RAYDIUM).stopTick).toBeUndefined();
    expect(of(BYREAL).stopTick).toBeDefined();
    expect(of(BYREAL).share).toBeLessThan(of(BYREAL).estimatedUnits);
    expect([of(PANCAKE).skipped, of(PANCAKE).stop]).toEqual([true, svmSkipStop(false)]);
    expect(priceOf(RAYDIUM)).toBe(ownLimit(RAYDIUM, wide, false));
    expect(priceOf(BYREAL)).toBeLessThan(ownLimit(BYREAL, wide, false));
    expect(priceOf(PANCAKE)).toBe(snapshotPrice(PANCAKE));
    expect(outcome.bought).toBeGreaterThan(0n);
    expect(outcome.units).toBeLessThan(1_400_000n);
  }, 120_000);

  it("finds Orca's pool on its adaptive fee tier by that tier, and skips it at a price", async () => {
    // Fee tier 1025 is an adaptive fee at tick spacing 64: the spacing alone is the static tier's
    // pool, which the pair does not have, and the tier after it is this one.
    const data = BYTES.get(ORCA.pool)!;
    expect([le(data, 41, 2), le(data, 43, 2)]).toEqual([64n, 1025n]);
    const orca =
      "  bought += Orca.Whirlpool.swap(\n" +
      "    Orca.Whirlpool.pool(USDC, SPCX_US, 64, 1025),\n" +
      "    USDC,\n    SPCX_US,\n    self.USDC - kept,\n    priceLimit,\n    0,\n  );\n";
    const at = source.indexOf("  bought += Byreal.CLMM.swap(");
    const withOrcaSource = `${source.slice(0, at)}${orca}${source.slice(at)}`;
    const withOrca = compileSauceProgram("solana", withOrcaSource);
    expect(Object.values(withOrca.derivedAccounts!)).toContain(
      "slot:Orca.Whirlpool(USDC,SPCX_US,64,1025):USDC.pool",
    );
    // Its accounts read from the pool and named in the cook, its fee more than one rate: it trades
    // nothing, and the order is the program's without it.
    const budget = 1_000_000n * 10n ** 6n;
    const plain = succeeded(await cook({ budget, priceLimit }));
    const tried = succeeded(await cook({ budget, priceLimit, source: withOrcaSource }));
    expect(priceOf(ORCA)).toBe(snapshotPrice(ORCA));
    expect([tried.spent, tried.bought, tried.unspent]).toEqual([
      plain.spent,
      plain.bought,
      plain.unspent,
    ]);
  }, 180_000);

  it("reverts below minTokens and above maxAvgPrice", async () => {
    const budget = 1_000n * 10n ** 6n;
    const simulated = succeeded(await cook({ budget, priceLimit }));
    expect(refused(await cook({ budget, priceLimit, minTokens: simulated.bought + 1n }))).toBe(
      "bought below minTokens",
    );
    const average = (simulated.spent * E18) / simulated.bought;
    expect(refused(await cook({ budget, priceLimit, maxAvgPrice: average - 1n }))).toBe(
      "average too high",
    );
    // At the average, both checks pass.
    succeeded(
      await cook({
        budget,
        priceLimit,
        minTokens: simulated.bought,
        maxAvgPrice: average + 1n,
      }),
    );
  }, 180_000);

  it("keeps what was bought and the rest of the budget in the Pot when the recipient is the Pot", async () => {
    const budget = 1_000_000n * 10n ** 6n;
    const outcome = succeeded(await cook({ budget, priceLimit, kept: 7n, keepInPot: true }));
    expect(outcome.bought).toBeGreaterThan(0n);
    expect(outcome.unspent).toBeGreaterThan(0n);
    // The Pot holds what it bought, and its USDC is the rest of the budget and its own 7.
    expect(outcome.kept).toBe(outcome.bought);
    expect(outcome.left).toBe(outcome.unspent + 7n);
  }, 120_000);

  it("refuses a budget not in the Pot, and a recipient's account another wallet holds", async () => {
    const budget = 1_000n * 10n ** 6n;
    expect(refused(await cook({ budget, priceLimit, short: true }))).toBe(
      "budget is not in the Pot",
    );
    // The transfer is refused after it, by the check that binds the account to the recipient.
    expect(refused(await cook({ budget, priceLimit, strangerRecipient: true }))).toBe(
      "wrong recipient account",
    );
  }, 120_000);
});
