/**
 * A Solana cook as `sauce run` sends one, in a bank. Each account the program takes is named as
 * `sauce run --account` names it (`svm/account-names.ts`: `pot`, `pot:USDC`, `@to:USDC`, …), over
 * the derivations the SDK wrote for the accounts it added to `main` (the token methods', a venue's
 * nine), so a test gives only the accounts nothing derives. A token account the cook names that the
 * chain does not hold yet is created first, the owner paying its rent. The program rides inline in
 * the Kitchen's `cook`; one too large for a transaction is staged into a code buffer first and
 * cooked from it, its accounts through a lookup table where they do not fit either, and the buffer
 * is closed after, its rent back to the owner.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  getAddressDecoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionSize,
  isAddress,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Transaction,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import type { CompiledProgram } from "./program.js";
import type { Bank, Sent } from "./solana-bank.js";
import {
  buildAtaPrepend,
  buildCloseCodeBufferInstruction,
  buildComputeBudgetPrepend,
  buildCookFromAccountInstruction,
  buildCookInstruction,
  buildCreateCodeBufferInstruction,
  buildExecuteTransaction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildHeapFramePrepend,
  buildWriteCodeBufferInstruction,
  deriveCodeBufferPda,
  deriveCodePda,
  ENGINE_GAS_LIMIT_CU,
  engineFaultName,
  GROWTH_STEP,
  LOOKUP_TABLE_MAX_ADDRESSES,
  resolveAccounts,
  resolveSvmAccountName,
  resolveTokenProgramByOwner,
  SvmAccountNameError,
  svmKitchenIdlPath,
  svmProgramStops,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TRANSACTION_SIZE_LIMIT,
  type AccountResolution,
  type CanonicalChain,
  type EntryValue,
  type ResolvedSvmAccountName,
} from "./sdk.js";

/** How many bytes of the program each staging transaction writes, as `sauce run` writes them. */
const CHUNK = 900;
/** Where a cook's lookup table is made: a key no cluster holds an account at. */
const TABLE_KEY = getAddressDecoder().decode(
  createHash("sha256").update("@eco-incorp/sauce/testing lookup table").digest(),
);

/** The chain a cook runs on, as the cook reaches it. */
export interface CookChain {
  readonly bank: Bank;
  readonly chain: CanonicalChain;
  readonly engine: Address;
  readonly kitchen: Address;
  readonly feeConfig: Address;
}

export interface CookInput {
  readonly owner: KeyPairSigner;
  readonly pot: Address;
  readonly salt: Uint8Array;
  readonly program: CompiledProgram;
  readonly args: readonly EntryValue[];
  /** The program's accounts by name, as `sauce run --account` takes them. */
  readonly accounts: Readonly<Record<string, string>>;
  /** The Kitchen's fee: the most the cook may pay. */
  readonly fee: bigint;
}

/** A cook sent, and how. */
export interface Cooked {
  readonly sent: Sent;
  /** The program was staged into a code buffer first: it does not fit one transaction. */
  readonly staged: boolean;
  /** Its accounts went through a lookup table: the staged cook does not fit without one. */
  readonly lookupTable: boolean;
  /** What each account the cook names is, for a person. */
  readonly labels: ReadonlyMap<Address, string>;
}

/** A transaction of `instructions` from `payer`, on a blockhash of its own. */
function transactionOf(
  chain: CookChain,
  payer: KeyPairSigner,
  instructions: readonly Instruction[],
  lookupTables?: AddressesByLookupTableAddress,
): Promise<Transaction> {
  return buildExecuteTransaction({
    payer,
    instructions,
    latestBlockhash: {
      blockhash: chain.bank.blockhash() as Blockhash,
      lastValidBlockHeight: 1_000_000n,
    },
    ...(lookupTables === undefined ? {} : { lookupTables }),
  });
}

/** Sends `instructions` from `payer`, throwing with why when they fail: a step before a cook. */
export async function sendStep(
  chain: CookChain,
  payer: KeyPairSigner,
  instructions: readonly Instruction[],
  what: string,
  labels: ReadonlyMap<Address, string> = new Map(),
): Promise<Sent> {
  const sent = await chain.bank.send(await transactionOf(chain, payer, instructions));
  if (!sent.ok) {
    const { reason } = failureOf(sent, chain, labels);
    throw new Error(`${what} failed: ${reason}\n${sent.logs.join("\n")}`);
  }

  return sent;
}

/** main's `Address` arguments by name, as keys, and its integers: what a name derives from. */
function argumentsByName(
  program: CompiledProgram,
  args: readonly EntryValue[],
): { keys: Record<string, Address>; integers: Record<string, bigint> } {
  const keys: Record<string, Address> = {};
  const integers: Record<string, bigint> = {};
  program.params.forEach((param, index) => {
    const value = args[index];
    if (param.type === "Address" && typeof value === "string") {
      if (isAddress(value)) keys[param.name] = value;
      else if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
        keys[param.name] = getAddressDecoder().decode(hexToBytes(value as Hex));
      }
    } else if (
      param.type === "Uint256" &&
      (typeof value === "bigint" ||
        typeof value === "number" ||
        (typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)))
    ) {
      integers[param.name] = BigInt(value);
    }
  });

  return { keys, integers };
}

/** A token account the cook names, which it creates where the chain does not hold one. */
interface NamedTokenAccount {
  readonly address: Address;
  readonly mint: Address;
  readonly holder: Address;
  readonly program: Address;
  readonly label: string;
}

/**
 * The program's accounts, each resolved from its name: the resolution `resolveAccounts` reads, what
 * each is, and the token accounts among them.
 */
async function resolveNames(
  chain: CookChain,
  input: CookInput,
  manifest: AccountManifest,
): Promise<{
  resolution: AccountResolution;
  labels: Map<Address, string>;
  tokenAccounts: NamedTokenAccount[];
}> {
  const derived = input.program.derivedAccounts ?? {};
  const names: Record<string, string> = { ...derived, ...input.accounts };
  if (manifest.accounts.some((entry) => entry.kind === "remaining")) {
    throw new Error(
      "the program takes a variable list of accounts after its named ones, which the testing kit " +
        "cannot attach",
    );
  }
  const slots = manifest.accounts.flatMap((entry) => (entry.kind === "slot" ? [entry] : []));
  const unknown = Object.keys(input.accounts).filter(
    (name) => !slots.some((slot) => slot.name === name),
  );
  if (unknown.length > 0) {
    throw new Error(
      `accounts.${unknown[0]}: the program has no account by that name` +
        (slots.length === 0 ? "" : `; it takes ${slots.map((slot) => slot.name).join(", ")}`),
    );
  }
  const missing = slots.filter((slot) => !Object.hasOwn(names, slot.name));
  if (missing.length > 0) {
    throw new Error(
      `the cook needs ${missing.map((slot) => `${slot.name} (${slot.requires})`).join(", ")}: ` +
        "name each in `accounts`, as `sauce run --account` takes it (pot, owner, pot:USDC, " +
        "mint:USDC, an address…)",
    );
  }
  const { bank } = chain;
  const { keys, integers } = argumentsByName(input.program, input.args);
  // This cook's pool slots, each read once for its nine names.
  const poolSlots = new Map();
  const labels = new Map<Address, string>([
    [input.owner.address, "the owner"],
    [input.pot, "the Pot"],
    [chain.feeConfig, "the Kitchen's fee config"],
  ]);
  const tokenAccounts: NamedTokenAccount[] = [];
  const resolution: AccountResolution = {};
  for (const slot of slots) {
    const value = names[slot.name]!;
    let resolved: ResolvedSvmAccountName;
    try {
      resolved = await resolveSvmAccountName(value, {
        chain: chain.chain,
        owner: input.owner.address,
        pot: input.pot,
        args: keys,
        integers,
        // A mint the registry does not record, and a pool's slot, are read from the chain.
        programOf: (mint) =>
          resolveTokenProgramByOwner(mint, async (key) => {
            await bank.ensure([key]);
            return bank.account(key)?.owner ?? null;
          }),
        load: async (key) => {
          await bank.ensure([key]);
          const account = bank.account(key);
          return account === null ? null : { data: account.data, owner: account.owner };
        },
        slots: poolSlots,
      });
    } catch (error) {
      if (error instanceof SvmAccountNameError) {
        throw new Error(
          `${Object.hasOwn(input.accounts, slot.name) ? `accounts.${slot.name}` : `the account ${slot.name}`} ` +
            `(${value}): ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    if (resolved.value === "pot") {
      resolution[slot.name] = { address: input.pot, signer: false };
      continue;
    }
    if (resolved.value === "owner") {
      resolution[slot.name] = { address: input.owner.address, signer: input.owner };
      continue;
    }
    resolution[slot.name] = resolved.value;
    if (!labels.has(resolved.value)) {
      labels.set(
        resolved.value,
        resolved.label === undefined ? slot.name : `${slot.name}, ${resolved.label}`,
      );
    }
    if (
      resolved.account !== undefined &&
      !tokenAccounts.some((token) => token.address === resolved.value)
    ) {
      tokenAccounts.push({
        address: resolved.value,
        ...resolved.account,
        label: resolved.label ?? slot.name,
      });
    }
  }

  return { resolution, labels, tokenAccounts };
}

/** The cook's own instructions: the heap frame, the compute limit, the Kitchen's cook. */
function cookInstructions(cook: Instruction): Instruction[] {
  return [
    buildHeapFramePrepend(),
    ...buildComputeBudgetPrepend({ unitLimit: ENGINE_GAS_LIMIT_CU }),
    cook,
  ];
}

/**
 * The accounts of `transaction` a lookup table may hold: every account its message lists, less the
 * signers and the programs its instructions call, which a transaction must list itself.
 */
function tableAddresses(transaction: Transaction): Address[] {
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

/**
 * Sends `input`'s program as a cook from the owner's Pot, with what it needs first: the token
 * accounts it names that the chain does not hold, and, for a program too large for one
 * transaction, its code buffer. Returns the cook's transaction, whether it succeeded or not; a
 * step before it that fails throws.
 */
export async function cook(chain: CookChain, input: CookInput): Promise<Cooked> {
  const manifest = input.program.manifest ?? { accounts: [] };
  const { resolution, labels, tokenAccounts } = await resolveNames(chain, input, manifest);
  // Each swap at a price's stop, worked out from the pools the cook names, as `sauce` works it out.
  const named = Object.fromEntries(
    Object.entries(resolution).map(([name, at]) => [
      name,
      typeof at === "string" ? at : (at as { address: Address }).address,
    ]),
  );
  const stops = await svmProgramStops(
    input.program,
    chain.chain,
    named,
    argumentsByName(input.program, input.args).integers,
    async (key) => {
      await chain.bank.ensure([key]);
      const account = chain.bank.account(key);
      return account === null ? null : { data: account.data, owner: account.owner };
    },
  );
  const payload = hexToBytes(input.program.payload(input.args, stops?.values ?? []));
  const tail = resolveAccounts(manifest, resolution, input.owner.address);
  const { bank, kitchen, engine, feeConfig } = chain;
  const owner = input.owner;

  // The token accounts the cook names that the chain does not hold, created first, a few to a
  // transaction: a program paying into an account that does not exist fails.
  await bank.ensure(tokenAccounts.flatMap((token) => [token.address, token.mint]));
  const toCreate = tokenAccounts.filter((token) => bank.account(token.address) === null);
  for (const token of toCreate) {
    if (bank.account(token.mint) === null) {
      throw new Error(
        `the cook names ${token.label}, ${token.address}, which cannot be created: its mint ` +
          `${token.mint} is not on this chain`,
      );
    }
  }
  for (let at = 0; at < toCreate.length; at += 4) {
    const batch = toCreate.slice(at, at + 4);
    const instructions = await Promise.all(
      batch.map(
        async (token) =>
          (
            await buildAtaPrepend({
              payer: owner,
              owner: token.holder,
              mint: token.mint,
              tokenProgram: token.program,
            })
          ).instruction,
      ),
    );
    await sendStep(
      chain,
      owner,
      instructions,
      `creating ${batch.map((token) => token.label).join(", ")}`,
      labels,
    );
  }

  const inline = await transactionOf(
    chain,
    owner,
    cookInstructions(
      buildCookInstruction({
        kitchen,
        owner: owner.address,
        engineProgram: engine,
        potSalt: input.salt,
        pot: input.pot,
        feeConfig,
        bytecode: payload,
        maxExecutionFee: input.fee,
        tail,
      }),
    ),
  );
  if (getTransactionSize(inline) <= TRANSACTION_SIZE_LIMIT) {
    return { sent: await bank.send(inline), staged: false, lookupTable: false, labels };
  }

  // Staged: the program written into a code buffer of the owner's, the first nonce free.
  let nonce = 0n;
  let buffer: { codeBuffer: Address; code: Address };
  for (;;) {
    const { address: codeBuffer } = await deriveCodeBufferPda(kitchen, owner.address, nonce);
    await bank.ensure([codeBuffer]);
    if (bank.account(codeBuffer) === null) {
      buffer = { codeBuffer, code: (await deriveCodePda(kitchen, codeBuffer)).address };
      break;
    }
    nonce++;
  }
  const accounts = { kitchen, owner: owner.address, ...buffer };
  const sha256 = new Uint8Array(createHash("sha256").update(payload).digest());
  await sendStep(
    chain,
    owner,
    [
      buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: payload.length }),
      ...Array.from({ length: Math.ceil(payload.length / GROWTH_STEP) - 1 }, () =>
        buildGrowCodeBufferInstruction(accounts),
      ),
    ],
    "creating the code buffer",
  );
  for (let offset = 0; offset < payload.length; offset += CHUNK) {
    await sendStep(
      chain,
      owner,
      [
        buildWriteCodeBufferInstruction({
          ...accounts,
          offset,
          chunk: payload.subarray(offset, offset + CHUNK),
        }),
      ],
      "staging the program",
    );
  }
  await sendStep(
    chain,
    owner,
    [
      buildFinalizeCodeBufferInstruction({
        ...accounts,
        len: payload.length,
        expectedSha256: sha256,
      }),
    ],
    "finalizing the code buffer",
  );
  const instructions = cookInstructions(
    buildCookFromAccountInstruction({
      kitchen,
      owner: owner.address,
      ...buffer,
      engineProgram: engine,
      potSalt: input.salt,
      pot: input.pot,
      feeConfig,
      maxExecutionFee: input.fee,
      tail,
    }),
  );
  let transaction = await transactionOf(chain, owner, instructions);
  let lookupTable = false;
  if (getTransactionSize(transaction) > TRANSACTION_SIZE_LIMIT) {
    const addresses = tableAddresses(transaction);
    if (addresses.length > LOOKUP_TABLE_MAX_ADDRESSES) {
      throw new Error(
        `the cook names ${addresses.length} accounts, more than one lookup table holds ` +
          `(${LOOKUP_TABLE_MAX_ADDRESSES})`,
      );
    }
    transaction = await transactionOf(chain, owner, instructions, bank.table(TABLE_KEY, addresses));
    lookupTable = true;
    const size = getTransactionSize(transaction);
    if (size > TRANSACTION_SIZE_LIMIT) {
      throw new Error(
        `the staged cook is a ${size}-byte transaction even with every account it names in a ` +
          `lookup table, past Solana's ${TRANSACTION_SIZE_LIMIT}: it signs or calls too many`,
      );
    }
  }
  const sent = await bank.send(transaction);
  await sendStep(
    chain,
    owner,
    [buildCloseCodeBufferInstruction(accounts)],
    "closing the code buffer",
  );

  return { sent, staged: true, lookupTable, labels };
}

// ---- Why a transaction failed -----------------------------------------------------------------

let kitchenErrorNames: ReadonlyMap<number, string> | undefined;

/** The Kitchen's error names, from the release IDL that ships beside its binary. */
function kitchenErrors(): ReadonlyMap<number, string> {
  if (kitchenErrorNames !== undefined) return kitchenErrorNames;
  try {
    const idl = JSON.parse(readFileSync(svmKitchenIdlPath(), "utf8")) as {
      errors?: { code: number; name: string; msg: string }[];
    };
    kitchenErrorNames = new Map((idl.errors ?? []).map((e) => [e.code, `${e.name}: ${e.msg}`]));
  } catch {
    kitchenErrorNames = new Map();
  }

  return kitchenErrorNames;
}

/**
 * The program whose own instruction failed. A transaction error names only the top-level
 * instruction, whose program may merely have passed on a failure from deep in a CPI; the logs say
 * where it began — a callee's `failed` line comes before each of its callers'.
 */
function failedProgram(logs: readonly string[]): string | undefined {
  for (const line of logs) {
    const failed = /^Program (\w+) failed: /.exec(line);
    if (failed !== null) return failed[1];
  }

  return undefined;
}

/** The return data `program` logged (`Program return: <program> <base64>`), the last it set. */
function loggedReturn(logs: readonly string[], program: string): Uint8Array | undefined {
  let found: Uint8Array | undefined;
  for (const line of logs) {
    const match = /^Program return: (\w+) ([A-Za-z0-9+/=]*)$/.exec(line);
    if (match !== null && match[1] === program) {
      found = new Uint8Array(getBase64Encoder().encode(match[2]!));
    }
  }

  return found;
}

/**
 * Why `program` refused, in its own words: the last `Program log:` line it wrote before it failed,
 * other than its instruction's name (Token-2022's "Account is frozen", an Anchor program's
 * `AnchorError … Error Message: …`).
 */
function programMessage(logs: readonly string[], program: string): string | undefined {
  let message: string | undefined;
  for (const line of logs) {
    if (line.startsWith(`Program ${program} invoke`)) message = undefined;
    else if (line.startsWith(`Program ${program} failed`)) return message;
    else {
      const log = /^Program log: (?:Error: )?(.+)$/.exec(line);
      if (log !== null && !log[1]!.startsWith("Instruction: ")) message = log[1];
    }
  }

  return undefined;
}

/** The token programs, by the name a person reads. */
const TOKEN_PROGRAMS: ReadonlyMap<string, string> = new Map([
  [TOKEN_PROGRAM_ID, "SPL Token"],
  [TOKEN_2022_PROGRAM_ID, "Token-2022"],
]);

/**
 * Why `sent` failed: the program's own `require` or `throw` message (its revert data the bytes of
 * the message) when the engine reverted; else the engine's or the Kitchen's refusal by name, another
 * program's in its own words, or the runtime's error, an account it names by index named.
 */
export function failureOf(
  sent: Sent,
  chain: Pick<CookChain, "engine" | "kitchen">,
  labels: ReadonlyMap<Address, string>,
): { reason: string | undefined; data: Hex | undefined } {
  const detail = (sent.err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  const custom = (detail?.[1] as { Custom?: unknown } | undefined)?.Custom;
  const program = failedProgram(sent.logs);
  if (custom !== undefined) {
    const code = Number(custom);
    if (program === chain.engine && code === 0) {
      const payload =
        sent.returnData.length > 0 ? sent.returnData : loggedReturn(sent.logs, chain.engine);
      if (payload === undefined || payload.length === 0)
        return { reason: undefined, data: undefined };
      const text = new TextDecoder("utf-8", { fatal: false }).decode(payload);

      return {
        reason: /^[\x20-\x7e]+$/.test(text) ? text : undefined,
        data: bytesToHex(payload),
      };
    }
    const kitchen = program === chain.kitchen ? kitchenErrors().get(code) : undefined;
    if (kitchen !== undefined)
      return { reason: `the Kitchen refused: ${kitchen}`, data: undefined };
    const fault = program === chain.engine ? engineFaultName(code) : undefined;
    if (fault !== undefined) {
      return {
        reason: `the engine refused: ${fault} (custom program error ${code})`,
        data: undefined,
      };
    }
    const said = program === undefined ? undefined : programMessage(sent.logs, program);
    const who =
      program === undefined
        ? `instruction ${detail![0]}`
        : (TOKEN_PROGRAMS.get(program) ?? `program ${program}`);

    return {
      reason:
        said === undefined
          ? `${who} failed with custom program error ${code} (0x${code.toString(16)})`
          : `${who} refused: ${said} (custom program error ${code})`,
      data: undefined,
    };
  }
  if (detail !== undefined) {
    const who =
      program === undefined
        ? `instruction ${detail[0]}`
        : (TOKEN_PROGRAMS.get(program) ?? `program ${program}`);

    return { reason: `${who} failed: ${String(detail[1])}`, data: undefined };
  }
  if (typeof sent.err === "string") return { reason: sent.err, data: undefined };
  // An error naming an account by its index in the message: which account, and what it is.
  const [name, fields] = Object.entries(sent.err as Record<string, unknown>)[0] ?? [];
  const index = (fields as { account_index?: number } | undefined)?.account_index;
  const account = index === undefined ? undefined : sent.accounts[index];
  const label = account === undefined ? undefined : labels.get(account);

  return {
    reason:
      account === undefined
        ? JSON.stringify(sent.err)
        : `${name}: account ${index} is ${account}${label === undefined ? "" : ` (${label})`}`,
    data: undefined,
  };
}
