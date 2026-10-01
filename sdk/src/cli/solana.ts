/**
 * The `sauce` command on Solana: a Pot is a Kitchen PDA, a cook is a Kitchen `cook` the released
 * engine runs, and both go through the SDK's own pieces — `createSauceSvmClient` (with the RPC URL
 * the user gave and the program ids `/deployments` records) builds, signs and simulates every cook;
 * `derivePotPda`/`buildCreatePotInstruction` are the Pot; the code-buffer builders stage a program
 * too large for one transaction. Nothing here encodes an instruction of its own.
 *
 * What this adds is the transport a command line needs and the SDK leaves to its caller: sending
 * a transaction and confirming it by polling (no websocket endpoint to configure), reading the
 * Kitchen's fee and a Pot's existence, mapping the manifest's account slots from `--account`
 * flags, and a keypair file as the signer. A keypair is read from the path given, never from the
 * environment, and its bytes are dropped once the signer holds the key.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionSize,
  isAddress,
  TRANSACTION_SIZE_LIMIT,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type SignatureBytes,
  type Transaction,
  type TransactionPartialSigner,
  type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { AccountManifest } from "sauce-compiler";
import { bytesToHex, formatUnits, hexToBytes, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../deployments/index.js";
import {
  mainReturnType,
  parseEntryType,
  type EntryType,
  type EntryValue,
} from "../routes/entry.js";
import { svmTokenRows } from "../routes/token-registry.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { svmKitchenIdlPath } from "../svm/engine-artifacts.js";
import { verifySvmSettleExecution, type SvmSettleExecutionVerification } from "../svm/verify.js";
import {
  buildCloseCodeBufferInstruction,
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildHeapFramePrepend,
  buildWriteCodeBufferInstruction,
  createSauceSvmClient,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  GROWTH_STEP,
  MAX_POT_LEN,
  resolveAccounts,
  type AccountResolution,
  type SauceSvmClient,
  type SimulateExecuteResult,
} from "../svm/index.js";
import { CliError, UsageError, type SaltChoice } from "./args.js";
import {
  compileProgram,
  payloadOf,
  refusePastDeadline,
  unapproved,
  type Approver,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import { decodeReturned, returnedLine } from "./returned.js";
import { secret } from "./signer.js";
import {
  accountsNow,
  movedBy,
  svmMovedJson,
  svmMovedLines,
  writableAccounts,
} from "./svm-effects.js";

/** The released programs, from the release record the SDK ships. */
const kitchen = (): Address => address(v12SvmKitchenProgramId());
const engine = (): Address => address(v12SvmEngineProgramId());

/** A Solana public key from a flag, or a usage error naming the flag. */
export function parsePubkey(flag: string, raw: string): Address {
  if (!isAddress(raw)) {
    throw new UsageError(`--${flag}: '${raw}' is not a Solana address (a base58 public key)`);
  }

  return address(raw);
}

/**
 * `--keypair <path>`: the standard Solana keypair file, a JSON array of the 64 secret-key bytes.
 * The file's text is registered as a secret before anything can fail and print it.
 */
export async function loadKeypair(path: string, files: CliFiles): Promise<KeyPairSigner> {
  let text: string;
  try {
    text = files.readText(path);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(`--keypair ${path}: ${code === "ENOENT" ? "no such file" : "unreadable"}`);
  }
  secret(text.trim());
  let bytes: Uint8Array | undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === 64 &&
      parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ) {
      bytes = Uint8Array.from(parsed as number[]);
    }
  } catch {
    // Reported below, without the text.
  }
  if (bytes === undefined) {
    throw new UsageError(
      `--keypair ${path}: not a Solana keypair file (a JSON array of 64 bytes, as solana-keygen writes)`,
    );
  }
  try {
    return await createKeyPairSignerFromBytes(bytes);
  } catch {
    throw new UsageError(`--keypair ${path}: its 64 bytes are not an ed25519 keypair`);
  } finally {
    bytes.fill(0);
  }
}

/** A signer that signs nothing: an all-zero signature, which a simulation (`sigVerify: false`)
 *  ignores and a wallet replaces. What `simulate` and `tx` build with, having no key. */
function unsignedSigner(owner: Address): TransactionPartialSigner {
  return {
    address: owner,
    signTransactions: async (transactions) =>
      transactions.map(() => ({ [owner]: new Uint8Array(64) as SignatureBytes })),
  };
}

// ---------------------------------------------------------------------------------------------
// The cluster: requests, the fee, a Pot, sending
// ---------------------------------------------------------------------------------------------

type Rpc = ReturnType<typeof createSolanaRpc>;

/** An RPC request, failing with what was asked and never the URL (a provider URL holds a key). */
async function ask<T>(url: string, what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new CliError(`reading ${what} failed: ${message.split(url).join("<RPC_URL>")}`);
  }
}

/** The Kitchen's execution fee in lamports, from its fee config account. */
async function kitchenFee(rpc: Rpc, url: string): Promise<bigint> {
  const { address: config } = await deriveExecutionFeeConfigPda(kitchen());
  const { value } = await ask(url, "the Kitchen's fee config", () =>
    rpc.getAccountInfo(config, { encoding: "base64" }).send(),
  );
  const discriminator = createHash("sha256")
    .update("account:ExecutionFeeConfig")
    .digest()
    .subarray(0, 8);
  const data =
    value === null ? undefined : new Uint8Array(getBase64Encoder().encode(value.data[0]));
  if (
    value === null ||
    value.owner !== kitchen() ||
    data === undefined ||
    data.length !== 16 ||
    !discriminator.every((byte, index) => data[index] === byte)
  ) {
    throw new CliError(
      `the released Kitchen (${kitchen()}) has no execution-fee config on this cluster: is it ` +
        "deployed there?",
    );
  }

  return new DataView(data.buffer, data.byteOffset).getBigUint64(8, true);
}

async function exists(rpc: Rpc, url: string, account: Address, what: string): Promise<boolean> {
  const { value } = await ask(url, what, () =>
    rpc.getAccountInfo(account, { encoding: "base64" }).send(),
  );

  return value !== null;
}

/** How long {@link awaitAccount} waits for an account to show, and how often it asks. */
export const ACCOUNT_WAIT = { tries: 60, delayMs: 1000 };

/**
 * Waits until the cluster shows `account`, just created in a confirmed transaction. A read with no
 * commitment is a finalized read, which trails a confirmation by several seconds, and the cook's
 * simulation reads the same way: cooking straight after creating its Pot would fail on a Pot that
 * is there.
 */
export async function awaitAccount(
  rpc: Rpc,
  url: string,
  account: Address,
  what: string,
  wait: { readonly tries: number; readonly delayMs: number } = ACCOUNT_WAIT,
): Promise<void> {
  for (let attempt = 0; attempt < wait.tries; attempt++) {
    if (await exists(rpc, url, account, what).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, wait.delayMs));
  }
  throw new CliError(
    `${what} ${account} was created, but the cluster still does not show it after ` +
      `${(wait.tries * wait.delayMs) / 1000}s: run the command again once it has caught up; the ` +
      "creation is not repeated.",
  );
}

/** The Kitchen's error names, from the release IDL that ships beside its binary. */
function kitchenErrors(): ReadonlyMap<number, string> {
  try {
    const idl = JSON.parse(readFileSync(svmKitchenIdlPath(), "utf8")) as {
      errors?: { code: number; name: string; msg: string }[];
    };

    return new Map((idl.errors ?? []).map((e) => [e.code, `${e.name}: ${e.msg}`]));
  } catch {
    return new Map();
  }
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

/** The return data the engine logged (`Program return: <engine> <base64>`), the last it set. */
function engineReturn(logs: readonly string[]): Uint8Array | undefined {
  let found: Uint8Array | undefined;
  for (const line of logs) {
    const match = /^Program return: (\w+) ([A-Za-z0-9+/=]*)$/.exec(line);
    if (match !== null && match[1] === engine()) {
      found = new Uint8Array(getBase64Encoder().encode(match[2]!));
    }
  }

  return found;
}

/**
 * A transaction error, read: the Sauce program's thrown text when the ENGINE failed with its revert
 * code, a Kitchen error by name when the KITCHEN failed, and otherwise the code and the program it
 * came from. Custom codes collide across programs (every Anchor program numbers from 6000; System
 * and SPL Token both use 0), so a code is named only for the program the logs show failing.
 */
export function failureReason(
  err: unknown,
  logs: readonly string[],
  returnData?: Uint8Array,
): string {
  const detail = (err as { InstructionError?: [unknown, unknown] } | null)?.InstructionError;
  const custom = (detail?.[1] as { Custom?: unknown } | undefined)?.Custom;
  const program = failedProgram(logs);
  if (custom !== undefined) {
    const code = Number(custom);
    if (program === engine() && code === 0) {
      // A revert's payload is the engine's return data, which the node may leave out of a failed
      // simulation's answer; its log line carries it too.
      const payload = returnData?.length ? returnData : engineReturn(logs);
      const text =
        payload === undefined || payload.length === 0
          ? ""
          : new TextDecoder("utf-8", { fatal: false }).decode(payload);

      return /^[\x20-\x7e]+$/.test(text)
        ? `the program threw "${text}"`
        : `the program reverted${payload?.length ? ` with ${bytesToHex(payload)}` : ""}`;
    }
    const named = program === kitchen() ? kitchenErrors().get(code) : undefined;
    if (named !== undefined) return `the Kitchen refused: ${named}`;

    return (
      `${program === undefined ? `instruction ${detail![0]}` : `program ${program}`} failed with ` +
      `custom program error ${code} (0x${code.toString(16)}); the logs say why`
    );
  }
  if (detail !== undefined) {
    return `${program === undefined ? `instruction ${detail[0]}` : `program ${program}`} failed: ${String(detail[1])}`;
  }

  return JSON.stringify(err, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export interface SvmSent {
  readonly signature: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly computeUnits?: bigint;
  readonly logs: readonly string[];
}

/** Polls until `signature` is confirmed (or a minute passes); its error, or null. */
async function confirmed(rpc: Rpc, url: string, signature: string): Promise<unknown> {
  for (let tries = 0; tries < 120; tries++) {
    const { value } = await ask(url, "the transaction's status", () =>
      rpc.getSignatureStatuses([signature as Signature]).send(),
    );
    const status = value[0];
    if (status !== null && status !== undefined && status.confirmationStatus !== "processed") {
      return status.err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new CliError(`transaction ${signature} was not confirmed within a minute`);
}

/** Sends `transaction` and polls until it is confirmed (or fails, or a minute passes). */
async function sendAndConfirm(rpc: Rpc, url: string, transaction: Transaction): Promise<SvmSent> {
  const signature = getSignatureFromTransaction(transaction);
  await ask(url, "sending the transaction", () =>
    rpc
      .sendTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
        // Every transaction here was simulated first; the node need not do it again.
        skipPreflight: true,
      })
      .send(),
  );
  // The status is the verdict: it is what confirmed, and it carries the error.
  const statusErr = await confirmed(rpc, url, signature);
  // The transaction itself — its logs, units and return data — can lag its status on a node.
  let response;
  for (let tries = 0; ; tries++) {
    response = await ask(url, "the confirmed transaction", () =>
      rpc
        .getTransaction(signature, {
          commitment: "confirmed",
          encoding: "base64",
          maxSupportedTransactionVersion: 0,
        })
        .send(),
    );
    if (response !== null || tries >= 20) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const meta = response?.meta;
  const returnData =
    meta?.returnData === undefined || meta.returnData === null
      ? undefined
      : new Uint8Array(getBase64Encoder().encode(meta.returnData.data[0]));
  const err = statusErr ?? meta?.err ?? null;
  const logs = meta?.logMessages ?? [];

  return {
    signature,
    ok: err === null,
    ...(err === null ? {} : { reason: failureReason(err, logs, returnData) }),
    ...(meta?.computeUnitsConsumed === undefined
      ? {}
      : { computeUnits: meta.computeUnitsConsumed }),
    logs,
  };
}

/** Builds, rehearses and sends `instructions` from `signer`, failing with the logs if the
 *  rehearsal fails. */
async function sendInstructions(
  rpc: Rpc,
  url: string,
  signer: TransactionSigner,
  instructions: readonly Instruction[],
  what: string,
): Promise<SvmSent> {
  const { value: latestBlockhash } = await ask(url, "the latest blockhash", () =>
    rpc.getLatestBlockhash().send(),
  );
  const transaction = await buildExecuteTransaction({
    payer: signer,
    instructions,
    latestBlockhash,
  });
  const { value } = await ask(url, `a simulation of ${what}`, () =>
    rpc
      .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
        replaceRecentBlockhash: true,
      })
      .send(),
  );
  if (value.err !== null) {
    const logs = value.logs ?? [];
    throw new CliError(
      `${what} would fail, so nothing was sent: ${failureReason(value.err, logs)}\n${logs.join("\n")}`,
    );
  }

  return sendAndConfirm(rpc, url, transaction);
}

// ---------------------------------------------------------------------------------------------
// Accounts, the Pot, the cook
// ---------------------------------------------------------------------------------------------

/** `pot:<token>` or `owner:<token>`: that one's associated token account for a mint, named by a
 *  registered symbol (`USDC`) or its base58 address. */
const TOKEN_ACCOUNT = /^(pot|owner):([A-Za-z0-9]+)$/;

/** `--account name=<pubkey | pot | owner | pot:<token> | owner:<token>>`, parsed. */
export function parseAccounts(raws: readonly string[]): Record<string, string> {
  const accounts: Record<string, string> = {};
  for (const raw of raws) {
    const at = raw.indexOf("=");
    const name = raw.slice(0, at).trim();
    const value = raw.slice(at + 1).trim();
    if (at <= 0 || value === "") {
      throw new UsageError(
        `--account: expected NAME=<address | pot | owner | pot:<token>>, got '${raw}'`,
      );
    }
    if (Object.hasOwn(accounts, name)) throw new UsageError(`--account: ${name} given twice`);
    if (value !== "pot" && value !== "owner" && !isAddress(value) && !TOKEN_ACCOUNT.test(value)) {
      throw new UsageError(
        `--account ${name}: '${value}' is not an address, pot, owner, or a token account: ` +
          "pot:USDC is the Pot's own USDC account (pot:<mint> for any mint), owner:USDC the owner's",
      );
    }
    accounts[name] = value;
  }

  return accounts;
}

/** One `pot:<token>`/`owner:<token>` resolved: the account, and what it is for a person. */
interface TokenAccountNamed {
  readonly address: Address;
  readonly label: string;
}

/**
 * Each `--account` value that names a token account (`pot:USDC`, `owner:<mint>`) as that
 * account: the associated token account of the Pot (or the owner) for the mint, under the classic
 * SPL Token program — the one `@sauce/token` takes. A symbol is one of the cluster's registered
 * mints; any other mint is given by its base58 address. Every other value is left as it is.
 */
export async function resolveTokenAccounts(
  given: Readonly<Record<string, string>>,
  owner: Address,
  pot: Address,
  chain: CanonicalChain,
): Promise<{
  readonly accounts: Record<string, string>;
  readonly named: ReadonlyMap<string, TokenAccountNamed>;
}> {
  const accounts: Record<string, string> = {};
  const named = new Map<string, TokenAccountNamed>();
  const rows = svmTokenRows(chain);
  for (const [name, value] of Object.entries(given)) {
    const match = TOKEN_ACCOUNT.exec(value);
    if (match === null) {
      accounts[name] = value;
      continue;
    }
    const [, whose, token] = match as unknown as [string, "pot" | "owner", string];
    const row = rows.find((candidate) => candidate.symbol === token);
    if (row === undefined && !isAddress(token)) {
      throw new UsageError(
        `--account ${name}=${value}: ${token} is not a mint ${chain.slug} registers ` +
          `(${rows.map((candidate) => candidate.symbol).join(", ") || "none"}): give the mint's ` +
          `base58 address, ${whose}:<mint>`,
      );
    }
    const mint = address(row?.mint ?? token);
    const [account] = await findAssociatedTokenPda({
      owner: whose === "pot" ? pot : owner,
      mint,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    accounts[name] = account;
    named.set(name, {
      address: account,
      label: `${whose === "pot" ? "the Pot" : "the owner"}'s ${row?.symbol ?? `mint ${mint}`} account`,
    });
  }

  return { accounts, named };
}

/**
 * Each slot of the manifest resolved from `--account`. The Pot goes in unsigned: the Kitchen signs
 * for it. The owner signs when the slot asks for a signer — with `signer` when there is one.
 */
function resolution(
  manifest: AccountManifest,
  given: Readonly<Record<string, string>>,
  owner: Address,
  pot: Address,
  signer: TransactionSigner,
): AccountResolution {
  const slots = manifest.accounts.filter((entry) => entry.kind === "slot");
  if (manifest.accounts.some((entry) => entry.kind === "remaining")) {
    throw new UsageError(
      "the program takes a variable list of accounts after its named ones, which the CLI cannot " +
        "attach yet: build that cook with the SDK's Solana client",
    );
  }
  const names = slots.map((slot) => slot.name);
  const unknown = Object.keys(given).filter((name) => !names.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(
      `--account ${unknown[0]}: the program has no account by that name` +
        (names.length === 0 ? "" : `; it takes ${names.join(", ")}`),
    );
  }
  const missing = slots.filter((slot) => !Object.hasOwn(given, slot.name));
  if (missing.length > 0) {
    throw new UsageError(
      `missing --account for ${missing.map((slot) => `${slot.name} (${slot.requires})`).join(", ")}: ` +
        "pass --account NAME=<address | pot | owner> for each",
    );
  }
  const resolved: AccountResolution = {};
  for (const slot of slots) {
    const value = given[slot.name]!;
    const at = value === "pot" ? pot : value === "owner" ? owner : address(value);
    resolved[slot.name] =
      at === pot ? { address: pot, signer: false } : at === owner ? { address: owner, signer } : at;
  }

  return resolved;
}

export interface SvmTarget extends SaltChoice {
  readonly owner: Address;
}

const saltBytes = (salt: Hex): Uint8Array => hexToBytes(salt);

const potOf = async (target: SvmTarget): Promise<Address> =>
  (await derivePotPda(kitchen(), target.owner, saltBytes(target.salt))).address;

/** Whether the Kitchen has created `target`'s Pot on the cluster `rpcUrl` serves. */
export async function svmPotExists(target: SvmTarget, rpcUrl: string): Promise<boolean> {
  return exists(createSolanaRpc(rpcUrl), rpcUrl, await potOf(target), "the Pot");
}

/** The Pot's associated token account for one registered mint, and what it holds. */
export interface SvmPotTokenAccount {
  readonly symbol: string;
  readonly mint: string;
  readonly decimals: number;
  /** The associated token account of the Pot for the mint (classic SPL Token). */
  readonly account: Address;
  readonly exists: boolean;
  /** Base units, as a decimal string; `null` while the account does not exist. */
  readonly balance: string | null;
}

/**
 * The Pot's associated token account for every mint the chain's cluster registers — each one a
 * classic SPL Token mint (the registry's own gate) — whether it exists, and its balance.
 */
export async function svmPotTokenAccounts(
  target: SvmTarget,
  rpcUrl: string,
  chain: CanonicalChain,
): Promise<readonly SvmPotTokenAccount[]> {
  const pot = await potOf(target);
  const rpc = createSolanaRpc(rpcUrl);

  return Promise.all(
    svmTokenRows(chain).map(async (row) => {
      const [account] = await findAssociatedTokenPda({
        owner: pot,
        mint: address(row.mint),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const base = { symbol: row.symbol, mint: row.mint, decimals: row.decimals, account };
      if (!(await exists(rpc, rpcUrl, account, `the Pot's ${row.symbol} account`))) {
        return { ...base, exists: false, balance: null };
      }
      const { value } = await ask(rpcUrl, `the Pot's ${row.symbol} balance`, () =>
        rpc.getTokenAccountBalance(account).send(),
      );

      return { ...base, exists: true, balance: value.amount };
    }),
  );
}

/** Names for the accounts a cook writes: the owner, the Pot, the Kitchen's fee config (where its
 *  fee goes), and each `--account` by its name (a token account named `pot:USDC` as what it is). */
async function accountLabels(
  input: SvmCookInput,
  pot: Address,
  given: Prepared["given"],
): Promise<Map<string, string>> {
  const labels = new Map<string, string[]>();
  const add = (account: string, name: string) =>
    labels.set(account, [...(labels.get(account) ?? []), name]);
  add(input.owner, "the owner");
  add(pot, "the Pot");
  add((await deriveExecutionFeeConfigPda(kitchen())).address, "the Kitchen's fee config");
  for (const [name, value] of Object.entries(given.accounts)) {
    const token = given.named.get(name);
    if (value !== "pot" && value !== "owner")
      add(value, token === undefined ? name : `${name}, ${token.label}`);
  }

  return new Map([...labels].map(([account, names]) => [account, names.join(", ")]));
}

/**
 * A note for each account `--account` names that the cluster does not have: a program reading it
 * fails, and SVM guards fail with no message, so this says which. A token account the Pot or the
 * owner has not had created yet says how one comes to be.
 */
async function missingAccounts(rpc: Rpc, url: string, given: Prepared["given"]): Promise<string[]> {
  const named = Object.entries(given.accounts).filter(
    ([, value]) => value !== "pot" && value !== "owner",
  );
  const there = await Promise.all(
    named.map(([name, value]) => exists(rpc, url, address(value), `the account ${name}`)),
  );

  return named.flatMap(([name, value], index) => {
    if (there[index]) return [];
    const token = given.named.get(name);

    return [
      `--account ${name}: ${value} does not exist on solana` +
        (token === undefined
          ? ""
          : ` (${token.label}: nothing has created it yet; a wallet's SPL transfer to the ` +
            "account's owner creates it, or create it with an associated-token-account " +
            "instruction)"),
    ];
  });
}

/** The `sauce pot` that creates `target`'s Pot. */
const createHint = (target: SvmTarget): string =>
  `sauce pot --deploy --chain solana --keypair <the owner's keypair>${target.flag === undefined ? "" : ` ${target.flag}`}`;

const createPotInstruction = (target: SvmTarget, pot: Address): Instruction =>
  buildCreatePotInstruction({
    kitchen: kitchen(),
    owner: target.owner,
    engineProgram: engine(),
    pot,
    salt: saltBytes(target.salt),
    space: MAX_POT_LEN,
  });

/**
 * A value of `type` with every `Address` in it as the word the engine reads on Solana: the public
 * key's 32 bytes, whole. A key is given in base58, or as 32 bytes of hex.
 */
function keyWords(type: EntryType, value: EntryValue, at: string): EntryValue {
  switch (type.kind) {
    case "address": {
      if (typeof value === "string" && isAddress(value)) {
        return bytesToHex(new Uint8Array(getAddressEncoder().encode(address(value))));
      }
      if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return value;
      throw new TypeError(
        `${at}: ${JSON.stringify(value)} is not a Solana public key (base58, or 32 bytes of hex)`,
      );
    }
    case "array":
      return Array.isArray(value)
        ? value.map((item, index) => keyWords(type.of, item, `${at}[${index}]`))
        : value;
    case "tuple": {
      if (Array.isArray(value)) {
        return value.map((item, index) =>
          index < type.fields.length
            ? keyWords(type.fields[index]!.type, item, `${at}.${type.fields[index]!.name}`)
            : item,
        );
      }
      if (value === null || typeof value !== "object" || value instanceof Uint8Array) return value;
      const record = value as { readonly [field: string]: EntryValue };

      return Object.fromEntries(
        Object.entries(record).map(([name, item]) => {
          const field = type.fields.find((candidate) => candidate.name === name);

          return [name, field === undefined ? item : keyWords(field.type, item, `${at}.${name}`)];
        }),
      );
    }
    default:
      return value;
  }
}

/**
 * The program and its arguments. On Solana the engine reads an `Address` argument as a whole
 * 32-byte word, a public key, where the EVM's ABI encoding keeps 20 bytes: each is encoded as that
 * word, from base58 (or 32 bytes of hex).
 */
function svmPayload(program: CompiledSauceProgram, args: ArgsInput | undefined): Uint8Array {
  const keyed = program.entryParams.some((param) => /\bAddress\b/.test(param.type));
  if (keyed && program.entryEncoding === "compact-v1") {
    throw new UsageError(
      "--compact-args: an Address argument on Solana is encoded as an ABI-v1 word only; compile " +
        "without --compact-args, or take the key as an Account parameter or a define",
    );
  }

  return hexToBytes(
    payloadOf(
      program,
      args,
      keyed
        ? (compiled, values) => ({
            program: {
              ...compiled,
              entryParams: compiled.entryParams.map((param) => ({
                ...param,
                type: param.type.replace(/\bAddress\b/g, "Uint256"),
              })),
            },
            values: values.map((value, index) => {
              const param = compiled.entryParams[index];

              return param === undefined
                ? value
                : keyWords(parseEntryType(param.type), value, `${param.name}`);
            }),
          })
        : undefined,
    ),
  );
}

export interface SvmCookInput extends ProgramInput, SvmTarget {
  readonly accounts: Readonly<Record<string, string>>;
  readonly args?: ArgsInput;
  readonly rpcUrl: string;
}

interface Prepared {
  readonly rpc: Rpc;
  readonly pot: Address;
  readonly fee: bigint;
  readonly program: CompiledSauceProgram;
  readonly bytecode: Uint8Array;
  readonly client: SauceSvmClient;
  readonly accounts: AccountResolution;
  readonly manifest: AccountManifest;
  /** `--account`'s values with every `pot:<token>` resolved to its account. */
  readonly given: Awaited<ReturnType<typeof resolveTokenAccounts>>;
}

/** Compiles the file, reads the fee, and builds the SDK client that cooks it as `signer`. */
async function prepare(
  input: SvmCookInput,
  files: CliFiles,
  signer: TransactionSigner,
): Promise<Prepared> {
  refusePastDeadline(input);
  const program = compileProgram(input, files);
  const bytecode = svmPayload(program, input.args);
  const manifest = program.manifest ?? { accounts: [] };
  const rpc = createSolanaRpc(input.rpcUrl);
  const pot = await potOf(input);
  const given = await resolveTokenAccounts(input.accounts, input.owner, pot, input.chain);
  const accounts = resolution(manifest, given.accounts, input.owner, pot, signer);
  const fee = await kitchenFee(rpc, input.rpcUrl);
  const client = await createSauceSvmClient({
    rpcUrl: input.rpcUrl,
    programId: engine(),
    kitchen: kitchen(),
    payer: signer,
    potSalt: saltBytes(input.salt),
    maxExecutionFee: fee,
  });

  return { rpc, pot, fee, program, bytecode, client, accounts, manifest, given };
}

/**
 * Whether the cook carrying `bytecode` fits in one transaction — measured as `run` sends it, with
 * the SetComputeUnitLimit instruction its rehearsal adds (any limit encodes to the same size).
 */
async function fits(
  prepared: Prepared,
  prepends: readonly Instruction[] = [],
): Promise<{ fits: boolean; size: number; transaction: Transaction }> {
  const transaction = await prepared.client.cookTransaction(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
    { computeUnitLimit: 1_400_000, prepends },
  );
  const size = getTransactionSize(transaction);

  return { fits: size <= TRANSACTION_SIZE_LIMIT, size, transaction };
}

/** A placeholder key, distinct per `index`, for an account a size estimate has no address for. */
const placeholderKey = (index: number): Address =>
  getBase58Decoder().decode(new Uint8Array(32).fill(index + 1)) as Address;

/** Whether a cook fits one transaction, measured without a cluster. */
export interface SvmCookSize {
  readonly size: number;
  readonly limit: number;
  readonly fits: boolean;
  /** The slots measured with a placeholder: no `--account` named them. */
  readonly assumed: readonly string[];
  /** The program reads accounts after its named ones, which add to the size. */
  readonly remaining: boolean;
}

/**
 * The size of the cook that carries `bytecode` inline, offline: the transaction `run` sends (heap
 * frame, compute-unit limit, the Kitchen's `cook`) for `manifest`, with each account `--account`
 * gives where it is given — `pot` and `owner` are the cook's own — and a distinct account for every
 * other slot, so a size is the most those slots can make it. The blockhash and signature are fixed
 * widths, so a placeholder of each measures the same.
 */
export async function svmCookSize(
  bytecode: Uint8Array,
  manifest: AccountManifest,
  given: Readonly<Record<string, string>>,
): Promise<SvmCookSize> {
  const owner = placeholderKey(0);
  const target: SvmTarget = { owner, salt: `0x${"00".repeat(32)}` };
  const pot = await potOf(target);
  // A token account (`pot:USDC`) is a distinct account of its own, as it is in a real cook.
  const accountsGiven = (await resolveTokenAccounts(given, owner, pot, requireChain("solana")))
    .accounts;
  const slots = manifest.accounts.filter((entry) => entry.kind === "slot");
  const assumed = slots.filter((slot) => !Object.hasOwn(given, slot.name)).map((s) => s.name);
  const named: AccountManifest = { accounts: slots };
  const signer = unsignedSigner(owner);
  // The accounts given, as a cook resolves them; every other slot a distinct account, which signs
  // for itself where the slot asks for a signer.
  const resolved: AccountResolution = resolution(
    named,
    Object.fromEntries(slots.map((slot) => [slot.name, accountsGiven[slot.name] ?? "pot"])),
    owner,
    pot,
    signer,
  );
  slots.forEach((slot, index) => {
    if (Object.hasOwn(given, slot.name)) return;
    const at = placeholderKey(index + 1);
    resolved[slot.name] = /signer/.test(slot.requires)
      ? { address: at, signer: unsignedSigner(at) }
      : at;
  });
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen());
  const cook = buildCookInstruction({
    kitchen: kitchen(),
    owner,
    engineProgram: engine(),
    potSalt: saltBytes(target.salt),
    pot,
    feeConfig,
    bytecode,
    maxExecutionFee: 0n,
    tail: resolveAccounts(named, resolved, owner),
  });
  const transaction = await buildExecuteTransaction({
    payer: signer,
    instructions: [
      buildHeapFramePrepend(),
      ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
      cook,
    ],
    latestBlockhash: {
      blockhash: placeholderKey(254) as unknown as Blockhash,
      lastValidBlockHeight: 0n,
    },
  });
  const size = getTransactionSize(transaction);

  return {
    size,
    limit: TRANSACTION_SIZE_LIMIT,
    fits: size <= TRANSACTION_SIZE_LIMIT,
    assumed,
    remaining: manifest.accounts.some((entry) => entry.kind === "remaining"),
  };
}

/** The payload a cook carries — the program, and the arguments appended to it — in bytes. */
const payloadSize = (prepared: Prepared): string => {
  const program = prepared.program.bytecode.length;
  const payload = prepared.bytecode.length;

  return payload === program
    ? `the payload (the program, with no arguments) is ${payload} bytes`
    : `the payload (the program's ${program} bytes and its arguments' ${payload - program}) is ` +
        `${payload} bytes`;
};

/** A cook too large for one transaction, for `what` (a simulation, an unsigned transaction). */
const tooLarge = (prepared: Prepared, size: number, what: string): CliError => {
  const over = size - TRANSACTION_SIZE_LIMIT;

  return new CliError(
    `${payloadSize(prepared)}, so its cook is a ${size}-byte transaction, ${over} past Solana's ` +
      `${TRANSACTION_SIZE_LIMIT}. A cook that large runs from a code buffer the program is staged ` +
      `into first, in transactions the owner signs and sends, which ${what} cannot do. Shrink the ` +
      `payload by at least ${over} bytes to fit, or let \`sauce run\` stage it (with the owner's ` +
      "--keypair; it rehearses the staged cook before sending it).",
  );
};

const simulated = (result: SimulateExecuteResult): string =>
  failureReason(result.err, result.logs, result.revert?.payload);

/** The lamports a cook takes from its owner, and what the owner holds, when it holds less. */
async function ownerShort(
  prepared: Prepared,
  input: SvmCookInput,
  creating: boolean,
): Promise<string | undefined> {
  try {
    const [held, rent] = await Promise.all([
      prepared.rpc.getBalance(input.owner).send(),
      creating
        ? prepared.rpc.getMinimumBalanceForRentExemption(BigInt(MAX_POT_LEN)).send()
        : Promise.resolve(0n),
    ]);
    // One signature's fee on top: the owner pays the transaction's too.
    const needed = BigInt(rent) + prepared.fee + 5_000n;
    if (BigInt(held.value) >= needed) return undefined;

    return (
      `${input.owner} holds ${held.value} lamports, and the cook takes ${needed}: ` +
      (creating ? `${rent} in rent for the Pot, ` : "") +
      `the Kitchen's fee of ${prepared.fee} and the transaction's. Solana's simulateTransaction ` +
      "takes no balance overrides, so the owner must hold them for a rehearsal too"
    );
  } catch {
    return undefined;
  }
}

/**
 * `sauce simulate` on Solana: the cook, simulated from the Pot's owner with no key — and, for a
 * Pot the Kitchen has not created yet, its `create_pot` first, in the same transaction.
 */
export async function svmSimulateCommand(
  input: SvmCookInput,
  files: CliFiles,
): Promise<CommandOutput> {
  const prepared = await prepare(input, files, unsignedSigner(input.owner));
  // The size first: it is the program's own, whatever the cluster holds.
  const alone = await fits(prepared);
  if (!alone.fits) throw tooLarge(prepared, alone.size, "a simulation, which sends nothing,");
  const created = await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot");
  const prepends = created ? [] : [createPotInstruction(input, prepared.pot)];
  let built = alone.transaction;
  if (!created) {
    const together = await fits(prepared, prepends);
    built = together.transaction;
    if (!together.fits) {
      const over = together.size - TRANSACTION_SIZE_LIMIT;
      throw new CliError(
        `Pot ${prepared.pot} is not created on solana yet, and its create_pot ahead of the cook ` +
          `makes a ${together.size}-byte transaction, ${over} past Solana's ` +
          `${TRANSACTION_SIZE_LIMIT}: create the Pot first (${createHint(input)}), or shrink the ` +
          `payload by at least ${over} bytes`,
      );
    }
  }
  // What the cook moved: every account it may write, read now and as the simulation leaves it.
  const tracked = writableAccounts(built);
  const before = await ask(input.rpcUrl, "the accounts the cook writes", () =>
    accountsNow(prepared.rpc, tracked),
  );
  const result = await prepared.client.simulate(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
    { prepends, accounts: tracked },
  );
  const moved =
    result.ok && result.accounts !== undefined
      ? await movedBy(
          prepared.rpc,
          input.chain,
          tracked,
          before,
          result.accounts,
          await accountLabels(input, prepared.pot, prepared.given),
          input.owner,
        )
      : undefined;
  const missing = await missingAccounts(prepared.rpc, input.rpcUrl, prepared.given);
  // What main returned: the engine's return data, read as the type main declares.
  const returns = result.ok ? bytesToHex(result.returnData ?? new Uint8Array()) : undefined;
  const returnType = mainReturnType(input.text);
  const json = {
    ok: result.ok,
    chain: "solana",
    owner: input.owner,
    pot: prepared.pot,
    fee: prepared.fee.toString(),
    path: "simulateTransaction",
    ...(returns === undefined ? {} : { returns }),
    ...(returns === undefined || returnType === undefined
      ? {}
      : { returnType, returned: decodeReturned(returnType, returns, input.chain) ?? null }),
    ...(missing.length === 0 ? {} : { missingAccounts: missing }),
    createPot: created ? null : { kitchen: kitchen(), owner: input.owner, salt: input.salt },
    ...(result.unitsConsumed === undefined
      ? {}
      : { computeUnits: result.unitsConsumed.toString() }),
    ...(result.ok ? {} : { reason: simulated(result) }),
    ...(result.ok ? (moved === undefined ? { moved: null } : svmMovedJson(moved)) : {}),
    logs: result.logs,
  };
  const how = [
    "Rehearsed with simulateTransaction, signatures unchecked; nothing was signed or sent:",
    ...(created
      ? []
      : [
          `  1. Kitchen create_pot: Pot ${prepared.pot} is not created on solana yet, so the ` +
            "transaction creates it first, the owner signing and paying its rent",
        ]),
    `  ${created ? "" : "2. "}the cook, from the owner ${input.owner}`,
  ];
  if (result.ok) {
    return {
      text: [
        `The cook succeeds from ${input.owner}: ${result.unitsConsumed ?? "?"} compute units` +
          (returns === undefined || returns === "0x" ? "" : `, returns ${returns}`),
        ...(returns === undefined || returnType === undefined
          ? []
          : [returnedLine(returnType, returns, input.chain)]),
        ...how,
        ...(moved === undefined ? [] : svmMovedLines(moved)),
      ].join("\n"),
      json,
      ...(moved === undefined || missing.length > 0
        ? {
            notes: [
              ...missing,
              ...(moved === undefined
                ? [
                    "the endpoint returned no account states from simulateTransaction, so what " +
                      "the cook moved is not shown",
                  ]
                : []),
            ],
          }
        : {}),
    };
  }
  const short = await ownerShort(prepared, input, !created);

  return {
    text: [
      `The cook fails: ${simulated(result)}`,
      ...how,
      "Program logs:",
      ...result.logs.map((l) => `  ${l}`),
    ].join("\n"),
    json,
    ...(short === undefined && missing.length === 0
      ? {}
      : { notes: [...missing, ...(short === undefined ? [] : [short])] }),
    exitCode: 1,
  };
}

/** `sauce tx` on Solana: the cook as an unsigned, serialized transaction for a wallet. */
export async function svmTxCommand(input: SvmCookInput, files: CliFiles): Promise<CommandOutput> {
  const prepared = await prepare(input, files, unsignedSigner(input.owner));
  const size = await fits(prepared);
  if (!size.fits) throw tooLarge(prepared, size.size, "one unsigned transaction");
  const deployed = await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot");
  const transaction = await prepared.client.cookTransaction(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
    {},
  );
  const json = {
    chain: "solana",
    feePayer: input.owner,
    pot: prepared.pot,
    fee: prepared.fee.toString(),
    transaction: getBase64EncodedWireTransaction(transaction),
  };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [
      `Pot ${prepared.pot} belongs to ${input.owner} (salt ${input.salt}). ` +
        (deployed
          ? "It is created. Fund its accounts with what the program spends."
          : `It is NOT created yet: ${createHint(input)}.`),
      `The transaction is base64, signed by no one; ${input.owner} signs it and pays the ` +
        `Kitchen's fee of ${prepared.fee} lamports. Its blockhash expires in about a minute.`,
    ],
  };
}

interface Staged {
  readonly codeBuffer: Address;
  readonly code: Address;
  readonly sha256: Uint8Array;
  readonly sent: readonly SvmSent[];
}

/**
 * Closes a code buffer, returning its rent. Never throws: a failure is the reason it stays open,
 * which the caller reports with the buffer's address.
 */
async function closeBuffer(
  rpc: Rpc,
  url: string,
  signer: TransactionSigner,
  buffer: { readonly codeBuffer: Address; readonly code: Address },
): Promise<{ sent?: SvmSent; open?: string }> {
  try {
    const sent = await sendInstructions(
      rpc,
      url,
      signer,
      [
        buildCloseCodeBufferInstruction({
          kitchen: kitchen(),
          owner: signer.address,
          codeBuffer: buffer.codeBuffer,
          code: buffer.code,
        }),
      ],
      "closing the code buffer",
    );
    if (sent.ok) return { sent };

    return {
      sent,
      open: `the code buffer ${buffer.codeBuffer} is still open (closing it failed in ${sent.signature}: ${sent.reason}); its rent stays there until it is closed`,
    };
  } catch (error) {
    return {
      open: `the code buffer ${buffer.codeBuffer} is still open (closing it failed: ${(error as Error).message.split("\n")[0]}); its rent stays there until it is closed`,
    };
  }
}

/**
 * Stages `bytecode` in a fresh code buffer: create, grow, write in chunks, finalize. A failure
 * after the buffer exists closes it again, and says so — or names it, when that fails too.
 */
async function stage(
  rpc: Rpc,
  url: string,
  signer: TransactionSigner,
  bytecode: Uint8Array,
): Promise<Staged> {
  const nonce = randomBytes(8).readBigUInt64LE(0);
  const { address: codeBuffer } = await deriveCodeBufferPda(kitchen(), signer.address, nonce);
  const { address: code } = await deriveCodePda(kitchen(), codeBuffer);
  const accounts = { kitchen: kitchen(), owner: signer.address, codeBuffer, code };
  const sent: SvmSent[] = [];
  const step = async (instructions: readonly Instruction[], what: string): Promise<void> => {
    const result = await sendInstructions(rpc, url, signer, instructions, what);
    sent.push(result);
    if (!result.ok) {
      throw new CliError(`${what} failed in ${result.signature}: ${result.reason}`);
    }
  };
  const grows = Math.ceil(bytecode.length / GROWTH_STEP) - 1;
  try {
    await step(
      [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: bytecode.length }),
        ...Array.from({ length: grows }, () => buildGrowCodeBufferInstruction(accounts)),
      ],
      "creating the code buffer",
    );
  } catch (error) {
    throw new CliError(`staging the program failed: ${(error as Error).message}`);
  }
  const sha256 = new Uint8Array(createHash("sha256").update(bytecode).digest());
  try {
    // A write carries its chunk plus ~200 bytes of signature, header and accounts.
    const CHUNK = 900;
    for (let offset = 0; offset < bytecode.length; offset += CHUNK) {
      await step(
        [
          buildWriteCodeBufferInstruction({
            ...accounts,
            offset,
            chunk: bytecode.subarray(offset, offset + CHUNK),
          }),
        ],
        `writing bytes ${offset}… of the program`,
      );
    }
    await step(
      [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: bytecode.length,
          expectedSha256: sha256,
        }),
      ],
      "finalizing the code buffer",
    );
  } catch (error) {
    const closed = await closeBuffer(rpc, url, signer, { codeBuffer, code });
    throw new CliError(
      `staging the program failed: ${(error as Error).message}\n` +
        (closed.open ?? `The code buffer ${codeBuffer} was closed again.`),
    );
  }

  return { codeBuffer, code, sha256, sent };
}

export interface SvmRunInput extends SvmCookInput {
  readonly signer: KeyPairSigner;
  readonly approver: Approver;
}

const sentLine = (what: string, sent: SvmSent): string =>
  `${what} ${sent.signature}: ${sent.ok ? "success" : "failed"}` +
  (sent.computeUnits === undefined ? "" : `, ${sent.computeUnits} compute units`) +
  (sent.reason === undefined ? "" : `, ${sent.reason}`);

const sentJson = (sent: SvmSent): Record<string, unknown> => ({
  signature: sent.signature,
  status: sent.ok ? "success" : "failed",
  ...(sent.computeUnits === undefined ? {} : { computeUnits: sent.computeUnits.toString() }),
  ...(sent.reason === undefined ? {} : { reason: sent.reason, logs: sent.logs }),
});

/** Creates the Pot when it is missing and the user agrees; what was sent, if anything. */
async function ensurePot(input: SvmRunInput, rpc: Rpc, pot: Address): Promise<SvmSent | undefined> {
  if (await exists(rpc, input.rpcUrl, pot, "the Pot")) return undefined;
  const missing = `Pot ${pot} is not deployed on solana`;
  const action = `create Pot ${pot}`;
  // With no one to ask, creating it is the one approval a Solana run needs: named before it sends.
  if (!input.approver.auto && !input.approver.canAsk) throw unapproved([action]);
  const agreed = await input.approver.approve(
    action,
    `Pot ${pot} (owner ${input.owner}, salt ${input.salt}) is not deployed on solana. ` +
      "Deploy it now? [y/N] ",
  );
  if (agreed !== true) {
    throw new CliError(
      agreed === undefined
        ? `${missing}. Create it first (${createHint(input)}), or pass --auto-approve to create ` +
            "it before the cook"
        : `${missing}, so nothing was sent. Create it with: ${createHint(input)}`,
    );
  }
  const created = await sendInstructions(
    rpc,
    input.rpcUrl,
    input.signer,
    [createPotInstruction(input, pot)],
    "creating the Pot",
  );
  if (!created.ok) throw new CliError(sentLine("creating the Pot", created));
  await awaitAccount(rpc, input.rpcUrl, pot, "the Pot");

  return created;
}

/** `sauce run` on Solana: compile, create the Pot if agreed, stage if needed, cook, confirm. */
export async function svmRunCommand(input: SvmRunInput, files: CliFiles): Promise<CommandOutput> {
  const prepared = await prepare(input, files, input.signer);
  const created = await ensurePot(input, prepared.rpc, prepared.pot);
  const size = await fits(prepared);
  // The cook's rehearsal failing: `computeUnitLimit: "auto"` simulates first, and its failure
  // carries the reason — read again, with the logs, to report it.
  const wouldFail = async (error: unknown, staged?: Staged): Promise<never> => {
    const logs = await rehearsalLogs(prepared, staged);
    const closed =
      staged === undefined
        ? undefined
        : await closeBuffer(prepared.rpc, input.rpcUrl, input.signer, staged);
    throw new CliError(
      `the cook would fail, so it was not sent: ${logs.reason ?? (error as Error).message}` +
        (logs.lines.length === 0
          ? ""
          : `\nProgram logs:\n${logs.lines.map((l) => `  ${l}`).join("\n")}`) +
        (closed === undefined
          ? ""
          : `\n${closed.open ?? `The code buffer ${staged!.codeBuffer} was closed again.`}`),
    );
  };
  let staged: Staged | undefined;
  let transaction: Transaction;
  if (size.fits) {
    try {
      transaction = await prepared.client.cookTransaction(
        prepared.bytecode,
        prepared.manifest,
        prepared.accounts,
        { computeUnitLimit: "auto" },
      );
    } catch (error) {
      return wouldFail(error);
    }
  } else {
    staged = await stage(prepared.rpc, input.rpcUrl, input.signer, prepared.bytecode);
    try {
      transaction = await prepared.client.stagedCookTransaction(
        staged.codeBuffer,
        prepared.manifest,
        prepared.accounts,
        { computeUnitLimit: "auto" },
      );
    } catch (error) {
      return wouldFail(error, staged);
    }
  }
  const cook = await sendAndConfirm(prepared.rpc, input.rpcUrl, transaction);
  // The cook has landed (or failed) by now: whatever happens to the buffer, it is reported.
  const closed =
    staged === undefined
      ? undefined
      : await closeBuffer(prepared.rpc, input.rpcUrl, input.signer, staged);

  return {
    text: [
      ...(created === undefined ? [] : [sentLine(`created Pot ${prepared.pot} in`, created)]),
      ...(staged === undefined
        ? []
        : [
            `staged the ${prepared.bytecode.length}-byte program in ${staged.sent.length} transactions`,
          ]),
      sentLine("cook", cook),
      ...(cook.ok ? [] : ["Program logs:", ...cook.logs.map((line) => `  ${line}`)]),
      ...(closed?.sent === undefined || closed.open !== undefined
        ? []
        : [sentLine("closed the code buffer in", closed.sent)]),
    ].join("\n"),
    ...(closed?.open === undefined ? {} : { notes: [`warning: ${closed.open}`] }),
    json: {
      chain: "solana",
      owner: input.owner,
      pot: prepared.pot,
      fee: prepared.fee.toString(),
      ...(created === undefined ? {} : { createPot: sentJson(created) }),
      ...(staged === undefined
        ? {}
        : {
            staged: {
              codeBuffer: staged.codeBuffer,
              sha256: bytesToHex(staged.sha256),
              transactions: staged.sent.map((step) => step.signature),
            },
          }),
      cook: sentJson(cook),
      ...(closed?.sent === undefined ? {} : { closeCodeBuffer: sentJson(closed.sent) }),
      ...(closed?.open === undefined ? {} : { warning: closed.open }),
    },
    ...(cook.ok ? {} : { exitCode: 1 }),
  };
}

/** The reason and logs of the cook's rehearsal, for a run that stops before sending. */
async function rehearsalLogs(
  prepared: Prepared,
  staged: { readonly codeBuffer: Address } | undefined,
): Promise<{ reason?: string; lines: readonly string[] }> {
  try {
    const result =
      staged === undefined
        ? await prepared.client.simulate(prepared.bytecode, prepared.manifest, prepared.accounts)
        : await prepared.client.simulateStaged(
            staged.codeBuffer,
            prepared.manifest,
            prepared.accounts,
          );

    return result.ok ? { lines: result.logs } : { reason: simulated(result), lines: result.logs };
  } catch {
    return { lines: [] };
  }
}

// ---------------------------------------------------------------------------------------------
// `sauce verify` on Solana
// ---------------------------------------------------------------------------------------------

export interface SvmVerifyInput {
  readonly signature: string;
  readonly rpcUrl: string;
  /** What the settle must enforce: both are compiled into an SVM settle, so a recompile pins them. */
  readonly minOut: bigint;
  readonly splCount: bigint;
}

/**
 * `sauce verify --chain solana <signature>`: the engine invocation a cook made, checked by the
 * SDK's `verifySvmSettleExecution` against the settle program recompiled for `minOut` and
 * `splCount`. A rejection exits 1: `TX_FAILED` when the transaction failed, `NO_SETTLE` when it
 * invokes no released engine or not with a settle's accounts, `NOT_GENUINE` with the SDK's reason
 * otherwise.
 */
export async function svmVerifyCommand(input: SvmVerifyInput): Promise<CommandOutput> {
  const rpc = createSolanaRpc(input.rpcUrl);
  const response = await ask(input.rpcUrl, "the transaction", () =>
    rpc
      .getTransaction(input.signature as Parameters<Rpc["getTransaction"]>[0], {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      })
      .send(),
  );
  if (response === null) throw new CliError(`no transaction ${input.signature} on solana`);
  const loaded = response.meta?.loadedAddresses;
  const keys = [
    ...response.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
  const invocation = (response.meta?.innerInstructions ?? [])
    .flatMap((group) => group.instructions)
    .find((inner) => keys[inner.programIdIndex] === engine());
  const rejected = (code: string, message: string): CommandOutput => ({
    text: `rejected (${code}): ${message}`,
    json: { signature: input.signature, chain: "solana", valid: false, code, message },
    exitCode: 1,
  });
  // A transaction that failed settled nothing, whatever its instructions carry.
  const failed = response.meta?.err ?? null;
  if (failed !== null) {
    return rejected(
      "TX_FAILED",
      `the transaction failed (${failureReason(failed, response.meta?.logMessages ?? [])}), so it settled nothing`,
    );
  }
  if (invocation === undefined) {
    return rejected(
      "NO_SETTLE",
      `the transaction does not invoke the released engine (${engine()})`,
    );
  }
  let verified: SvmSettleExecutionVerification;
  try {
    verified = verifySvmSettleExecution({
      instructionData: new Uint8Array(getBase58Encoder().encode(invocation.data)),
      accounts: invocation.accounts.map((index) => keys[index]!),
      minOut: input.minOut,
      splCount: input.splCount,
    });
  } catch (error) {
    return rejected("NO_SETTLE", (error as Error).message);
  }
  if (!verified.genuine)
    return rejected("NOT_GENUINE", verified.mismatch ?? "not the settle program");
  const accounts = Object.entries(verified.accounts).map(([ref, at]) => `${ref} ${at}`);

  return {
    text: [
      `valid: the settle program, sweeping ${verified.escrowCount} escrow${verified.escrowCount === 1 ? "" : "s"} ` +
        `(minOut ${input.minOut}, splCount ${input.splCount})`,
      ...(verified.gate === undefined
        ? []
        : [`  Pot        ${verified.gate.pot}, owner ${verified.gate.owner}`]),
      ...accounts.map((line) => `  ${line}`),
      `  verified by ${verified.verifiedBy}`,
    ].join("\n"),
    json: {
      signature: input.signature,
      chain: "solana",
      valid: true,
      escrowCount: verified.escrowCount,
      minOut: input.minOut.toString(),
      splCount: input.splCount.toString(),
      accounts: verified.accounts,
      ...(verified.gate === undefined
        ? {}
        : { pot: verified.gate.pot, owner: verified.gate.owner }),
      verifiedBy: verified.verifiedBy,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// `sauce pot` on Solana
// ---------------------------------------------------------------------------------------------

const ROLE_NAMES = ["readonly", "writable", "readonly signer", "writable signer"] as const;

/** `sauce pot --chain solana`: the Pot PDA an owner and salt give, and its create instruction. */
export async function svmPotCommand(target: SvmTarget): Promise<CommandOutput> {
  const pot = await potOf(target);
  const instruction = createPotInstruction(target, pot);
  const json = {
    chain: "solana",
    pot,
    owner: target.owner,
    salt: target.salt,
    kitchen: kitchen(),
    engine: engine(),
    instruction: {
      programAddress: instruction.programAddress,
      accounts: (instruction.accounts ?? []).map((meta) => ({
        address: meta.address,
        role: ROLE_NAMES[meta.role],
      })),
      data: getBase58Decoder().decode(instruction.data ?? new Uint8Array()),
    },
  };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [
      `Kitchen create_pot on the released Kitchen. ${target.owner} signs it and pays the rent; ` +
        "it creates the Pot once.",
    ],
  };
}

/** The released programs on the cluster, and the Pot: what a cook there needs. */
async function deployment(
  rpc: Rpc,
  url: string,
  pot: Address,
): Promise<{ json: Record<string, unknown>; notes: string[] }> {
  const program = async (at: Address, what: string): Promise<boolean> => {
    const { value } = await ask(url, what, () =>
      rpc.getAccountInfo(at, { encoding: "base64" }).send(),
    );

    return value !== null && value.executable;
  };
  const [engineThere, kitchenThere, potThere] = await Promise.all([
    program(engine(), "the engine program"),
    program(kitchen(), "the Kitchen program"),
    exists(rpc, url, pot, "the Pot"),
  ]);
  const fee = kitchenThere ? await kitchenFee(rpc, url).catch(() => undefined) : undefined;
  const there = (deployed: boolean) => (deployed ? "deployed" : "NOT deployed");

  return {
    json: {
      engine: { address: engine(), deployed: engineThere },
      kitchen: {
        address: kitchen(),
        deployed: kitchenThere,
        ...(fee === undefined ? {} : { executionFee: fee.toString() }),
      },
      pot: { address: pot, deployed: potThere },
    },
    notes: [
      `On the cluster: the engine ${engine()} is ${there(engineThere)}; the Kitchen ${kitchen()} ` +
        `is ${there(kitchenThere)}` +
        (fee === undefined ? "" : `, its execution fee ${fee} lamports`) +
        `; the Pot ${pot} is ${there(potThere)}.`,
      ...(kitchenThere && fee === undefined
        ? ["The Kitchen has no execution-fee config on this cluster: a cook there is refused."]
        : []),
    ],
  };
}

/** `sauce pot --chain solana` with an endpoint: the prediction, and what the cluster has. */
export async function svmPotStatusCommand(
  target: SvmTarget & { readonly rpcUrl: string },
): Promise<CommandOutput> {
  const predicted = await svmPotCommand(target);
  const pot = predicted.json.pot as Address;
  const found = await deployment(createSolanaRpc(target.rpcUrl), target.rpcUrl, pot);
  const tokenAccounts = await svmPotTokenAccounts(target, target.rpcUrl, requireChain("solana"));
  const json = { ...predicted.json, deployment: found.json, tokenAccounts };
  const accountNotes = tokenAccounts.map(
    (one) =>
      `The Pot's ${one.symbol} account, --account NAME=pot:${one.symbol}: ${one.account}, ` +
      (one.balance === null
        ? "not created yet (a wallet's SPL transfer to the Pot creates it)"
        : `holding ${formatUnits(BigInt(one.balance), one.decimals)} ${one.symbol}`),
  );

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [...found.notes, ...accountNotes],
  };
}

/** `sauce pot --deploy --chain solana`: creates the signer's Pot unless it is already there. */
export async function svmPotDeployCommand(
  target: SvmTarget & { readonly rpcUrl: string; readonly signer: KeyPairSigner },
): Promise<CommandOutput> {
  const predicted = await svmPotCommand(target);
  const pot = predicted.json.pot as Address;
  const rpc = createSolanaRpc(target.rpcUrl);
  if (await exists(rpc, target.rpcUrl, pot, "the Pot")) {
    const json = { ...predicted.json, deployed: true };

    return {
      text: JSON.stringify(json, null, 2),
      json,
      notes: [`Pot ${pot} is already created on solana.`],
    };
  }
  const sent = await sendInstructions(
    rpc,
    target.rpcUrl,
    target.signer,
    [createPotInstruction(target, pot)],
    "creating the Pot",
  );
  if (sent.ok) await awaitAccount(rpc, target.rpcUrl, pot, "the Pot");
  const json = { ...predicted.json, deployed: sent.ok, createPot: sentJson(sent) };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [sentLine(`created Pot ${pot} in`, sent)],
    ...(sent.ok ? {} : { exitCode: 1 }),
  };
}
