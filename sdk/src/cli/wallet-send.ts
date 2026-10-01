/**
 * Sending, from a wallet, transactions another step built unsigned: what `sauce_wallet_send` (the
 * local MCP server's) does with the result of `sauce_tx`, `sauce_pot`, `sauce_actions`,
 * `sauce_intent_publish` or any `sauce_intent_*` tool — taken as they come back, whole.
 *
 * Nothing is sent before the whole plan is rehearsed and held to the wallet's policy. On an EVM
 * chain the transactions are rehearsed together in one `eth_simulateV1` block from the wallet (one
 * alone may fall back to `eth_call`), the plan refused if any would revert, and the policy checked
 * over all of them; then each is sent through `chain.ts#sendAndWait` — the path `sauce run` and
 * `sauce intent fill --send` send through, which simulates it again, reserves what it spends in the
 * wallet's ledger, signs, sends and waits — stopping at the first that does not succeed. On Solana
 * each is signed by the wallet as its fee payer and sent through `solana.ts#sendPlannedSvm`, which
 * rehearses it as signed and refuses it if it would fail, as `sauce intent fill --send` does.
 */
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { getAddress, isAddress, type Address, type Hex } from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { CliError, UsageError } from "./args.js";
import { connect, revertReason, sendAndWait, simulate, type TxRequest } from "./chain.js";
import { measureEvm, noPolicyNote, rehearsePlan, type SendGuard } from "./policy.js";
import { sendPlannedSvm } from "./solana.js";
import { HOT_WALLET } from "./wallet-commands.js";
import type { Unlocked } from "./wallets.js";

/** One transaction of a plan, as another step built it. */
export type PlannedTx =
  | {
      readonly kind: "evm";
      readonly chainId?: number;
      readonly to: Address;
      readonly data: Hex;
      readonly value: bigint;
      readonly what: string;
    }
  | {
      readonly kind: "svm";
      readonly chainId?: number;
      readonly transaction: string;
      readonly feePayer?: string;
      readonly what: string;
    };

const SHAPES =
  "a transaction ({ to, data, value }, or a Solana { transaction } in base64), a list of them, or " +
  "a tool's whole result that carries them (transactions, intents[].transactions, transaction)";

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

function valueOf(raw: unknown, where: string): bigint {
  if (raw === undefined || raw === null) return 0n;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === "string" && /^(?:\d+|0x[0-9a-fA-F]+)$/.test(raw)) return BigInt(raw);
  throw new UsageError(`${where}.value is not an amount in base units (a decimal string)`);
}

function chainIdOf(raw: unknown, inherited: number | undefined): number | undefined {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);

  return inherited;
}

/** One transaction object, or the plan around it. */
function collect(
  value: unknown,
  where: string,
  inherited: number | undefined,
  out: PlannedTx[],
): void {
  if (Array.isArray(value)) {
    value.forEach((each, index) => collect(each, `${where}[${index}]`, inherited, out));

    return;
  }
  if (value === null || typeof value !== "object") {
    throw new UsageError(`${where} is not ${SHAPES}`);
  }
  const fields = value as Record<string, unknown>;
  if (fields.ready === false) {
    throw new UsageError(
      `${where} is not ready to send${typeof fields.why === "string" ? `: ${fields.why}` : ""}`,
    );
  }
  const chainId = chainIdOf(fields.chainId, inherited);
  const what = typeof fields.what === "string" ? fields.what : `transaction ${out.length + 1}`;
  if (typeof fields.transaction === "string") {
    out.push({
      kind: "svm",
      ...(chainId === undefined ? {} : { chainId }),
      transaction: fields.transaction,
      ...(typeof fields.feePayer === "string" ? { feePayer: fields.feePayer } : {}),
      what,
    });

    return;
  }
  if (typeof fields.to === "string" && typeof fields.data === "string") {
    if (!isAddress(fields.to, { strict: false }))
      throw new UsageError(`${where}.to is not an address`);
    if (!HEX.test(fields.data)) throw new UsageError(`${where}.data is not 0x hex`);
    out.push({
      kind: "evm",
      ...(chainId === undefined ? {} : { chainId }),
      to: getAddress(fields.to),
      data: fields.data as Hex,
      value: valueOf(fields.value, where),
      what,
    });

    return;
  }
  if (Array.isArray(fields.transactions)) {
    collect(fields.transactions, `${where}.transactions`, chainId, out);

    return;
  }
  if (Array.isArray(fields.intents)) {
    const before = out.length;
    fields.intents.forEach((intent, index) => {
      const each = intent as Record<string, unknown> | null;
      if (each !== null && typeof each === "object" && "transactions" in each) {
        collect(each, `${where}.intents[${index}]`, chainId, out);
      }
    });
    if (out.length > before) return;
  }
  if (fields.transaction !== null && typeof fields.transaction === "object") {
    collect(fields.transaction, `${where}.transaction`, chainId, out);

    return;
  }
  throw new UsageError(`${where} is not ${SHAPES}`);
}

/** The transactions `value` carries, in the order they are sent: {@link SHAPES}. */
export function plannedTransactions(value: unknown, where = "transaction"): PlannedTx[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new UsageError(`${where} is not JSON`);
    }
  }
  const out: PlannedTx[] = [];
  collect(parsed, where, undefined, out);
  if (out.length === 0) throw new UsageError(`${where} carries no transaction to send`);

  return out;
}

/** The one chain a plan is sent on: each transaction's, `given`'s, and all the same. */
export function planChain(
  transactions: readonly PlannedTx[],
  given?: CanonicalChain,
): CanonicalChain {
  const ids = new Set<number>();
  for (const tx of transactions) {
    if (tx.chainId !== undefined) ids.add(tx.chainId);
    else if (tx.kind === "svm") ids.add(requireChain("solana").id);
  }
  if (given !== undefined) {
    const other = [...ids].find((id) => id !== given.id);
    if (other !== undefined) {
      throw new UsageError(
        `the transactions are for chain ${other}, not ${given.slug} (${given.id}): send each ` +
          "chain's in a call of its own",
      );
    }

    return given;
  }
  if (ids.size > 1) {
    throw new UsageError(
      `the transactions are for chains ${[...ids].join(" and ")}: send each chain's in a call of its own`,
    );
  }
  const [id] = ids;
  if (id === undefined) throw new UsageError("the transactions name no chain: give chain");

  return requireChain(id);
}

/** What was sent, one entry per transaction, in order. */
interface SentEntry {
  readonly what: string;
  readonly hash: string;
  readonly status: "success" | "reverted" | "failed";
  readonly blockNumber?: string;
  readonly gasUsed?: string;
  readonly fee?: string;
  readonly reason?: string;
}

export interface PlanInput {
  readonly wallet: Unlocked;
  readonly guard: SendGuard;
  readonly chain: CanonicalChain;
  readonly transactions: readonly PlannedTx[];
  readonly rpcUrl: string;
}

/** Sends a plan from a wallet: rehearsed and held to its policy first, then each in order. */
export async function sendPlan(
  input: PlanInput,
): Promise<{ readonly json: Record<string, unknown>; readonly notes: string[] }> {
  const { wallet, guard, chain, transactions } = input;
  const kinds = new Set(transactions.map((tx) => tx.kind));
  if (kinds.size > 1) throw new UsageError("the plan mixes EVM and Solana transactions");
  const svm = kinds.has("svm");
  if (svm !== (chain.kind === "svm")) {
    throw new UsageError(
      `the transactions are ${svm ? "Solana" : "EVM"} ones, and ${chain.slug} is not ` +
        `${svm ? "Solana" : "an EVM chain"}`,
    );
  }
  if (svm !== (wallet.kind === "solana")) {
    throw new UsageError(
      `wallet ${wallet.info.name} is ${wallet.kind === "evm" ? "an EVM" : "a Solana"} wallet, and ` +
        `these are ${svm ? "Solana" : "EVM"} transactions`,
    );
  }
  const sent = svm ? await sendSvm(input) : await sendEvm(input);
  const failed = sent.find((entry) => entry.status !== "success");
  const landed = sent.filter((entry) => entry.hash !== "").length;
  const notes = [
    ...(guard.policy === undefined ? [noPolicyNote(wallet.info)] : []),
    ...(failed === undefined
      ? []
      : [
          `${failed.what} did not succeed${failed.reason === undefined ? "" : `: ${failed.reason}`}; ` +
            `nothing after it was sent (${landed} of ${transactions.length} sent)`,
        ]),
    HOT_WALLET,
  ];

  return {
    json: {
      wallet: wallet.info.name,
      from: wallet.info.address,
      chain: chain.slug,
      chainId: chain.id,
      ok: failed === undefined && sent.length === transactions.length,
      sent,
      policy: guard.policy?.path ?? null,
    },
    notes,
  };
}

async function sendEvm(input: PlanInput): Promise<SentEntry[]> {
  if (input.wallet.kind !== "evm") throw new Error("internal: an EVM plan from a Solana wallet");
  const account = input.wallet.account;
  const client = await connect(input.rpcUrl, input.chain);
  const requests: TxRequest[] = input.transactions.map((tx) => {
    if (tx.kind !== "evm") throw new Error("internal: a Solana transaction in an EVM plan");

    return { to: tx.to, data: tx.data, value: tx.value };
  });
  input.guard.gate(input.chain);
  // Rehearsed together first: a plan's later transactions run on what its earlier ones leave.
  const rehearsed = await rehearsePlan(client, account.address, requests);
  if (rehearsed === undefined && requests.length > 1) {
    throw new CliError(
      `rehearsing ${requests.length} transactions together needs eth_simulateV1, and the ` +
        `${input.chain.slug} endpoint did not run it: nothing was sent. Use an endpoint that ` +
        "serves it, or send them one call each",
    );
  }
  if (rehearsed === undefined) {
    const alone = await simulate(client, account.address, requests[0]!);
    if (!alone.ok) throw new CliError(`not sent — it would revert: ${alone.reason}`);
  } else {
    const failing = rehearsed.findIndex((call) => call.status !== "success");
    if (failing >= 0) {
      const tx = input.transactions[failing]!;
      const data = rehearsed[failing]!.data;
      throw new CliError(
        `not sent — ${tx.what} (${failing + 1} of ${requests.length}) would revert: ` +
          (data === "0x" ? "it reverted with no data" : revertReason({ data })),
      );
    }
  }
  if (input.guard.policy !== undefined) {
    await input.guard.preflight(
      await measureEvm(client, input.chain, account.address, requests, rehearsed),
    );
  }

  const sent: SentEntry[] = [];
  for (const [index, request] of requests.entries()) {
    const what = input.transactions[index]!.what;
    let result;
    try {
      result = await sendAndWait(client, input.rpcUrl, account, request);
    } catch (error) {
      // Once one is sent, a refusal of the next is part of the result, not the whole of it.
      if (sent.length === 0) throw error;
      sent.push({ what, hash: "", status: "failed", reason: (error as Error).message });
      break;
    }
    sent.push({
      what,
      hash: result.hash,
      status: result.status,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
    if (result.status !== "success") break;
  }

  return sent;
}

/** The fee payer a Solana wire transaction names: its first account. */
function feePayerOf(transaction: string): string | undefined {
  try {
    const decoded = getTransactionDecoder().decode(
      new Uint8Array(getBase64Encoder().encode(transaction)),
    );

    return getCompiledTransactionMessageDecoder().decode(decoded.messageBytes).staticAccounts[0];
  } catch {
    throw new UsageError("transaction is not a base64 Solana transaction");
  }
}

async function sendSvm(input: PlanInput): Promise<SentEntry[]> {
  if (input.wallet.kind !== "solana") throw new Error("internal: a Solana plan from an EVM wallet");
  const signer = input.wallet.signer;
  input.guard.gate(input.chain);
  const sent: SentEntry[] = [];
  for (const tx of input.transactions) {
    if (tx.kind !== "svm") throw new Error("internal: an EVM transaction in a Solana plan");
    const feePayer = tx.feePayer ?? feePayerOf(tx.transaction);
    if (feePayer !== signer.address) {
      throw new UsageError(
        `${tx.what} is paid by ${feePayer ?? "no one"}, and wallet ${input.wallet.info.name} is ` +
          `${signer.address}: build it with the wallet's address as its owner or fee payer`,
      );
    }
    let result;
    try {
      result = await sendPlannedSvm(input.rpcUrl, signer, {
        feePayer,
        transaction: tx.transaction,
        what: tx.what,
      });
    } catch (error) {
      if (sent.length === 0) throw error;
      sent.push({ what: tx.what, hash: "", status: "failed", reason: (error as Error).message });
      break;
    }
    sent.push({
      what: tx.what,
      hash: result.signature,
      status: result.ok ? "success" : "failed",
      ...(result.slot === undefined ? {} : { blockNumber: result.slot.toString() }),
      ...(result.fee === undefined ? {} : { fee: result.fee.toString() }),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
    if (!result.ok) break;
  }

  return sent;
}
