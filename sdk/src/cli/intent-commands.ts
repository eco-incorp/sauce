/**
 * The `sauce` commands that move an intent on after it is filled — `prove`, `claim`, `refund`,
 * `cancel` — and `intents`, which lists, shows and imports the intents the store keeps, and in a
 * terminal picks one and acts on it.
 *
 * Each is a layer over `lifecycle.ts`, which reads the chains and builds the transactions as plain
 * values (what `sauce mcp` returns unsigned): this adds where the intent comes from (a file, or a
 * hash the store holds), the signer and the approval of what it spends, sending, and the store.
 * Given no signer, a command prints the transactions it would send, unsigned, for a wallet.
 */
import type { KeyPairSigner } from "@solana/kit";
import { formatUnits, getAddress, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { TOKEN_REGISTRY } from "../routes/token-registry.js";
import { CliError, UsageError } from "./args.js";
import { connect, sendAndWait, type Sent } from "./chain.js";
import { unapproved, type Approver, type CommandOutput } from "./commands.js";
import { addressLabels, effectLines, effectsJson, effectsOf, nativeSymbol } from "./effects.js";
import { linkLines, txLinks } from "./links.js";
import { costJson, costLine, costOf, type Cost } from "./receipt.js";
import {
  buildCancel,
  buildClaim,
  buildProve,
  buildRefund,
  dispatchedMessages,
  gatewayStatus,
  importIntents,
  intentOf,
  intentStatus,
  publishedIntents,
  txRequest,
  type Ability,
  type AnyTxJson,
  type Endpoints,
  type IntentRecord,
  type IntentStatus,
  type TxJson,
  type VaultMove,
} from "./lifecycle.js";
import { isSvmTx, type SvmTxJson } from "./lifecycle-svm.js";
import { sendPlannedSvm, type SvmSent } from "./solana.js";
import { SOLANA_HYPERLANE } from "../svm/portal.js";
import type { IntentStore, StoreEvent, StoreEventName, StoredIntent } from "./store.js";

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Whether `operand` names an intent by hash, rather than a file. */
export const isIntentHash = (operand: string): boolean => HASH.test(operand);

/** What every lifecycle command is given besides its intents. */
export interface LifecycleContext {
  readonly store: IntentStore;
  /** The endpoint of `chain`, when `--rpc-url` or `--config` gives one. */
  readonly endpoint: (chain: CanonicalChain) => string | undefined;
  /** The signer, which sends; without one, the transactions are printed unsigned. */
  readonly account?: PrivateKeyAccount;
  /** `--keypair`: the Solana signer, for a step on Solana (it pays that transaction's fee). */
  readonly svmSigner?: KeyPairSigner;
  /** Who approves what the command spends beyond gas: `--auto-approve`, or the person asked. */
  readonly approver: Approver;
  /** `--api`: the Eco API gateway, an optional second source of status (and its key). */
  readonly api?: { readonly url: string; readonly key?: string };
}

/** An intent a command acts on, and whether the store has it already. */
export interface Target {
  readonly record: IntentRecord;
  readonly stored?: StoredIntent;
}

/** The intents `hash` names, from the store. */
export function storedTargets(store: IntentStore, hash: Hex): Target[] {
  if (!store.has(hash)) {
    throw new CliError(
      `no intent ${hash.toLowerCase()} in ${store.dir}: import the transaction that published ` +
        "it (`sauce intent import <tx hash> --chain <source>`)",
    );
  }
  const stored = store.load(hash);

  return [{ record: stored.record, stored }];
}

/** Every chain `targets` touch, with the endpoint each has. */
function endpointsOf(targets: readonly Target[], context: LifecycleContext): Endpoints {
  const endpoints: Record<string, string> = {};
  for (const { record } of targets) {
    for (const id of [record.source.chainId, record.destination.chainId]) {
      const url = context.endpoint(requireChain(id));
      if (url !== undefined) endpoints[String(id)] = url;
    }
  }

  return endpoints;
}

const iso = (seconds: string | bigint): string => new Date(Number(seconds) * 1000).toISOString();

/** How long until (or since) `seconds`, from `now`, in words. */
function relative(seconds: string, now: bigint): string {
  const delta = BigInt(seconds) - now;
  const span = delta < 0n ? -delta : delta;
  const words =
    span < 120n
      ? `${span}s`
      : span < 7200n
        ? `${span / 60n}m`
        : span < 172800n
          ? `${span / 3600n}h`
          : `${span / 86400n}d`;

  return delta < 0n ? `${words} ago` : `in ${words}`;
}

/** One transaction sent, and what for: an EVM chain's, with its receipt, or Solana's. */
type SentTx =
  | { readonly tx: TxJson; readonly result: Sent; readonly time: bigint }
  | { readonly tx: SvmTxJson; readonly svm: SvmSent; readonly time: bigint };

/** An EVM transaction sent: where the step is on an EVM chain (a claim, a refund). */
function onEvm(sent: SentTx | undefined): Extract<SentTx, { result: Sent }> {
  if (sent === undefined || !("result" in sent))
    throw new Error("internal: not an EVM transaction");

  return sent;
}

/** The hash (on Solana the signature) of a sent transaction, and the block (slot) it landed in. */
const sentHash = (sent: SentTx): string => ("svm" in sent ? sent.svm.signature : sent.result.hash);
const sentBlock = (sent: SentTx): string =>
  "svm" in sent ? (sent.svm.slot ?? 0n).toString() : sent.result.blockNumber.toString();

/** The Hyperlane messages a sent transaction dispatched: from an EVM Mailbox's `DispatchId`
 *  events, or Solana's Mailbox's log line. */
function messagesOf(sent: SentTx): Array<{ readonly mailbox: string; readonly id: Hex }> {
  if ("result" in sent) return dispatchedMessages(sent.result.logs);

  return sent.svm.logs.flatMap((line) => {
    const found = /Dispatched message to \d+, ID (0x[0-9a-f]{64})/.exec(line);

    return found === null ? [] : [{ mailbox: SOLANA_HYPERLANE.mailbox, id: found[1] as Hex }];
  });
}

/** Sends `transactions` in order, each rehearsed first and refused if it would fail: an EVM one
 *  from the signer (`sendAndWait`), a Solana one signed by `--keypair` (`sendPlannedSvm`). */
async function sendAll(
  transactions: readonly AnyTxJson[],
  context: LifecycleContext,
): Promise<SentTx[]> {
  const sent: SentTx[] = [];
  for (const tx of transactions) {
    const chain = requireChain(tx.chainId);
    const url = context.endpoint(chain);
    if (url === undefined) throw new UsageError(`sending needs ${chain.slug}'s endpoint`);
    if (isSvmTx(tx)) {
      if (context.svmSigner === undefined) {
        throw new UsageError(`${tx.what} is a Solana transaction: sign it with --keypair <path>`);
      }
      const result = await sendPlannedSvm(url, context.svmSigner, tx);
      if (!result.ok) {
        throw new CliError(
          `${tx.what}: ${result.signature} failed: ${result.reason ?? "no reason"}`,
        );
      }
      sent.push({ tx, svm: result, time: BigInt(Math.floor(Date.now() / 1000)) });
      continue;
    }
    const client = await connect(url, chain);
    const result = await sendAndWait(client, url, context.account!, txRequest(tx));
    if (result.status !== "success") {
      throw new CliError(`${tx.what}: ${result.hash} reverted: ${result.reason ?? "no reason"}`);
    }
    const block = await client.getBlock({ blockNumber: result.blockNumber }).catch(() => undefined);
    sent.push({ tx, result, time: block?.timestamp ?? BigInt(Math.floor(Date.now() / 1000)) });
  }

  return sent;
}

/** Approval of what `transactions` spend from the signer beyond gas: their value. */
async function approveSpend(
  context: LifecycleContext,
  what: string,
  transactions: readonly AnyTxJson[],
): Promise<string[]> {
  const spend = transactions.filter((tx) => BigInt(tx.value) > 0n);
  if (spend.length === 0) return [];
  const from = isSvmTx(transactions[0]!) ? transactions[0].feePayer : context.account!.address;
  const lines = [
    `${what} sends ${transactions.length} transaction(s) from ${from}:`,
    ...transactions.map((tx, index) => `  ${index + 1}. ${tx.what}`),
    `It spends ${spend.map(valueText).join(" and ")}, plus ${isSvmTx(spend[0]!) ? "the fee" : "gas"}.`,
  ];
  const action = `${what.toLowerCase()}: spend ${spend.map(valueText).join(" and ")}`;
  const answer = await context.approver.approve(action, `${lines.join("\n")}\nSend them? [y/N] `);
  if (answer === undefined) throw unapproved([action]);
  if (!answer) throw new CliError("not sent: you declined");

  return context.approver.auto ? lines : [];
}

/** What a transaction spends beyond its fee, in its chain's native coin (SOL's 9 decimals on
 *  Solana), and where. */
function valueText(tx: AnyTxJson): string {
  const chain = requireChain(tx.chainId);

  return (
    `${formatUnits(BigInt(tx.value), chain.kind === "svm" ? 9 : 18)} ${nativeSymbol(chain)} on ` +
    `${tx.chain}${isSvmTx(tx) ? " (the IGP's gas and the message accounts' rent, as rehearsed)" : ""}`
  );
}

/**
 * The transactions to send once `approved` was approved: the same ones with `--auto-approve`, or
 * where nothing beyond gas was asked about; otherwise built again from the chain as it is now,
 * because a question can stand for minutes and the prover's fee can move. Refuses, sending
 * nothing, when the new plan is not ready or spends more native value than was approved.
 */
async function rebuilt(
  context: LifecycleContext,
  approved: readonly AnyTxJson[],
  build: () => Promise<{
    readonly ready: boolean;
    readonly why?: string;
    readonly transactions: readonly AnyTxJson[];
  }>,
): Promise<readonly AnyTxJson[]> {
  const total = (transactions: readonly AnyTxJson[]): bigint =>
    transactions.reduce((sum, tx) => sum + BigInt(tx.value), 0n);
  if (context.approver.auto || total(approved) === 0n) return approved;
  // Built again: the fee can move while the question stands, and a Solana blockhash expires.
  const fresh = await build();
  if (!fresh.ready) throw new CliError(`not sent: ${fresh.why ?? "it is no longer ready"}`);
  // A Solana transaction's value is a rehearsal's measure, which moves by a few lamports with the
  // accounts it creates: within a hundredth, it is the spend approved.
  const allowed = approved.some(isSvmTx)
    ? total(approved) + total(approved) / 100n
    : total(approved);
  if (total(fresh.transactions) > allowed) {
    const chain = requireChain(approved[0]!.chainId);
    const decimals = chain.kind === "svm" ? 9 : 18;
    const native = nativeSymbol(chain);
    throw new CliError(
      `not sent: it now takes ${formatUnits(total(fresh.transactions), decimals)} ${native} of value, ` +
        `more than the ${formatUnits(total(approved), decimals)} ${native} you approved (the prover's ` +
        "fee rose): run it again",
    );
  }

  return fresh.transactions;
}

/** The transactions printed for a wallet to sign, when the command has no signer. */
function unsigned(transactions: readonly AnyTxJson[], what: string): CommandOutput {
  return {
    text: JSON.stringify({ transactions }, null, 2),
    json: { sent: false, transactions },
    notes: [
      `${what}: no signer given, so nothing was sent. Sign and send these in order (any account ` +
        "may), or pass --keystore or --private-key.",
    ],
  };
}

/** The account that pays a step on `chain`'s Solana side, where it is Solana: the `--keypair`
 *  signer, which a Solana plan is built for. */
function svmFrom(chain: CanonicalChain, context: LifecycleContext): { readonly from?: string } {
  if (chain.kind !== "svm") return {};
  if (context.svmSigner === undefined) {
    throw new UsageError(
      `this step is a transaction on ${chain.slug}, built for the account that pays its fee: ` +
        "pass --keypair <path>",
    );
  }

  return { from: context.svmSigner.address };
}

/** Records `event` for every intent of `targets`, saving each record first. */
function remember(
  context: LifecycleContext,
  records: readonly IntentRecord[],
  event: StoreEventName,
  sent: SentTx,
  extra: Partial<StoreEvent> = {},
): void {
  for (const record of records) {
    context.store.save(record);
    context.store.append(record.intentHash, {
      event,
      chain: sent.tx.chain,
      chainId: sent.tx.chainId,
      tx: sentHash(sent),
      block: sentBlock(sent),
      time: iso(sent.time),
      ...("svm" in sent
        ? { from: sent.tx.feePayer }
        : context.account === undefined
          ? {}
          : { from: context.account.address }),
      ...extra,
    });
  }
}

/** What a sent transaction moved, decoded from its logs. */
async function moved(
  context: LifecycleContext,
  sent: Extract<SentTx, { result: Sent }>,
  known: ReadonlyArray<readonly [Address, string]>,
) {
  const chain = requireChain(sent.tx.chainId);
  const client = await connect(context.endpoint(chain)!, chain);

  return effectsOf(client, chain, sent.result.logs, false, addressLabels(chain, known));
}

/** What a sent transaction cost: its receipt's gas (and an OP-stack chain's L1 fee) and value. */
const costOfSent = (sent: Extract<SentTx, { result: Sent }>): Cost | undefined =>
  sent.result.receipt === undefined
    ? undefined
    : costOf(sent.result.receipt, BigInt(sent.tx.value));

/** Where a person opens a sent transaction: its explorer page and its trace. */
const linksOf = (sent: SentTx) =>
  txLinks(requireChain(sent.tx.chainId), "svm" in sent ? sent.svm.signature : sent.result.hash);

/** A sent transaction's line, then its links. */
const sentLines = (sent: SentTx): string[] => {
  if ("svm" in sent) {
    return [
      `${sent.tx.what}: ${sent.svm.signature} on ${sent.tx.chain}, slot ${sent.svm.slot ?? "?"}` +
        (sent.svm.fee === undefined ? "" : `; fee ${formatUnits(sent.svm.fee, 9)} SOL`) +
        (BigInt(sent.tx.value) > 0n
          ? `, and ${formatUnits(BigInt(sent.tx.value), 9)} SOL the IGP's gas and rent`
          : ""),
      ...linkLines(linksOf(sent)),
    ];
  }
  const cost = costOfSent(sent);

  return [
    `${sent.tx.what}: ${sent.result.hash} on ${sent.tx.chain}, block ${sent.result.blockNumber}` +
      (cost === undefined
        ? `, gas used ${sent.result.gasUsed}`
        : `; ${costLine(cost, requireChain(sent.tx.chainId), BigInt(sent.tx.value) > 0n ? "the prover's fee" : "none")}`),
    ...linkLines(linksOf(sent)),
  ];
};

const sentJson = (sent: SentTx) =>
  "svm" in sent
    ? {
        ...sent.tx,
        signature: sent.svm.signature,
        ...linksOf(sent),
        slot: (sent.svm.slot ?? 0n).toString(),
        ...(sent.svm.fee === undefined ? {} : { fee: sent.svm.fee.toString() }),
        ...(sent.svm.computeUnits === undefined
          ? {}
          : { computeUnits: sent.svm.computeUnits.toString() }),
      }
    : {
        ...sent.tx,
        hash: sent.result.hash,
        ...linksOf(sent),
        status: sent.result.status,
        block: sent.result.blockNumber.toString(),
        gasUsed: sent.result.gasUsed.toString(),
        ...(costOfSent(sent) === undefined ? {} : { cost: costJson(costOfSent(sent)!) }),
      };

const moveText = (move: VaultMove): string =>
  `${move.decimals === undefined ? `${move.amount} (base units)` : formatUnits(BigInt(move.amount), move.decimals)} ` +
  `${move.symbol ?? (move.token === "native" ? "native" : move.token)} to ${move.to}`;

/** When the store saw the intent filled: what a person waiting for its proof wants to know. */
function filledAt(targets: readonly Target[], now: bigint | undefined): string[] {
  return targets.flatMap(({ stored }) => {
    const filled = stored?.events.filter((event) => event.event === "filled").at(-1);
    if (filled === undefined) return [];
    const message = stored!.events.filter((event) => event.event === "proving").at(-1)?.message;
    const seconds = BigInt(Math.floor(Date.parse(filled.time) / 1000));

    return [
      `${stored!.intentHash} was filled on ${filled.chain} at ${filled.time}` +
        (now === undefined ? "" : ` (${relative(seconds.toString(), now)})`) +
        (message === undefined
          ? ", and no proof was sent from here: `sauce intent prove` sends one"
          : `; its proof travels as Hyperlane message ${message}, which the Hyperlane explorer ` +
            "(explorer.hyperlane.xyz) shows by id"),
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// prove, claim, refund, cancel
// ---------------------------------------------------------------------------------------------

/** `sauce intent prove`: the proof of filled (or cancelled) intents, from their destination. */
export async function proveCommand(
  targets: readonly Target[],
  context: LifecycleContext,
): Promise<CommandOutput> {
  const records = targets.map((target) => target.record);
  const cancelledIn = Object.fromEntries(
    targets.flatMap((target) => {
      const cancelled = target.stored?.events
        .filter((event) => event.event === "cancelled" && event.block !== undefined)
        .at(-1);

      return cancelled === undefined ? [] : [[target.record.intentHash, cancelled.block!] as const];
    }),
  );
  const endpoints = endpointsOf(targets, context);
  const payer = svmFrom(requireChain(records[0]!.destination.chainId), context);
  const plan = await buildProve(records, endpoints, { cancelledIn, ...payer });
  if (!plan.ready) {
    return {
      text: `Not proven: ${plan.why}`,
      json: {
        ready: false,
        why: plan.why,
        ...(plan.prover === undefined ? {} : { prover: plan.prover }),
      },
      notes: plan.notes,
      exitCode: 1,
    };
  }
  if (context.account === undefined && payer.from === undefined) {
    return unsigned(plan.transactions, "prove");
  }
  const shown = await approveSpend(context, "Proving", plan.transactions);
  const [sent] = await sendAll(
    await rebuilt(context, plan.transactions, () =>
      buildProve(records, endpoints, { cancelledIn, ...payer }),
    ),
    context,
  );
  const messages = messagesOf(sent!);
  for (const message of messages)
    remember(context, records, "proving", sent!, { message: message.id });
  if (messages.length === 0) remember(context, records, "proving", sent!);
  const source = records[0]!.source.chain;

  return {
    text: [
      ...shown,
      ...sentLines(sent!),
      ...messages.map(
        (message) =>
          `The proof travels to ${source} as Hyperlane message ${message.id} (dispatched by ` +
          `the Mailbox ${message.mailbox}).`,
      ),
    ].join("\n"),
    json: { ready: true, sent: true, transactions: [sentJson(sent!)], fee: plan.fee, messages },
    notes: [
      ...plan.notes,
      `Once it arrives, \`sauce intent claim ${records[0]!.intentHash} --chain ${source}\` pays the claimant` +
        " (or, for a cancellation, `sauce intent refund` pays the creator).",
    ],
  };
}

/** `sauce intent claim`: the rewards of proven intents, paid to their claimants on the source. */
export async function claimCommand(
  targets: readonly Target[],
  context: LifecycleContext,
): Promise<CommandOutput> {
  const records = targets.map((target) => target.record);
  const endpoints = endpointsOf(targets, context);
  const plan = await buildClaim(records, endpoints);
  if (!plan.ready) {
    const source = requireChain(records[0]!.source.chainId);
    const url = context.endpoint(source);
    const now =
      url === undefined
        ? undefined
        : await connect(url, source)
            .then((client) => client.getBlock())
            .then((block) => block.timestamp)
            .catch(() => undefined);

    return {
      text: `Not claimable yet: ${plan.why}`,
      json: { ready: false, why: plan.why, notes: plan.notes },
      notes: [...plan.notes.slice(1), ...filledAt(targets, now)],
      exitCode: 1,
    };
  }
  if (context.account === undefined) return unsigned(plan.transactions, "claim");
  const sent = onEvm((await sendAll(plan.transactions, context))[0]);
  const claimed = records.filter((record) =>
    plan.claims.some((claim) => claim.intentHash === record.intentHash),
  );
  remember(context, claimed, "claimed", sent);
  const effects = await moved(context, sent, [
    [getAddress(records[0]!.source.portal), "Portal"],
    ...plan.claims.map((claim) => [claim.vault, "the intent's vault"] as const),
    ...plan.claims.map((claim) => [claim.claimant, "the claimant"] as const),
  ]);

  return {
    text: [
      ...sentLines(sent),
      ...plan.claims.flatMap((claim) => [
        `Claimed ${claim.intentHash} for ${claim.claimant}:`,
        ...claim.moves.map((move) => `  ${moveText(move)}`),
      ]),
      ...effectLines(effects),
    ].join("\n"),
    json: {
      ready: true,
      sent: true,
      transactions: [sentJson(sent)],
      claims: plan.claims,
      ...effectsJson(effects),
    },
    notes: plan.notes,
  };
}

/** `sauce intent refund`: an unearned reward returned from its vault to its creator. */
export async function refundCommand(
  targets: readonly Target[],
  context: LifecycleContext,
): Promise<CommandOutput> {
  const endpoints = endpointsOf(targets, context);
  const texts: string[] = [];
  const json: Record<string, unknown>[] = [];
  const notes: string[] = [];
  let failed = false;
  for (const target of targets) {
    const plan = await buildRefund(target.record, endpoints);
    if (!plan.ready) {
      failed = true;
      texts.push(`${target.record.intentHash}: not refundable yet: ${plan.why}`);
      json.push({ intentHash: target.record.intentHash, ready: false, why: plan.why });
      continue;
    }
    if (context.account === undefined) {
      texts.push(JSON.stringify({ transactions: plan.transactions }, null, 2));
      json.push({
        intentHash: target.record.intentHash,
        ready: true,
        sent: false,
        transactions: plan.transactions,
      });
      continue;
    }
    const sent = onEvm((await sendAll(plan.transactions, context))[0]);
    remember(context, [target.record], "refunded", sent);
    const effects = await moved(context, sent, [
      [getAddress(target.record.source.portal), "Portal"],
      [plan.vault, "the intent's vault"],
      [plan.refundee, "the creator"],
    ]);
    texts.push(
      ...sentLines(sent),
      `Refunded ${target.record.intentHash} to its creator ${plan.refundee}:`,
      ...plan.moves.map((move) => `  ${moveText(move)}`),
      ...effectLines(effects),
    );
    json.push({
      intentHash: target.record.intentHash,
      ready: true,
      sent: true,
      transactions: [sentJson(sent)],
      refundee: plan.refundee,
      moves: plan.moves,
      ...effectsJson(effects),
    });
    notes.push(...plan.notes);
  }
  if (context.account === undefined && !failed) {
    notes.push(
      "refund: no signer given, so nothing was sent. Sign and send these (any account may).",
    );
  }

  return {
    text: texts.join("\n"),
    json: { intents: json },
    ...(notes.length === 0 ? {} : { notes }),
    ...(failed ? { exitCode: 1 } : {}),
  };
}

/** `sauce intent cancel`: an unfilled intent cancelled on its destination after its route's deadline. */
export async function cancelCommand(
  targets: readonly Target[],
  context: LifecycleContext,
  options: { readonly prove: boolean },
): Promise<CommandOutput> {
  const endpoints = endpointsOf(targets, context);
  const texts: string[] = [];
  const json: Record<string, unknown>[] = [];
  const notes: string[] = [];
  let failed = false;
  for (const target of targets) {
    const payer = svmFrom(requireChain(target.record.destination.chainId), context);
    const plan = await buildCancel(target.record, endpoints, { prove: options.prove, ...payer });
    if (!plan.ready) {
      failed = true;
      texts.push(`${target.record.intentHash}: not cancelled: ${plan.why}`);
      json.push({ intentHash: target.record.intentHash, ready: false, why: plan.why });
      continue;
    }
    if (context.account === undefined && payer.from === undefined) {
      texts.push(JSON.stringify({ transactions: plan.transactions }, null, 2));
      json.push({
        intentHash: target.record.intentHash,
        ready: true,
        sent: false,
        transactions: plan.transactions,
      });
      notes.push(...plan.notes);
      continue;
    }
    texts.push(...(await approveSpend(context, "Cancelling", plan.transactions)));
    const [sent] = await sendAll(
      await rebuilt(context, plan.transactions, () =>
        buildCancel(target.record, endpoints, { prove: options.prove, ...payer }),
      ),
      context,
    );
    remember(context, [target.record], "cancelled", sent!);
    const messages = messagesOf(sent!);
    for (const message of messages) {
      remember(context, [target.record], "proving", sent!, { message: message.id });
    }
    texts.push(
      ...sentLines(sent!),
      `Cancelled ${target.record.intentHash} on ${target.record.destination.chain}: no solver can fill it now.`,
      ...messages.map(
        (message) =>
          `The cancellation's proof travels to ${target.record.source.chain} as Hyperlane message ${message.id}.`,
      ),
    );
    json.push({
      intentHash: target.record.intentHash,
      ready: true,
      sent: true,
      transactions: [sentJson(sent!)],
      messages,
    });
    notes.push(...plan.notes);
  }

  return {
    text: texts.join("\n"),
    json: { intents: json },
    ...(notes.length === 0 ? {} : { notes }),
    ...(failed ? { exitCode: 1 } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// intents: list, show, import
// ---------------------------------------------------------------------------------------------

const abilityText = (name: string, ability: Ability): string =>
  `  ${name.padEnd(7)}${ability.ok ? "yes" : "no "}  ${ability.why}`;

/** What `formatUnits` makes of a vault holding, for a person. */
const holdingText = (entry: NonNullable<IntentStatus["source"]>["vaultHolds"][number]): string => {
  const unit = (value: string) =>
    entry.decimals === undefined
      ? `${value} (base units)`
      : formatUnits(BigInt(value), entry.decimals);

  return `${unit(entry.holds)} of ${unit(entry.reward)} ${entry.symbol ?? (entry.token === "native" ? "native" : entry.token)}`;
};

/** `amount` of `token` on `chainId`, in whole units with its symbol where the registry names it. */
function tokenText(
  chainId: number,
  entry: { readonly token: Hex; readonly amount: string },
): string {
  const row = (TOKEN_REGISTRY[chainId] ?? []).find(
    (candidate) => candidate.address.toLowerCase() === entry.token.toLowerCase(),
  );

  return row === undefined
    ? `${entry.amount} of ${entry.token}`
    : `${formatUnits(BigInt(entry.amount), row.decimals)} ${row.symbol}`;
}

/** An intent's record, events and live status, for a person. */
export function statusLines(stored: Target, status: IntentStatus | undefined): string[] {
  const { record } = stored;
  const intent = intentOf(record);
  const now = status?.destination?.time ?? status?.source?.time;
  const when = (seconds: string) =>
    `${iso(seconds)}${now === undefined ? "" : ` (${relative(seconds, BigInt(now))})`}`;
  const lines = [
    `Intent ${record.intentHash}: ${record.source.chain} -> ${record.destination.chain}` +
      (status === undefined ? "" : `, ${status.state}`),
    `  delivers ${record.route.tokens.map((entry) => tokenText(record.destination.chainId, entry)).join(", ") || "no token"} ` +
      `in ${intent.route.calls.length} call(s); reward ` +
      `${record.reward.tokens.map((entry) => tokenText(record.source.chainId, entry)).join(", ") || "no token"}` +
      (record.reward.nativeAmount === "0" ? "" : ` and ${record.reward.nativeAmount} wei`),
    `  route deadline:  ${when(record.route.deadline)} (fill by; cancellable after)`,
    `  reward deadline: ${when(record.reward.deadline)} (refundable from, unproven)`,
    `  creator ${record.reward.creator}, prover ${record.reward.prover}`,
    `  source Portal ${record.source.portal}` +
      (record.vault === undefined ? "" : `, vault ${record.vault}`),
  ];
  if (status?.source !== undefined) {
    lines.push(
      `  on ${status.source.chain}: reward ${status.source.rewardStatus}, vault holds ` +
        (status.source.vaultHolds.map(holdingText).join(", ") || "nothing it owes") +
        `; proof: ${status.source.proof === null ? "none" : `${status.source.proof.claimant} from chain ${status.source.proof.destination}`}`,
    );
  }
  if (status?.destination !== undefined) {
    lines.push(
      `  on ${status.destination.chain}: ` +
        (status.destination.cancelled
          ? "cancelled"
          : status.destination.claimant === null
            ? "not filled"
            : `filled for ${status.destination.claimant}`) +
        `; Portal ${status.destination.portal} ${status.destination.canCancel ? "can" : "cannot"} cancel`,
    );
  }
  if (status !== undefined) {
    lines.push(
      "  can:",
      ...Object.entries(status.can).map(([name, ability]) => abilityText(name, ability)),
    );
  }
  const events = stored.stored?.events ?? [];
  if (events.length > 0) {
    lines.push(
      "  events:",
      ...events.map(
        (event) =>
          `    ${event.time}  ${event.event.padEnd(9)} ${event.chain}` +
          (event.tx === undefined ? "" : ` ${event.tx}`) +
          (event.block === undefined ? "" : ` block ${event.block}`) +
          (event.message === undefined ? "" : ` message ${event.message}`),
      ),
    );
  }

  return lines;
}

/** `sauce intent show`: an intent's record, events and, with endpoints, where it stands. */
export async function showCommand(
  target: Target,
  context: LifecycleContext,
): Promise<CommandOutput> {
  const endpoints = endpointsOf([target], context);
  const [status, gateway] = await Promise.all([
    Object.keys(endpoints).length === 0 ? undefined : intentStatus(target.record, endpoints),
    context.api === undefined
      ? undefined
      : gatewayStatus(context.api.url, target.record.intentHash, context.api.key).then(
          (answer) => answer ?? null,
        ),
  ]);
  const lines = statusLines(target, status);
  if (gateway !== undefined) {
    lines.push(
      gateway === null
        ? "  the gateway (--api) has no entry for it"
        : `  the gateway (--api) says ${gateway.status}` +
            (gateway.destinationTx === undefined
              ? ""
              : `, destination tx ${gateway.destinationTx}`),
    );
  }

  return {
    text: lines.join("\n"),
    json: {
      record: target.record,
      events: target.stored?.events ?? [],
      ...(status === undefined ? {} : { status }),
      ...(gateway === undefined ? {} : { gateway }),
    },
    notes: [
      ...(target.stored?.warnings ?? []),
      ...(status?.notes ?? []),
      ...(status === undefined
        ? ["no endpoint given: --config with both chains' endpoints shows where it stands"]
        : []),
    ],
  };
}

/** The last thing the store saw happen to an intent, as a word. */
const lastEvent = (stored: StoredIntent): string => stored.events.at(-1)?.event ?? "stored";

/** `sauce intent list`: every intent the store keeps, with where it stands when endpoints say. */
export async function listCommand(context: LifecycleContext): Promise<CommandOutput> {
  const listing = context.store.list();
  const all = [...listing.intents].sort((a, b) =>
    (a.events[0]?.time ?? "").localeCompare(b.events[0]?.time ?? ""),
  );
  const unread: string[] = [];
  const rows = await inBatches(all, LIST_READS, async (stored) => {
    const endpoints = endpointsOf([{ record: stored.record, stored }], context);
    if (Object.keys(endpoints).length === 0) return { stored, status: undefined };
    try {
      return { stored, status: await intentStatus(stored.record, endpoints) };
    } catch (error) {
      unread.push(
        `${stored.intentHash}: its status could not be read: ` +
          (error instanceof Error ? error.message : String(error)),
      );

      return { stored, status: undefined };
    }
  });

  return {
    text:
      rows.length === 0
        ? `No intents in ${context.store.dir}.`
        : rows
            .map(
              ({ stored, status }, index) =>
                `${String(index + 1).padStart(3)}. ${stored.intentHash}  ${stored.record.source.chain} -> ` +
                `${stored.record.destination.chain}  ${status?.state ?? lastEvent(stored)}  ` +
                `fill by ${iso(stored.record.route.deadline)}`,
            )
            .join("\n"),
    json: {
      store: context.store.dir,
      intents: rows.map(({ stored, status }) => ({
        intentHash: stored.intentHash,
        source: stored.record.source.chain,
        destination: stored.record.destination.chain,
        last: lastEvent(stored),
        ...(status === undefined ? {} : { state: status.state, can: status.can }),
      })),
    },
    notes: [...listing.warnings, ...rows.flatMap(({ stored }) => stored.warnings), ...unread],
  };
}

/** How many intents `sauce intent list` reads at once: each read is several calls on two chains. */
const LIST_READS = 4;

/** `run` over `items`, `size` at a time, the results in `items`' order. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }

  return results;
}

/** `sauce intent import`: the intents a transaction published, rebuilt and stored. */
export async function importCommand(
  ref: { readonly txHash: Hex; readonly chain: CanonicalChain; readonly index?: number },
  context: LifecycleContext,
): Promise<CommandOutput> {
  const url = context.endpoint(ref.chain);
  if (url === undefined) {
    throw new UsageError(
      `missing --rpc-url <url> (or --config <file>): the ${ref.chain.slug} endpoint`,
    );
  }
  const { intents } = await importIntents(
    {
      txHash: ref.txHash,
      chain: ref.chain.id,
      ...(ref.index === undefined ? {} : { index: ref.index }),
    },
    { [String(ref.chain.id)]: url },
  );
  const lines: string[] = [];
  for (const published of intents) {
    const created = context.store.save(published.record);
    const base = {
      chain: ref.chain.slug,
      chainId: ref.chain.id,
      tx: published.txHash,
      block: published.block,
      time: iso(published.time),
    };
    if (created === "created") {
      context.store.append(published.record.intentHash, { event: "imported", ...base });
      if (published.funded)
        context.store.append(published.record.intentHash, { event: "funded", ...base });
    }
    lines.push(
      `${created === "created" ? "Imported" : "Already stored"} ${published.record.intentHash}: ` +
        `${published.record.source.chain} -> ${published.record.destination.chain}` +
        (published.funded ? ", funded in the same transaction" : ""),
    );
  }

  return {
    text: lines.join("\n"),
    json: { store: context.store.dir, intents: intents.map((entry) => ({ ...entry })) },
  };
}

/** Records the intents a sent transaction published (`run`) in the store. */
export async function rememberPublished(
  store: IntentStore,
  chain: CanonicalChain,
  rpcUrl: string,
  sent: Sent,
): Promise<IntentRecord[]> {
  if (sent.status !== "success") return [];
  const intents = await publishedIntents(await connect(rpcUrl, chain), chain, sent.logs, {
    txHash: sent.hash,
    blockNumber: sent.blockNumber,
  });
  for (const published of intents) {
    store.save(published.record);
    const base = {
      chain: chain.slug,
      chainId: chain.id,
      tx: published.txHash,
      block: published.block,
      time: iso(published.time),
    };
    store.append(published.record.intentHash, { event: "published", ...base });
    if (published.funded) store.append(published.record.intentHash, { event: "funded", ...base });
  }

  return intents.map((entry) => entry.record);
}
