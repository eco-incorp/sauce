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
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionSize,
  isAddress,
  TRANSACTION_SIZE_LIMIT,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
  type TransactionPartialSigner,
  type TransactionSigner,
} from "@solana/kit";
import type { AccountManifest } from "sauce-compiler";
import { bytesToHex, hexToBytes, type Hex } from "viem";

import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../deployments/index.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { svmKitchenIdlPath } from "../svm/engine-artifacts.js";
import { verifySvmSettleExecution, type SvmSettleExecutionVerification } from "../svm/verify.js";
import {
  buildCloseCodeBufferInstruction,
  buildCreateCodeBufferInstruction,
  buildCreatePotInstruction,
  buildExecuteTransaction,
  buildFinalizeCodeBufferInstruction,
  buildGrowCodeBufferInstruction,
  buildWriteCodeBufferInstruction,
  createSauceSvmClient,
  deriveCodeBufferPda,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
  derivePotPda,
  GROWTH_STEP,
  MAX_POT_LEN,
  type AccountResolution,
  type SauceSvmClient,
  type SimulateExecuteResult,
} from "../svm/index.js";
import { CliError, UsageError, type SaltChoice } from "./args.js";
import {
  compileProgram,
  payloadOf,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type Confirm,
  type ProgramInput,
} from "./commands.js";
import { secret } from "./signer.js";

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

/** A transaction error, read: the program's thrown text, a Kitchen error by name, or as given. */
function reasonOf(err: unknown, returnData?: Uint8Array): string {
  const detail = (err as { InstructionError?: [unknown, unknown] } | null)?.InstructionError;
  const custom = (detail?.[1] as { Custom?: unknown } | undefined)?.Custom;
  if (custom !== undefined) {
    const code = Number(custom);
    if (code === 0) {
      const text =
        returnData === undefined || returnData.length === 0
          ? ""
          : new TextDecoder("utf-8", { fatal: false }).decode(returnData);

      return /^[\x20-\x7e]+$/.test(text)
        ? `the program threw "${text}"`
        : `the program reverted${returnData?.length ? ` with ${bytesToHex(returnData)}` : ""}`;
    }
    const named = kitchenErrors().get(code);
    if (named !== undefined) return `the Kitchen refused: ${named}`;

    return (
      `instruction ${detail![0]} failed with custom program error ${code} ` +
      `(0x${code.toString(16)}); the program logs say which program and why`
    );
  }
  if (detail !== undefined) return `instruction ${detail[0]} failed: ${String(detail[1])}`;

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
  for (let tries = 0; ; tries++) {
    const { value } = await ask(url, "the transaction's status", () =>
      rpc.getSignatureStatuses([signature]).send(),
    );
    const status = value[0];
    if (status !== null && status !== undefined && status.confirmationStatus !== "processed") break;
    if (tries >= 120)
      throw new CliError(`transaction ${signature} was not confirmed within a minute`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const response = await ask(url, "the confirmed transaction", () =>
    rpc
      .getTransaction(signature, {
        commitment: "confirmed",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      })
      .send(),
  );
  const meta = response?.meta;
  const returnData =
    meta?.returnData === undefined || meta.returnData === null
      ? undefined
      : new Uint8Array(getBase64Encoder().encode(meta.returnData.data[0]));
  const err = meta?.err ?? null;

  return {
    signature,
    ok: err === null,
    ...(err === null ? {} : { reason: reasonOf(err, returnData) }),
    ...(meta?.computeUnitsConsumed === undefined
      ? {}
      : { computeUnits: meta.computeUnitsConsumed }),
    logs: meta?.logMessages ?? [],
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
    throw new CliError(
      `${what} would fail, so nothing was sent: ${reasonOf(value.err)}\n${(value.logs ?? []).join("\n")}`,
    );
  }

  return sendAndConfirm(rpc, url, transaction);
}

// ---------------------------------------------------------------------------------------------
// Accounts, the Pot, the cook
// ---------------------------------------------------------------------------------------------

/** `--account name=<pubkey | pot | owner>`, parsed. */
export function parseAccounts(raws: readonly string[]): Record<string, string> {
  const accounts: Record<string, string> = {};
  for (const raw of raws) {
    const at = raw.indexOf("=");
    const name = raw.slice(0, at).trim();
    const value = raw.slice(at + 1).trim();
    if (at <= 0 || value === "") {
      throw new UsageError(`--account: expected NAME=<address | pot | owner>, got '${raw}'`);
    }
    if (Object.hasOwn(accounts, name)) throw new UsageError(`--account: ${name} given twice`);
    if (value !== "pot" && value !== "owner" && !isAddress(value)) {
      throw new UsageError(`--account ${name}: '${value}' is not an address, pot or owner`);
    }
    accounts[name] = value;
  }

  return accounts;
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

/** The program and its arguments, checked for what the CLI can encode on Solana. */
function svmPayload(program: CompiledSauceProgram, args: ArgsInput | undefined): Uint8Array {
  const address = program.entryParams.find((param) => /\bAddress\b/.test(param.type));
  if (address !== undefined) {
    throw new UsageError(
      `main's ${address.name}: ${address.type} is a 32-byte public key on Solana, which the CLI ` +
        "does not encode as an argument: take it as an Account parameter (passed with --account) " +
        "or a define",
    );
  }

  return hexToBytes(payloadOf(program, args));
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
}

/** Compiles the file, reads the fee, and builds the SDK client that cooks it as `signer`. */
async function prepare(
  input: SvmCookInput,
  files: CliFiles,
  signer: TransactionSigner,
): Promise<Prepared> {
  const program = compileProgram(input, files);
  const bytecode = svmPayload(program, input.args);
  const manifest = program.manifest ?? { accounts: [] };
  const rpc = createSolanaRpc(input.rpcUrl);
  const pot = await potOf(input);
  const accounts = resolution(manifest, input.accounts, input.owner, pot, signer);
  const fee = await kitchenFee(rpc, input.rpcUrl);
  const client = await createSauceSvmClient({
    rpcUrl: input.rpcUrl,
    programId: engine(),
    kitchen: kitchen(),
    payer: signer,
    potSalt: saltBytes(input.salt),
    maxExecutionFee: fee,
  });

  return { rpc, pot, fee, program, bytecode, client, accounts, manifest };
}

/** Whether the cook carrying `bytecode` fits in one transaction. */
async function fits(prepared: Prepared): Promise<{ fits: boolean; size: number }> {
  const transaction = await prepared.client.cookTransaction(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
    {},
  );
  const size = getTransactionSize(transaction);

  return { fits: size <= TRANSACTION_SIZE_LIMIT, size };
}

const tooLarge = (bytes: number, size: number, what: string): CliError =>
  new CliError(
    `the program is ${bytes} bytes, so its cook is a ${size}-byte transaction, past Solana's ` +
      `${TRANSACTION_SIZE_LIMIT}: it has to be staged first, which ${what} cannot do. ` +
      "`sauce run` stages it.",
  );

function simulated(result: SimulateExecuteResult): string {
  const revert = result.revert?.payload;

  return reasonOf(result.err, revert);
}

/** `sauce simulate` on Solana: the cook, simulated from the Pot's owner — no key. */
export async function svmSimulateCommand(
  input: SvmCookInput,
  files: CliFiles,
): Promise<CommandOutput> {
  const prepared = await prepare(input, files, unsignedSigner(input.owner));
  if (!(await exists(prepared.rpc, input.rpcUrl, prepared.pot, "the Pot"))) {
    throw new CliError(
      `Pot ${prepared.pot} is not deployed on solana, so there is nothing to simulate the cook ` +
        `on: create it first (${createHint(input)})`,
    );
  }
  const size = await fits(prepared);
  if (!size.fits) throw tooLarge(prepared.bytecode.length, size.size, "a simulation");
  const result = await prepared.client.simulate(
    prepared.bytecode,
    prepared.manifest,
    prepared.accounts,
  );
  const json = {
    ok: result.ok,
    chain: "solana",
    owner: input.owner,
    pot: prepared.pot,
    fee: prepared.fee.toString(),
    ...(result.unitsConsumed === undefined
      ? {}
      : { computeUnits: result.unitsConsumed.toString() }),
    ...(result.ok ? {} : { reason: simulated(result) }),
    logs: result.logs,
  };

  return result.ok
    ? {
        text: `The cook succeeds from ${input.owner}: ${result.unitsConsumed ?? "?"} compute units`,
        json,
      }
    : {
        text: [
          `The cook fails: ${simulated(result)}`,
          "Program logs:",
          ...result.logs.map((l) => `  ${l}`),
        ].join("\n"),
        json,
        exitCode: 1,
      };
}

/** `sauce tx` on Solana: the cook as an unsigned, serialized transaction for a wallet. */
export async function svmTxCommand(input: SvmCookInput, files: CliFiles): Promise<CommandOutput> {
  const prepared = await prepare(input, files, unsignedSigner(input.owner));
  const size = await fits(prepared);
  if (!size.fits) throw tooLarge(prepared.bytecode.length, size.size, "one unsigned transaction");
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

/** Stages `bytecode` in a fresh code buffer: create, grow, write in chunks, finalize. */
async function stage(
  rpc: Rpc,
  url: string,
  signer: TransactionSigner,
  bytecode: Uint8Array,
): Promise<{ codeBuffer: Address; code: Address; sha256: Uint8Array; sent: SvmSent[] }> {
  const nonce = randomBytes(8).readBigUInt64LE(0);
  const { address: codeBuffer } = await deriveCodeBufferPda(kitchen(), signer.address, nonce);
  const { address: code } = await deriveCodePda(kitchen(), codeBuffer);
  const accounts = { kitchen: kitchen(), owner: signer.address, codeBuffer, code };
  const sent: SvmSent[] = [];
  const grows = Math.ceil(bytecode.length / GROWTH_STEP) - 1;
  sent.push(
    await sendInstructions(
      rpc,
      url,
      signer,
      [
        buildCreateCodeBufferInstruction({ ...accounts, nonce, capacity: bytecode.length }),
        ...Array.from({ length: grows }, () => buildGrowCodeBufferInstruction(accounts)),
      ],
      "creating the code buffer",
    ),
  );
  // A write carries its chunk plus ~200 bytes of signature, header and accounts.
  const CHUNK = 900;
  for (let offset = 0; offset < bytecode.length; offset += CHUNK) {
    sent.push(
      await sendInstructions(
        rpc,
        url,
        signer,
        [
          buildWriteCodeBufferInstruction({
            ...accounts,
            offset,
            chunk: bytecode.subarray(offset, offset + CHUNK),
          }),
        ],
        `writing bytes ${offset}… of the program`,
      ),
    );
  }
  const sha256 = new Uint8Array(createHash("sha256").update(bytecode).digest());
  sent.push(
    await sendInstructions(
      rpc,
      url,
      signer,
      [
        buildFinalizeCodeBufferInstruction({
          ...accounts,
          len: bytecode.length,
          expectedSha256: sha256,
        }),
      ],
      "finalizing the code buffer",
    ),
  );
  for (const step of sent) {
    if (!step.ok)
      throw new CliError(`staging the program failed in ${step.signature}: ${step.reason}`);
  }

  return { codeBuffer, code, sha256, sent };
}

export interface SvmRunInput extends SvmCookInput {
  readonly signer: KeyPairSigner;
  readonly yes: boolean;
  readonly confirm: Confirm;
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
  const agreed = input.yes
    ? true
    : await input.confirm(
        `Pot ${pot} (owner ${input.owner}, salt ${input.salt}) is not deployed on solana. ` +
          "Deploy it now? [y/N] ",
      );
  if (agreed !== true) {
    throw new CliError(
      agreed === undefined
        ? `${missing}. Create it first (${createHint(input)}), or pass --yes to create it before the cook`
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

  return created;
}

/** `sauce run` on Solana: compile, create the Pot if agreed, stage if needed, cook, confirm. */
export async function svmRunCommand(input: SvmRunInput, files: CliFiles): Promise<CommandOutput> {
  const prepared = await prepare(input, files, input.signer);
  const created = await ensurePot(input, prepared.rpc, prepared.pot);
  const size = await fits(prepared);
  let staged: Awaited<ReturnType<typeof stage>> | undefined;
  let transaction: Transaction;
  try {
    if (size.fits) {
      transaction = await prepared.client.cookTransaction(
        prepared.bytecode,
        prepared.manifest,
        prepared.accounts,
        { computeUnitLimit: "auto" },
      );
    } else {
      staged = await stage(prepared.rpc, input.rpcUrl, input.signer, prepared.bytecode);
      transaction = await prepared.client.stagedCookTransaction(
        staged.codeBuffer,
        prepared.manifest,
        prepared.accounts,
        { computeUnitLimit: "auto" },
      );
    }
  } catch (error) {
    // `computeUnitLimit: "auto"` rehearses the cook first; its failure carries the reason.
    const logs = await rehearsalLogs(prepared, staged);
    throw new CliError(
      `the cook would fail, so it was not sent: ${logs.reason ?? (error as Error).message}` +
        (logs.lines.length === 0
          ? ""
          : `\nProgram logs:\n${logs.lines.map((l) => `  ${l}`).join("\n")}`),
    );
  }
  const cook = await sendAndConfirm(prepared.rpc, input.rpcUrl, transaction);
  const closed =
    staged === undefined
      ? undefined
      : await sendInstructions(
          prepared.rpc,
          input.rpcUrl,
          input.signer,
          [
            buildCloseCodeBufferInstruction({
              kitchen: kitchen(),
              owner: input.owner,
              codeBuffer: staged.codeBuffer,
              code: staged.code,
            }),
          ],
          "closing the code buffer",
        );

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
      ...(closed === undefined ? [] : [sentLine("closed the code buffer in", closed)]),
    ].join("\n"),
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
      ...(closed === undefined ? {} : { closeCodeBuffer: sentJson(closed) }),
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
 * `splCount`. A rejection exits 1: `NO_SETTLE` when the transaction invokes no released engine or
 * not with a settle's accounts, `NOT_GENUINE` with the SDK's reason otherwise.
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
  const json = { ...predicted.json, deployed: sent.ok, createPot: sentJson(sent) };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [sentLine(`created Pot ${pot} in`, sent)],
    ...(sent.ok ? {} : { exitCode: 1 }),
  };
}
