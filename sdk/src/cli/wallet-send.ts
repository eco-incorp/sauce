/**
 * Sending, from a wallet, transactions another step built unsigned: what `sauce_wallet_send` (the
 * local MCP server's) does with the result of `sauce_tx`, `sauce_pot`, `sauce_actions` or
 * `sauce_signed_cook`/`sauce_sign` (its `deployPot` and signed `cook`, or a cancellation's
 * transactions) — taken as it comes back, whole.
 *
 * Nothing is sent before the whole plan is rehearsed and held to the wallet's policy. On an EVM
 * chain the transactions are rehearsed together in one `eth_simulateV1` block from the wallet (one
 * alone may fall back to `eth_call`), the plan refused if any would revert, and the policy checked
 * over all of them; then each is sent through `chain.ts#sendAndWait` — the path `sauce run` sends
 * through, which simulates it again, reserves what it spends in the wallet's ledger, signs, sends
 * and waits — stopping at the first that does not succeed. Every cook and Pot deployment of an EVM
 * plan is held to the Pot guard first, together (`chain.ts#requirePlanSendable`), so none of it is
 * sent when a later step would be refused; after a deployment, the next step waits until the
 * endpoint shows the Pot's code. On Solana each is signed by the wallet
 * as its fee payer and sent through `solana.ts#sendPlannedSvm`, which rehearses it as signed and
 * refuses it if it would fail, as `sauce run` does.
 */
import {
  address,
  createSolanaRpc,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from "@solana/kit";
import {
  bytesToHex,
  getAddress,
  isAddress,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { v12SvmKitchenProgramId } from "../deployments/index.js";
import { v12PotAbi } from "../evm/engine.js";
import { decodeReturned } from "../routes/returned.js";
import { fetchExecutionFee, MAX_POT_LEN } from "../svm/index.js";
import { CliError, UsageError } from "./args.js";
import {
  awaitPot,
  connect,
  requirePlanSendable,
  revertReason,
  sendAndWait,
  simulate,
  type TxRequest,
} from "./chain.js";
import { txLinks } from "./links.js";
import { measureEvm, noPolicyNote, rehearsePlan, type Measured, type SendGuard } from "./policy.js";
import type { PotRecord } from "./pot-store.js";
import { cookReport } from "./receipt.js";
import { requireReleased, sendPlannedSvm, sendPlanTx, type SvmSent } from "./solana.js";
import {
  decodeCursor,
  encodeCursor,
  isCook,
  nextStep,
  planPrograms,
  transactionsAhead,
  type SvmPlan,
} from "./svm-plan.js";
import { HOT_WALLET } from "./wallet-commands.js";
import type { Unlocked, WalletInfo } from "./wallets.js";

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
  "a tool's whole result that carries them (transactions, transaction, or a signed cook's cook " +
  "and deployPot)";

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

function valueOf(raw: unknown, where: string): bigint {
  if (raw === undefined || raw === null) return 0n;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return BigInt(raw);
  if (typeof raw === "string" && /^(?:\d+|0x[0-9a-fA-F]+)$/.test(raw)) return BigInt(raw);
  throw new UsageError(
    `${where}.value is not an amount in base units (a hex quantity, or a decimal string)`,
  );
}

function chainIdOf(raw: unknown, inherited: number | undefined): number | undefined {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);

  return inherited;
}

/** One transaction object, or the plan around it; `label` names one that names itself nothing. */
function collect(
  value: unknown,
  where: string,
  inherited: number | undefined,
  out: PlannedTx[],
  label?: string,
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
  const what =
    typeof fields.what === "string" ? fields.what : (label ?? `transaction ${out.length + 1}`);
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
  // A signed cook (`sauce sign`): the Pot's deployment, where it has none yet, then the cook.
  const deployPot =
    fields.deployPot !== null && typeof fields.deployPot === "object"
      ? fields.deployPot
      : undefined;
  const cook = fields.cook !== null && typeof fields.cook === "object" ? fields.cook : undefined;
  if (deployPot !== undefined || cook !== undefined) {
    const pot = typeof fields.pot === "string" ? ` ${fields.pot}` : "";
    if (deployPot !== undefined) {
      collect(deployPot, `${where}.deployPot`, chainId, out, `Kitchen.deployPot of Pot${pot}`);
    }
    if (cook !== undefined)
      collect(cook, `${where}.cook`, chainId, out, `signed cook on Pot${pot}`);

    return;
  }
  if (Array.isArray(fields.transactions)) {
    collect(fields.transactions, `${where}.transactions`, chainId, out);

    return;
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
  /** A cook's: what it left in the Pot, what moved, and both as lines to read. */
  readonly leftInPot?: ReadonlyArray<Record<string, unknown>>;
  readonly moves?: unknown;
  readonly summary?: readonly string[];
  /** A Solana cook's: what `main` returned, as hex, and read as the type it declares. */
  readonly returns?: string;
  readonly returnType?: string;
  readonly returned?: unknown;
  /** The Pots it deployed, as the `sauce` command records them, for the caller to keep. */
  readonly pots?: readonly PotRecord[];
}

/** `cook(address,bytes)` and a signed cook's `cookSigned(…)`: each runs a program on the Pot it is
 *  sent to. */
const COOKS = new Set<string>([
  toFunctionSelector("function cook(address engine, bytes program)"),
  toFunctionSelector(
    v12PotAbi.find((item) => item.type === "function" && item.name === "cookSigned")!,
  ),
]);

export interface PlanInput {
  readonly wallet: Unlocked;
  readonly guard: SendGuard;
  readonly chain: CanonicalChain;
  readonly transactions: readonly PlannedTx[];
  readonly rpcUrl: string;
}

/** Refuses a plan `wallet` cannot send on `chain`: mixed kinds, or a kind the chain or wallet is not. */
export function checkPlan(
  wallet: Pick<Unlocked, "kind" | "info">,
  chain: CanonicalChain,
  transactions: readonly PlannedTx[],
): void {
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
}

/** Sends a plan from a wallet: rehearsed and held to its policy first, then each in order. */
export async function sendPlan(
  input: PlanInput,
): Promise<{ readonly json: Record<string, unknown>; readonly notes: string[] }> {
  const { wallet, guard, chain, transactions } = input;
  checkPlan(wallet, chain, transactions);
  const sent = chain.kind === "svm" ? await sendSvm(input) : await sendEvm(input);
  const failed = sent.find((entry) => entry.status !== "success");
  const landed = sent.filter((entry) => entry.hash !== "").length;
  const notes = [
    ...(guard.policy === undefined ? [noPolicyNote(wallet.info)] : guard.policy.notes),
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
      // Each one's explorer page and trace, for a person to open, beside its hash.
      sent: sent.map((entry) =>
        entry.hash === "" ? entry : { ...entry, ...txLinks(chain, entry.hash) },
      ),
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
  // Every cook and Pot deployment of the plan held to the guard before anything is rehearsed or
  // sent (`chain.ts#requirePlanSendable`): a later step it refuses leaves every one before it unsent.
  try {
    await requirePlanSendable(
      client,
      requests.map((tx, index) => ({
        tx,
        what: `${input.transactions[index]!.what} (${index + 1} of ${requests.length})`,
      })),
    );
  } catch (error) {
    if (!(error instanceof CliError) || requests.length === 1) throw error;
    throw new CliError(`not sent — ${error.message}`);
  }
  // Rehearsed together first: a plan's later transactions run on what its earlier ones leave.
  const rehearsed = await rehearsePlan(client, account.address, requests);
  if (rehearsed === undefined && requests.length > 1) {
    throw new CliError(
      `simulating ${requests.length} transactions together needs eth_simulateV1, and the ` +
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
    // A cook that landed: what moved, by role, and what it left in the Pot, from its receipt.
    const report =
      result.status === "success" &&
      result.receipt !== undefined &&
      COOKS.has(request.data.slice(0, 10).toLowerCase())
        ? // What was sent stands whatever reading its receipt back does.
          await cookReport(client, input.chain, result.receipt, {
            sender: account.address,
            pot: getAddress(request.to),
            wallet: "the wallet",
          }).catch(() => undefined)
        : undefined;
    sent.push({
      what,
      hash: result.hash,
      status: result.status,
      blockNumber: result.blockNumber.toString(),
      gasUsed: result.gasUsed.toString(),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.pots === undefined ? {} : { pots: result.pots }),
      ...(report === undefined
        ? {}
        : {
            leftInPot: report.leftInPot,
            moves: report.effects.moves,
            summary: [...report.left, ...report.lines],
          }),
    });
    if (result.status !== "success") break;
    // A Pot it deployed, once the endpoint shows its code: a receipt is no proof that the node
    // answering next has its block, and the transaction after it is checked and rehearsed there.
    const next = input.transactions[index + 1];
    if (next !== undefined) {
      try {
        for (const pot of result.pots ?? []) {
          await awaitPot(client, getAddress(pot.pot), result.blockNumber);
        }
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        sent.push({
          what: next.what,
          hash: "",
          status: "failed",
          reason: `not sent — ${error.message}`,
        });
        break;
      }
    }
  }

  return sent;
}

/** The cursor of a Solana plan `value` carries — `sauce_tx`'s, or a send's `next` — if it is one. */
export function plannedCursor(value: unknown): string | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const fields = parsed as { cursor?: unknown; next?: { cursor?: unknown } | null };
  const found = fields.cursor ?? fields.next?.cursor;

  return typeof found === "string" ? found : undefined;
}

/** One transaction of a plan's step as a tool handed it out: base64, for the owner to sign. */
export interface HandedOutTx {
  readonly what: string;
  readonly transaction: string;
}

/** The step's transactions `value` hands out — `sauce_tx`'s `transaction` or `transactions`, or a
 *  send's `next.transactions` — as they were built. */
export function plannedHandedOut(value: unknown): HandedOutTx[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const fields = parsed as {
    transaction?: unknown;
    transactions?: unknown;
    next?: { transactions?: unknown } | null;
  };
  if (typeof fields.transaction === "string") {
    return [{ what: "the cook", transaction: fields.transaction }];
  }
  const list = Array.isArray(fields.transactions)
    ? fields.transactions
    : Array.isArray(fields.next?.transactions)
      ? fields.next.transactions
      : [];

  return (list as unknown[]).flatMap((entry) => {
    const one = entry as { what?: unknown; transaction?: unknown } | null;

    return one !== null && typeof one === "object" && typeof one.transaction === "string"
      ? [
          {
            what: typeof one.what === "string" ? one.what : "a transaction",
            transaction: one.transaction,
          },
        ]
      : [];
  });
}

/** A Solana transaction's base fee, per signature: every plan transaction carries one. */
const SIGNATURE_FEE = 5_000n;
/** An SPL token account's bytes, and a lookup table's header and each address in it. */
const TOKEN_ACCOUNT_LEN = 165n;
const TABLE_HEADER_LEN = 56n;
/** A code buffer's metadata account. */
const CODE_BUFFER_LEN = 91n;

/**
 * What each transaction `plan` has still to send takes out of the owner's lamports, as far as it can
 * be known before any is sent, counted as the policy measures each when it is sent: the rent of what
 * it creates (the Pot, token accounts, the code buffer and its code account, the lookup table and
 * each address added to it), each transaction's fee, and the cook's execution fee. Rent that stays
 * in what the wallet controls does not count: a token account the owner holds, and the Pot a cook
 * creates ahead of itself, which that cook then runs on. What the cook's program moves cannot be
 * known until its setup is on the cluster: it is measured when the cook is sent.
 */
async function planOutflows(
  plan: SvmPlan,
  ctx: { readonly rpc: ReturnType<typeof createSolanaRpc>; readonly url: string },
  owner: KeyPairSigner,
  chain: CanonicalChain,
): Promise<Measured[]> {
  const step = { ...ctx, signer: owner };
  const ahead = await transactionsAhead(plan, step);
  const [base, one] = await Promise.all([
    ctx.rpc.getMinimumBalanceForRentExemption(0n).send(),
    ctx.rpc.getMinimumBalanceForRentExemption(1n).send(),
  ]);
  const rent = (bytes: bigint): bigint => BigInt(base) + bytes * (BigInt(one) - BigInt(base));
  const fee = ahead.some((tx) => tx.kind === "cook")
    ? await fetchExecutionFee(ctx.rpc, address(v12SvmKitchenProgramId()))
    : 0n;
  const kitchen = v12SvmKitchenProgramId();
  let tableBytes = TABLE_HEADER_LEN;

  return ahead.map((tx): Measured => {
    const programs = [
      ...new Set(
        tx.instructions
          .map((instruction) => instruction.programAddress as string)
          .filter((program) => program !== "ComputeBudget111111111111111111111111111111"),
      ),
    ];
    let lamports = SIGNATURE_FEE;
    if (tx.kind === "pot") lamports += rent(BigInt(MAX_POT_LEN));
    if (tx.kind === "accounts") {
      const others = (tx.accounts ?? []).filter((account) => account.holder !== owner.address);
      lamports += BigInt(others.length) * rent(TOKEN_ACCOUNT_LEN);
    }
    if (tx.kind === "buffer" && tx.what === "creating the code buffer") {
      lamports += rent(CODE_BUFFER_LEN) + rent(BigInt(plan.staged?.length ?? 0));
    }
    if (tx.kind === "table") {
      if (tx.what === "creating the lookup table") lamports += rent(TABLE_HEADER_LEN);
      else {
        // An extend pays the rent of the addresses it adds, the bytes of its data past the u32 tag
        // and the u64 count: 32 each, as the table holds them.
        const data = tx.instructions[0]?.data ?? new Uint8Array();
        const added = BigInt(Math.max(0, data.length - 12));
        lamports += rent(tableBytes + added) - rent(tableBytes);
        tableBytes += added;
      }
    }
    if (tx.kind === "cook") lamports += fee;

    return {
      chain,
      to: tx.kind === "cook" || tx.kind === "close" ? [kitchen] : programs,
      native: { token: "native", symbol: "SOL", decimals: 9, amount: lamports },
      tokens: [],
      approvals: [],
      unmeasured: {},
    };
  });
}

/**
 * The plan a cursor carries, for the wallet `wallet` to send: refused, before anything else is read
 * from it or the wallet is unlocked, unless the wallet is the plan's owner — the one key that signs
 * and pays every transaction of the plan.
 */
export function planFor(cursor: string, wallet: WalletInfo): SvmPlan {
  const plan = decodeCursor(cursor);
  if (plan.owner !== wallet.address) {
    throw new UsageError(
      `the plan is ${plan.owner}'s: only that key signs its transactions, and wallet ` +
        `${wallet.name} is ${wallet.address}. Send it from the wallet at ${plan.owner}, or have ` +
        "that key sign each step and send it with sauce_send",
    );
  }

  return plan;
}

/** How many times a plan's step waits, a second each, for the cluster to catch up. */
const PLAN_WAITS = 10;

/**
 * Sends a Solana plan from a wallet, step by step (`svm-plan.ts`): each step built from what the
 * cluster shows, each transaction built on a fresh blockhash, signed by the wallet, rehearsed and
 * held to its policy as it is sent (`solana.ts#sendPlanTx`), until the plan is done. A cook that
 * would fail is not sent, and the code buffer the plan staged is closed again. A cook a tool
 * already handed out (`handedOut`, with the plan remembering it) is the one sent: built again, it
 * could land twice. Once a cook goes out, the plan remembers it before anything can fail, and a
 * failure after that returns the cursor rather than lose it.
 */
export async function sendSvmPlan(input: {
  readonly wallet: Unlocked;
  readonly guard: SendGuard;
  readonly chain: CanonicalChain;
  readonly cursor: string;
  readonly rpcUrl: string;
  readonly handedOut?: readonly HandedOutTx[];
}): Promise<{ readonly json: Record<string, unknown>; readonly notes: string[] }> {
  const { wallet, guard, chain } = input;
  if (chain.kind !== "svm") throw new UsageError("a plan's cursor is a Solana plan's");
  if (wallet.kind !== "solana") {
    throw new UsageError(`wallet ${wallet.info.name} is an EVM wallet, and the plan is Solana's`);
  }
  let plan = planFor(input.cursor, wallet.info);
  guard.gate(chain);
  const ctx = { rpc: createSolanaRpc(input.rpcUrl), url: input.rpcUrl, signer: wallet.signer };
  // The cluster the plan carries on against, checked before anything of it is signed: the plan
  // may have been made against another endpoint, or before an upgrade.
  await requireReleased(ctx.rpc, ctx.url, planPrograms(plan));
  // The whole plan held to the wallet's policy before any of it is sent, as far as it can be
  // measured now; each transaction is measured again, and reserved in the ledger, as it is sent.
  if (guard.policy !== undefined) {
    await guard.preflight(await planOutflows(plan, ctx, wallet.signer, chain));
  }
  const sent: SentEntry[] = [];
  const said: string[] = [];
  let done = false;
  const entryOf = (what: string, result: SvmSent, cook: boolean): SentEntry => {
    const returns =
      cook && result.ok ? bytesToHex(result.returnData ?? new Uint8Array()) : undefined;
    const returned =
      returns === undefined || plan.returnType === undefined
        ? undefined
        : (decodeReturned(plan.returnType, returns, chain) ?? null);

    return {
      what,
      hash: result.signature,
      status: result.ok ? "success" : "failed",
      ...(result.slot === undefined ? {} : { blockNumber: result.slot.toString() }),
      ...(result.fee === undefined ? {} : { fee: result.fee.toString() }),
      ...(result.reason === undefined ? {} : { reason: result.reason }),
      ...(result.pots === undefined ? {} : { pots: result.pots }),
      ...(returns === undefined ? {} : { returns }),
      ...(returned === undefined ? {} : { returnType: plan.returnType, returned }),
    };
  };
  // The cook the plan handed out, sent as it was built: a fresh one could land beside it.
  const handed = (input.handedOut ?? []).map((tx) => ({
    ...tx,
    cook: isCook(
      getTransactionDecoder().decode(new Uint8Array(getBase64Encoder().encode(tx.transaction))),
    ),
  }));
  if (plan.cook !== undefined && plan.cooked === undefined && handed.some((tx) => tx.cook)) {
    for (const tx of handed) {
      let result: SvmSent;
      try {
        result = await sendPlannedSvm(input.rpcUrl, wallet.signer, {
          feePayer: wallet.signer.address,
          transaction: tx.transaction,
          what: tx.what,
        });
      } catch (error) {
        // Refused before it went out (expired, say): the plan, from the cluster, says what next.
        said.push(
          `${tx.what}, as handed out, was not sent: ${(error as Error).message.split("\n")[0]}`,
        );
        break;
      }
      sent.push(entryOf(tx.what, result, tx.cook));
      if (tx.cook) plan = { ...plan, cooked: { ok: result.ok, signature: result.signature } };
      else if (!result.ok) break;
    }
  }
  for (let waits = 0; ;) {
    const step = await nextStep(plan, ctx);
    if (step.name === "done") {
      done = true;
      said.push(...step.notes);
      break;
    }
    if (step.wait !== undefined) {
      if (++waits > PLAN_WAITS) {
        said.push(step.wait);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    // A cook that would fail is not sent: the plan gives it up, and closes what it staged.
    const giving =
      step.fails === undefined ? undefined : await nextStep(plan, ctx, { close: true });
    if (step.fails !== undefined) {
      said.push(`the cook would fail, so it was not sent: ${step.fails.reason}`);
    }
    let stopped = giving !== undefined;
    let next = step.plan;
    for (const tx of (giving ?? step).transactions) {
      let result: SvmSent;
      let out = false;
      try {
        // A cook is remembered as handed out the moment it can land, before it goes.
        result = await sendPlanTx(
          ctx,
          tx,
          tx.kind === "cook"
            ? (lifetime) => {
                out = true;
                next = { ...next, cook: lifetime };
              }
            : undefined,
        );
      } catch (error) {
        const message = (error as Error).message.split("\n")[0]!;
        if (out) {
          said.push(
            `the cook went out, and how it went is not known: ${message}; send the cursor ` +
              "again to learn it (a cook is never sent twice)",
          );
        } else if (sent.length === 0) {
          throw error;
        }
        // Once one is sent, a refusal of the next is part of the result, not the whole of it.
        sent.push({ what: tx.what, hash: "", status: "failed", reason: message });
        stopped = true;
        break;
      }
      sent.push(entryOf(tx.what, result, tx.kind === "cook"));
      if (tx.kind === "cook") {
        next = { ...next, cooked: { ok: result.ok, signature: result.signature } };
      } else if (!result.ok) {
        stopped = true;
        break;
      }
    }
    plan = next;
    if (stopped) break;
  }
  const failed = sent.find((entry) => entry.status !== "success");
  const landed = sent.filter((entry) => entry.hash !== "").length;

  return {
    json: {
      wallet: wallet.info.name,
      from: wallet.info.address,
      chain: chain.slug,
      chainId: chain.id,
      ok: done && failed === undefined && !said.some((note) => note.startsWith("the cook would")),
      sent: sent.map((entry) =>
        entry.hash === "" ? entry : { ...entry, ...txLinks(chain, entry.hash) },
      ),
      ...(done ? {} : { cursor: encodeCursor(plan) }),
      policy: guard.policy?.path ?? null,
    },
    notes: [
      ...(guard.policy === undefined ? [noPolicyNote(wallet.info)] : guard.policy.notes),
      ...said,
      ...(failed === undefined
        ? []
        : [
            `${failed.what} did not succeed${failed.reason === undefined ? "" : `: ${failed.reason}`}; ` +
              `the plan stopped there (${landed} sent)`,
          ]),
      ...(done
        ? []
        : [
            "the plan is not done: send `cursor` again to carry on from what the cluster shows, " +
              "or with close to give up on the cook and close its code buffer",
          ]),
      HOT_WALLET,
    ],
  };
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
      ...(result.pots === undefined ? {} : { pots: result.pots }),
    });
    if (!result.ok) break;
  }

  return sent;
}
