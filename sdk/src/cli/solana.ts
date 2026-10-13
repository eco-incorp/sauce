/**
 * The `sauce` command on Solana: a Pot is a Kitchen PDA, a cook is a Kitchen `cook` the released
 * engine runs — or, `--via engine`, the engine's own paid `cookAndPay`, with no Kitchen and no Pot —
 * and both go through the SDK's own pieces — `createSauceSvmClient` (with the RPC URL the user gave
 * and the program ids `/deployments` records) builds, signs and simulates every cook;
 * `derivePotPda`/`buildCreatePotInstruction` are the Pot; the code-buffer builders stage a program
 * too large for one transaction. Nothing here encodes an instruction of its own.
 *
 * What this adds is the transport a command line needs and the SDK leaves to its caller: sending
 * a transaction and confirming it by polling (no websocket endpoint to configure), reading the
 * Kitchen's fee and a Pot's existence, mapping the manifest's account slots from `--account`
 * flags, and a keypair file as the signer. A keypair is read from the path given, never from the
 * environment, and its bytes are dropped once the signer holds the key.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionSize,
  isAddress,
  signTransaction,
  TRANSACTION_SIZE_LIMIT,
  lamports,
  type Address,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type Transaction,
  type TransactionSigner,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import { bytesToHex, formatUnits, hexToBytes, parseUnits, type Hex } from "viem";

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
  type AccountResolution,
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
  type CookVia,
  createSauceSvmClient,
  decodeExecutionFeeConfig,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  type EngineFault,
  engineFaultName,
  fetchAlt,
  GROWTH_STEP,
  MAX_POT_LEN,
  resolveAccounts,
  resolveTokenProgramByOwner,
  type SauceSvmClient,
  type SimulateExecuteResult,
  svmTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../svm/index.js";
import { CliError, UsageError, type SaltChoice } from "./args.js";
import {
  type Approver,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  compileProgram,
  payloadOf,
  type ProgramInput,
  refusePastDeadline,
  revertedFirst,
  unapproved,
} from "./commands.js";
import { approveAll } from "./approvals.js";
import { decodeReturned, returnedLine } from "./returned.js";
import { guardOf } from "./policy.js";
import { FIELDLESS, openFork, type ForkSnapshot } from "./svm-fork.js";
import { secret } from "./signer.js";
import { requireSupported } from "./support.js";
import {
  accountsNow,
  messageAccounts,
  movedBy,
  svmLeftInPot,
  svmLeftInPotJson,
  svmLeftInPotLines,
  svmMovedJson,
  svmMovedLines,
  writableAccounts,
} from "./svm-effects.js";
import { linkLines, txLinks } from "./links.js";
import {
  buildPlanTx,
  encodeCursor,
  newSvmPlan,
  nextStep,
  planBuffer,
  signableStep,
  tableAddresses,
  unsignedSigner,
  type CookHandedOut,
  type PlanStep,
  type PlanTokenAccount,
  type PlanTx,
  type StepContext,
  type SvmPlan,
} from "./svm-plan.js";

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

/** Requests to `url`, each failing with what it read and never the URL: for a command's reads. */
export const svmReader =
  (url: string) =>
  <T>(what: string, request: () => Promise<T>): Promise<T> =>
    ask(url, what, request);

/**
 * The execution fee in lamports, from the Kitchen's fee config account: what a cook pays, through
 * the Kitchen or direct to the engine, which reads the same account.
 */
async function kitchenFee(rpc: Rpc, url: string): Promise<bigint> {
  const { address: config } = await deriveExecutionFeeConfigPda(kitchen());
  const { value } = await ask(url, "the Kitchen's fee config", () =>
    rpc.getAccountInfo(config, { encoding: "base64" }).send(),
  );
  try {
    if (value === null || value.owner !== kitchen()) throw new Error("absent");

    return decodeExecutionFeeConfig(new Uint8Array(getBase64Encoder().encode(value.data[0])));
  } catch {
    throw new CliError(
      `the released Kitchen (${kitchen()}) has no execution-fee config on this cluster: is it ` +
        "deployed there? Every cook is refused without one, through the Kitchen or direct.",
    );
  }
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

/** The two token programs, whose refusals a program's token writes meet, by the name a person reads. */
const TOKEN_PROGRAMS: ReadonlyMap<string, string> = new Map([
  [TOKEN_PROGRAM_ID, "SPL Token"],
  [TOKEN_2022_PROGRAM_ID, "Token-2022"],
]);

/**
 * Why a token program refused, in its own words: the last `Program log:` line it wrote before it
 * failed, other than the instruction's name. Token-2022 states each refusal so — a paused mint
 * ("Transferring, minting, and burning is paused on this mint"), a frozen account ("Account is
 * frozen") — where its error code alone is a number shared with every other program's.
 */
function tokenProgramMessage(logs: readonly string[], program: string): string | undefined {
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

/** What a few of the engine's refusals mean for the cook that met them. */
const ENGINE_FAULT_HINTS: Partial<Record<EngineFault, string>> = {
  ExecutionFeeExceedsMaximum:
    "the execution fee is above the max_execution_fee the cook signed (it rose since it was read): run it again",
  ExecutionFeeNotPaid: "the fee payer holds less than the execution fee",
  InvalidFeePayer: "the fee payer must be a System-owned account that holds no data",
  InvalidFeeConfig: "the fee config is not the released Kitchen's",
  CodeHashMismatch: "the staged program is not the bytes the cook was pinned to",
  NotCookedByKitchen: "the engine's legacy instructions run only from a Kitchen cook",
  AccountNotSigner:
    "the program wrote an account that did not sign — directly to the engine, nothing signs for a Pot",
};

/**
 * A transaction error, read: the Sauce program's thrown text when the ENGINE failed with its revert
 * code, the engine's or the Kitchen's error by name when either refused, a token program's refusal
 * in the words it logged, and otherwise the code and the program it came from. Custom codes collide across programs (every Anchor program numbers from
 * 6000; System and SPL Token both use 0), so a code is named only for the program the logs show
 * failing.
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
    const tokenProgram = program === undefined ? undefined : TOKEN_PROGRAMS.get(program);
    const said = tokenProgram === undefined ? undefined : tokenProgramMessage(logs, program!);
    if (said !== undefined) {
      return `${tokenProgram} refused: ${said} (custom program error ${code})`;
    }
    const fault = program === engine() ? engineFaultName(code) : undefined;
    if (fault !== undefined) {
      const hint = ENGINE_FAULT_HINTS[fault];

      return `the engine refused: ${fault} (custom program error ${code})${hint === undefined ? "" : `: ${hint}`}`;
    }

    return (
      `${program === undefined ? `instruction ${detail![0]}` : `program ${program}`} failed with ` +
      `custom program error ${code} (0x${code.toString(16)}); the logs say why`
    );
  }
  if (detail !== undefined) {
    return `${program === undefined ? `instruction ${detail[0]}` : `program ${program}`} failed: ${String(detail[1])}`;
  }

  // A transaction error with no fields, by its number (as a local copy reports one): its name.
  if (typeof err === "number" && FIELDLESS[err] !== undefined) return FIELDLESS[err];

  return JSON.stringify(err, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

/**
 * `reason` with the account a transaction error names only by its index in the message (`accounts`,
 * in that order) and what that account is (`labels`): a bare index cannot be read without the
 * message.
 */
export function namingAccount(
  reason: string,
  accounts: readonly Address[],
  labels?: ReadonlyMap<string, string>,
): string {
  const index = /account_index"?:\s*(\d+)/.exec(reason)?.[1];
  const account = index === undefined ? undefined : accounts[Number(index)];
  if (account === undefined) return reason;
  const label = labels?.get(account);
  const rent = /InsufficientFundsForRent/.test(reason)
    ? ", which the transaction would leave below its rent-exempt minimum"
    : "";

  return `${reason}: account ${index} is ${account}${label === undefined ? "" : ` (${label})`}${rent}`;
}

export interface SvmSent {
  readonly signature: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly computeUnits?: bigint;
  readonly logs: readonly string[];
  /** The slot it landed in, where the status said. */
  readonly slot?: bigint;
  /** The fee it paid, in lamports, where the node said. */
  readonly fee?: bigint;
  /** What the engine returned, where it ran and the node said: a program's `main`'s value. */
  readonly returnData?: Uint8Array;
}

/**
 * Polls until `signature` is confirmed (or a minute passes); its error, or null, and its slot. The
 * cluster's history is searched too, so one that landed long ago is found.
 */
async function confirmed(
  rpc: Rpc,
  url: string,
  signature: string,
): Promise<{ err: unknown; slot: bigint }> {
  for (let tries = 0; tries < 120; tries++) {
    const { value } = await ask(url, "the transaction's status", () =>
      rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: true }).send(),
    );
    const status = value[0];
    if (status !== null && status !== undefined && status.confirmationStatus !== "processed") {
      return { err: status.err, slot: BigInt(status.slot) };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new CliError(`transaction ${signature} was not confirmed within a minute`);
}

/**
 * Sends `transaction` and polls until it is confirmed (or fails, or a minute passes). From a wallet
 * (`--wallet`), the fee payer's, it is held to the wallet's policy first (`policy.ts`).
 */
export async function sendAndConfirm(
  rpc: Rpc,
  url: string,
  transaction: Transaction,
): Promise<SvmSent> {
  const signature = getSignatureFromTransaction(transaction);
  const payer = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    .staticAccounts[0];
  const reservation = payer === undefined ? undefined : await guardOf(payer)?.svm(rpc, transaction);
  try {
    await ask(url, "sending the transaction", () =>
      rpc
        .sendTransaction(getBase64EncodedWireTransaction(transaction), {
          encoding: "base64",
          // Every transaction here was simulated first; the node need not do it again.
          skipPreflight: true,
        })
        .send(),
    );
  } catch (error) {
    reservation?.released("sending failed");
    throw error;
  }

  return svmLanded(rpc, url, signature, (ok) =>
    ok ? reservation?.sent(signature) : reservation?.released(`${signature} failed`),
  );
}

/**
 * Polls until `signature` is confirmed (or a minute passes) and reads it back: whether it failed
 * and why, its logs, units, fee and what the engine returned. `seen` is told whether it succeeded
 * first.
 */
export async function svmLanded(
  rpc: Rpc,
  url: string,
  signature: Signature,
  seen?: (ok: boolean) => void,
): Promise<SvmSent> {
  // The status is the verdict: it is what confirmed, and it carries the error.
  const { err: statusErr, slot } = await confirmed(rpc, url, signature);
  seen?.(statusErr === null);
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
  // The engine's own: the node's return data where the engine set it last, else its log line.
  const returned = meta?.returnData?.programId === engine() ? returnData : engineReturn(logs);

  return {
    signature,
    ok: err === null,
    ...(err === null ? {} : { reason: failureReason(err, logs, returnData) }),
    ...(meta?.computeUnitsConsumed === undefined
      ? {}
      : { computeUnits: meta.computeUnitsConsumed }),
    logs,
    slot,
    ...(meta?.fee === undefined ? {} : { fee: BigInt(meta.fee) }),
    ...(returned === undefined ? {} : { returnData: returned }),
  };
}

/**
 * Signs a plan's Solana transaction (`lifecycle-svm.ts`: base64, its fresh keys' signatures in, the
 * fee payer's out) with `signer`, the fee payer, rehearses it as signed and refuses it if it would
 * fail, then sends it and waits until it is confirmed.
 */
export async function sendPlannedSvm(
  url: string,
  signer: KeyPairSigner,
  tx: { readonly feePayer: string; readonly transaction: string; readonly what: string },
): Promise<SvmSent> {
  if (tx.feePayer !== signer.address) {
    throw new CliError(
      `${tx.what} is paid by ${tx.feePayer}, and the signer is ${signer.address}: build it for the signer`,
    );
  }
  const rpc = createSolanaRpc(url);
  const decoded = getTransactionDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(tx.transaction)),
  );
  const signed = await signTransaction([signer.keyPair], decoded);
  const wire = getBase64EncodedWireTransaction(signed);
  const { value } = await ask(url, `a simulation of ${tx.what}`, () =>
    rpc.simulateTransaction(wire, { encoding: "base64", sigVerify: true }).send(),
  );
  if (value.err !== null) {
    const logs = value.logs ?? [];
    throw new CliError(
      `${tx.what} would fail, so nothing was sent: ${failureReason(value.err, logs)}\n${logs.join("\n")}`,
    );
  }

  return sendAndConfirm(rpc, url, signed);
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

/**
 * A value that names an account by its token: `pot:<token>` or `owner:<token>`, that one's
 * associated token account for the mint; `mint:<token>`, the mint itself; `program:<token>`, the
 * token program that owns the mint. The token is a registered symbol (`USDC`, or a stock's, which
 * can carry a "_": `NVDA_US`) or a mint's base58 address.
 */
const TOKEN_NAMED = /^(pot|owner|mint|program):([A-Za-z0-9_]+)$/;
/** The System program, which owns every wallet. */
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** `--account name=<pubkey | pot | owner | pot:<token> | owner:<token> | mint:<token> | program:<token>>`, parsed. */
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
    if (value !== "pot" && value !== "owner" && !isAddress(value) && !TOKEN_NAMED.test(value)) {
      throw new UsageError(
        `--account ${name}: '${value}' is not an address, pot, owner, or a token's account: ` +
          "pot:USDC is the Pot's own USDC account (pot:<mint> for any mint), owner:USDC the " +
          "owner's, mint:USDC the mint and program:USDC its token program",
      );
    }
    accounts[name] = value;
  }

  return accounts;
}

/** One `<whose>:<token>` resolved: the account, what it is for a person, and which kind it is. */
interface TokenAccountNamed {
  readonly address: Address;
  readonly label: string;
  /** A holder's token account, which a transfer can bring into being, or the mint or its program. */
  readonly kind: "account" | "mint" | "program";
  /** A holder's token account's mint, holder and token program. */
  readonly account?: {
    readonly mint: Address;
    readonly holder: Address;
    readonly program: Address;
  };
}

/** The token program that owns a mint the registry does not record, read from the cluster. */
export type MintProgramOf = (mint: Address) => Promise<Address>;

/**
 * A mint's token program read from the account's owner on the cluster `rpcUrl` serves: legacy SPL
 * Token or Token-2022, and nothing else (`token-program.ts`).
 */
const mintProgramOn =
  (rpc: Rpc, url: string): MintProgramOf =>
  (mint) =>
    resolveTokenProgramByOwner(mint, async (key) => {
      const { value } = await ask(url, `the mint ${key}`, () =>
        rpc.getAccountInfo(key, { encoding: "base64" }).send(),
      );

      return value === null ? null : value.owner;
    });

/** The name a person reads for a token program. */
const programName = (program: Address): string =>
  program === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL Token";

/**
 * Each `--account` value that names an account by its token as that account: `pot:USDC` and
 * `owner:<mint>` the associated token account of the Pot (or the owner) for the mint, under the
 * token program that owns the mint; `mint:USDC` the mint; `program:USDC` that token program — the
 * accounts `@sauce/token`'s writes take. A symbol is one of the cluster's registered mints, whose
 * row records its program; any other mint is given by its base58 address, and its program is read
 * with `programOf`. Every other value is left as it is.
 */
export async function resolveTokenAccounts(
  given: Readonly<Record<string, string>>,
  owner: Address,
  pot: Address,
  chain: CanonicalChain,
  via: "kitchen" | "engine" = "kitchen",
  programOf: MintProgramOf = async () => TOKEN_PROGRAM_ID,
): Promise<{
  readonly accounts: Record<string, string>;
  readonly named: ReadonlyMap<string, TokenAccountNamed>;
}> {
  const accounts: Record<string, string> = {};
  const named = new Map<string, TokenAccountNamed>();
  const rows = svmTokenRows(chain);
  for (const [name, value] of Object.entries(given)) {
    const match = TOKEN_NAMED.exec(value);
    if (match === null) {
      accounts[name] = value;
      continue;
    }
    const [, whose, token] = match as unknown as [
      string,
      "pot" | "owner" | "mint" | "program",
      string,
    ];
    if (whose === "pot" && via === "engine") {
      throw new UsageError(
        `--account ${name}=${value}: --via engine cooks with no Pot, so there is no Pot's token ` +
          `account to pass: give the account the program reads by its address (owner:${token} ` +
          "for the owner's), or cook through the Kitchen",
      );
    }
    // Without regard to case: a stock's symbol is its issuer's ticker (`TSLAx`), not uppercase.
    const row = rows.find((candidate) => candidate.symbol.toUpperCase() === token.toUpperCase());
    if (row === undefined && !isAddress(token)) {
      // The cluster's other mints by name, its tokenized stocks by count: there are over a thousand.
      const listed = rows.filter((candidate) => candidate.stock === undefined);
      const stocks = rows.length - listed.length;
      throw new UsageError(
        `--account ${name}=${value}: ${token} is not a mint ${chain.slug} registers ` +
          `(${listed.map((candidate) => candidate.symbol).join(", ") || "none"}` +
          (stocks > 0
            ? `, and ${stocks} stock tokens: sauce globals --chain ${chain.slug} --stocks`
            : "") +
          `): give the mint's base58 address, ${whose}:<mint>`,
      );
    }
    const mint = address(row?.mint ?? token);
    const what = row?.symbol ?? `mint ${mint}`;
    if (whose === "mint") {
      accounts[name] = mint;
      named.set(name, { address: mint, label: `the ${what} mint`, kind: "mint" });
      continue;
    }
    const tokenProgram = row?.tokenProgram ?? (await programOf(mint));
    if (whose === "program") {
      accounts[name] = tokenProgram;
      named.set(name, {
        address: tokenProgram,
        label: `${what}'s token program, ${programName(tokenProgram)}`,
        kind: "program",
      });
      continue;
    }
    const holder = whose === "pot" ? pot : owner;
    const account = await svmTokenAccount({ mint, tokenProgram }, holder);
    accounts[name] = account;
    named.set(name, {
      address: account,
      label: `${whose === "pot" ? "the Pot" : "the owner"}'s ${what} account`,
      kind: "account",
      account: { mint, holder, program: tokenProgram },
    });
  }

  return { accounts, named };
}

/**
 * Each slot of the manifest resolved from `--account`. The Pot goes in unsigned: the Kitchen signs
 * for it — and, cooked directly (`via` engine), nothing does, so a slot that must sign cannot be
 * the Pot. The owner signs when the slot asks for a signer — with `signer` when there is one.
 */
function resolution(
  manifest: AccountManifest,
  given: Readonly<Record<string, string>>,
  owner: Address,
  pot: Address,
  signer: TransactionSigner,
  via: CookVia = "kitchen",
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
    if (via === "engine" && value === "pot" && /signer/.test(slot.requires)) {
      throw new UsageError(
        `--account ${slot.name}=pot: ${slot.name} must sign (${slot.requires}), and cooked ` +
          "directly to the engine (--via engine) nothing signs for the Pot — only a Kitchen cook " +
          `does. Give ${slot.name} a signer (owner), or cook --via kitchen.`,
      );
    }
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
  /** The token program that owns the mint: legacy SPL Token or Token-2022. */
  readonly tokenProgram: Address;
  /** The associated token account of the Pot for the mint, under its token program. */
  readonly account: Address;
  readonly exists: boolean;
  /** Base units, as a decimal string; `null` while the account does not exist. */
  readonly balance: string | null;
}

/**
 * The Pot's associated token account for every mint the chain's cluster registers but its tokenized
 * stocks — each under the token program its row records — whether it exists, and its balance. The
 * stocks are over a thousand mints, two reads each: a stock's account is `pot:<symbol>`.
 */
export async function svmPotTokenAccounts(
  target: SvmTarget,
  rpcUrl: string,
  chain: CanonicalChain,
): Promise<readonly SvmPotTokenAccount[]> {
  const pot = await potOf(target);
  const rpc = createSolanaRpc(rpcUrl);

  return Promise.all(
    svmTokenRows(chain)
      .filter((row) => row.stock === undefined)
      .map(async (row) => {
        const mint = address(row.mint);
        const account = await svmTokenAccount({ mint, tokenProgram: row.tokenProgram }, pot);
        const base = {
          symbol: row.symbol,
          mint: row.mint,
          decimals: row.decimals,
          tokenProgram: row.tokenProgram,
          account,
        };
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
          : token.kind !== "account"
            ? ` (${token.label})`
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
        "without --compact-args, or take the key as an Account parameter",
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
  /**
   * How the cook reaches the engine (`--via`): `kitchen`, the default, is the Kitchen's `cook` on
   * the owner's Pot; `engine` is the engine's own paid `cookAndPay`, with no Kitchen and no Pot, the
   * owner signing as the authority the program acts with.
   */
  readonly via?: CookVia;
  /**
   * The most the cook may pay in execution fee, in lamports (`--max-execution-fee`): with a fee
   * above it the command refuses before signing or sending anything. Either way the cook signs the
   * fee it read as its `max_execution_fee`, so it pays that or, if the fee rises first, fails.
   */
  readonly maxExecutionFee?: bigint;
  /**
   * Address lookup tables the cook's accounts are taken through (`--lookup-table`), each read from
   * the cluster: through one, an account costs the transaction one byte instead of 32, so a cook
   * naming more accounts than a transaction lists fits. `sauce run` creates one when none is given
   * and the accounts do not fit.
   */
  readonly lookupTables?: readonly Address[];
  /**
   * Balances to give for the rehearsal only (`--assume-balance`), each in the account the cook
   * spends from: the Pot's for the mint, or the owner's cooked directly. Solana's simulation takes
   * no account overrides, so a rehearsal with one runs in a local copy of the accounts.
   */
  readonly assume?: readonly SvmAssumed[];
  /**
   * The cluster's state shared with other rehearsals (`sauce_simulate`'s scenarios): rehearsed in
   * a local copy of it, so each sees the accounts and the slot the first read.
   */
  readonly snapshot?: ForkSnapshot;
}

/** A balance `--assume-balance` gives, on Solana: a mint and an amount of it. */
export interface SvmAssumed {
  readonly raw: string;
  readonly mint: Address;
  /** The symbol given, or the mint. */
  readonly label: string;
  /** The registry's decimals; `undefined` for a mint by address, read from the mint. */
  readonly decimals?: number;
  readonly program?: Address;
  /** In whole tokens as written (`1.5`), or in base units (`1500000n`). */
  readonly amount: { readonly units: string } | { readonly base: bigint };
}

/** `--assume-balance` on Solana: `<TOKEN|mint>:<amount>`, each mint once. */
export function svmAssumedBalances(raws: readonly string[], chain: CanonicalChain): SvmAssumed[] {
  const rows = svmTokenRows(chain);
  const seen = new Set<string>();

  return raws.map((raw) => {
    const at = raw.lastIndexOf(":");
    const token = raw.slice(0, at).trim();
    const amount = raw.slice(at + 1).trim();
    const base = /^(\d+)n$/.exec(amount);
    if (at <= 0 || (base === null && !/^\d+(\.\d+)?$/.test(amount))) {
      throw new UsageError(
        `--assume-balance: expected <TOKEN|mint>:<amount>, as USDC:1.5 (whole tokens) or ` +
          `USDC:1500000n (base units); got '${raw}'`,
      );
    }
    const row = rows.find((candidate) => candidate.symbol.toUpperCase() === token.toUpperCase());
    if (row === undefined && !isAddress(token)) {
      throw new UsageError(
        `--assume-balance ${raw}: ${token} is not a mint ${chain.slug} registers: give its symbol ` +
          "(sauce globals --chain solana) or its base58 address",
      );
    }
    const mint = address(row?.mint ?? token);
    if (seen.has(mint)) throw new UsageError(`--assume-balance names ${token} twice: give it once`);
    seen.add(mint);

    return {
      raw,
      mint,
      label: row?.symbol ?? mint,
      ...(row === undefined ? {} : { decimals: row.decimals, program: address(row.tokenProgram) }),
      amount: base === null ? { units: amount } : { base: BigInt(base[1]!) },
    };
  });
}

interface Prepared {
  readonly rpc: Rpc;
  readonly via: CookVia;
  readonly pot: Address;
  readonly fee: bigint;
  readonly program: CompiledSauceProgram;
  readonly bytecode: Uint8Array;
  readonly client: SauceSvmClient;
  readonly accounts: AccountResolution;
  readonly manifest: AccountManifest;
  /** `--account`'s values with every `pot:<token>` resolved to its account. */
  readonly given: Awaited<ReturnType<typeof resolveTokenAccounts>>;
  /** `--lookup-table`'s tables, each with the addresses it holds now. */
  readonly lookupTables: AddressesByLookupTableAddress;
}

/** Each of `tables`, read from the cluster: the addresses it holds. */
async function lookupTablesOf(
  rpc: Rpc,
  url: string,
  tables: readonly Address[],
): Promise<AddressesByLookupTableAddress> {
  const read: AddressesByLookupTableAddress = {};
  for (const table of tables) {
    try {
      Object.assign(read, await fetchAlt(rpc, table));
    } catch (error) {
      const message = ((error as Error).message ?? String(error)).split(url).join("<RPC_URL>");
      throw new CliError(
        `--lookup-table ${table} is not an address lookup table on solana: ${message.split("\n")[0]}`,
      );
    }
  }

  return read;
}

/** The lookup tables a cook is compressed against, or none: the option the client's builders take. */
const tablesOption = (
  tables: AddressesByLookupTableAddress,
): { lookupTables?: AddressesByLookupTableAddress } =>
  Object.keys(tables).length === 0 ? {} : { lookupTables: tables };

/** Compiles the file, reads the fee, and builds the SDK client that cooks it as `signer`. */
async function prepare(
  input: SvmCookInput,
  files: CliFiles,
  signer: TransactionSigner,
): Promise<Prepared> {
  refusePastDeadline(input);
  const via = input.via ?? "kitchen";
  const program = compileProgram(input, files);
  const bytecode = svmPayload(program, input.args);
  const manifest = program.manifest ?? { accounts: [] };
  const rpc = createSolanaRpc(input.rpcUrl);
  const pot = await potOf(input);
  const given = await resolveTokenAccounts(
    input.accounts,
    input.owner,
    pot,
    input.chain,
    via,
    mintProgramOn(rpc, input.rpcUrl),
  );
  const accounts = resolution(manifest, given.accounts, input.owner, pot, signer, via);
  const fee = await kitchenFee(rpc, input.rpcUrl);
  if (input.maxExecutionFee !== undefined && fee > input.maxExecutionFee) {
    throw new CliError(
      `the execution fee is ${fee} lamports, above --max-execution-fee ${input.maxExecutionFee}: ` +
        "nothing was signed or sent",
    );
  }
  // The cap the cook signs is the fee just read: it pays what is shown here, or fails.
  const client = await createSauceSvmClient({
    rpcUrl: input.rpcUrl,
    programId: engine(),
    kitchen: kitchen(),
    payer: signer,
    potSalt: saltBytes(input.salt),
    maxExecutionFee: fee,
    via,
  });
  const lookupTables = await lookupTablesOf(rpc, input.rpcUrl, input.lookupTables ?? []);

  return { rpc, via, pot, fee, program, bytecode, client, accounts, manifest, given, lookupTables };
}

/** What a direct cook is called in what a command prints. */
const DIRECT_COOK = "the engine's direct cook (cookAndPay)";

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
    { computeUnitLimit: 1_400_000, prepends, ...tablesOption(prepared.lookupTables) },
  );
  const size = getTransactionSize(transaction);

  return { fits: size <= TRANSACTION_SIZE_LIMIT, size, transaction };
}

/** A placeholder key, distinct per `index`, for an account a size estimate has no address for. */
const placeholderKey = (index: number): Address =>
  getBase58Decoder().decode(new Uint8Array(32).fill(index + 1)) as Address;

/** Whether a cook fits one transaction, measured without a cluster. */
export interface SvmCookSize {
  /** The cook measured: through the Kitchen, or direct to the engine. */
  readonly via: CookVia;
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
 * frame, compute-unit limit, the Kitchen's `cook` — or `via` engine, the engine's `cookAndPay`) for
 * `manifest`, with each account `--account` gives where it is given — `pot` and `owner` are the
 * cook's own — and a distinct account for every other slot, so a size is the most those slots can
 * make it. The blockhash and signature are fixed widths, so a placeholder of each measures the same.
 */
export async function svmCookSize(
  bytecode: Uint8Array,
  manifest: AccountManifest,
  given: Readonly<Record<string, string>>,
  via: CookVia = "kitchen",
): Promise<SvmCookSize> {
  const owner = placeholderKey(0);
  const target: SvmTarget = { owner, salt: `0x${"00".repeat(32)}` };
  const pot = await potOf(target);
  // A token account (`pot:USDC`) is a distinct account of its own, as it is in a real cook. With no
  // cluster, an unregistered mint's program is taken as legacy SPL Token: a key is a key to the size.
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
  const tail = resolveAccounts(named, resolved, owner);
  const cook =
    via === "engine"
      ? buildCookAndPayInstruction({
          engineProgram: engine(),
          feeConfig,
          feePayer: owner,
          maxExecutionFee: 0n,
          bytecode,
          tail,
        })
      : buildCookInstruction({
          kitchen: kitchen(),
          owner,
          engineProgram: engine(),
          potSalt: saltBytes(target.salt),
          pot,
          feeConfig,
          bytecode,
          maxExecutionFee: 0n,
          tail,
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
    via,
    size,
    limit: TRANSACTION_SIZE_LIMIT,
    fits: size <= TRANSACTION_SIZE_LIMIT,
    assumed,
    remaining: manifest.accounts.some((entry) => entry.kind === "remaining"),
  };
}

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
      `the execution fee of ${prepared.fee} and the transaction's. Solana's simulateTransaction ` +
      "takes no balance overrides, so the owner must hold them for a rehearsal too"
    );
  } catch {
    return undefined;
  }
}

/**
 * `sauce simulate` on Solana: the cook, simulated from the Pot's owner with no key — and, for a
 * Pot the Kitchen has not created yet, its `create_pot` first, in the same transaction. Directly to
 * the engine (`via` engine) there is no Pot to create: the owner is the signer, and pays.
 */
export async function svmSimulateCommand(
  input: SvmCookInput,
  files: CliFiles,
): Promise<CommandOutput> {
  return revertedFirst(await simulateSvm(input, files));
}

async function simulateSvm(input: SvmCookInput, files: CliFiles): Promise<CommandOutput> {
  const prepared = await prepare(input, files, unsignedSigner(input.owner));
  const direct = prepared.via === "engine";
  // The size first: it is the program's own, whatever the cluster holds.
  const alone = await fits(prepared);
  // Too large for one transaction: no cluster can stage it without sending, so a local copy does;
  // and a balance to assume, which a cluster's simulation takes no override for; and a snapshot
  // shared with other rehearsals, which a cluster, moving on between them, cannot hold.
  if (!alone.fits || (input.assume ?? []).length > 0 || input.snapshot !== undefined)
    return stagedRehearsal(prepared, input, alone.fits);
  const created = direct || (await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot"));
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
  const tracked = writableAccounts(built, prepared.lookupTables);
  const before = await ask(input.rpcUrl, "the accounts the cook writes", () =>
    accountsNow(prepared.rpc, tracked),
  );
  const result = await prepared.client.simulate(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
    { prepends, accounts: tracked, ...tablesOption(prepared.lookupTables) },
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
  // What the cook leaves in the Pot's token accounts, which is not in the owner's wallet.
  const left = moved === undefined || direct ? undefined : svmLeftInPot(moved, prepared.pot);
  const missing = await missingAccounts(prepared.rpc, input.rpcUrl, prepared.given);
  // What main returned: the engine's return data, read as the type main declares.
  const returns = result.ok ? bytesToHex(result.returnData ?? new Uint8Array()) : undefined;
  const returnType = mainReturnType(input.text);
  const json = {
    ok: result.ok,
    ...(left === undefined ? {} : { leftInPot: svmLeftInPotJson(left) }),
    chain: "solana",
    via: prepared.via,
    owner: input.owner,
    ...(direct ? {} : { pot: prepared.pot }),
    fee: prepared.fee.toString(),
    maxExecutionFee: prepared.fee.toString(),
    path: "simulateTransaction",
    ...(returns === undefined ? {} : { returns }),
    ...(returns === undefined || returnType === undefined
      ? {}
      : { returnType, returned: decodeReturned(returnType, returns, input.chain) ?? null }),
    ...(missing.length === 0 ? {} : { missingAccounts: missing }),
    ...(direct
      ? {}
      : {
          createPot: created ? null : { kitchen: kitchen(), owner: input.owner, salt: input.salt },
        }),
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
    direct
      ? `  ${DIRECT_COOK}, from ${input.owner}, which signs for the program and pays ` +
        `the execution fee of ${prepared.fee} lamports: no Kitchen and no Pot`
      : `  ${created ? "" : "2. "}the cook, from the owner ${input.owner}, which pays the ` +
        `Kitchen's execution fee of ${prepared.fee} lamports`,
  ];
  if (result.ok) {
    return {
      text: [
        `The cook succeeds from ${input.owner}: ${result.unitsConsumed ?? "?"} compute units` +
          (returns === undefined || returns === "0x" ? "" : `, returns ${returns}`),
        ...(returns === undefined || returnType === undefined
          ? []
          : [returnedLine(returnType, returns, input.chain)]),
        ...(left === undefined ? [] : svmLeftInPotLines(left, "the owner's wallet")),
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
      `The cook reverts: ${simulated(result)}`,
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

/**
 * `sauce simulate` of a cook too large for one transaction: in a local copy of every account it
 * names (`svm-fork.ts`), the program staged into a code buffer as `sauce run` stages it, the Pot
 * created first where the cluster has none, then the cook from that buffer, its accounts listed in
 * full (the copy takes a transaction of any size). What the cook moved is the copy's accounts
 * before it and after. Nothing is signed or sent.
 */
async function stagedRehearsal(
  prepared: Prepared,
  input: SvmCookInput,
  fitsOne = false,
): Promise<CommandOutput> {
  const owner = input.owner;
  const direct = prepared.via === "engine";
  const signer = unsignedSigner(owner);
  const { bytecode } = prepared;
  const nonce = 0n;
  const { address: codeBuffer } = await deriveCodeBufferPda(kitchen(), owner, nonce);
  const { address: code } = await deriveCodePda(kitchen(), codeBuffer);
  const buffer = { kitchen: kitchen(), owner, codeBuffer, code };
  const sha256 = new Uint8Array(createHash("sha256").update(bytecode).digest());
  const CHUNK = 900;
  const staging: Instruction[][] = [
    [
      buildCreateCodeBufferInstruction({ ...buffer, nonce, capacity: bytecode.length }),
      ...Array.from({ length: Math.ceil(bytecode.length / GROWTH_STEP) - 1 }, () =>
        buildGrowCodeBufferInstruction(buffer),
      ),
    ],
    ...Array.from({ length: Math.ceil(bytecode.length / CHUNK) }, (_, i) => [
      buildWriteCodeBufferInstruction({
        ...buffer,
        offset: i * CHUNK,
        chunk: bytecode.subarray(i * CHUNK, (i + 1) * CHUNK),
      }),
    ]),
    [
      buildFinalizeCodeBufferInstruction({
        ...buffer,
        len: bytecode.length,
        expectedSha256: sha256,
      }),
    ],
  ];
  const tail = resolveAccounts(prepared.manifest, prepared.accounts, owner);
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen());
  const cook = direct
    ? buildCookAndPayFromAccountPinnedInstruction({
        engineProgram: engine(),
        code,
        expectedSha256: sha256,
        feeConfig,
        feePayer: owner,
        maxExecutionFee: prepared.fee,
        tail,
      })
    : buildCookFromAccountInstruction({
        kitchen: kitchen(),
        owner,
        codeBuffer,
        code,
        engineProgram: engine(),
        potSalt: saltBytes(input.salt),
        pot: prepared.pot,
        feeConfig,
        maxExecutionFee: prepared.fee,
        tail,
      });
  const created = direct || (await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot"));
  const fork = await openFork(
    prepared.rpc,
    (what, request) => ask(input.rpcUrl, what, request),
    [
      owner,
      prepared.pot,
      ...(input.assume ?? []).map((assumed) => assumed.mint),
      ...(cook.accounts ?? []).map((meta) => meta.address),
    ],
    engine(),
    kitchen(),
    input.snapshot,
  );
  // The owner signs and pays every transaction of the rehearsal: an account a program owns, or one
  // holding data, cannot pay a fee, so it is refused here, by name, before anything runs.
  const payer = fork.account(owner);
  if (payer !== null && (payer.owner !== SYSTEM_PROGRAM || payer.data.length > 0)) {
    throw new CliError(
      `--owner ${owner} is an account of ${payer.owner}${payer.data.length > 0 ? `, holding ${payer.data.length} bytes` : ""}, ` +
        "not a wallet: the owner signs and pays the cook, so give a wallet's address, or any " +
        "address with no account at all, which the copy funds",
    );
  }
  const notes: string[] = [];
  // A Pot's or owner's token account the cluster does not have yet is made, empty, in the copy:
  // `sauce run` does not make it, so the note says to.
  for (const [name, token] of prepared.given.named) {
    if (token.account === undefined || fork.account(token.address) !== null) continue;
    fork.tokenAccount(
      token.address,
      token.account.mint,
      token.account.holder,
      token.account.program,
      0n,
    );
    notes.push(
      `--account ${name}: ${token.label}, ${token.address}, does not exist on solana; the copy made ` +
        "it empty, and `sauce run` creates it before the cook (asking first, or with --yes)",
    );
  }
  const holder = direct ? owner : prepared.pot;
  for (const assumed of input.assume ?? []) {
    const mintAccount = fork.account(assumed.mint);
    if (mintAccount === null) {
      throw new CliError(
        `--assume-balance ${assumed.raw}: ${assumed.mint} is not a mint on solana`,
      );
    }
    const program = assumed.program ?? mintAccount.owner;
    const decimals = assumed.decimals ?? mintAccount.data[44] ?? 0;
    const amount =
      "base" in assumed.amount ? assumed.amount.base : parseUnits(assumed.amount.units, decimals);
    const account = await svmTokenAccount({ mint: assumed.mint, tokenProgram: program }, holder);
    fork.tokenAccount(account, assumed.mint, holder, program, amount);
    notes.push(
      `assumed: ${direct ? "the owner" : "the Pot"}'s ${assumed.label} account, ${account}, holds ` +
        `${formatUnits(amount, decimals)} ${assumed.label} in the copy (--assume-balance)`,
    );
  }
  const held = fork.svm.getBalance(owner) ?? 0n;
  // The copy pays the staging rent and the fees from the owner's lamports as the cluster would;
  // short of them, it is given them, which the result says.
  const topUp = 10_000_000_000n;
  fork.svm.airdrop(owner, lamports(topUp));
  const transactionOf = (instructions: readonly Instruction[]): Promise<Transaction> =>
    buildExecuteTransaction({
      payer: signer,
      instructions,
      latestBlockhash: {
        blockhash: fork.svm.latestBlockhash() as Blockhash,
        lastValidBlockHeight: 1_000_000n,
      },
    });
  const send = async (instructions: readonly Instruction[], what: string): Promise<void> => {
    const result = fork.send(await transactionOf(instructions));
    if (!result.ok) {
      throw new CliError(
        `${what} fails in the local copy: ${failureReason(result.err, result.logs)}\n` +
          result.logs.join("\n"),
      );
    }
  };
  if (!created) await send([createPotInstruction(input, prepared.pot)], "creating the Pot");
  for (const [index, batch] of staging.entries())
    await send(batch, index === 0 ? "creating the code buffer" : "staging the program");
  const tracked = [
    ...new Set(
      (cook.accounts ?? [])
        .filter(
          (meta) => meta.role === AccountRole.WRITABLE || meta.role === AccountRole.WRITABLE_SIGNER,
        )
        .map((meta) => meta.address),
    ),
  ];
  const before = tracked.map(fork.account);
  fork.svm.expireBlockhash();
  // Its accounts through a lookup table, as `sauce run` sends it.
  const instructions = [
    buildHeapFramePrepend(),
    ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
    cook,
  ];
  const lookupTables = fork.table(tableAddresses(await transactionOf(instructions)));
  const cookTransaction = await buildExecuteTransaction({
    payer: signer,
    instructions,
    latestBlockhash: {
      blockhash: fork.svm.latestBlockhash() as Blockhash,
      lastValidBlockHeight: 1_000_000n,
    },
    lookupTables,
  });
  const simulated = fork.simulate(cookTransaction, tracked);
  const failed = !simulated.ok;
  const { logs, units, returnData, after } = simulated;
  const labels = await accountLabels(input, prepared.pot, prepared.given);
  const moved = failed
    ? undefined
    : await movedBy(prepared.rpc, input.chain, tracked, before, after, labels, owner);
  // What the cook leaves in the Pot's token accounts, which is not in the owner's wallet.
  const left = moved === undefined || direct ? undefined : svmLeftInPot(moved, prepared.pot);
  // What main returned stands even when the transaction then fails on its own (a rent check, say):
  // only a failed instruction undoes the program's return.
  const instructionFailed =
    (simulated.err as { InstructionError?: unknown } | null)?.InstructionError !== undefined ||
    /InstructionError/.test(String(simulated.err));
  const returns =
    !failed || (!instructionFailed && returnData.length > 0) ? bytesToHex(returnData) : undefined;
  const returnType = mainReturnType(input.text);
  const reason = failed
    ? namingAccount(
        failureReason(simulated.err, logs, returnData.length > 0 ? returnData : undefined),
        messageAccounts(cookTransaction, lookupTables),
        labels,
      )
    : undefined;
  const staged = `${bytecode.length}-byte`;
  const json = {
    ok: !failed,
    ...(left === undefined ? {} : { leftInPot: svmLeftInPotJson(left) }),
    chain: "solana",
    via: prepared.via,
    owner,
    ...(direct ? {} : { pot: prepared.pot }),
    fee: prepared.fee.toString(),
    maxExecutionFee: prepared.fee.toString(),
    path: "local copy (LiteSVM)",
    slot: fork.slot.toString(),
    staged: { bytes: bytecode.length, transactions: staging.length },
    ...(returns === undefined ? {} : { returns }),
    ...(returns === undefined || returnType === undefined
      ? {}
      : { returnType, returned: decodeReturned(returnType, returns, input.chain) ?? null }),
    ...(direct
      ? {}
      : { createPot: created ? null : { kitchen: kitchen(), owner, salt: input.salt } }),
    computeUnits: units.toString(),
    ...(reason === undefined ? {} : { reason }),
    ...(failed ? {} : moved === undefined ? { moved: null } : svmMovedJson(moved)),
    logs,
  };
  const how = [
    `Rehearsed in a local copy (LiteSVM) of the ${fork.loaded} accounts the cook names, read from ` +
      `solana at slot ${fork.slot}, with the released engine and Kitchen: ` +
      (fitsOne
        ? "a cluster's simulation takes no balance to assume."
        : "the cook does not fit one transaction, and no cluster can stage a program without sending.") +
      " Nothing was signed or sent:",
    ...(created
      ? []
      : [
          `  Kitchen create_pot: Pot ${prepared.pot} is not created on solana yet, so the copy creates it first`,
        ]),
    `  the ${staged} program staged into a code buffer in ${staging.length} transactions, as \`sauce run\` stages it`,
    direct
      ? `  ${DIRECT_COOK} from that buffer, from ${owner}, which signs and pays the execution fee of ${prepared.fee} lamports`
      : `  the cook from that buffer, from the owner ${owner}, which pays the Kitchen's execution fee of ${prepared.fee} lamports`,
  ];
  if (held < 100_000_000n)
    notes.push(
      `${owner} holds ${held} lamports on solana; the copy gave it more to pay the staging rent ` +
        "and the fees, which `sauce run` takes from it on the cluster (the buffer's rent comes " +
        "back when the run closes it)",
    );
  if (!failed) {
    return {
      text: [
        `The cook succeeds from ${owner}: ${units} compute units` +
          (returns === undefined || returns === "0x" ? "" : `, returns ${returns}`),
        ...(returns === undefined || returnType === undefined
          ? []
          : [returnedLine(returnType, returns, input.chain)]),
        ...(left === undefined ? [] : svmLeftInPotLines(left, "the owner's wallet")),
        ...how,
        ...(moved === undefined ? [] : svmMovedLines(moved)),
      ].join("\n"),
      json,
      ...(notes.length === 0 ? {} : { notes }),
    };
  }

  return {
    text: [
      `The cook reverts: ${reason}`,
      ...(returns === undefined || returnType === undefined
        ? []
        : [`${returnedLine(returnType, returns, input.chain)}, before the transaction failed`]),
      ...how,
      "Program logs:",
      ...logs.map((l) => `  ${l}`),
    ].join("\n"),
    json,
    ...(notes.length === 0 ? {} : { notes }),
    exitCode: 1,
  };
}

/** The plan for the cook `prepared` builds (`svm-plan.ts`): its accounts, its Pot, and the token
 *  accounts it names, which the plan creates where the cluster does not have them. */
async function planOf(prepared: Prepared, input: SvmCookInput): Promise<SvmPlan> {
  const potMissing =
    prepared.via === "kitchen" &&
    !(await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot"));
  const tokenAccounts: PlanTokenAccount[] = [];
  for (const token of prepared.given.named.values()) {
    if (token.account === undefined || tokenAccounts.some((one) => one.address === token.address))
      continue;
    tokenAccounts.push({ address: token.address, ...token.account, label: token.label });
  }
  const returnType = mainReturnType(input.text);

  return newSvmPlan({
    owner: input.owner,
    salt: input.salt,
    via: prepared.via,
    ...(input.maxExecutionFee === undefined ? {} : { maxExecutionFee: input.maxExecutionFee }),
    payload: prepared.bytecode,
    tail: resolveAccounts(prepared.manifest, prepared.accounts, input.owner).map((meta) => ({
      address: meta.address,
      role: meta.role,
    })),
    lookupTables: prepared.lookupTables,
    potMissing,
    tokenAccounts,
    ...(returnType === undefined ? {} : { returnType }),
    labels: await accountLabels(input, prepared.pot, prepared.given),
  });
}

/**
 * `sauce tx` on Solana: the cook as an unsigned, serialized transaction for a wallet — or, where it
 * needs more than one transaction (a program staged in a code buffer, a lookup table, a Pot or a
 * token account to create first), the plan's first step, and the cursor `sauce send` takes to send
 * it and build the next one fresh.
 */
export async function svmTxCommand(input: SvmCookInput, files: CliFiles): Promise<CommandOutput> {
  requireSupported("building the cook transaction", [input.chain]);
  const signer = unsignedSigner(input.owner);
  const prepared = await prepare(input, files, signer);
  const direct = prepared.via === "engine";
  const plan = await planOf(prepared, input);
  const ctx: StepContext = { rpc: prepared.rpc, url: input.rpcUrl, signer, fee: prepared.fee };
  const step = await nextStep(plan, ctx);
  const built = await signableStep(step, ctx);
  const cursor = encodeCursor(built.plan);
  // One transaction, the cook alone: the shape a wallet takes, as it always was.
  const single = step.name === "cook" && built.transactions.length === 1;
  const createsPot = step.transactions.some((tx) => tx.createsPot === true);
  const json = {
    chain: "solana",
    via: prepared.via,
    feePayer: input.owner,
    ...(direct ? {} : { pot: prepared.pot }),
    fee: prepared.fee.toString(),
    maxExecutionFee: prepared.fee.toString(),
    ...(single
      ? { ...(direct ? {} : { createsPot }), transaction: built.transactions[0]!.transaction }
      : { step: step.name, transactions: built.transactions }),
    plan: step.overview,
    ...(built.lastValidBlockHeight === undefined
      ? {}
      : { expiresAtBlockHeight: built.lastValidBlockHeight.toString() }),
    ...(step.fails === undefined ? {} : { fails: step.fails.reason, logs: step.fails.logs }),
    ...(step.wait === undefined ? {} : { wait: step.wait }),
    cursor,
  };
  const potNote = direct
    ? `${DIRECT_COOK}: no Kitchen and no Pot. ${input.owner} is the authority ` +
      "the program acts with, so the accounts it spends from are the signer's own."
    : `Pot ${prepared.pot} belongs to ${input.owner} (salt ${input.salt}). ` +
      (plan.pot === "there"
        ? "It is created. Fund its accounts with what the program spends."
        : plan.pot === "inline"
          ? "It isn't created yet: this transaction creates it (the Kitchen's create_pot, the " +
            "owner paying its rent) ahead of the cook."
          : "It isn't created yet: the setup creates it first (the Kitchen's create_pot, the " +
            "owner paying its rent).");

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [
      potNote,
      ...step.notes,
      single
        ? `The transaction is base64, signed by no one; ${input.owner} signs it and pays the ` +
          `execution fee of ${prepared.fee} lamports (its max_execution_fee). Its blockhash ` +
          "expires in about a minute. `sauce send <signed> --cursor <cursor>` sends it and reads " +
          "back what main returned."
        : step.fails !== undefined
          ? `Simulated now, the cook would fail: ${step.fails.reason}, so no cook was built and ` +
            "none is handed out. Fix what it needs (fund the Pot, create an account it names), " +
            "then `sauce send --cursor <cursor>` simulates it again and builds it; `--close` gives " +
            "up on it."
          : step.wait !== undefined
            ? `Nothing to sign yet: ${step.wait}. \`sauce send --cursor <cursor>\` builds the ` +
              `${step.name} step then.`
            : `This is the plan's ${step.name} step: ${built.transactions.length} transactions, base64 ` +
              `and signed by no one, on one blockhash that expires in about a minute. ${input.owner} ` +
              "signs each and pays for it; `sauce send <signed>… --cursor <cursor>` sends them in " +
              "order and builds the next step fresh (" +
              step.overview
                .filter((stage) => stage.state === "later")
                .map((stage) => stage.what)
                .join(", then ") +
              "). Whatever expires before it lands is built again, from what the cluster shows.",
    ],
    // No cook to sign: what the command is for, it could not give.
    ...(step.fails === undefined ? {} : { exitCode: 1 }),
  };
}

export interface SvmRunInput extends SvmCookInput {
  readonly signer: KeyPairSigner;
  readonly approver: Approver;
}

const sentLine = (what: string, sent: SvmSent): string =>
  `${what} ${sent.signature}: ${sent.ok ? "success" : "failed"}` +
  (sent.computeUnits === undefined ? "" : `, ${sent.computeUnits} compute units`) +
  (sent.reason === undefined ? "" : `, ${sent.reason}`);

/** A sent transaction's line, then where a person opens it: Solscan, and its trace. */
const sentLines = (what: string, sent: SvmSent): string[] => [
  sentLine(what, sent),
  ...linkLines(txLinks(requireChain("solana"), sent.signature)),
];

const sentJson = (sent: SvmSent): Record<string, unknown> => ({
  signature: sent.signature,
  ...txLinks(requireChain("solana"), sent.signature),
  status: sent.ok ? "success" : "failed",
  ...(sent.computeUnits === undefined ? {} : { computeUnits: sent.computeUnits.toString() }),
  ...(sent.reason === undefined ? {} : { reason: sent.reason, logs: sent.logs }),
});

/**
 * Builds a plan's transaction for `ctx.signer` on a fresh blockhash, signs it, rehearses it and
 * sends it, failing with the logs if the rehearsal fails: how this process sends every step.
 * `sending` is told the blockhash's lifetime once the rehearsal passed, before it goes out: from
 * then on, it can land.
 */
export async function sendPlanTx(
  ctx: StepContext,
  tx: PlanTx,
  sending?: (lifetime: CookHandedOut) => void,
): Promise<SvmSent> {
  const { value: latestBlockhash, context } = await ask(ctx.url, "the latest blockhash", () =>
    ctx.rpc.getLatestBlockhash().send(),
  );
  const transaction = await buildPlanTx(tx, ctx, latestBlockhash);
  const { value } = await ask(ctx.url, `a simulation of ${tx.what}`, () =>
    ctx.rpc
      .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
        replaceRecentBlockhash: true,
      })
      .send(),
  );
  if (value.err !== null) {
    const logs = value.logs ?? [];
    throw new CliError(
      `${tx.what} would fail, so nothing was sent: ${failureReason(value.err, logs)}\n${logs.join("\n")}`,
    );
  }
  sending?.({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    slot: BigInt(context.slot),
  });

  return sendAndConfirm(ctx.rpc, ctx.url, transaction);
}

/**
 * Gives up on `plan`'s cook and closes its code buffer, returning its rent. Never throws: a failure
 * is the reason it stays open, which the caller reports with the buffer's address.
 */
async function closePlanBuffer(
  plan: SvmPlan,
  ctx: StepContext,
): Promise<{ sent?: SvmSent; open?: string }> {
  const buffer = await planBuffer(plan);
  try {
    const step = await nextStep(plan, ctx, { close: true });
    const tx = step.transactions[0];
    if (tx === undefined) return {};
    const sent = await sendPlanTx(ctx, tx);
    if (sent.ok) return { sent };

    return {
      sent,
      open: `the code buffer ${buffer?.codeBuffer} is still open (closing it failed in ${sent.signature}: ${sent.reason}); its rent stays there until it is closed: sauce reclaim --chain solana closes it`,
    };
  } catch (error) {
    return {
      open: `the code buffer ${buffer?.codeBuffer} is still open (closing it failed: ${(error as Error).message.split("\n")[0]}); its rent stays there until it is closed: sauce reclaim --chain solana closes it`,
    };
  }
}

/** How long a run waits for a lookup table its setup just extended to come into use: the slot
 *  after, usually well inside the first try. */
const TABLE_WARMUP = { tries: 30, delayMs: 500 };

/** What a run asks before it creates a Pot that does not fit in the cook's own transaction. */
const potApproval = (input: SvmRunInput, pot: Address) => ({
  action: `create Pot ${pot}`,
  reason: `Your Pot ${pot} on solana isn't deployed yet, and its creation does not fit in the cook's transaction`,
  offer: "Deploy it now",
  estimate: "its rent paid by you",
  byHand: `create it yourself with ${createHint(input)}`,
});

/**
 * Asks for the token accounts the cook names that solana does not have yet, as the Pot's creation
 * is asked for: their rent comes from the owner. A program paying into an account that does not
 * exist fails.
 */
async function approveTokenAccounts(
  input: SvmRunInput,
  missing: readonly PlanTokenAccount[],
): Promise<string[]> {
  const made = missing.map((token) => `${token.label}, ${token.address}`);
  const actions = made.map((one) => `create ${one}`);
  if (!input.approver.auto && !input.approver.canAsk) throw unapproved(actions, input.approver.why);
  const agreed = await input.approver.approve(
    actions.join("; "),
    `${made.join("; ")}: not on solana yet, and the cook names ${missing.length === 1 ? "it" : "them"}. ` +
      "Create now, the owner paying the rent? [y/N] ",
  );
  if (agreed !== true) {
    throw new CliError(
      `${made.join("; ")} ${missing.length === 1 ? "does" : "do"} not exist on solana, so nothing ` +
        "was sent: create each (its associated token account, idempotently), or pass " +
        "--yes (-y) to create them before the cook",
    );
  }

  return made;
}

/**
 * `sauce run` on Solana: compile, then the plan's steps (`svm-plan.ts`), each transaction built on
 * a fresh blockhash and signed with the keypair: what the cook needs created first (asked for), the
 * program staged where it does not fit one transaction, a lookup table for its accounts, the cook,
 * and the code buffer's close.
 */
export async function svmRunCommand(input: SvmRunInput, files: CliFiles): Promise<CommandOutput> {
  requireSupported("sending the cook", [input.chain]);
  const prepared = await prepare(input, files, input.signer);
  const direct = prepared.via === "engine";
  const ctx: StepContext = {
    rpc: prepared.rpc,
    url: input.rpcUrl,
    signer: input.signer,
    fee: prepared.fee,
  };
  let plan = await planOf(prepared, input);
  const buffer = await planBuffer(plan);
  let created: SvmSent | undefined;
  let accountsMade: { sent: SvmSent; made: string[] } | undefined;
  const staged: SvmSent[] = [];
  const tabled: SvmSent[] = [];
  // Once the buffer is there, a run that stops closes it again, and says whether it did; a lookup
  // table it created stays, and is named.
  const closedAgain = async (): Promise<string> =>
    (buffer === undefined || staged.length === 0
      ? ""
      : `\n${(await closePlanBuffer(plan, ctx)).open ?? `The code buffer ${buffer.codeBuffer} was closed again.`}`) +
    (tabled.length === 0 || plan.table?.address === undefined
      ? ""
      : `\nLookup table ${plan.table.address} stays: sauce reclaim --chain solana closes it.`);
  // The step after, read from the cluster: a failure to read it is a stop like any other.
  const after = async (): Promise<PlanStep> => {
    try {
      return await nextStep(plan, ctx);
    } catch (error) {
      throw new CliError(`${(error as Error).message}${await closedAgain()}`);
    }
  };

  let step = await nextStep(plan, ctx);
  while (step.name === "setup") {
    // Asked as every step a command sends first is (`approvals.ts`): with no one to ask, named
    // before anything is sent.
    if (step.transactions.some((tx) => tx.kind === "pot")) {
      await approveAll(input.approver, [potApproval(input, prepared.pot)]);
    }
    const accounts = step.transactions.find((tx) => tx.kind === "accounts")?.accounts;
    const made = accounts === undefined ? undefined : await approveTokenAccounts(input, accounts);
    plan = step.plan;
    for (const tx of step.transactions) {
      const staging = tx.kind === "buffer" || tx.kind === "write" || tx.kind === "finalize";
      let sent: SvmSent;
      try {
        sent = await sendPlanTx(ctx, tx);
      } catch (error) {
        throw new CliError(
          `${staging ? "staging the program failed: " : ""}${(error as Error).message}${await closedAgain()}`,
        );
      }
      if (staging) staged.push(sent);
      if (tx.kind === "table") tabled.push(sent);
      if (!sent.ok) {
        throw new CliError(
          tx.kind === "pot" || tx.kind === "accounts"
            ? sentLine(tx.what, sent)
            : `${staging ? "staging the program failed: " : ""}${tx.what} failed in ` +
                `${sent.signature}: ${sent.reason}${await closedAgain()}`,
        );
      }
      if (tx.kind === "pot") {
        created = sent;
        await awaitAccount(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot");
      }
      if (tx.kind === "accounts") accountsMade = { sent, made: made ?? [] };
    }
    step = await after();
  }
  // A lookup table the setup just extended is in use from the next slot: a run, the owner's own
  // process, waits for it, a little.
  for (let tries = 0; step.readyAt !== undefined && tries < TABLE_WARMUP.tries; tries++) {
    await new Promise((resolve) => setTimeout(resolve, TABLE_WARMUP.delayMs));
    step = await after();
  }
  if (step.wait !== undefined) throw new CliError(`${step.wait}${await closedAgain()}`);
  if (step.fails !== undefined) {
    throw new CliError(
      `the cook would fail, so it was not sent: ${step.fails.reason}` +
        (step.fails.logs.length === 0
          ? ""
          : `\nProgram logs:\n${step.fails.logs.map((l) => `  ${l}`).join("\n")}`) +
        (await closedAgain()),
    );
  }
  const cookTx = step.transactions[0];
  if (step.name !== "cook" || cookTx === undefined) {
    throw new CliError(
      `the plan's step after its setup is ${step.name}, not the cook${await closedAgain()}`,
    );
  }
  if (step.unrehearsed === true) {
    throw new CliError(
      `the endpoint did not simulate the cook, so it was not sent${await closedAgain()}`,
    );
  }
  plan = step.plan;
  const createInCook = cookTx.createsPot === true;
  const { value: latestBlockhash } = await ask(input.rpcUrl, "the latest blockhash", () =>
    prepared.rpc.getLatestBlockhash().send(),
  );
  const transaction = await buildPlanTx(cookTx, ctx, latestBlockhash);
  // What the cook moves: every account it may write, read before it is sent and once it lands.
  const tracked = writableAccounts(transaction, cookTx.lookupTables ?? {});
  const before = await accountsNow(prepared.rpc, tracked).catch(() => undefined);
  let cook: SvmSent;
  try {
    cook = await sendAndConfirm(prepared.rpc, input.rpcUrl, transaction);
  } catch (error) {
    // Sent, perhaps: the cook may still land, so the buffer it runs from stays.
    throw new CliError(
      `${(error as Error).message}` +
        (buffer === undefined
          ? ""
          : `\nThe code buffer ${buffer.codeBuffer} stays open, as the cook may still land: ` +
            "sauce reclaim --chain solana closes it once it has."),
    );
  }
  const landedAs =
    cook.ok && before !== undefined
      ? await accountsNow(prepared.rpc, tracked).catch(() => undefined)
      : undefined;
  const moved =
    before === undefined || landedAs === undefined
      ? undefined
      : await movedBy(
          prepared.rpc,
          input.chain,
          tracked,
          before,
          landedAs,
          await accountLabels(input, prepared.pot, prepared.given),
          input.owner,
        );
  const left = moved === undefined || direct ? undefined : svmLeftInPot(moved, prepared.pot);
  plan = { ...plan, cooked: { ok: cook.ok, signature: cook.signature } };
  // The cook has landed (or failed) by now: whatever happens to the buffer, it is reported.
  const closed = buffer === undefined ? undefined : await closePlanBuffer(plan, ctx);
  const table = plan.table?.address;

  return {
    text: [
      ...(created === undefined ? [] : sentLines(`created Pot ${prepared.pot} in`, created)),
      ...(createInCook
        ? [
            cook.ok
              ? `created Pot ${prepared.pot} in the cook's own transaction, ahead of the cook`
              : `Pot ${prepared.pot} was to be created in the cook's transaction, which failed: it is not`,
          ]
        : []),
      ...(accountsMade === undefined
        ? []
        : sentLines(`created ${accountsMade.made.join("; ")} in`, accountsMade.sent)),
      ...(staged.length === 0
        ? []
        : [`staged the ${prepared.bytecode.length}-byte program in ${staged.length} transactions`]),
      ...(table === undefined || tabled.length === 0
        ? []
        : [
            `created lookup table ${table} holding the cook's ${plan.table!.addresses.length} ` +
              `accounts in ${tabled.length} transactions; a later cook naming them reuses it with ` +
              `--lookup-table ${table}, and sauce reclaim closes it once none will`,
          ]),
      ...sentLines(direct ? "cook (direct to the engine)" : "cook", cook),
      ...(cook.ok ? [`execution fee: ${step.fee ?? prepared.fee} lamports`] : []),
      ...(left === undefined ? [] : svmLeftInPotLines(left, "your wallet")),
      ...(moved === undefined ? [] : svmMovedLines(moved)),
      ...(cook.ok ? [] : ["Program logs:", ...cook.logs.map((line) => `  ${line}`)]),
      ...(closed?.sent === undefined || closed.open !== undefined
        ? []
        : sentLines("closed the code buffer in", closed.sent)),
    ].join("\n"),
    ...(closed?.open === undefined ? {} : { notes: [`warning: ${closed.open}`] }),
    json: {
      chain: "solana",
      via: prepared.via,
      owner: input.owner,
      ...(direct ? {} : { pot: prepared.pot }),
      fee: (step.fee ?? prepared.fee).toString(),
      maxExecutionFee: (step.fee ?? prepared.fee).toString(),
      ...(created === undefined ? {} : { createPot: sentJson(created) }),
      ...(createInCook
        ? { createPot: { inCook: true, ...(cook.ok ? {} : { undone: true }) } }
        : {}),
      ...(accountsMade === undefined
        ? {}
        : { createTokenAccounts: { ...sentJson(accountsMade.sent), accounts: accountsMade.made } }),
      ...(buffer === undefined
        ? {}
        : {
            staged: {
              codeBuffer: buffer.codeBuffer,
              sha256: bytesToHex(plan.staged!.sha256),
              transactions: staged.map((one) => one.signature),
            },
          }),
      ...(table === undefined || tabled.length === 0
        ? {}
        : {
            lookupTable: {
              address: table,
              accounts: plan.table!.addresses.length,
              transactions: tabled.map((one) => one.signature),
            },
          }),
      ...(left === undefined ? {} : { leftInPot: svmLeftInPotJson(left) }),
      cook: { ...sentJson(cook), ...(moved === undefined ? {} : svmMovedJson(moved)) },
      ...(closed?.sent === undefined ? {} : { closeCodeBuffer: sentJson(closed.sent) }),
      ...(closed?.open === undefined ? {} : { warning: closed.open }),
    },
    ...(cook.ok ? {} : { exitCode: 1 }),
  };
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
  requireSupported("creating a Pot", [requireChain("solana")]);
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
    notes: sentLines(`created Pot ${pot} in`, sent).map((line) => line.trim()),
    ...(sent.ok ? {} : { exitCode: 1 }),
  };
}
