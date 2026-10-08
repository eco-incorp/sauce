/**
 * The machinery `svm-exact-in.e2e.test.ts` runs every exact-input venue through: a LiteSVM bank
 * with the released engine and Kitchen, the venue's mainnet program and its pool's mainnet accounts,
 * a program calling one `@sauce/router` function cooked on the harness Pot, and what the cook did —
 * what the recipient received, what the paying account paid, the venue's own instruction as the
 * engine sent it, and the compute units the cook and the venue each used.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  AccountRole,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  lamports,
} from "@solana/kit";
import type { Address, AddressesByLookupTableAddress, Instruction } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { FailedTransactionMetadata } from "litesvm";

import { encodeEntryArguments } from "../../../src/routes/entry.js";
import { compileSauceProgram } from "../../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildExecuteTransaction,
  buildHeapFramePrepend,
} from "../../../src/svm/index.js";
import {
  fabricateAlt,
  HARNESS_POT_SALT,
  loadFixtureAccounts,
  randomAddress,
  setTokenAccount,
  stageProgram,
  startEngine,
  tokenAmount,
} from "../../svm/engine-harness.js";
import type { EngineHarness } from "../../svm/engine-harness.js";
import { loadFixtures } from "../../svm/fixtures.js";
import { svmExactInProgramCalling, svmInstructionProgram } from "./harness.js";

export type Compiled = ReturnType<typeof compileSauceProgram>;

const FIXTURES = new URL("../../svm/fixtures/", import.meta.url);
const PROGRAMS = new URL("../../fixtures/svm-exact-in-programs/", import.meta.url);

export const SYSTEM = "11111111111111111111111111111111" as Address;
export const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
export const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as Address;
const WSOL = "So11111111111111111111111111111111111111112" as Address;

/** One slot account: where it is, and whether the venue writes it. */
export interface SlotAccount {
  address: Address;
  writable?: boolean;
}

/** One account of a `Cpi` form's list: an address, or the trade's own paying or receiving account
 *  or authority. */
export type CpiAccount = {
  address: Address | "source" | "recipient" | "authority";
  writable?: boolean;
};

/** One trade at one pool, as a venue's case gives it: a slot, or a `Cpi` form's program and list. */
export interface Trade {
  slot: SlotAccount[];
  cpi?: { program: Address; accounts: CpiAccount[] };
  pay: Address;
  buy: Address;
  amountIn: bigint;
  minOut?: bigint;
  /** The token programs of the paying and the receiving accounts, Tokenkeg unless named. */
  payProgram?: Address;
  buyProgram?: Address;
  /** What the paying account holds beyond `amountIn`. */
  spare?: bigint;
  /** The paying and receiving accounts at the authority's associated addresses, for a venue that
   *  requires them. */
  ata?: boolean;
  /** The authority attached writable, for a venue whose swap writes it. */
  authorityWritable?: boolean;
  /** The two mints attached writable, for a venue whose swap writes them. */
  mintsWritable?: boolean;
}

export type Outcome =
  | {
      ok: true;
      returned: bigint;
      received: bigint;
      paid: bigint;
      /** The venue's own instruction, as the engine invoked it. */
      call?: { program: Address; data: string; accounts: Address[] };
      /** The whole cook's compute units; the engine's, the venue's call included; the venue's. */
      cu: bigint;
      engineCu: bigint;
      venueCu: bigint;
      source: Address;
      recipient: Address;
    }
  | { ok: false; reason: string; logs: string[] };

const compiledPrograms = new Map<string, Compiled>();
const compiledOnce = (source: string): Compiled => {
  let program = compiledPrograms.get(source);
  if (program === undefined) {
    program = compileSauceProgram("solana", source);
    compiledPrograms.set(source, program);
  }
  return program;
};

/** The slot form `name` compiled into a program calling it once on a slot of `length` accounts; ""
 *  is the same program calling nothing, the base a slot form's compute units sit on. */
export const compiled = (name: string, length: number): Compiled =>
  compiledOnce(svmExactInProgramCalling(name, length));

/** A program sending venue `base`'s instruction once on a list of `length` accounts, through its
 *  `Cpi` or `Data` form, written by hand around the amount (`baked.prefix`, `baked.suffix`), or not
 *  at all; `baked` writes the arguments it names as literals. See `svmInstructionProgram`. */
export const instruction = (
  form: "Cpi" | "Data" | "hand" | "none",
  base: string,
  length: number,
  baked: Readonly<Record<string, string>> = {},
): Compiled => compiledOnce(svmInstructionProgram(form, base, length, baked));

/** A venue program's ELF, gzipped in the fixture directory. */
export const venueProgram = (file: string): Uint8Array =>
  new Uint8Array(gunzipSync(readFileSync(new URL(file, PROGRAMS))));

const MANIFEST = JSON.parse(readFileSync(new URL("manifest.json", PROGRAMS), "utf8")) as {
  programs: { name: string; programId: Address; file: string; sha256: string }[];
};

/** A dumped program's id, by its name in the fixture's manifest. */
export const venueProgramId = (name: string): Address => {
  const entry = MANIFEST.programs.find((program) => program.name === name);
  if (entry === undefined) throw new Error(`no program ${name} in the fixture`);
  return entry.programId;
};

/** Every account a venue's fixture placed, as it was before any cook: each cook starts from it. */
const snapshots = new WeakMap<EngineHarness, Address[]>();
const saved = new WeakMap<EngineHarness, ReturnType<EngineHarness["svm"]["getAccount"]>[]>();

/** Boots the engine at `clock` with the venue's programs and the accounts of `dirs`. */
export const boot = async (
  clock: bigint,
  dirs: readonly string[],
  programs: readonly [Address, string][],
): Promise<EngineHarness> => {
  const harness = await startEngine(clock);
  const placed: Address[] = [];
  for (const dir of dirs) {
    const fixtures = loadFixtures(new URL(dir, FIXTURES).pathname);
    loadFixtureAccounts(harness, fixtures);
    placed.push(...fixtures.map((fixture) => fixture.address as Address));
  }
  // A wrapped-SOL account holds its amount in lamports too, which a fixture loaded at the rent
  // minimum lacks: an account paying wrapped SOL out of it would fall below rent.
  for (const at of placed) {
    const account = harness.svm.getAccount(at);
    if (
      account.exists &&
      account.programAddress === TOKEN &&
      account.data.length === 165 &&
      getAddressDecoder().decode(account.data.subarray(0, 32)) === WSOL &&
      account.data[108 + 1] === 1
    ) {
      const amount = new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(
        64,
        true,
      );
      const rent = harness.svm.minimumBalanceForRentExemption(165n);
      harness.svm.setAccount({ ...account, lamports: lamports(rent + amount) });
    }
  }
  for (const [id, file] of programs) harness.svm.addProgram(id, venueProgram(file));
  snapshots.set(harness, placed);
  freeze(harness);
  return harness;
};

/** Records the state every cook starts from: the fixture's accounts as they were, and the accounts
 *  the case placed since, as they are now. */
export const freeze = (harness: EngineHarness, extra: readonly Address[] = []): void => {
  const fresh = extra.map((at) => harness.svm.getAccount(at));
  restore(harness);
  for (const account of fresh) if (account.exists) harness.svm.setAccount(account);
  const placed = [...new Set([...(snapshots.get(harness) ?? []), ...extra])];
  snapshots.set(harness, placed);
  saved.set(
    harness,
    placed.map((at) => harness.svm.getAccount(at)),
  );
};

function restore(harness: EngineHarness): void {
  for (const account of saved.get(harness) ?? [])
    if (account.exists) harness.svm.setAccount(account);
}

/** Writes `bytes` at `offset` into a frozen account, so every cook starts from it, and returns what
 *  puts the account back. */
export const editFrozen = (
  harness: EngineHarness,
  at: Address,
  offset: number,
  bytes: readonly number[],
): (() => void) => {
  restore(harness);
  const before = harness.svm.getAccount(at);
  if (!before.exists) throw new Error(`no account ${at} to edit`);
  const data = new Uint8Array(before.data);
  data.set(bytes, offset);
  harness.svm.setAccount({ ...before, data });
  freeze(harness, [at]);
  return () => {
    harness.svm.setAccount(before);
    freeze(harness, [at]);
  };
};

let nonce = 0n;

/** A transaction's account keys in the order its instructions index them: the static keys, then
 *  the lookup tables' writable entries, then their read-only ones. */
const decodeKeys = (wire: Uint8Array, lookupTables: AddressesByLookupTableAddress): Address[] => {
  const transaction = getTransactionDecoder().decode(wire);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys = [...message.staticAccounts];
  const lookups = "addressTableLookups" in message ? (message.addressTableLookups ?? []) : [];
  const writable: Address[] = [];
  const readonly: Address[] = [];
  for (const lookup of lookups) {
    const table = lookupTables[lookup.lookupTableAddress]!;
    for (const i of lookup.writableIndexes) writable.push(table[i]!);
    for (const i of lookup.readonlyIndexes) readonly.push(table[i]!);
  }
  return [...keys, ...writable, ...readonly];
};

/**
 * Cooks `program` on `trade`: a fresh paying account holding `amountIn` (and `spare`), a fresh
 * recipient, both the Pot's, the slot's accounts attached with their roles, through a lookup table
 * as `sauce run` cooks a staged program.
 */
export const cook = async (
  harness: EngineHarness,
  program: Compiled,
  trade: Trade,
  venue: Address,
): Promise<Outcome> => {
  restore(harness);
  const spare = trade.spare ?? 7n;
  const at = async (mint: Address, program: Address): Promise<Address> =>
    trade.ata === true
      ? (await findAssociatedTokenPda({ owner: harness.pot, mint, tokenProgram: program }))[0]
      : randomAddress();
  const payProgram = trade.payProgram ?? TOKEN;
  const buyProgram = trade.buyProgram ?? TOKEN;
  const source = setTokenAccount(
    harness,
    await at(trade.pay, payProgram),
    trade.pay,
    harness.pot,
    trade.amountIn + spare,
    payProgram,
  );
  const recipient = setTokenAccount(
    harness,
    await at(trade.buy, buyProgram),
    trade.buy,
    harness.pot,
    0n,
    buyProgram,
  );
  const w = AccountRole.WRITABLE;
  const r = AccountRole.READONLY;
  const named: Record<string, { address: Address; role: AccountRole }> = {
    authority: { address: harness.pot, role: trade.authorityWritable === true ? w : r }, // the Kitchen signs for the Pot
    source: { address: source, role: w },
    payMint: { address: trade.pay, role: trade.mintsWritable === true ? w : r },
    buyMint: { address: trade.buy, role: trade.mintsWritable === true ? w : r },
    tokenProgram: { address: TOKEN, role: r },
    token2022: { address: TOKEN_2022, role: r },
    memo: { address: MEMO, role: r },
    recipient: { address: recipient, role: w },
  };
  trade.slot.forEach((account, i) => {
    named[`s${i}`] = { address: account.address, role: account.writable === true ? w : r };
  });
  if (trade.cpi !== undefined) {
    named.program = { address: trade.cpi.program, role: r };
    trade.cpi.accounts.forEach((account, i) => {
      const at = account.address;
      const address =
        at === "source"
          ? source
          : at === "recipient"
            ? recipient
            : at === "authority"
              ? harness.pot
              : at;
      named[`a${i}`] = { address, role: account.writable === true ? w : r };
    });
  }
  const tail = program.manifest!.accounts.map((entry) => {
    if (entry.kind !== "slot") throw new Error("the program takes no remaining accounts");
    const meta = named[entry.name];
    if (meta === undefined) throw new Error(`no account for ${entry.name}`);
    return meta;
  });
  const args = encodeEntryArguments(
    program,
    program.entryParams.map((param) =>
      param.name === "amountIn"
        ? trade.amountIn
        : param.name === "minOut"
          ? (trade.minOut ?? 0n)
          : 0n,
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
  const lookupTables = fabricateAlt(harness, keys);
  harness.svm.expireBlockhash();
  const transaction = await buildExecuteTransaction({
    payer: harness.payer,
    instructions,
    latestBlockhash: { blockhash: harness.svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n },
    lookupTables,
  });
  const result = harness.svm.sendTransaction(transaction);
  if (result instanceof FailedTransactionMetadata) {
    return {
      ok: false,
      reason: new TextDecoder().decode(result.meta().returnData().data()),
      logs: [String(result.err()), ...result.meta().logs()],
    };
  }
  const wire = new Uint8Array(getTransactionEncoder().encode(transaction));
  const all = decodeKeys(wire, lookupTables);
  const inner = result.innerInstructions().flat();
  const venueCall = inner
    .map((entry) => entry.instruction())
    .find((ix) => all[ix.programIdIndex()] === venue);
  const consumed = (program: Address): bigint =>
    result
      .logs()
      .map((line) => line.match(/^Program (\w+) consumed (\d+) of/))
      .filter((match): match is RegExpMatchArray => match !== null && match[1] === program)
      .reduce((sum, match) => sum + BigInt(match[2]!), 0n);
  return {
    ok: true,
    returned: BigInt(
      `0x${Buffer.from(result.returnData().data().subarray(0, 32)).toString("hex")}`,
    ),
    received: tokenAmount(harness, recipient),
    paid: trade.amountIn + spare - tokenAmount(harness, source),
    ...(venueCall === undefined
      ? {}
      : {
          call: {
            program: venue,
            data: Buffer.from(venueCall.data()).toString("hex"),
            accounts: [...venueCall.accounts()].map((i) => all[i]!),
          },
        }),
    cu: result.computeUnitsConsumed(),
    engineCu: consumed(harness.programId),
    venueCu: consumed(venue),
    source,
    recipient,
  };
};

export const succeeded = (outcome: Outcome): Extract<Outcome, { ok: true }> => {
  if (!outcome.ok)
    throw new Error(`the cook failed: ${outcome.reason}\n${outcome.logs.join("\n")}`);
  return outcome;
};

export const refused = (outcome: Outcome): string => {
  if (outcome.ok) throw new Error("the cook succeeded; expected a refusal");
  return outcome.reason;
};

/** A 32-byte public key read from an account's data. */
export const keyAt = (harness: EngineHarness, at: Address, offset: number): Address => {
  const account = harness.svm.getAccount(at);
  if (!account.exists) throw new Error(`no account ${at}`);
  return getAddressDecoder().decode(account.data.subarray(offset, offset + 32));
};
