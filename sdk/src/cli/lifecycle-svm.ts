/**
 * The Solana half of an intent's life after publishing, for an intent an EVM chain published to
 * Solana: what Solana's Portal recorded, and the fill, the proof and the cancellation as unsigned
 * Solana transactions — base64 wire transactions with the fee payer's signature left empty and
 * the fresh keys a proof needs already signed. `lifecycle.ts` calls these where the destination
 * is Solana, and returns them in the same plans; like it, this holds no key, store, prompt or
 * environment, and reads only the endpoints it is given.
 *
 * The instructions are `svm/portal.ts`'s. Solana's simulation takes no state overrides, so a
 * rehearsal here runs on the accounts as they are: a solver that does not hold the route's tokens
 * yet sees the fill fail, saying so.
 */
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64Decoder,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  isSignerRole,
  type Address as SvmAddress,
  type AddressesByLookupTableAddress,
  type Blockhash,
  type Base64EncodedWireTransaction,
  type Instruction,
  type TransactionMessageBytesBase64,
} from "@solana/kit";
import { bytesToHex, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { hashIntent } from "../routes/encode.js";
import type { Intent } from "../routes/types.js";
import {
  associatedTokenAccount,
  buildPortalCancelInstruction,
  buildPortalFulfillInstruction,
  buildPortalHyperProveInstructions,
  decodeFulfillMarker,
  PORTAL_DISCRIMINATORS,
  svmFulfillMarkerPda,
  svmKeyOf,
} from "../svm/portal.js";
import { TOKEN_PROGRAM_ID } from "../svm/token-program.js";
import { fetchAlt, lookupTableBatches } from "../svm/alt.js";
import { v12SvmKitchenProgramId } from "../deployments/index.js";
import { buildHeapFramePrepend } from "../svm/prepends.js";
import { CliError } from "./args.js";

export type SvmRpc = ReturnType<typeof createSolanaRpc>;

/** A Solana transaction, unsigned by its fee payer, for any wallet to sign and send. */
export interface SvmTxJson {
  readonly chainId: number;
  readonly chain: string;
  /** Who pays the fee and signs last. */
  readonly feePayer: string;
  /** The wire transaction, base64: the fee payer's signature empty, every other one there. */
  readonly transaction: string;
  /** Lamports the fee payer spends beyond the fee, as the rehearsal measured; "0" unmeasured. */
  readonly value: string;
  /** What it does, for a person. */
  readonly what: string;
}

/** Whether a plan's transaction is Solana's. */
export const isSvmTx = (tx: object): tx is SvmTxJson => "transaction" in tx;

/** Solana's largest transaction on the wire. */
export const SVM_PACKET_BYTES = 1232;

/** A client for a Solana endpoint. */
export const svmRpc = (url: string): SvmRpc => createSolanaRpc(url);

async function ask<T>(what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    // The transport's message can name the endpoint, which may carry a key: never print one.
    const reason =
      error instanceof Error ? error.message.replace(/[a-z][\w+.-]*:\/\/\S+/gi, "<endpoint>") : "";
    throw new CliError(`reading ${what} from Solana failed${reason === "" ? "" : `: ${reason}`}`, {
      cause: error,
    });
  }
}

const bytesOf = (data: readonly [string, string] | string): Uint8Array =>
  new Uint8Array(getBase64Encoder().encode(Array.isArray(data) ? data[0] : (data as string)));

/** An account's data and owner, or `null` when there is none. */
async function account(
  rpc: SvmRpc,
  key: SvmAddress,
  what: string,
): Promise<{ data: Uint8Array; owner: string; executable: boolean; lamports: bigint } | null> {
  const { value } = await ask(what, () =>
    rpc.getAccountInfo(key, { encoding: "base64", commitment: "confirmed" }).send(),
  );
  if (value === null) return null;

  return {
    data: bytesOf(value.data as readonly [string, string]),
    owner: value.owner,
    executable: value.executable,
    lamports: BigInt(value.lamports),
  };
}

/** The cluster's clock, as the Portal reads it: `Clock::unix_timestamp`. */
export async function svmTime(rpc: SvmRpc): Promise<bigint> {
  const clock = await account(
    rpc,
    address("SysvarC1ock11111111111111111111111111111111"),
    "the clock",
  );
  if (clock === null || clock.data.length < 40)
    throw new CliError("Solana's endpoint has no clock");

  return new DataView(clock.data.buffer, clock.data.byteOffset).getBigInt64(32, true);
}

/** The newest slot the cluster has finalized. */
export async function svmFinalizedSlot(rpc: SvmRpc): Promise<bigint> {
  return ask("the finalized slot", () => rpc.getSlot({ commitment: "finalized" }).send());
}

/** Whether `program` is an executable account on the cluster. */
export async function svmProgramExists(rpc: SvmRpc, program: SvmAddress): Promise<boolean> {
  return (await account(rpc, program, `the program ${program}`))?.executable === true;
}

const portalCode = new Map<string, Uint8Array>();

/** An upgradeable program's ELF (its ProgramData past the 45-byte header), read once per id. */
async function programCode(rpc: SvmRpc, program: SvmAddress): Promise<Uint8Array | undefined> {
  const cached = portalCode.get(program);
  if (cached !== undefined) {
    // Least recently used goes first: a hit moves to the end.
    portalCode.delete(program);
    portalCode.set(program, cached);

    return cached;
  }
  const head = await account(rpc, program, `the program ${program}`);
  if (head === null || !head.executable || head.data.length < 36) return undefined;
  const programData = svmKeyOf(bytesToHex(head.data.subarray(4, 36)));
  const data = await account(rpc, programData, `${program}'s code`);
  if (data === null) return undefined;
  const code = data.data.subarray(45);
  portalCode.set(program, code);
  if (portalCode.size > 8) portalCode.delete(portalCode.keys().next().value!);

  return code;
}

/**
 * Whether `code` (an SBF program's ELF) dispatches the instruction whose Anchor discriminator is
 * `discriminator`: the program compares the instruction's first 8 bytes against it as a 64-bit
 * constant, which SBF loads with `lddw` — its low 32 bits in the first slot's immediate, its high
 * 32 bits eight bytes on, in the second's. Searched as that, or as 8 contiguous bytes.
 */
export function dispatchesDiscriminator(code: Uint8Array, discriminator: Uint8Array): boolean {
  const at = (i: number, from: number, to: number): boolean => {
    for (let j = from; j < to; j++) if (code[i + j - from] !== discriminator[j]) return false;

    return true;
  };
  for (let i = 0; i + 12 <= code.length; i++) {
    if (at(i, 0, 4) && (at(i + 4, 4, 8) || at(i + 8, 4, 8))) return true;
  }

  return false;
}

/** What Solana's Portal recorded for `intent`: the claimant (`null` while unfilled), whether the
 *  Portal has `cancel` (its code carries the instruction's discriminator, as an EVM Portal's
 *  carries a selector), and the cluster's time. */
export async function readSvmDestination(
  rpc: SvmRpc,
  intent: Intent,
): Promise<{ portal: string; claimant: Hex | null; canCancel: boolean; time: bigint }> {
  const portal = svmKeyOf(intent.route.portal);
  const code = await programCode(rpc, portal);
  if (code === undefined) {
    throw new CliError(`the Portal the route records, ${portal}, is not a program on Solana`);
  }
  const { intentHash } = hashIntent(intent);
  const [marker, time] = await Promise.all([
    account(rpc, await svmFulfillMarkerPda(portal, intentHash), "the intent's fulfill marker"),
    svmTime(rpc),
  ]);

  return {
    portal,
    claimant: marker === null ? null : decodeFulfillMarker(marker.data),
    canCancel: dispatchesDiscriminator(code, PORTAL_DISCRIMINATORS.cancel),
    time,
  };
}

/** `instructions` as one transaction from `feePayer` on a fresh blockhash, signed by every signer
 *  they carry but the fee payer; refused when it is past Solana's packet size. */
export async function svmTransaction(
  rpc: SvmRpc,
  chain: CanonicalChain,
  feePayer: SvmAddress,
  instructions: readonly Instruction[],
  what: string,
  /** Lookup tables its accounts are taken through. */
  tables?: AddressesByLookupTableAddress,
): Promise<SvmTxJson> {
  const { value: blockhash } = await ask("the latest blockhash", () =>
    rpc.getLatestBlockhash().send(),
  );
  const transaction = getBase64EncodedWireTransaction(
    await partiallySignTransactionMessageWithSigners(
      messageOf(feePayer, instructions, blockhash, tables),
    ),
  );
  const size = getBase64Encoder().encode(transaction).length;
  if (size > SVM_PACKET_BYTES) {
    throw new CliError(
      `${what} is ${size} bytes, past Solana's ${SVM_PACKET_BYTES}-byte transaction: the route is ` +
        "too large to send this way",
    );
  }

  return { chainId: chain.id, chain: chain.slug, feePayer, transaction, value: "0", what };
}

/** A v0 message of `instructions` from `feePayer`, through `tables` where given. */
function messageOf(
  feePayer: SvmAddress,
  instructions: readonly Instruction[],
  blockhash: { readonly blockhash: Blockhash; readonly lastValidBlockHeight: bigint },
  tables?: AddressesByLookupTableAddress,
) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  );

  return tables === undefined
    ? message
    : compressTransactionMessageUsingAddressLookupTables(message, tables);
}

/** The wire size of `instructions` from `feePayer`, through `tables` where given: what decides
 *  whether they fit one transaction. Reads nothing. */
function wireBytes(
  feePayer: SvmAddress,
  instructions: readonly Instruction[],
  tables?: AddressesByLookupTableAddress,
): number {
  const message = messageOf(
    feePayer,
    instructions,
    { blockhash: feePayer as unknown as Blockhash, lastValidBlockHeight: 0n },
    tables,
  );

  return getTransactionEncoder().encode(compileTransaction(message)).length;
}

/**
 * The accounts a lookup table can carry for `instructions`: every account but a signer and an
 * instruction's own program, which the transaction lists itself, in first-seen order.
 */
function tableAddresses(instructions: readonly Instruction[]): SvmAddress[] {
  const programs = new Set<string>(instructions.map((instruction) => instruction.programAddress));
  const seen = new Set<string>();
  const addresses: SvmAddress[] = [];
  for (const instruction of instructions) {
    for (const meta of instruction.accounts ?? []) {
      if (!("address" in meta) || isSignerRole(meta.role)) continue;
      if (programs.has(meta.address) || seen.has(meta.address)) continue;
      seen.add(meta.address);
      addresses.push(meta.address);
    }
  }

  return addresses;
}

/** Why a Solana transaction failed: Anchor's error code where the logs give one. */
export function svmFailure(err: unknown, logs: readonly string[]): string {
  const anchor = logs
    .map((line) => /Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*)$/.exec(line))
    .find((match) => match !== null);
  if (anchor !== undefined && anchor !== null) return `${anchor[1]}: ${anchor[2]}`;
  const failed = logs.find((line) => /failed: /.test(line));
  if (failed !== undefined) return failed.replace(/^Program \w+ /, "");

  return JSON.stringify(err, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

export interface SvmRehearsal {
  readonly ok: boolean;
  readonly reason?: string;
  readonly logs: readonly string[];
  readonly units?: bigint;
  /** The accounts asked for, as the transaction leaves them: data, and lamports. */
  readonly after: ReadonlyMap<
    string,
    { readonly data: Uint8Array; readonly lamports: bigint } | null
  >;
}

/** `tx` simulated as the cluster would run it, unsigned, reporting `watch` as it leaves them. */
export async function rehearseSvm(
  rpc: SvmRpc,
  tx: SvmTxJson,
  watch: readonly string[] = [],
): Promise<SvmRehearsal> {
  const { value } = await ask("a simulation", () =>
    rpc
      .simulateTransaction(tx.transaction as Base64EncodedWireTransaction, {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: true,
        ...(watch.length === 0
          ? {}
          : { accounts: { addresses: watch.map((key) => address(key)), encoding: "base64" } }),
      })
      .send(),
  );
  const logs = value.logs ?? [];
  const after = new Map<string, { data: Uint8Array; lamports: bigint } | null>();
  const accounts =
    (
      value as {
        accounts?: ReadonlyArray<{
          data: readonly [string, string];
          lamports: bigint | number;
        } | null> | null;
      }
    ).accounts ?? [];
  accounts.forEach((entry, index) => {
    after.set(
      watch[index]!,
      entry === null ? null : { data: bytesOf(entry.data), lamports: BigInt(entry.lamports) },
    );
  });

  return {
    ok: value.err === null,
    ...(value.err === null ? {} : { reason: svmFailure(value.err, logs) }),
    logs,
    ...(value.unitsConsumed === undefined ? {} : { units: BigInt(value.unitsConsumed) }),
    after,
  };
}

/** A token account's amount (SPL layout, Token-2022's base too), or 0 where there is none. */
export const tokenAccountAmount = (data: Uint8Array | null | undefined): bigint =>
  data === null || data === undefined || data.length < 72
    ? 0n
    : new DataView(data.buffer, data.byteOffset).getBigUint64(64, true);

// ---------------------------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------------------------

export interface SvmFillToken {
  readonly mint: string;
  readonly program: string;
  /** The solver's associated token account, which pays. */
  readonly from: string;
  readonly amount: bigint;
  readonly held: bigint;
}

export interface SvmFillPlan {
  /** What the fill needs sent first: the lookup table its accounts are taken through, created and
   *  extended by the solver. Empty when the fill fits one transaction as it is, or the table is
   *  given. */
  readonly setup: readonly SvmTxJson[];
  /** The lookup table the fill takes its accounts through, where it needs one. */
  readonly lookupTable?: { readonly address: string; readonly addresses: readonly string[] };
  readonly transaction: SvmTxJson;
  readonly tokens: readonly SvmFillToken[];
  readonly nativeAmount: bigint;
  /** Every writable account the route's calls touch: what the rehearsal reports. */
  readonly touched: readonly string[];
  readonly notes: readonly string[];
}

/**
 * The fill of `intent` on Solana by `solver`, for `claimant` (32 bytes: who the source pays): one
 * `fulfill`, the solver its fee payer. Each route mint's token program is read off the mint.
 *
 * A route carries every instruction the fill runs, a program's bytecode included, and a fill whose
 * accounts make it larger than one transaction takes them through an address lookup table: the
 * solver's own, created and extended by the `setup` transactions, usable from the slot after the
 * last of them. `lookupTable` names one that exists already (the one `setup` made), read from the
 * cluster and held to every account the fill takes.
 */
export async function planSvmFill(
  rpc: SvmRpc,
  chain: CanonicalChain,
  intent: Intent,
  options: {
    readonly solver: SvmAddress;
    readonly claimant: Hex;
    readonly lookupTable?: SvmAddress;
  },
): Promise<SvmFillPlan> {
  const portal = svmKeyOf(intent.route.portal);
  // Each token's mint (whose owner is its token program), then the solver's account for it: two
  // reads a token, every token at once.
  const tokens: SvmFillToken[] = await Promise.all(
    intent.route.tokens.map(async (entry) => {
      const mint = svmKeyOf(entry.token);
      const found = await account(rpc, mint, `the mint ${mint}`);
      if (found === null) throw new CliError(`the route's mint ${mint} does not exist on Solana`);
      const program = address(found.owner);
      const from = await associatedTokenAccount(options.solver, mint, program);
      const held = await account(rpc, from, `the solver's ${mint} account`);

      return { mint, program, from, amount: entry.amount, held: tokenAccountAmount(held?.data) };
    }),
  );
  const tokenPrograms: Record<string, SvmAddress> = Object.fromEntries(
    tokens.map((token) => [token.mint, address(token.program)]),
  );
  const fulfill = await buildPortalFulfillInstruction({
    intent,
    portal,
    solver: options.solver,
    claimant: options.claimant,
    tokenPrograms,
  });
  const notes: string[] = [];
  for (const token of tokens) {
    if (token.held < token.amount) {
      notes.push(
        `${options.solver} holds ${token.held} of ${token.mint} (base units) in ${token.from}, and the ` +
          `fill delivers ${token.amount}: the fulfill fails until it holds enough`,
      );
    }
  }
  const touched = [
    ...new Set(
      fulfill
        .accounts!.filter(
          (meta) => meta.role === AccountRole.WRITABLE || meta.role === AccountRole.WRITABLE_SIGNER,
        )
        .map((meta) => meta.address)
        .filter((key) => key !== options.solver),
    ),
  ];

  const instructions = fillInstructions(intent, fulfill);
  const what = `Portal.fulfill(${hashIntent(intent).intentHash}, route, rewardHash, ${options.claimant}) on ${chain.slug}`;
  const table = await fillTable(rpc, chain, options.solver, instructions, options.lookupTable);

  return {
    setup: table?.setup ?? [],
    ...(table === undefined
      ? {}
      : { lookupTable: { address: table.address, addresses: table.addresses } }),
    transaction: await svmTransaction(
      rpc,
      chain,
      options.solver,
      instructions,
      what,
      table === undefined ? undefined : { [table.address]: table.addresses },
    ),
    tokens,
    nativeAmount: intent.route.nativeAmount,
    touched,
    notes,
  };
}

/**
 * The lookup table a fill takes its accounts through: none when it fits one transaction as it is;
 * `given`, read from the cluster and held to the fill's accounts; else a new one the solver creates
 * at a recent slot, with the transactions that create and extend it.
 */
async function fillTable(
  rpc: SvmRpc,
  chain: CanonicalChain,
  solver: SvmAddress,
  instructions: readonly Instruction[],
  given: SvmAddress | undefined,
): Promise<
  | { readonly address: SvmAddress; readonly addresses: SvmAddress[]; readonly setup: SvmTxJson[] }
  | undefined
> {
  if (given === undefined && wireBytes(solver, instructions) <= SVM_PACKET_BYTES) return undefined;
  const addresses = tableAddresses(instructions);
  if (given !== undefined) {
    const held = await ask(`the lookup table ${given}`, () => fetchAlt(rpc, given));
    const holds = new Set<string>(held[given] ?? []);
    const missing = addresses.filter((key) => !holds.has(key));
    if (missing.length > 0) {
      throw new CliError(
        `the lookup table ${given} does not hold ${missing.length} of the fill's accounts ` +
          `(${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ", …" : ""})`,
      );
    }

    return { address: given, addresses: held[given] as SvmAddress[], setup: [] };
  }
  const recentSlot = await ask("a recent slot", () =>
    rpc.getSlot({ commitment: "finalized" }).send(),
  );
  const signer = createNoopSigner(solver);
  const { lookupTableAddress, batches } = await lookupTableBatches({
    payer: signer,
    authority: signer,
    recentSlot,
    addresses,
  });
  const setup = await Promise.all(
    batches.map((batch, index) =>
      svmTransaction(
        rpc,
        chain,
        solver,
        batch,
        index === 0
          ? `create the lookup table ${lookupTableAddress} the fill takes its accounts through`
          : `extend the lookup table ${lookupTableAddress} with the fill's accounts ` +
              `(${index} of ${batches.length - 1})`,
      ),
    ),
  );

  return { address: lookupTableAddress, addresses, setup };
}

/** A fill's instructions: its fulfill after the compute budget it needs. A route that cooks
 *  through the Kitchen runs the engine, whose memory is the transaction's heap frame: the fill
 *  requests it, as every cook does. */
function fillInstructions(intent: Intent, fulfill: Instruction): Instruction[] {
  const kitchen = v12SvmKitchenProgramId();

  return intent.route.calls.some((call) => svmKeyOf(call.target) === kitchen)
    ? [buildHeapFramePrepend(), getSetComputeUnitLimitInstruction({ units: 1_400_000 }), fulfill]
    : [getSetComputeUnitLimitInstruction({ units: 400_000 }), fulfill];
}

/**
 * The size of `intent`'s fill on the wire, as {@link planSvmFill} builds it for any solver, and
 * whether it takes its accounts through a lookup table to get there: whether a solver can send it
 * in one transaction ({@link SVM_PACKET_BYTES}). Reads nothing: the solver and the table are
 * placeholder keys, which change no size.
 */
export async function svmFillBytes(
  intent: Intent,
): Promise<{ readonly bytes: number; readonly table: boolean }> {
  const solver = (await generateKeyPairSigner()).address;
  const fulfill = await buildPortalFulfillInstruction({
    intent,
    portal: svmKeyOf(intent.route.portal),
    solver,
    claimant: `0x${"11".repeat(32)}`,
    tokenPrograms: Object.fromEntries(
      intent.route.tokens.map((token) => [svmKeyOf(token.token), TOKEN_PROGRAM_ID]),
    ),
  });
  const instructions = fillInstructions(intent, fulfill);
  const plain = wireBytes(solver, instructions);
  if (plain <= SVM_PACKET_BYTES) return { bytes: plain, table: false };
  // Through a lookup table: its address is any key, its addresses the fill's.
  const table = (await generateKeyPairSigner()).address;

  return {
    bytes: wireBytes(solver, instructions, { [table]: tableAddresses(instructions) }),
    table: true,
  };
}

// ---------------------------------------------------------------------------------------------
// The proof, and the cancellation
// ---------------------------------------------------------------------------------------------

export interface SvmHyperRoute {
  readonly hyperProver: SvmAddress;
  readonly sourceChainId: bigint;
  /** The source chain's HyperProver: the message's recipient. */
  readonly sourceProver: Hex;
}

/** The proof of `intentHashes` from Solana's Portal through the HyperProver, with the IGP's gas, in
 *  one transaction from `payer`: the message and gas-payment keys are fresh, and sign it. */
export async function svmProveTransaction(
  rpc: SvmRpc,
  chain: CanonicalChain,
  portal: SvmAddress,
  intentHashes: readonly Hex[],
  route: SvmHyperRoute,
  payer: SvmAddress,
  what: string,
): Promise<SvmTxJson> {
  const instructions = await buildPortalHyperProveInstructions({
    portal,
    hyperProver: route.hyperProver,
    intentHashes,
    sourceChainId: route.sourceChainId,
    sourceProver: route.sourceProver,
    payer,
    uniqueMessage: await generateKeyPairSigner(),
    uniqueGasPayment: await generateKeyPairSigner(),
  });

  return svmTransaction(
    rpc,
    chain,
    payer,
    [getSetComputeUnitLimitInstruction({ units: 600_000 }), ...instructions],
    what,
  );
}

/** The cancellation of `intent` on Solana from `payer`; with `prove`, its proof in the same
 *  transaction (atomic, as EVM's `cancelAndProve` is). */
export async function svmCancelTransaction(
  rpc: SvmRpc,
  chain: CanonicalChain,
  intent: Intent,
  payer: SvmAddress,
  prove: SvmHyperRoute | undefined,
  what: string,
): Promise<SvmTxJson> {
  const portal = svmKeyOf(intent.route.portal);
  const cancel = await buildPortalCancelInstruction({ intent, portal, payer });
  const proof =
    prove === undefined
      ? []
      : await buildPortalHyperProveInstructions({
          portal,
          hyperProver: prove.hyperProver,
          intentHashes: [hashIntent(intent).intentHash],
          sourceChainId: prove.sourceChainId,
          sourceProver: prove.sourceProver,
          payer,
          uniqueMessage: await generateKeyPairSigner(),
          uniqueGasPayment: await generateKeyPairSigner(),
        });

  return svmTransaction(
    rpc,
    chain,
    payer,
    [
      getSetComputeUnitLimitInstruction({ units: prove === undefined ? 200_000 : 700_000 }),
      cancel,
      ...proof,
    ],
    what,
  );
}

/**
 * What the fee payer spends beyond the fee, as `rehearsal` (of `tx`) leaves its account: the
 * accounts' rents, the IGP's gas. A simulation charges the fee too, so the cluster's fee for the
 * message (`getFeeForMessage`) is taken off.
 */
export async function svmSpend(
  rpc: SvmRpc,
  payer: SvmAddress,
  tx: SvmTxJson,
  rehearsal: SvmRehearsal,
): Promise<bigint> {
  const after = rehearsal.after.get(payer)?.lamports;
  if (after === undefined) return 0n;
  const message = getBase64Decoder().decode(
    getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(tx.transaction)))
      .messageBytes,
  );
  const [before, fee] = await Promise.all([
    ask("the fee payer's balance", () => rpc.getBalance(payer).send()),
    ask("the transaction's fee", () =>
      rpc.getFeeForMessage(message as TransactionMessageBytesBase64).send(),
    ),
  ]);
  const spent = BigInt(before.value) - after - BigInt(fee.value ?? 0n);

  return spent > 0n ? spent : 0n;
}
