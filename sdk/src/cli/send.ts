/**
 * `sauce send`: transactions signed somewhere else — a KMS, a hardware wallet, another wallet's
 * MCP server — broadcast, confirmed and reported the way `sauce run` reports its own. It takes the
 * SIGNED bytes and never a key: an EVM chain's raw `0x…` transaction (its chain and sender read
 * from it), Solana's base64 wire transaction (every signature checked against its message).
 *
 * Each one is rehearsed as it was signed before it is sent — on an EVM chain an `eth_call` from its
 * sender, and its gas limit held to what the rehearsal used; on Solana a simulation that checks
 * the signatures — and one that would fail is refused with its reason, so nothing is spent on it.
 * They go out in the order given, each confirmed before the next is rehearsed (a cook after the
 * Pot's deployment runs on the Pot it deployed), stopping at the first that does not succeed.
 * What landed is reported from the chain: the status, the fee, the reason a failure gives, and for
 * a cook what moved and what it left in the Pot, and what `main` returned on Solana.
 */
import {
  createSolanaRpc,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isSolanaError,
  SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH,
  verifySignature,
  type Address as SvmAddress,
  type AddressesByLookupTableAddress,
  type Transaction,
} from "@solana/kit";
import {
  bytesToHex,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionSerializedGeneric,
} from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { v12SvmEngineProgramId, v12SvmKitchenProgramId } from "../deployments/index.js";
import { deriveExecutionFeeConfigPda, fetchAlt, KITCHEN_COOKS } from "../svm/index.js";
import { CliError, UsageError } from "./args.js";
import { connect, landed, reasonOf, simulate, type Sent } from "./chain.js";
import type { CommandOutput } from "./commands.js";
import { linkLines, txLinks } from "./links.js";
import { guardOf, type Reservation } from "./policy.js";
import { cookReport, costJson, costLine, costOf } from "./receipt.js";
import { failureReason, sendAndConfirm, svmLanded, svmReader, type SvmSent } from "./solana.js";
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
  type SvmMoved,
} from "./svm-effects.js";

export interface SendInput {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  /** Signed transactions, in the order they are sent: raw `0x…` hex on an EVM chain, base64 on
   *  Solana. */
  readonly transactions: readonly string[];
}

const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** What `sauce send` takes, for the messages that name it. */
const SIGNED_SHAPES =
  "a signed transaction: an EVM chain's raw 0x… hex, or Solana's base64 wire transaction";

/**
 * The chain signed `transactions` are for: an EVM transaction's own chain id, Solana for a base64
 * one — all the same, and `given`'s where it is given.
 */
export function signedChain(
  transactions: readonly string[],
  given?: CanonicalChain,
): CanonicalChain {
  if (transactions.length === 0) throw new UsageError("missing the signed transactions to send");
  const chains = transactions.map((raw, index) => {
    const where = `transaction ${index + 1}`;
    if (HEX.test(raw)) {
      let chainId: number | undefined;
      try {
        chainId = parseTransaction(raw as TransactionSerializedGeneric).chainId;
      } catch {
        throw new UsageError(`${where} is 0x hex, but not a serialized EVM transaction`);
      }
      if (chainId === undefined) {
        if (given === undefined) {
          throw new UsageError(
            `${where} names no chain (a legacy transaction signed without EIP-155): give the chain`,
          );
        }

        return given;
      }

      return requireChain(chainId);
    }
    if (BASE64.test(raw)) return requireChain("solana");
    throw new UsageError(`${where} is not ${SIGNED_SHAPES}`);
  });
  const chain = given ?? chains[0]!;
  const other = chains.find((one) => one.id !== chain.id);
  if (other !== undefined) {
    throw new UsageError(
      `the transactions are for ${other.slug}, not ${chain.slug}: send each chain's in a call of its own`,
    );
  }

  return chain;
}

/** One transaction as it went, in order. */
interface SentEntry {
  readonly what: string;
  /** Its hash (a Solana signature); empty when it was not sent. */
  readonly hash: string;
  readonly status: "success" | "reverted" | "failed";
  readonly reason?: string;
  readonly lines: readonly string[];
  readonly json: Record<string, unknown>;
}

/** `sauce send`: each signed transaction rehearsed, broadcast and confirmed, in order. */
export async function sendCommand(input: SendInput): Promise<CommandOutput> {
  const { chain } = input;
  requireSupported("sending", [chain]);
  if (chain.kind === "svm" && input.transactions.some((raw) => HEX.test(raw))) {
    throw new UsageError("an EVM transaction (0x hex) cannot be sent on Solana");
  }
  if (chain.kind === "evm" && input.transactions.some((raw) => !HEX.test(raw))) {
    throw new UsageError(`a transaction on ${chain.slug} is a raw 0x… one: ${SIGNED_SHAPES}`);
  }
  const sent = chain.kind === "svm" ? await sendSvm(input) : await sendEvm(input);
  const failed = sent.find((entry) => entry.status !== "success");
  const ok = failed === undefined && sent.length === input.transactions.length;
  const landedCount = sent.filter((entry) => entry.hash !== "").length;

  return {
    text: sent.flatMap((entry) => entry.lines).join("\n"),
    json: {
      chain: chain.slug,
      chainId: chain.id,
      ok,
      sent: sent.map((entry) => ({
        what: entry.what,
        hash: entry.hash,
        ...(entry.hash === "" ? {} : txLinks(chain, entry.hash)),
        status: entry.status,
        ...entry.json,
        ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      })),
    },
    ...(failed === undefined
      ? {}
      : {
          notes: [
            `${failed.what} did not succeed${failed.reason === undefined ? "" : `: ${failed.reason}`}; ` +
              `nothing after it was sent (${landedCount} of ${input.transactions.length} sent)`,
          ],
        }),
    ...(ok ? {} : { exitCode: 1 }),
  };
}

// ---------------------------------------------------------------------------------------------
// An EVM chain
// ---------------------------------------------------------------------------------------------

/** `cook(address,bytes)` and `deployPot(address,bytes32)`, which a send names. */
const COOK = toFunctionSelector("function cook(address engine, bytes program)");
const DEPLOY_POT = toFunctionSelector("function deployPot(address owner, bytes32 salt)");

interface SignedEvm {
  readonly raw: TransactionSerializedGeneric;
  readonly hash: Hex;
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
  readonly value: bigint;
  readonly gas?: bigint;
}

async function signedEvm(raw: string, where: string): Promise<SignedEvm> {
  const serialized = raw as TransactionSerializedGeneric;
  const parsed = parseTransaction(serialized);
  if (parsed.r === undefined || parsed.s === undefined) {
    throw new UsageError(
      `${where} is not signed: sign it with your wallet or signer first (no key ever comes here)`,
    );
  }
  if (parsed.type === "eip4844") {
    throw new UsageError(`${where} carries blobs, which sauce send does not broadcast`);
  }
  if (parsed.to === undefined || parsed.to === null) {
    throw new UsageError(`${where} creates a contract; sauce send broadcasts calls`);
  }
  let from: Address;
  try {
    from = await recoverTransactionAddress({ serializedTransaction: serialized as never });
  } catch {
    throw new UsageError(`${where}: its signature does not recover a sender`);
  }

  return {
    raw: serialized,
    hash: keccak256(serialized),
    from,
    to: getAddress(parsed.to),
    data: parsed.data ?? "0x",
    value: parsed.value ?? 0n,
    ...(parsed.gas === undefined ? {} : { gas: parsed.gas }),
  };
}

/** What a transaction is, for the lines that report it. */
const evmWhat = (tx: SignedEvm, index: number): string => {
  const selector = tx.data.slice(0, 10).toLowerCase();
  if (selector === COOK) return `cook on Pot ${tx.to}`;
  if (selector === DEPLOY_POT) return `Kitchen.deployPot at ${tx.to}`;

  return `transaction ${index + 1} to ${tx.to}`;
};

/** Broadcasts `tx`; one the node already has (sent before, perhaps by the signer) is waited for. */
async function broadcastEvm(client: PublicClient, tx: SignedEvm): Promise<void> {
  try {
    await client.sendRawTransaction({ serializedTransaction: tx.raw });
  } catch (error) {
    const reason = reasonOf(error);
    const known = await client.getTransaction({ hash: tx.hash }).then(
      () => true,
      () => false,
    );
    if (known) return;
    throw new CliError(`sending failed: ${reason}`);
  }
}

async function sendEvm(input: SendInput): Promise<SentEntry[]> {
  const signed = await Promise.all(
    input.transactions.map((raw, index) => signedEvm(raw, `transaction ${index + 1}`)),
  );
  const client = await connect(input.rpcUrl, input.chain);
  const sent: SentEntry[] = [];
  for (const [index, tx] of signed.entries()) {
    const what = evmWhat(tx, index);
    const refused = (reason: string): SentEntry => {
      if (sent.length === 0) throw new CliError(`${what}: not sent — ${reason}`);

      return {
        what,
        hash: "",
        status: "failed",
        reason: `not sent — ${reason}`,
        lines: [],
        json: {},
      };
    };
    const request = { to: tx.to, data: tx.data, value: tx.value };
    // One the chain has already (sent before, by this or by the signer) is read back, not resent.
    const known = await client.getTransaction({ hash: tx.hash }).then(
      () => true,
      () => false,
    );
    let reservation: Reservation | undefined;
    if (!known) {
      // Rehearsed as it was signed, on what the transactions before it left.
      const rehearsal = await simulate(client, tx.from, request);
      if (!rehearsal.ok) {
        sent.push(refused(`it would revert: ${rehearsal.reason}`));
        break;
      }
      if (tx.gas !== undefined && tx.gas < rehearsal.gas) {
        sent.push(
          refused(
            `it is signed with a gas limit of ${tx.gas}, and the simulation used ${rehearsal.gas}: ` +
              "it would run out of gas. Sign it again with a higher limit",
          ),
        );
        break;
      }
      reservation = await guardOf(tx.from)?.evm(client, request);
      try {
        await broadcastEvm(client, tx);
      } catch (error) {
        reservation?.released("sending failed");
        if (sent.length === 0) throw error;
        sent.push({
          what,
          hash: "",
          status: "failed",
          reason: (error as Error).message,
          lines: [],
          json: {},
        });
        break;
      }
    }
    const result = await landed(client, tx.hash, tx.from, request, (status) =>
      status === "success" ? reservation?.sent(tx.hash) : reservation?.released("reverted"),
    );
    sent.push(await evmEntry(client, input.chain, tx, what, result));
    if (result.status !== "success") break;
  }

  return sent;
}

/** A landed EVM transaction's report: its line and links, its cost, and a cook's moves. */
async function evmEntry(
  client: PublicClient,
  chain: CanonicalChain,
  tx: SignedEvm,
  what: string,
  result: Sent,
): Promise<SentEntry> {
  const cost = result.receipt === undefined ? undefined : costOf(result.receipt, tx.value);
  const cook =
    result.status === "success" &&
    result.receipt !== undefined &&
    tx.data.toLowerCase().startsWith(COOK)
      ? // What was sent stands whatever reading its receipt back does.
        await cookReport(client, chain, result.receipt, {
          sender: tx.from,
          pot: tx.to,
          wallet: "the signer's wallet",
        }).catch(() => undefined)
      : undefined;

  return {
    what,
    hash: result.hash,
    status: result.status,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    lines: [
      `${what} ${result.hash}: ${result.status}, gas used ${result.gasUsed}, block ${result.blockNumber}` +
        (result.reason === undefined ? "" : `, reverted: ${result.reason}`),
      ...linkLines(txLinks(chain, result.hash)),
      ...(cost === undefined ? [] : [costLine(cost, chain, "the value it carried")]),
      ...(cook?.left ?? []),
      ...(cook?.lines ?? []),
    ],
    json: {
      from: tx.from,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      ...(cost === undefined ? {} : { cost: costJson(cost) }),
      ...(cook === undefined
        ? {}
        : {
            leftInPot: cook.leftInPot,
            moves: cook.effects.moves,
            summary: [...cook.left, ...cook.lines],
          }),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Solana
// ---------------------------------------------------------------------------------------------

interface SignedSvm {
  readonly transaction: Transaction;
  readonly wire: string;
  readonly feePayer: SvmAddress;
}

async function signedSvm(raw: string, where: string): Promise<SignedSvm> {
  let transaction: Transaction;
  try {
    transaction = getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(raw)));
  } catch (error) {
    // Signatures that do not match the message's signers, by count, named as such.
    if (isSolanaError(error, SOLANA_ERROR__TRANSACTION__MESSAGE_SIGNATURES_MISMATCH)) {
      const { numRequiredSignatures, signaturesLength, signerAddresses } = error.context;
      const plural = (count: number, what: string) => `${count} ${what}${count === 1 ? "" : "s"}`;
      throw new UsageError(
        `${where} carries ${signaturesLength === 0 ? "no signature" : plural(signaturesLength, "signature")}, ` +
          `and its message has ${plural(numRequiredSignatures, "signer")} ` +
          `(${signerAddresses.join(", ")}): sign it with each, with your wallet or signer (no ` +
          "key ever comes here)",
      );
    }
    throw new UsageError(`${where} is base64, but not a Solana transaction`);
  }
  const signers = Object.entries(transaction.signatures);
  if (signers.length === 0) {
    throw new UsageError(
      `${where} has no signer, so no fee payer: a Solana transaction is signed by at least its ` +
        "fee payer",
    );
  }
  for (const [index, [signer, signature]] of signers.entries()) {
    if (signature === null || signature.every((byte) => byte === 0)) {
      throw new UsageError(
        `${where} is not signed by ${index === 0 ? "its fee payer " : ""}${signer}: sign it with ` +
          "your wallet or signer first (no key ever comes here)",
      );
    }
    const key = await getPublicKeyFromAddress(signer as SvmAddress);
    if (!(await verifySignature(key, signature, transaction.messageBytes))) {
      throw new UsageError(
        `${where}: ${signer}'s signature does not verify; the transaction was changed after it was signed`,
      );
    }
  }

  return {
    transaction,
    wire: getBase64EncodedWireTransaction(transaction),
    feePayer: signers[0]![0] as SvmAddress,
  };
}

/** The lookup tables `transaction`'s message loads accounts through, each read from the cluster. */
async function tablesOf(
  read: ReturnType<typeof svmReader>,
  rpc: ReturnType<typeof createSolanaRpc>,
  transaction: Transaction,
): Promise<AddressesByLookupTableAddress> {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    addressTableLookups?: readonly { lookupTableAddress: SvmAddress }[];
  };
  const tables: AddressesByLookupTableAddress = {};
  for (const { lookupTableAddress } of message.addressTableLookups ?? []) {
    Object.assign(
      tables,
      await read(`lookup table ${lookupTableAddress}`, () => fetchAlt(rpc, lookupTableAddress)),
    );
  }

  return tables;
}

/** The Pot a Kitchen cook in `transaction` runs on, if it has one. */
function cookedPot(
  transaction: Transaction,
  tables: AddressesByLookupTableAddress,
): SvmAddress | undefined {
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as {
    instructions: readonly {
      programAddressIndex: number;
      accountIndices?: readonly number[];
      data?: Uint8Array;
    }[];
  };
  const accounts = messageAccounts(transaction, tables);
  for (const instruction of message.instructions) {
    if (accounts[instruction.programAddressIndex] !== v12SvmKitchenProgramId()) continue;
    const data = instruction.data ?? new Uint8Array();
    const cook = KITCHEN_COOKS.find(({ discriminator }) =>
      discriminator.every((byte, index) => data[index] === byte),
    );
    const at = cook === undefined ? undefined : instruction.accountIndices?.[cook.potIndex];
    if (at !== undefined) return accounts[at];
  }

  return undefined;
}

/** Whether `transaction` calls the engine, directly or through the Kitchen. */
const runsEngine = (transaction: Transaction, tables: AddressesByLookupTableAddress): boolean =>
  messageAccounts(transaction, tables).includes(v12SvmEngineProgramId() as SvmAddress);

async function sendSvm(input: SendInput): Promise<SentEntry[]> {
  const signed = await Promise.all(
    input.transactions.map((raw, index) => signedSvm(raw, `transaction ${index + 1}`)),
  );
  const rpc = createSolanaRpc(input.rpcUrl);
  const read = svmReader(input.rpcUrl);
  const { address: feeConfig } = await deriveExecutionFeeConfigPda(
    v12SvmKitchenProgramId() as SvmAddress,
  );
  const sent: SentEntry[] = [];
  for (const [index, tx] of signed.entries()) {
    const tables = await tablesOf(read, rpc, tx.transaction);
    const pot = cookedPot(tx.transaction, tables);
    const what = pot === undefined ? `transaction ${index + 1}` : `cook on Pot ${pot}`;
    const signature = getSignatureFromTransaction(tx.transaction);
    // One the cluster has already (sent before, by this or by the signer) is read back, not resent:
    // looked for in the cluster's history, not only its recent status cache.
    const {
      value: [status],
    } = await read("the transaction's status", () =>
      rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send(),
    );
    if (status !== null && status !== undefined) {
      const result = await svmLanded(rpc, input.rpcUrl, signature);
      sent.push(svmEntry(input.chain, tx, what, result, pot, tables, undefined));
      if (!result.ok) break;
      continue;
    }
    // Rehearsed as it was signed: an expired blockhash, a short balance, a revert, refused here.
    const { value } = await read(`a simulation of ${what}`, () =>
      rpc.simulateTransaction(tx.wire as never, { encoding: "base64", sigVerify: true }).send(),
    );
    if (value.err !== null) {
      const said = failureReason(value.err, value.logs ?? []);
      const reason = /BlockhashNotFound/.test(said)
        ? "its blockhash has expired (a Solana transaction lands within about a minute of being " +
          "built, or never): build it again and sign the new one"
        : `it would fail: ${said}`;
      if (sent.length === 0) {
        throw new CliError(
          `${what}: not sent — ${reason}` +
            ((value.logs ?? []).length === 0 ? "" : `\n${(value.logs ?? []).join("\n")}`),
        );
      }
      sent.push({
        what,
        hash: "",
        status: "failed",
        reason: `not sent — ${reason}`,
        lines: [],
        json: {},
      });
      break;
    }
    // What it moves: every account it may write, read before it is sent and once it lands.
    const tracked = writableAccounts(tx.transaction, tables);
    const before = await accountsNow(rpc, tracked).catch(() => undefined);
    const result = await sendAndConfirm(rpc, input.rpcUrl, tx.transaction);
    const after =
      result.ok && before !== undefined
        ? await accountsNow(rpc, tracked).catch(() => undefined)
        : undefined;
    const labels = new Map<string, string>([
      [tx.feePayer, "the signer, which paid the fee"],
      [feeConfig, "the Kitchen's fee config"],
      ...(pot === undefined ? [] : [[pot, "the Pot"] as const]),
    ]);
    const moved =
      before === undefined || after === undefined
        ? undefined
        : await movedBy(rpc, input.chain, tracked, before, after, labels, tx.feePayer).catch(
            () => undefined,
          );
    sent.push(svmEntry(input.chain, tx, what, result, pot, tables, moved));
    if (!result.ok) break;
  }

  return sent;
}

/** A landed Solana transaction's report: its line and links, what `main` returned, what moved. */
function svmEntry(
  chain: CanonicalChain,
  tx: SignedSvm,
  what: string,
  result: SvmSent,
  pot: SvmAddress | undefined,
  tables: AddressesByLookupTableAddress,
  moved: SvmMoved | undefined,
): SentEntry {
  const left = moved === undefined || pot === undefined ? undefined : svmLeftInPot(moved, pot);
  const returns =
    result.ok && runsEngine(tx.transaction, tables)
      ? bytesToHex(result.returnData ?? new Uint8Array())
      : undefined;

  return {
    what,
    hash: result.signature,
    status: result.ok ? "success" : "failed",
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    lines: [
      `${what} ${result.signature}: ${result.ok ? "success" : "failed"}` +
        (result.computeUnits === undefined ? "" : `, ${result.computeUnits} compute units`) +
        (result.reason === undefined ? "" : `, ${result.reason}`),
      ...linkLines(txLinks(chain, result.signature)),
      ...(returns === undefined || returns === "0x" ? [] : [`returns ${returns}`]),
      ...(left === undefined ? [] : svmLeftInPotLines(left, "the signer's wallet")),
      ...(moved === undefined ? [] : svmMovedLines(moved)),
      ...(result.ok ? [] : ["Program logs:", ...result.logs.map((line) => `  ${line}`)]),
    ],
    json: {
      feePayer: tx.feePayer,
      ...(result.slot === undefined ? {} : { slot: result.slot.toString() }),
      ...(result.fee === undefined ? {} : { fee: result.fee.toString() }),
      ...(result.computeUnits === undefined
        ? {}
        : { computeUnits: result.computeUnits.toString() }),
      ...(returns === undefined ? {} : { returns }),
      ...(left === undefined ? {} : { leftInPot: svmLeftInPotJson(left) }),
      ...(moved === undefined ? {} : svmMovedJson(moved)),
      ...(result.ok ? {} : { logs: result.logs }),
    },
  };
}
