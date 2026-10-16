/**
 * The `sauce-solana-distributed-swap` skill's program, executed: staged and cooked through the
 * released Kitchen on the harness Pot, against the venues' own mainnet programs and the pools'
 * mainnet accounts (`test/fixtures/svm-venue-programs/`, written by `scripts/dump-svm-venues.mjs`).
 * The program finds its pools by key (`Orca.Whirlpool.pool(USDC, WSOL, spacing)`), and every account
 * it names is derived (`derivedAccounts`): each is resolved here as the command resolves it, by
 * `resolveSvmAccountName` reading the bank, so a key with no pool in the fixture is an empty slot.
 * It proves what the skill says the program does: one exact-input order split over the pools its keys
 * find, each stopping exactly at its own fee-adjusted limit; a key with no pool, a pool past its
 * limit, an empty pool and a remainder of dust skipped; the minimum-output and average-price checks;
 * what was bought and what is left of the budget sent to the recipient, and the Pot's other balance
 * untouched; both kept in the Pot when the recipient is the Pot; and the refusals of a budget the Pot
 * does not hold and a recipient's account another wallet holds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AccountRole } from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
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
import type { OwnedAccountLoader } from "../../src/svm/venues/types.js";
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
  ownLimit,
  pool,
  restoreVenues,
  SYSTEM,
  TOKEN,
  USDC,
  WSOL,
} from "./venue-fixture.js";
import type { Pool } from "./venue-fixture.js";

/** The skill's program. */
const PROGRAM = fileURLToPath(
  new URL(
    "../../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
);

/** The pools of the program's keys the fixture holds, in the program's order; its other keys find
 *  none there. */
const ORCA = pool("orca-whirlpool-sol-usdc");
const RAYDIUM = pool("raydium-clmm-sol-usdc");
const FOUND = [ORCA, RAYDIUM];

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
  /** Bytes to change in an account before the cook, for one case: a pool emptied. */
  edit?: { address: Address; offset: number; bytes: number[] };
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
      /** The Pot's WSOL: nothing, unless the recipient is the Pot. */
      kept: bigint;
      /** The Pot's USDC after the cook. */
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
  let harness: EngineHarness;
  let nonce = 0n;

  beforeAll(async () => {
    // A little after the snapshot: a whirlpool refuses a clock before its last update.
    harness = await startEngine(BigInt(manifest.unixTimestamp) + 60n);
    loadVenues(harness.svm);
  }, 120_000);

  /** The bank's accounts, as the command reads the cluster's. */
  const load: OwnedAccountLoader = async (at) => {
    const account = harness.svm.getAccount(at);
    return account.exists ? { data: account.data, owner: account.programAddress } : null;
  };

  const cook = async (order: Order): Promise<Outcome> => {
    restoreVenues(harness.svm, order.edit);
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
    const potBuy = setTokenAccount(harness, await ata(harness.pot, WSOL), WSOL, harness.pot, 0n);
    const to = order.keepInPot ? harness.pot : randomAddress();
    const recipient = order.keepInPot
      ? potBuy
      : setTokenAccount(
          harness,
          await ata(to, WSOL),
          WSOL,
          order.strangerRecipient ? randomAddress() : to,
          0n,
        );
    const refund = order.keepInPot
      ? potPay
      : setTokenAccount(harness, await ata(to, USDC), USDC, to, 0n);

    // Each account the program names, from its derivation, as the command resolves it.
    const slots = new Map<string, Promise<SvmSlot>>();
    const derived = program.derivedAccounts as Readonly<Record<string, string>>;
    const tail = await Promise.all(
      program.manifest!.accounts.map(async (entry) => {
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
        // The Kitchen signs for the Pot; the System program, which stands in for every account a
        // slot does not use, is never writable.
        const writable = entry.requires === "writable" && at !== SYSTEM;
        return { address: at, role: writable ? AccountRole.WRITABLE : AccountRole.READONLY };
      }),
    );

    // The cook carries the program and its arguments staged in a code buffer, and its accounts
    // through a lookup table: as `sauce run` stages a program too large for one transaction. An
    // `Address` argument is its key's 32 bytes, one word, as the command encodes it.
    const keyed = {
      ...program,
      entryParams: program.entryParams.map((param) => ({
        ...param,
        type: param.type.replace(/\bAddress\b/g, "Uint256"),
      })),
    };
    const args = encodeEntryArguments(keyed, [
      order.budget,
      order.priceLimit,
      order.minTokens ?? 0n,
      order.maxAvgPrice ?? 0n,
      word(to),
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
        `two pools found: ${outcome.units} compute units, ${outcome.size}-byte transaction, ` +
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
    expect(priceOf(ORCA)).not.toBe(snapshotPrice(ORCA));
    expect(priceOf(RAYDIUM)).toBe(snapshotPrice(RAYDIUM));
  }, 120_000);

  it("skips a pool past its limit, an empty pool, and a remainder of dust, and completes", async () => {
    const budget = 1_000_000n * 10n ** 6n;
    // A limit between the two pools' prices: the dearer sits out.
    const [cheaper, dearer] = [...FOUND].sort((a, b) =>
      allIn(a, false) < allIn(b, false) ? -1 : 1,
    ) as [Pool, Pool];
    const between = (allIn(cheaper, false) + allIn(dearer, false)) / 2n;
    expect(allIn(cheaper, false)).toBeLessThan(between);
    expect(allIn(dearer, false)).toBeGreaterThan(between);
    const one = succeeded(await cook({ budget, priceLimit: between }));
    expect(priceOf(cheaper)).toBe(ownLimit(cheaper, between, false));
    expect(priceOf(dearer)).toBe(snapshotPrice(dearer));
    expect(one.bought).toBeGreaterThan(0n);

    // Orca's pool emptied (no liquidity at its price): Raydium takes the order alone.
    const emptied = {
      address: ORCA.pool,
      offset: LAYOUT[ORCA.venue]!.liquidity,
      bytes: Array(16).fill(0),
    };
    const alone = succeeded(await cook({ budget, priceLimit, edit: emptied }));
    expect(priceOf(ORCA)).toBe(snapshotPrice(ORCA));
    expect(priceOf(RAYDIUM)).toBe(ownLimit(RAYDIUM, priceLimit, false));
    expect(alone.bought).toBeGreaterThan(0n);

    // What Orca's pool takes on its own, and one atom more: Raydium's pool is offered one atom of
    // USDC, which its fee takes whole, so it buys nothing there, and is skipped rather than the cook
    // reverted.
    const orcaAlone = succeeded(
      await cook({
        budget,
        priceLimit,
        edit: {
          address: RAYDIUM.pool,
          offset: LAYOUT[RAYDIUM.venue]!.liquidity,
          bytes: Array(16).fill(0),
        },
      }),
    );
    const dust = succeeded(await cook({ budget: orcaAlone.spent + 1n, priceLimit }));
    expect(dust.spent).toBe(orcaAlone.spent);
    expect(dust.bought).toBe(orcaAlone.bought);
    expect(dust.unspent).toBe(1n);
    expect(dust.refunded).toBe(1n);
    expect(priceOf(RAYDIUM)).toBe(snapshotPrice(RAYDIUM));
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
