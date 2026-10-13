/**
 * A Solana cook as a plan of steps, for a signer that is not this process — and the one path the
 * command's own sends take too (`sauce run`, a wallet's `sauce_wallet_send`).
 *
 * A cook too large for one transaction runs from a code buffer the program is staged into first,
 * its accounts perhaps through a lookup table; a Pot or a token account it names may need creating.
 * The plan has three steps:
 *
 *   setup  everything the cook needs on the cluster, in order: the Pot (where it cannot ride in
 *          the cook's own transaction), the token accounts, the code buffer created and grown, the
 *          program written into it chunk by chunk and finalized, the lookup table created and
 *          extended;
 *   cook   built once the setup is there: the table past its warm-up slot, the compute limit from
 *          a rehearsal of the cook itself;
 *   close  the code buffer closed, its rent back to the owner.
 *
 * Every transaction is signed by the owner alone, who pays for it: the buffer, its code account,
 * the Pot, the token accounts and the table are all addresses derived from the owner (and a nonce,
 * a salt, a slot), so no step needs a fresh keypair.
 *
 * A step is built from the plan and from what the cluster shows NOW: what landed is skipped, what
 * did not is built again — a chunk is written only where the code account does not hold its bytes
 * yet — so a signer slow enough to let a blockhash expire re-signs only what is left, and progress
 * never goes back. The plan is carried between calls as a cursor (`encodeCursor`): what the steps
 * are built from, and what was handed out since — never a key, and never an endpoint. A cook is
 * never built again while one handed out can still land (its blockhash's last valid block height),
 * and, staged, not once the code account shows a cook landed.
 */
import { createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import {
  type AccountRole,
  address,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionSize,
  isAddress,
  isSignerRole,
  TRANSACTION_SIZE_LIMIT,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
  type Signature,
  type SignatureBytes,
  type Transaction,
  type TransactionPartialSigner,
  type TransactionSigner,
  createSolanaRpc,
} from "@solana/kit";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  fetchMaybeAddressLookupTable,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../deployments/index.js";
import {
  buildAtaPrepend,
  buildCloseCodeBufferInstruction,
  buildComputeBudgetPrepend,
  buildCookAndPayFromAccountPinnedInstruction,
  buildCookAndPayInstruction,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildHeapFramePrepend,
  buildWriteCodeBufferInstruction,
  COOK_AND_PAY_DISCRIMINATOR,
  COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR,
  type CookVia,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  ENGINE_GAS_LIMIT_CU,
  fetchExecutionFee,
  GROWTH_STEP,
  KITCHEN_DISCRIMINATORS,
  LOOKUP_TABLE_MAX_ADDRESSES,
  lookupTableBatches,
  MAX_CODE_LEN,
  MAX_POT_LEN,
  recommendedComputeUnitLimit,
} from "../svm/index.js";
import { CliError, UsageError } from "./args.js";
import { failureReason } from "./solana.js";
import { messageAccounts } from "./svm-effects.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

const kitchen = (): Address => address(v12SvmKitchenProgramId());
const engine = (): Address => address(v12SvmEngineProgramId());

/** One account of the cook's own tail: the program's accounts, after the Kitchen's named ones. */
export interface PlanAccount {
  readonly address: Address;
  readonly role: AccountRole;
}

/** A holder's associated token account the cook names that the plan creates where it is missing. */
export interface PlanTokenAccount {
  readonly address: Address;
  readonly holder: Address;
  readonly mint: Address;
  readonly program: Address;
  /** What it is, for a person: "the Pot's USDC account". */
  readonly label: string;
}

/** What every step of a plan is built from, and what was handed out since: the cursor's content. */
export interface SvmPlan {
  readonly owner: Address;
  readonly salt: Hex;
  readonly via: CookVia;
  /** The most the cook may pay in execution fee (`--max-execution-fee`). */
  readonly maxExecutionFee?: bigint;
  readonly tail: readonly PlanAccount[];
  /** Lookup tables the caller gave (`--lookup-table`). */
  readonly lookupTables: readonly Address[];
  /**
   * The Pot, as the plan was made: there already; to be created in the cook's own transaction,
   * ahead of the cook; or in the setup, where the two do not fit in one. Read again at each step.
   */
  readonly pot: "there" | "inline" | "setup";
  readonly tokenAccounts: readonly PlanTokenAccount[];
  /** The program and its arguments: carried until it is staged (and always, unstaged). */
  readonly payload?: Uint8Array;
  /** Staged: the code buffer's nonce, and the payload's digest and length. */
  readonly staged?: {
    readonly nonce: bigint;
    readonly sha256: Uint8Array;
    readonly length: number;
  };
  /** The lookup table the plan creates, for the addresses it must hold; its address once chosen. */
  readonly table?: {
    readonly addresses: readonly Address[];
    readonly address?: Address;
    readonly recentSlot?: bigint;
  };
  /** The type `main` declares it returns, to read what a cook returned. */
  readonly returnType?: string;
  /** Names for the accounts a cook writes, for what it moved. */
  readonly labels: readonly (readonly [string, string])[];
  /**
   * The cook was handed out: the blockhash it was built on, the last block height that blockhash
   * is valid to, and the slot it was read at, which no landing of it can precede.
   */
  readonly cook?: CookHandedOut;
  /** The cook landed: whether it succeeded, and where. */
  readonly cooked?: { readonly ok: boolean; readonly signature: string };
  /** The plan gave up on its cook: what is left is the code buffer's close. */
  readonly closing?: boolean;
}

/** A cook handed out to a signer, as the plan remembers it. */
export interface CookHandedOut {
  readonly blockhash: string;
  readonly lastValidBlockHeight: bigint;
  readonly slot: bigint;
}

/** What a step's transaction does, by kind. */
export type PlanTxKind =
  "pot" | "accounts" | "buffer" | "write" | "finalize" | "table" | "cook" | "close";

/** One transaction of a step: its instructions, and the tables they are compressed against. */
export interface PlanTx {
  readonly what: string;
  readonly kind: PlanTxKind;
  readonly instructions: readonly Instruction[];
  readonly lookupTables?: AddressesByLookupTableAddress;
  /** The token accounts it creates (`accounts`). */
  readonly accounts?: readonly PlanTokenAccount[];
  /** It creates the Pot ahead of the cook (`cook`). */
  readonly createsPot?: boolean;
}

/** One stage of the plan, for a person: what it does, and whether it is done. */
export interface PlanStage {
  readonly step: "setup" | "cook" | "close";
  readonly what: string;
  readonly state: "done" | "next" | "later" | "given up";
}

export interface PlanStep {
  readonly name: "setup" | "cook" | "close" | "done";
  readonly transactions: readonly PlanTx[];
  /** The plan to carry on from, with what the cluster showed folded in. */
  readonly plan: SvmPlan;
  readonly overview: readonly PlanStage[];
  readonly notes: readonly string[];
  /** Nothing to sign yet: why, and when to ask again. */
  readonly wait?: string;
  /** The cook's rehearsal failed: why, and its logs. It is built anyway, at the most compute. */
  readonly fails?: { readonly reason: string; readonly logs: readonly string[] };
  /** The execution fee the cook signs, in lamports. */
  readonly fee?: bigint;
  /** The endpoint did not simulate the cook: it is built at the most compute, unrehearsed. */
  readonly unrehearsed?: true;
}

/** Where a step is built: the cluster, and the signer each transaction is built for. */
export interface StepContext {
  readonly rpc: Rpc;
  readonly url: string;
  /** The owner: a real signer for a send of this process's, else one that signs nothing. */
  readonly signer: TransactionSigner;
  /** The Kitchen's execution fee, where the caller has just read it; else the cook reads it. */
  readonly fee?: bigint;
}

/** A signer that signs nothing: an all-zero signature, which a simulation ignores and a wallet
 *  replaces. What a plan for another signer is built with. */
export function unsignedSigner(owner: Address): TransactionPartialSigner {
  return {
    address: owner,
    signTransactions: async (transactions) =>
      transactions.map(() => ({ [owner]: new Uint8Array(64) as SignatureBytes })),
  };
}

/** An RPC request, failing with what was asked and never the URL (a provider URL holds a key). */
async function ask<T>(url: string, what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new CliError(`reading ${what} failed: ${message.split(url).join("<RPC_URL>")}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------------------------

const CURSOR_PREFIX = "sauce-plan-1.";
/** The most entries a cursor's list holds: a table's addresses, the cook's accounts. */
const LIST_MOST = 256;
/** The most token accounts or lookup tables a plan names, as a command takes them. */
const NAMED_MOST = 64;
/** The most a cursor may carry, decoded: a staged program at its largest, and its accounts. */
const CURSOR_MAX = 2 * MAX_CODE_LEN;

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const unb64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"));

/** The plan as an opaque string, to hand back for the next step. */
export function encodeCursor(plan: SvmPlan): string {
  const json = {
    owner: plan.owner,
    salt: plan.salt,
    via: plan.via,
    ...(plan.maxExecutionFee === undefined ? {} : { maxExecutionFee: `${plan.maxExecutionFee}` }),
    tail: plan.tail.map((meta) => [meta.address, meta.role]),
    lookupTables: plan.lookupTables,
    pot: plan.pot,
    tokenAccounts: plan.tokenAccounts.map((one) => [
      one.address,
      one.holder,
      one.mint,
      one.program,
      one.label,
    ]),
    ...(plan.payload === undefined ? {} : { payload: b64(plan.payload) }),
    ...(plan.staged === undefined
      ? {}
      : {
          staged: [`${plan.staged.nonce}`, bytesToHex(plan.staged.sha256), plan.staged.length],
        }),
    ...(plan.table === undefined
      ? {}
      : {
          table: {
            addresses: plan.table.addresses,
            ...(plan.table.address === undefined ? {} : { address: plan.table.address }),
            ...(plan.table.recentSlot === undefined
              ? {}
              : { recentSlot: `${plan.table.recentSlot}` }),
          },
        }),
    ...(plan.returnType === undefined ? {} : { returnType: plan.returnType }),
    labels: plan.labels,
    ...(plan.cook === undefined
      ? {}
      : {
          cook: [plan.cook.blockhash, `${plan.cook.lastValidBlockHeight}`, `${plan.cook.slot}`],
        }),
    ...(plan.cooked === undefined ? {} : { cooked: [plan.cooked.ok, plan.cooked.signature] }),
    ...(plan.closing === true ? { closing: true } : {}),
  };

  return CURSOR_PREFIX + b64(deflateRawSync(Buffer.from(JSON.stringify(json))));
}

/** A cursor `encodeCursor` made, read back; anything else is refused. */
export function decodeCursor(text: string): SvmPlan {
  const bad = (why: string): UsageError =>
    new UsageError(
      `cursor: ${why}; pass the cursor a step returned, whole (sauce tx or sauce send gives one)`,
    );
  if (!text.startsWith(CURSOR_PREFIX)) throw bad("not a plan's cursor");
  let raw: Record<string, unknown>;
  try {
    const inflated = inflateRawSync(unb64(text.slice(CURSOR_PREFIX.length)), {
      maxOutputLength: CURSOR_MAX * 2,
    });
    raw = JSON.parse(inflated.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw bad("it does not decode");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw bad("not a plan");
  const key = (value: unknown, what: string): Address => {
    if (typeof value !== "string" || !isAddress(value)) throw bad(`${what} is not an address`);

    return value;
  };
  const integer = (value: unknown, what: string): bigint => {
    if (typeof value !== "string" || !/^\d{1,30}$/.test(value))
      throw bad(`${what} is not an integer`);

    return BigInt(value);
  };
  const list = (value: unknown, what: string, most = LIST_MOST): unknown[] => {
    if (!Array.isArray(value) || value.length > most) throw bad(`${what} is not a list`);

    return value;
  };
  const via = raw.via === "engine" ? "engine" : raw.via === "kitchen" ? "kitchen" : undefined;
  if (via === undefined) throw bad("via is neither kitchen nor engine");
  if (typeof raw.salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(raw.salt)) {
    throw bad("salt is not 32 bytes");
  }
  if (raw.pot !== "there" && raw.pot !== "inline" && raw.pot !== "setup") throw bad("pot");
  const tail = list(raw.tail, "tail").map((entry) => {
    const [at, role] = list(entry, "an account") as [unknown, unknown];
    if (typeof role !== "number" || ![0, 1, 2, 3].includes(role)) throw bad("an account's role");

    return { address: key(at, "an account"), role: role as AccountRole };
  });
  const tokenAccounts = list(raw.tokenAccounts, "tokenAccounts", NAMED_MOST).map((entry) => {
    const [at, holder, mint, program, label] = list(entry, "a token account");
    if (typeof label !== "string" || label.length > 200) throw bad("a token account's label");

    return {
      address: key(at, "a token account"),
      holder: key(holder, "a holder"),
      mint: key(mint, "a mint"),
      program: key(program, "a token program"),
      label,
    };
  });
  const payload = raw.payload === undefined ? undefined : unb64(String(raw.payload));
  if (payload !== undefined && (payload.length === 0 || payload.length > MAX_CODE_LEN)) {
    throw bad("payload");
  }
  let staged: SvmPlan["staged"];
  if (raw.staged !== undefined) {
    const [nonce, sha256, length] = list(raw.staged, "staged");
    if (typeof sha256 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(sha256)) throw bad("sha256");
    if (typeof length !== "number" || !Number.isInteger(length) || length < 1) throw bad("length");
    staged = { nonce: integer(nonce, "nonce"), sha256: hexToBytes(sha256 as Hex), length };
  }
  let table: SvmPlan["table"];
  if (raw.table !== undefined) {
    const given = raw.table as Record<string, unknown> | null;
    if (given === null || typeof given !== "object") throw bad("table");
    table = {
      addresses: list(given.addresses, "the table's addresses").map((at) => key(at, "an address")),
      ...(given.address === undefined ? {} : { address: key(given.address, "the table") }),
      ...(given.recentSlot === undefined
        ? {}
        : { recentSlot: integer(given.recentSlot, "recentSlot") }),
    };
  }
  const labels = list(raw.labels, "labels").map((entry) => {
    const [at, label] = list(entry, "a label");
    if (typeof at !== "string" || typeof label !== "string") throw bad("a label");

    return [at, label] as const;
  });
  const cookOf = ([blockhash, height, slot]: unknown[]): CookHandedOut => {
    if (typeof blockhash !== "string" || !isAddress(blockhash)) throw bad("the cook's blockhash");

    return {
      blockhash,
      lastValidBlockHeight: integer(height, "the cook's last valid block height"),
      slot: integer(slot, "the cook's slot"),
    };
  };
  let cooked: SvmPlan["cooked"];
  if (raw.cooked !== undefined) {
    const [ok, signature] = list(raw.cooked, "cooked");
    if (typeof ok !== "boolean" || typeof signature !== "string") throw bad("cooked");
    cooked = { ok, signature };
  }

  return {
    owner: key(raw.owner, "owner"),
    salt: raw.salt as Hex,
    via,
    ...(raw.maxExecutionFee === undefined
      ? {}
      : { maxExecutionFee: integer(raw.maxExecutionFee, "maxExecutionFee") }),
    tail,
    lookupTables: list(raw.lookupTables, "lookupTables", NAMED_MOST).map((at) =>
      key(at, "a lookup table"),
    ),
    pot: raw.pot,
    tokenAccounts,
    ...(payload === undefined ? {} : { payload }),
    ...(staged === undefined ? {} : { staged }),
    ...(table === undefined ? {} : { table }),
    ...(typeof raw.returnType === "string" ? { returnType: raw.returnType } : {}),
    labels,
    ...(raw.cook === undefined ? {} : { cook: cookOf(list(raw.cook, "cook", 3)) }),
    ...(cooked === undefined ? {} : { cooked }),
    ...(raw.closing === true ? { closing: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Making a plan
// ---------------------------------------------------------------------------------------------

/** A placeholder key, distinct per `index`, for a size estimate's blockhash and table. */
const placeholderKey = (index: number): Address =>
  getBase58Decoder().decode(new Uint8Array(32).fill(index + 1)) as Address;

const PLACEHOLDER_BLOCKHASH = {
  blockhash: placeholderKey(254) as unknown as Blockhash,
  lastValidBlockHeight: 0n,
};

/** Where a staged plan's program lives: the code buffer's metadata account and its code account. */
export async function planBuffer(
  plan: Pick<SvmPlan, "owner" | "staged">,
): Promise<{ codeBuffer: Address; code: Address } | undefined> {
  if (plan.staged === undefined) return undefined;
  const { address: codeBuffer } = await deriveCodeBufferPda(
    kitchen(),
    plan.owner,
    plan.staged.nonce,
  );
  const { address: code } = await deriveCodePda(kitchen(), codeBuffer);

  return { codeBuffer, code };
}

const potOf = async (plan: Pick<SvmPlan, "owner" | "salt">): Promise<Address> =>
  (await derivePotPda(kitchen(), plan.owner, hexToBytes(plan.salt))).address;

/** The Kitchen's `create_pot` for the plan's Pot, the owner paying its rent. */
async function createPotInstruction(plan: SvmPlan): Promise<Instruction> {
  return buildCreatePotInstruction({
    kitchen: kitchen(),
    owner: plan.owner,
    engineProgram: engine(),
    pot: await potOf(plan),
    salt: hexToBytes(plan.salt),
    space: MAX_POT_LEN,
  });
}

/** `plan.tail` with `signer` on each account that signs: the owner's, and one that signs nothing
 *  for any other (which its holder must sign). */
function tailFor(plan: SvmPlan, signer: TransactionSigner): Instruction["accounts"] {
  const others = new Map<string, TransactionSigner>();

  return plan.tail.map((meta) => {
    if (!isSignerRole(meta.role)) return meta;
    const by =
      meta.address === signer.address
        ? signer
        : (others.get(meta.address) ??
          others.set(meta.address, unsignedSigner(meta.address)).get(meta.address)!);

    return { ...meta, signer: by };
  });
}

/** The cook instruction: through the Kitchen or direct to the engine, the program inline or staged. */
async function cookInstruction(
  plan: SvmPlan,
  signer: TransactionSigner,
  fee: bigint,
): Promise<Instruction> {
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen());
  const tail = tailFor(plan, signer) as Parameters<typeof buildCookInstruction>[0]["tail"];
  const buffer = await planBuffer(plan);
  if (buffer !== undefined) {
    return plan.via === "engine"
      ? buildCookAndPayFromAccountPinnedInstruction({
          engineProgram: engine(),
          code: buffer.code,
          expectedSha256: plan.staged!.sha256,
          feeConfig,
          feePayer: plan.owner,
          maxExecutionFee: fee,
          tail,
        })
      : buildCookFromAccountInstruction({
          kitchen: kitchen(),
          owner: plan.owner,
          codeBuffer: buffer.codeBuffer,
          code: buffer.code,
          engineProgram: engine(),
          potSalt: hexToBytes(plan.salt),
          pot: await potOf(plan),
          feeConfig,
          maxExecutionFee: fee,
          tail,
        });
  }
  if (plan.payload === undefined) throw new Error("internal: an unstaged plan carries its payload");

  return plan.via === "engine"
    ? buildCookAndPayInstruction({
        engineProgram: engine(),
        feeConfig,
        feePayer: plan.owner,
        maxExecutionFee: fee,
        bytecode: plan.payload,
        tail,
      })
    : buildCookInstruction({
        kitchen: kitchen(),
        owner: plan.owner,
        engineProgram: engine(),
        potSalt: hexToBytes(plan.salt),
        pot: await potOf(plan),
        feeConfig,
        bytecode: plan.payload,
        maxExecutionFee: fee,
        tail,
      });
}

/** The cook's whole instruction list: the heap frame, the compute limit, the Pot where it rides
 *  along, the cook. */
async function cookInstructions(
  plan: SvmPlan,
  signer: TransactionSigner,
  fee: bigint,
  unitLimit: number,
  withPot: boolean,
): Promise<Instruction[]> {
  return [
    buildHeapFramePrepend(),
    ...buildComputeBudgetPrepend({ unitLimit }),
    ...(withPot ? [await createPotInstruction(plan)] : []),
    await cookInstruction(plan, signer, fee),
  ];
}

/** The size of a transaction of `instructions` from `plan`'s owner, through `tables`, offline. */
async function sizeOf(
  plan: SvmPlan,
  instructions: readonly Instruction[],
  tables?: AddressesByLookupTableAddress,
): Promise<number> {
  const transaction = await buildExecuteTransaction({
    payer: unsignedSigner(plan.owner),
    instructions,
    latestBlockhash: PLACEHOLDER_BLOCKHASH,
    ...(tables === undefined || Object.keys(tables).length === 0 ? {} : { lookupTables: tables }),
  });

  return getTransactionSize(transaction);
}

/**
 * The accounts of `transaction` a lookup table may hold: every account its message lists, less the
 * signers and the programs its instructions call, which a transaction must list itself.
 */
export function tableAddresses(transaction: Transaction): Address[] {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    header: { numSignerAccounts: number };
    staticAccounts: readonly Address[];
    instructions: readonly { programAddressIndex: number }[];
  };
  const called = new Set(
    message.instructions.map((instruction) => instruction.programAddressIndex),
  );

  return message.staticAccounts.filter(
    (_, index) => index >= message.header.numSignerAccounts && !called.has(index),
  );
}

export interface NewPlanInput {
  readonly owner: Address;
  readonly salt: Hex;
  readonly via: CookVia;
  readonly maxExecutionFee?: bigint;
  /** The program with its arguments appended: what the cook runs. */
  readonly payload: Uint8Array;
  readonly tail: readonly PlanAccount[];
  /** The tables the caller gave, as the cluster holds them. */
  readonly lookupTables: AddressesByLookupTableAddress;
  /** The Pot is not created yet (a Kitchen cook's). */
  readonly potMissing: boolean;
  readonly tokenAccounts: readonly PlanTokenAccount[];
  readonly returnType?: string;
  readonly labels: ReadonlyMap<string, string>;
}

/**
 * The plan for a cook: inline where the cook fits one transaction (the Pot created in it too,
 * where that fits), else staged — through the caller's tables, or a table the plan creates when
 * the staged cook's accounts do not fit without one. Sized offline, as the cook is sent: with the
 * heap frame and a compute-unit limit (any limit encodes to the same size).
 */
export async function newSvmPlan(input: NewPlanInput): Promise<SvmPlan> {
  const base: SvmPlan = {
    owner: input.owner,
    salt: input.salt,
    via: input.via,
    ...(input.maxExecutionFee === undefined ? {} : { maxExecutionFee: input.maxExecutionFee }),
    tail: input.tail,
    lookupTables: Object.keys(input.lookupTables) as Address[],
    pot: input.potMissing ? "setup" : "there",
    tokenAccounts: input.tokenAccounts,
    payload: input.payload,
    ...(input.returnType === undefined ? {} : { returnType: input.returnType }),
    labels: [...input.labels],
  };
  const signer = unsignedSigner(input.owner);
  const limit = ENGINE_GAS_LIMIT_CU;
  const inline = await sizeOf(
    base,
    await cookInstructions(base, signer, 0n, limit, false),
    input.lookupTables,
  );
  if (inline <= TRANSACTION_SIZE_LIMIT) {
    const withPot =
      input.potMissing &&
      input.via === "kitchen" &&
      (await sizeOf(
        base,
        await cookInstructions(base, signer, 0n, limit, true),
        input.lookupTables,
      )) <= TRANSACTION_SIZE_LIMIT;

    return { ...base, pot: withPot ? "inline" : base.pot };
  }
  const staged: SvmPlan = {
    ...base,
    staged: {
      nonce: randomBytes(8).readBigUInt64LE(0),
      sha256: new Uint8Array(createHash("sha256").update(input.payload).digest()),
      length: input.payload.length,
    },
  };
  const instructions = await cookInstructions(staged, signer, 0n, limit, false);
  if ((await sizeOf(staged, instructions, input.lookupTables)) <= TRANSACTION_SIZE_LIMIT) {
    return staged;
  }
  if (base.lookupTables.length > 0) {
    throw new CliError(
      `the staged cook is a ${await sizeOf(staged, instructions, input.lookupTables)}-byte ` +
        `transaction even through the lookup tables given, past Solana's ${TRANSACTION_SIZE_LIMIT}: ` +
        "give a table holding every account the cook names, or none and one is created",
    );
  }
  const addresses = tableAddresses(
    await buildExecuteTransaction({
      payer: signer,
      instructions,
      latestBlockhash: PLACEHOLDER_BLOCKHASH,
    }),
  );
  if (addresses.length > LOOKUP_TABLE_MAX_ADDRESSES) {
    throw new CliError(
      `the cook names ${addresses.length} accounts, more than one lookup table holds ` +
        `(${LOOKUP_TABLE_MAX_ADDRESSES})`,
    );
  }
  const through = await sizeOf(staged, instructions, { [placeholderKey(253)]: addresses });
  if (through > TRANSACTION_SIZE_LIMIT) {
    throw new CliError(
      `the staged cook is a ${through}-byte transaction even with every account it names in a ` +
        `lookup table, past Solana's ${TRANSACTION_SIZE_LIMIT}: it signs or calls too many`,
    );
  }

  return { ...staged, table: { addresses } };
}

// ---------------------------------------------------------------------------------------------
// What the cluster shows
// ---------------------------------------------------------------------------------------------

/** A CodeBuffer account: 8 discriminator bytes, owner, nonce, the digest, capacity, len, finalized. */
interface BufferState {
  readonly sha256: Uint8Array;
  readonly finalized: boolean;
  /** The code account's bytes. */
  readonly code: Uint8Array;
}

async function bufferState(ctx: StepContext, plan: SvmPlan): Promise<BufferState | undefined> {
  const buffer = await planBuffer(plan);
  if (buffer === undefined) return undefined;
  const { value } = await ask(ctx.url, "the code buffer", () =>
    ctx.rpc.getMultipleAccounts([buffer.codeBuffer, buffer.code], { encoding: "base64" }).send(),
  );
  const [meta, code] = value;
  if (meta === null || meta === undefined || meta.owner !== kitchen()) return undefined;
  const data = new Uint8Array(getBase64Encoder().encode(meta.data[0]));

  return {
    sha256: data.subarray(48, 80),
    finalized: data[88] === 1,
    code:
      code === null || code === undefined
        ? new Uint8Array()
        : new Uint8Array(getBase64Encoder().encode(code.data[0])),
  };
}

interface TableState {
  readonly addresses: readonly Address[];
  readonly lastExtendedSlot: bigint;
}

async function tableState(ctx: StepContext, table: Address): Promise<TableState | undefined> {
  const found = await ask(ctx.url, `lookup table ${table}`, () =>
    fetchMaybeAddressLookupTable(ctx.rpc, table),
  );
  if (!found.exists) return undefined;

  return { addresses: found.data.addresses, lastExtendedSlot: found.data.lastExtendedSlot };
}

async function exists(ctx: StepContext, account: Address, what: string): Promise<boolean> {
  const { value } = await ask(ctx.url, what, () =>
    ctx.rpc.getAccountInfo(account, { encoding: "base64" }).send(),
  );

  return value !== null;
}

/** A write's chunk: what a write transaction carries besides its signature, header and accounts. */
const CHUNK = 900;
/** Grow instructions in one transaction, well inside its size. */
const GROWS_PER_TRANSACTION = 40;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

// ---------------------------------------------------------------------------------------------
// The next step
// ---------------------------------------------------------------------------------------------

/**
 * The next step of `plan`, from what the cluster shows now. `close` gives up on the cook: the code
 * buffer is closed (when there is one), and the plan is done.
 */
export async function nextStep(
  plan: SvmPlan,
  ctx: StepContext,
  options: { readonly close?: boolean } = {},
): Promise<PlanStep> {
  if (ctx.signer.address !== plan.owner) {
    throw new UsageError(
      `the plan is the owner ${plan.owner}'s, and the signer is ${ctx.signer.address}`,
    );
  }
  const buffer = await planBuffer(plan);
  const state = buffer === undefined ? undefined : await bufferState(ctx, plan);
  const finalized =
    state !== undefined &&
    state.finalized &&
    plan.staged !== undefined &&
    sameBytes(state.sha256, plan.staged.sha256);
  if (state?.finalized === true && !finalized) {
    throw new CliError(
      `the code buffer ${buffer!.codeBuffer} is finalized over other bytes than this plan's: ` +
        "make a new plan",
    );
  }
  // Staged: the payload is no longer needed once the cluster holds it.
  let current: SvmPlan = finalized && plan.payload !== undefined ? withoutPayload(plan) : plan;
  // A cook handed out and not heard of since: never a second while it can still land, nor once
  // it has — and no close while it can still land.
  if (current.cook !== undefined && current.cooked === undefined) {
    const handed = current.cook;
    const height = await ask(ctx.url, "the block height", () =>
      ctx.rpc.getBlockHeight({ commitment: "confirmed" }).send(),
    );
    if (height <= handed.lastValidBlockHeight) {
      const name = options.close === true ? "close" : "cook";

      return {
        name,
        transactions: [],
        plan: current,
        overview: overview(current, name),
        notes: [],
        wait:
          `the cook handed out last can still land until block height ` +
          `${handed.lastValidBlockHeight} (now ${height}): send it, or give its signature if it ` +
          `was sent another way; ask again once that height has passed to have it ` +
          (options.close === true ? "given up" : "rebuilt"),
      };
    }
    const landed = await cookLanded(ctx, current.owner, handed);
    current = landed === undefined ? withoutCook(current) : { ...current, cooked: landed };
  }
  if (options.close === true || current.cooked !== undefined || current.closing === true) {
    return closeStep(
      options.close === true ? { ...current, closing: true } : current,
      ctx,
      state !== undefined,
    );
  }
  // Staged and finalized once (the plan let go of the program), and gone now: closed before its
  // cook ever ran.
  if (buffer !== undefined && state === undefined && current.payload === undefined) {
    throw new CliError(
      `the code buffer ${buffer.codeBuffer} is gone, and the plan's cook never ran: something ` +
        "closed it (sauce reclaim?). Make a new plan",
    );
  }
  const setup = await setupTransactions(current, ctx, state, finalized);
  if (setup.transactions.length > 0) {
    return {
      name: "setup",
      transactions: setup.transactions,
      plan: setup.plan,
      overview: overview(setup.plan, "setup"),
      notes: setup.notes,
    };
  }

  return cookStep(setup.plan, ctx);
}

/**
 * Every transaction `plan` has still to send, as the cluster shows it now: the whole setup that is
 * not there yet, then the cook, then the code buffer's close — the cook and the close by kind
 * alone, for what they cost to be counted before any is sent (a wallet's policy).
 */
export async function transactionsAhead(plan: SvmPlan, ctx: StepContext): Promise<PlanTx[]> {
  const buffer = await planBuffer(plan);
  const state = buffer === undefined ? undefined : await bufferState(ctx, plan);
  const finalized =
    state !== undefined &&
    state.finalized &&
    plan.staged !== undefined &&
    sameBytes(state.sha256, plan.staged.sha256);
  const setup = await setupTransactions(plan, ctx, state, finalized, Number.MAX_SAFE_INTEGER);

  return [
    ...setup.transactions,
    ...(plan.cooked === undefined
      ? [
          {
            what: "the cook",
            kind: "cook" as const,
            instructions: [],
            createsPot: plan.pot === "inline" && !(await exists(ctx, await potOf(plan), "the Pot")),
          },
        ]
      : []),
    ...(buffer === undefined
      ? []
      : [{ what: "closing the code buffer", kind: "close" as const, instructions: [] }]),
  ];
}

const withoutPayload = (plan: SvmPlan): SvmPlan => {
  const { payload: _payload, ...rest } = plan;

  return rest;
};

const withoutCook = (plan: SvmPlan): SvmPlan => {
  const { cook: _cook, ...rest } = plan;

  return rest;
};

/** The setup the cluster does not hold yet, in the order it is sent. */
async function setupTransactions(
  plan: SvmPlan,
  ctx: StepContext,
  state: BufferState | undefined,
  finalized: boolean,
  most = STEP_MOST,
): Promise<{ transactions: PlanTx[]; plan: SvmPlan; notes: string[] }> {
  const transactions: PlanTx[] = [];
  const notes: string[] = [];
  const pot = await potOf(plan);
  if (plan.pot === "setup" && !(await exists(ctx, pot, "the Pot"))) {
    transactions.push({
      what: "creating the Pot",
      kind: "pot",
      instructions: [await createPotInstruction(plan)],
    });
  }
  const missing: PlanTokenAccount[] = [];
  for (const account of plan.tokenAccounts) {
    if (!(await exists(ctx, account.address, account.label))) missing.push(account);
  }
  if (missing.length > 0) {
    transactions.push({
      what: "creating the token accounts",
      kind: "accounts",
      accounts: missing,
      instructions: await Promise.all(
        missing.map(
          async (account) =>
            (
              await buildAtaPrepend({
                payer: ctx.signer,
                owner: account.holder,
                mint: account.mint,
                tokenProgram: account.program,
              })
            ).instruction,
        ),
      ),
    });
  }
  const buffer = await planBuffer(plan);
  if (buffer !== undefined && !finalized) {
    if (plan.payload === undefined) {
      throw new CliError(
        `the code buffer ${buffer.codeBuffer} is not finalized, and the plan no longer carries ` +
          "the program: make a new plan",
      );
    }
    const accounts = { kitchen: kitchen(), owner: plan.owner, ...buffer };
    const payload = plan.payload;
    const growths = Math.ceil(payload.length / GROWTH_STEP) - 1;
    if (state === undefined) {
      const grows = Array.from({ length: growths }, () => buildGrowCodeBufferInstruction(accounts));
      transactions.push({
        what: "creating the code buffer",
        kind: "buffer",
        instructions: [
          buildCreateCodeBufferInstruction({
            ...accounts,
            nonce: plan.staged!.nonce,
            capacity: payload.length,
          }),
          ...grows.slice(0, GROWS_PER_TRANSACTION),
        ],
      });
      for (let at = GROWS_PER_TRANSACTION; at < grows.length; at += GROWS_PER_TRANSACTION) {
        transactions.push({
          what: "growing the code buffer",
          kind: "buffer",
          instructions: grows.slice(at, at + GROWS_PER_TRANSACTION),
        });
      }
    } else if (state.code.length < payload.length) {
      // Created and not fully grown: the grows left.
      const left = Math.ceil((payload.length - state.code.length) / GROWTH_STEP);
      for (let at = 0; at < left; at += GROWS_PER_TRANSACTION) {
        transactions.push({
          what: "growing the code buffer",
          kind: "buffer",
          instructions: Array.from({ length: Math.min(GROWS_PER_TRANSACTION, left - at) }, () =>
            buildGrowCodeBufferInstruction(accounts),
          ),
        });
      }
    }
    for (let offset = 0; offset < payload.length; offset += CHUNK) {
      const chunk = payload.subarray(offset, offset + CHUNK);
      // A chunk the code account holds already is not written again.
      if (
        state !== undefined &&
        sameBytes(state.code.subarray(offset, offset + chunk.length), chunk)
      ) {
        continue;
      }
      transactions.push({
        what: `writing bytes ${offset}… of the program`,
        kind: "write",
        instructions: [buildWriteCodeBufferInstruction({ ...accounts, offset, chunk })],
      });
    }
    transactions.push({
      what: "finalizing the code buffer",
      kind: "finalize",
      instructions: [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: payload.length,
          expectedSha256: plan.staged!.sha256,
        }),
      ],
    });
  }
  let next = plan;
  if (plan.table !== undefined) {
    const made = await tableTransactions(plan, ctx);
    transactions.push(...made.transactions);
    next = made.plan;
  }
  // A step a signer can sign before its blockhash expires: what is past it comes in the next,
  // built from what the cluster shows then (the finalize after every write, the table after it).
  if (transactions.length > most) {
    notes.push(
      `the setup is ${transactions.length} transactions: this step is the first ${most}, and ` +
        "the next step has the rest",
    );
  }

  return { transactions: transactions.slice(0, most), plan: next, notes };
}

/** The most transactions one step holds, all on one blockhash: what a signer and the sends that
 *  confirm each in turn finish well inside the minute it is valid for. */
const STEP_MOST = 32;

/** A table's creation recent slot is usable while SlotHashes holds it: 512 slots. Past this many,
 *  a table that has not appeared is made at a new slot. */
const RECENT_SLOT_AGE = 300n;

/** The plan's lookup table: created and extended where the cluster does not hold it all. */
async function tableTransactions(
  plan: SvmPlan,
  ctx: StepContext,
): Promise<{ transactions: PlanTx[]; plan: SvmPlan }> {
  const wanted = plan.table!;
  const held = wanted.address === undefined ? undefined : await tableState(ctx, wanted.address);
  if (held !== undefined) {
    const have = new Set(held.addresses);
    const missing = wanted.addresses.filter((at) => !have.has(at));
    const transactions: PlanTx[] = [];
    for (let at = 0; at < missing.length; at += 30) {
      transactions.push({
        what: "extending the lookup table",
        kind: "table",
        instructions: [
          getExtendLookupTableInstruction({
            address: wanted.address!,
            authority: ctx.signer,
            payer: ctx.signer,
            addresses: missing.slice(at, at + 30),
          }),
        ],
      });
    }

    return { transactions, plan };
  }
  const finalizedSlot = await ask(ctx.url, "the finalized slot", () =>
    ctx.rpc.getSlot({ commitment: "finalized" }).send(),
  );
  const recentSlot =
    wanted.recentSlot !== undefined && finalizedSlot - wanted.recentSlot <= RECENT_SLOT_AGE
      ? wanted.recentSlot
      : finalizedSlot;
  const { lookupTableAddress, batches } = await lookupTableBatches({
    payer: ctx.signer,
    authority: ctx.signer,
    recentSlot,
    addresses: wanted.addresses,
  });

  return {
    transactions: batches.map((instructions, index) => ({
      what: index === 0 ? "creating the lookup table" : "extending the lookup table",
      kind: "table" as const,
      instructions,
    })),
    plan: { ...plan, table: { ...wanted, address: lookupTableAddress, recentSlot } },
  };
}

/** How long a cook's step waits for a lookup table the setup just extended to come into use. */
const TABLE_WARMUP = { tries: 30, delayMs: 500 };

/** The cook, rehearsed for its compute: built at the most where its rehearsal fails. */
async function cookStep(plan: SvmPlan, ctx: StepContext): Promise<PlanStep> {
  const tables: AddressesByLookupTableAddress = {};
  for (const table of [
    ...plan.lookupTables,
    ...(plan.table?.address === undefined ? [] : [plan.table.address]),
  ]) {
    let held = await tableState(ctx, table);
    if (held === undefined) {
      throw new CliError(`lookup table ${table} is not on the cluster: is it closed?`);
    }
    // Addresses a table takes in slot N are usable from slot N + 1.
    for (let attempt = 0; ; attempt++) {
      const slot = await ask(ctx.url, "the slot", () =>
        ctx.rpc.getSlot({ commitment: "confirmed" }).send(),
      );
      if (slot > held.lastExtendedSlot) break;
      if (attempt >= TABLE_WARMUP.tries) {
        return {
          name: "cook",
          transactions: [],
          plan,
          overview: overview(plan, "cook"),
          notes: [],
          wait: `lookup table ${table} comes into use after slot ${held.lastExtendedSlot}: ask again`,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, TABLE_WARMUP.delayMs));
      held = (await tableState(ctx, table)) ?? held;
    }
    tables[table] = [...held.addresses];
  }
  const fee =
    ctx.fee ??
    (await ask(ctx.url, "the Kitchen's execution fee", () =>
      fetchExecutionFee(ctx.rpc, kitchen()),
    ).catch((error: unknown) => {
      throw new CliError(
        `the released Kitchen (${kitchen()}) has no execution-fee config on this cluster: is it ` +
          `deployed there? Every cook is refused without one. (${(error as Error).message})`,
      );
    }));
  if (plan.maxExecutionFee !== undefined && fee > plan.maxExecutionFee) {
    throw new CliError(
      `the execution fee is ${fee} lamports, above --max-execution-fee ${plan.maxExecutionFee}: ` +
        "nothing was built",
    );
  }
  const withPot = plan.pot === "inline" && !(await exists(ctx, await potOf(plan), "the Pot"));
  const lookupTables = Object.keys(tables).length === 0 ? undefined : tables;
  const build = async (unitLimit: number, latestBlockhash: typeof PLACEHOLDER_BLOCKHASH) =>
    buildExecuteTransaction({
      payer: ctx.signer,
      instructions: await cookInstructions(plan, ctx.signer, fee, unitLimit, withPot),
      latestBlockhash,
      ...(lookupTables === undefined ? {} : { lookupTables }),
    });
  // Rehearsed at the most compute, for what it takes.
  const { value: latest } = await ask(ctx.url, "the latest blockhash", () =>
    ctx.rpc.getLatestBlockhash().send(),
  );
  const rehearsal = getBase64EncodedWireTransaction(await build(ENGINE_GAS_LIMIT_CU, latest));
  // An endpoint that does not simulate leaves the cook unrehearsed: built at the most compute.
  const value = await ask(ctx.url, "a simulation of the cook", () =>
    ctx.rpc
      .simulateTransaction(rehearsal, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
      })
      .send(),
  ).then(
    (answer) => answer?.value ?? undefined,
    () => undefined,
  );
  const logs = value?.logs ?? [];
  const returned =
    value?.returnData === null || value?.returnData === undefined
      ? undefined
      : new Uint8Array(getBase64Encoder().encode(value.returnData.data[0]));
  const fails =
    value === undefined || value.err === null
      ? undefined
      : { reason: failureReason(value.err, logs, returned), logs };
  const unitLimit =
    fails === undefined && value?.unitsConsumed !== undefined && value.unitsConsumed !== null
      ? recommendedComputeUnitLimit(BigInt(value.unitsConsumed))
      : ENGINE_GAS_LIMIT_CU;

  return {
    name: "cook",
    transactions: [
      {
        what:
          plan.via === "engine"
            ? "the engine's direct cook (cookAndPay)"
            : `cook on Pot ${await potOf(plan)}`,
        kind: "cook",
        createsPot: withPot,
        instructions: await cookInstructions(plan, ctx.signer, fee, unitLimit, withPot),
        ...(lookupTables === undefined ? {} : { lookupTables }),
      },
    ],
    plan,
    overview: overview(plan, "cook"),
    notes:
      value === undefined
        ? ["the endpoint did not simulate the cook, so it is built at the most compute it may use"]
        : [],
    fee,
    ...(fails === undefined ? {} : { fails }),
    ...(value === undefined ? { unrehearsed: true as const } : {}),
  };
}

/** The close of the code buffer, or, with none open, the end. */
async function closeStep(plan: SvmPlan, ctx: StepContext, open: boolean): Promise<PlanStep> {
  const buffer = await planBuffer(plan);
  const notes =
    plan.table?.address === undefined
      ? []
      : [
          `lookup table ${plan.table.address} stays for a later cook naming the same accounts ` +
            `(--lookup-table ${plan.table.address}); sauce reclaim closes it`,
        ];
  if (buffer === undefined || !open) {
    return { name: "done", transactions: [], plan, overview: overview(plan, "done"), notes };
  }

  return {
    name: "close",
    transactions: [
      {
        what: "closing the code buffer",
        kind: "close",
        instructions: [
          buildCloseCodeBufferInstruction({ kitchen: kitchen(), owner: plan.owner, ...buffer }),
        ],
      },
    ],
    plan,
    overview: overview(plan, "close"),
    notes,
  };
}

/** How many of the owner's transactions a landed-cook search reads, at most, before it gives up. */
const HISTORY_MOST = 500;

/**
 * Whether the cook handed out landed: a transaction of the owner's, since the slot the cook was
 * built at, on the cook's blockhash, that cooks. Landed — succeeded or failed — it cannot land
 * again. An endpoint that cannot say refuses the step rather than risk a second cook.
 */
async function cookLanded(
  ctx: StepContext,
  owner: Address,
  handed: CookHandedOut,
): Promise<SvmPlan["cooked"] | undefined> {
  let before: Signature | undefined;
  for (let read = 0; read < HISTORY_MOST;) {
    const page = await ask(ctx.url, "the owner's transactions since the cook was handed out", () =>
      ctx.rpc
        .getSignaturesForAddress(owner, { limit: 100, ...(before === undefined ? {} : { before }) })
        .send(),
    );
    for (const entry of page) {
      if (BigInt(entry.slot) < handed.slot) return undefined;
      read += 1;
      const response = await ask(ctx.url, `transaction ${entry.signature}`, () =>
        ctx.rpc
          .getTransaction(entry.signature as Signature, {
            commitment: "confirmed",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          })
          .send(),
      );
      if (response === null) continue;
      const transaction = getTransactionDecoder().decode(
        new Uint8Array(getBase64Encoder().encode(response.transaction[0])),
      );
      const { lifetimeToken } = getCompiledTransactionMessageDecoder().decode(
        transaction.messageBytes,
      ) as { lifetimeToken: string };
      if (lifetimeToken === handed.blockhash && isCook(transaction)) {
        return { ok: (response.meta?.err ?? null) === null, signature: entry.signature };
      }
    }
    if (page.length < 100) return undefined;
    before = page.at(-1)!.signature as Signature;
  }
  throw new CliError(
    `${owner} sent more than ${HISTORY_MOST} transactions since the cook was handed out, too many ` +
      "to look through for it: give the cook's signature if it was sent, or close",
  );
}

/** The associated-token-account program, which creates a holder's token account for a mint. */
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** The lookup-table program's instructions, by their u32 index, as a plan's steps name them. */
const TABLE_INSTRUCTIONS: Readonly<Record<number, string>> = {
  0: "creating the lookup table",
  2: "extending the lookup table",
  3: "deactivating the lookup table",
  4: "closing the lookup table",
};

/** A little-endian u32 of `data` at `offset`, or 0 past its end. */
const u32At = (data: Uint8Array, offset: number): number =>
  data.length < offset + 4 ? 0 : new DataView(data.buffer, data.byteOffset).getUint32(offset, true);

const KITCHEN_NAMES = Object.keys(
  KITCHEN_DISCRIMINATORS,
) as (keyof typeof KITCHEN_DISCRIMINATORS)[];
/** The Pot's index among each Kitchen cook's accounts. */
const COOK_POT_INDEX = { cook: 2, cookFromAccount: 4 } as const;
/** What each other Kitchen instruction a plan sends does, in its words. */
const KITCHEN_STEPS: Partial<
  Record<keyof typeof KITCHEN_DISCRIMINATORS, (data: Uint8Array) => string>
> = {
  createPot: () => "creating the Pot",
  createCodeBuffer: () => "creating the code buffer",
  growCodeBuffer: () => "growing the code buffer",
  writeCodeBuffer: (data) => `writing bytes ${u32At(data, 8)}… of the program`,
  finalizeCodeBuffer: () => "finalizing the code buffer",
  closeCodeBuffer: () => "closing the code buffer",
};

/** What a transaction read back does: in its plan's words, whether it cooks, and on which Pot. */
export interface PlanTxRead {
  readonly what: string;
  readonly cook: boolean;
  readonly pot?: Address;
}

/**
 * `transaction`, read back as a plan's step names what it does: the Kitchen's instructions by their
 * discriminators (a cook with the Pot it runs on, from `tables` where the message loads it), the
 * engine's direct cooks, a lookup table's creation or extension, token accounts created — its cook
 * where it has one (a Pot created ahead of it is part of the cook's transaction), else its first.
 * `undefined` for anything else.
 */
export function readPlanTx(
  transaction: Transaction,
  tables: AddressesByLookupTableAddress = {},
): PlanTxRead | undefined {
  const read = readInstructions(transaction, tables);

  return read.find((each) => each.cook) ?? read[0];
}

function readInstructions(
  transaction: Transaction,
  tables: AddressesByLookupTableAddress,
): PlanTxRead[] {
  const read: PlanTxRead[] = [];
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    instructions: readonly {
      programAddressIndex: number;
      accountIndices?: readonly number[];
      data?: Uint8Array;
    }[];
  };
  const accounts = messageAccounts(transaction, tables);
  const starts = (data: Uint8Array, head: Uint8Array): boolean =>
    head.every((byte, index) => data[index] === byte);
  for (const instruction of message.instructions) {
    const program = accounts[instruction.programAddressIndex];
    const data = instruction.data ?? new Uint8Array();
    if (program === kitchen()) {
      const name = KITCHEN_NAMES.find((each) => starts(data, KITCHEN_DISCRIMINATORS[each]));
      if (name === "cook" || name === "cookFromAccount") {
        const at = instruction.accountIndices?.[COOK_POT_INDEX[name]];
        const pot = at === undefined ? undefined : accounts[at];
        read.push({
          what: `cook on Pot ${pot}`,
          cook: true,
          ...(pot === undefined ? {} : { pot }),
        });
      } else if (name !== undefined && KITCHEN_STEPS[name] !== undefined) {
        read.push({ what: KITCHEN_STEPS[name](data), cook: false });
      }
    } else if (
      program === engine() &&
      (starts(data, COOK_AND_PAY_DISCRIMINATOR) ||
        starts(data, COOK_AND_PAY_FROM_ACCOUNT_PINNED_DISCRIMINATOR))
    ) {
      read.push({ what: "the engine's direct cook (cookAndPay)", cook: true });
    } else if (program === ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS && data.length >= 4) {
      const what = TABLE_INSTRUCTIONS[u32At(data, 0)];
      if (what !== undefined) read.push({ what, cook: false });
    } else if (program === ASSOCIATED_TOKEN_PROGRAM) {
      read.push({ what: "creating the token accounts", cook: false });
    }
  }

  return read;
}

/** Whether `transaction` cooks: a Kitchen cook, or the engine's direct one. */
export const isCook = (transaction: Transaction): boolean => readPlanTx(transaction)?.cook === true;

/** The plan's stages, for a person, as of the step `at`. */
function overview(plan: SvmPlan, at: PlanStep["name"]): PlanStage[] {
  const order = ["setup", "cook", "close", "done"] as const;
  const state = (step: (typeof order)[number]): PlanStage["state"] => {
    const here = order.indexOf(at);
    const there = order.indexOf(step);

    return there < here ? "done" : there === here ? "next" : "later";
  };
  const parts = [
    ...(plan.pot === "setup" ? ["create the Pot"] : []),
    ...(plan.tokenAccounts.length === 0
      ? []
      : [`create ${plan.tokenAccounts.map((account) => account.label).join(", ")} where missing`]),
    ...(plan.staged === undefined
      ? []
      : [`stage the ${plan.staged.length}-byte program in a code buffer`]),
    ...(plan.table === undefined
      ? []
      : [`create a lookup table for the cook's ${plan.table.addresses.length} accounts`]),
  ];
  const how = plan.via === "engine" ? "the engine's direct cook" : "the cook, through the Kitchen";

  return [
    ...(parts.length === 0
      ? []
      : [{ step: "setup" as const, what: parts.join("; "), state: state("setup") }]),
    {
      step: "cook",
      what:
        plan.staged === undefined
          ? `${how}${plan.pot === "inline" ? ", creating the Pot ahead of it" : ""}`
          : `${how}, from the code buffer`,
      state:
        plan.cooked !== undefined ? "done" : plan.closing === true ? "given up" : state("cook"),
    },
    ...(plan.staged === undefined
      ? []
      : [
          {
            step: "close" as const,
            what: "close the code buffer, its rent back to the owner",
            state: state("close"),
          },
        ]),
  ];
}

// ---------------------------------------------------------------------------------------------
// A step's transactions, built
// ---------------------------------------------------------------------------------------------

/** One transaction of a step as a signer takes it: base64, signed by no one yet. */
export interface SignableTx {
  readonly what: string;
  readonly transaction: string;
  readonly feePayer: Address;
}

/** `tx`, built for `ctx.signer` on `latestBlockhash`: signed, where the signer signs. */
export async function buildPlanTx(
  tx: PlanTx,
  ctx: StepContext,
  latestBlockhash: Parameters<typeof buildExecuteTransaction>[0]["latestBlockhash"],
): Promise<Transaction> {
  const transaction = await buildExecuteTransaction({
    payer: ctx.signer,
    instructions: tx.instructions,
    latestBlockhash,
    ...(tx.lookupTables === undefined ? {} : { lookupTables: tx.lookupTables }),
  });
  const size = getTransactionSize(transaction);
  if (size > TRANSACTION_SIZE_LIMIT) {
    throw new CliError(
      `${tx.what} is a ${size}-byte transaction, past Solana's ${TRANSACTION_SIZE_LIMIT}`,
    );
  }

  return transaction;
}

/**
 * `txs` for a signer that is not this process: each built on one fresh blockhash, base64, and that
 * blockhash's lifetime — what a cook among them is remembered by.
 */
export async function signableTransactions(
  txs: readonly PlanTx[],
  ctx: StepContext,
): Promise<{
  readonly transactions: readonly SignableTx[];
  readonly lastValidBlockHeight?: bigint;
  readonly lifetime?: CookHandedOut;
}> {
  if (txs.length === 0) return { transactions: [] };
  const { value: latest, context } = await ask(ctx.url, "the latest blockhash", () =>
    ctx.rpc.getLatestBlockhash().send(),
  );
  const transactions = await Promise.all(
    txs.map(async (tx) => ({
      what: tx.what,
      transaction: getBase64EncodedWireTransaction(await buildPlanTx(tx, ctx, latest)),
      feePayer: ctx.signer.address,
    })),
  );

  return {
    transactions,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    lifetime: {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      slot: BigInt(context.slot),
    },
  };
}

/**
 * A step's transactions for a signer that is not this process, each built on one fresh blockhash,
 * for the owner to sign, and the plan to carry on from — the cook, handed out, remembered by that
 * blockhash, so it is never built again while it can still land, nor once it has.
 */
export async function signableStep(
  step: PlanStep,
  ctx: StepContext,
): Promise<{
  readonly transactions: readonly SignableTx[];
  readonly lastValidBlockHeight?: bigint;
  readonly plan: SvmPlan;
}> {
  const { lifetime, ...built } = await signableTransactions(step.transactions, ctx);
  const cooks = step.transactions.some((tx) => tx.kind === "cook");

  return {
    ...built,
    plan: cooks && lifetime !== undefined ? { ...step.plan, cook: lifetime } : step.plan,
  };
}
