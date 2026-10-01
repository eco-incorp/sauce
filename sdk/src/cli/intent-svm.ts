/**
 * `sauce intent fill` for an intent an EVM chain published to Solana: the fill rehearsed on the
 * cluster as it is (Solana's simulation takes no state overrides, so the solver's own accounts
 * pay), and with `--send` sent from `--keypair`, then the proof. The transactions are
 * `lifecycle.ts#buildFill`'s and `#buildProve`'s, the same ones `sauce mcp` returns unsigned;
 * this adds the rehearsal's report, the approval, sending and the store.
 */
import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { formatUnits, type Hex } from "viem";

import { requireChain } from "../chains/canonical.js";
import { svmTokenRows } from "../routes/token-registry.js";
import { CliError, UsageError } from "./args.js";
import { unapproved, type CommandOutput } from "./commands.js";
import type { LifecycleContext, Target } from "./intent-commands.js";
import { buildFill, buildProve } from "./lifecycle.js";
import { rehearseSvm, tokenAccountAmount, type SvmTxJson } from "./lifecycle-svm.js";
import { sendPlannedSvm, type SvmSent } from "./solana.js";
import { SOLANA_HYPERLANE } from "../svm/portal.js";

/** The writable accounts a transaction takes that are not its signers: what it can change. */
function writableAccounts(tx: SvmTxJson): string[] {
  const transaction = getTransactionDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(tx.transaction)),
  );
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys = message.staticAccounts;
  const { numSignerAccounts, numReadonlyNonSignerAccounts } = message.header;

  return keys.slice(numSignerAccounts, keys.length - numReadonlyNonSignerAccounts);
}

/** A token account's mint (its first 32 bytes) and amount, where `data` is one: SPL's base
 *  layout, which Token-2022's shares. */
const tokenAccount = (data: Uint8Array | null | undefined) =>
  data === null || data === undefined || data.length < 165
    ? undefined
    : { mint: getAddressDecoder().decode(data.subarray(0, 32)), amount: tokenAccountAmount(data) };

/** A Solana token amount, in whole units where the registry knows the mint. */
function amountText(mint: string, amount: bigint): string {
  const row = svmTokenRows(requireChain("solana")).find((entry) => entry.mint === mint);

  return row === undefined
    ? `${amount} of ${mint} (base units)`
    : `${formatUnits(amount, row.decimals)} ${row.symbol}`;
}

export interface SvmFillInput {
  readonly targets: readonly Target[];
  /** Who the rehearsal fills as, with no `--send`: a Solana key. Default: the `--keypair` key. */
  readonly solver?: string;
  /** The claimant on the source chain, 20 or 32 bytes: required, a Solana key is not one. */
  readonly claimant?: Hex;
  readonly prove?: boolean;
  readonly send: boolean;
}

/** Rehearses (and, with `send`, sends) the fill of each of `input.targets`, all to Solana. */
export async function svmFillCommand(
  input: SvmFillInput,
  context: LifecycleContext,
): Promise<CommandOutput> {
  const texts: string[] = [];
  const json: Record<string, unknown>[] = [];
  const notes: string[] = [];
  let failed = false;
  for (const target of input.targets) {
    const record = target.record;
    const chain = requireChain(record.destination.chainId);
    const url = context.endpoint(chain);
    if (url === undefined) {
      throw new UsageError(
        `a fill on ${chain.slug} needs its endpoint (--config naming ${chain.id})`,
      );
    }
    if (input.send && context.svmSigner === undefined) {
      throw new UsageError(`sending a fill on ${chain.slug} needs its signer: --keypair <path>`);
    }
    const solver = input.send
      ? context.svmSigner!.address
      : (input.solver ?? context.svmSigner?.address);
    if (solver === undefined) {
      throw new UsageError(
        `a fill on ${chain.slug} is rehearsed from the solver's own accounts (Solana's simulation ` +
          "takes no overrides): --solver <key>, or --keypair <path>",
      );
    }
    const endpoints: Record<string, string> = { [String(chain.id)]: url };
    const source = context.endpoint(requireChain(record.source.chainId));
    if (source !== undefined) endpoints[String(record.source.chainId)] = source;
    const build = () =>
      buildFill(record, endpoints, {
        from: solver,
        ...(input.claimant === undefined ? {} : { claimant: input.claimant }),
        ...(input.prove === undefined ? {} : { prove: input.prove }),
      });
    let fill = await build();
    const fillTx = fill.transactions[0] as SvmTxJson;
    const rpc = createSolanaRpc(url);
    const watch = writableAccounts(fillTx);
    const before = await rpc
      .getMultipleAccounts(
        watch.map((key) => address(key)),
        { encoding: "base64" },
      )
      .send()
      .then(({ value }) =>
        value.map((entry) =>
          entry === null
            ? null
            : new Uint8Array(
                getBase64Encoder().encode((entry.data as readonly [string, string])[0]),
              ),
        ),
      )
      .catch(() => {
        throw new CliError(`reading the accounts the fill writes from ${chain.slug} failed`);
      });
    const rehearsal = await rehearseSvm(rpc, fillTx, watch);
    const moved = watch.flatMap((key, index) => {
      const was = tokenAccount(before[index]);
      const now = tokenAccount(rehearsal.after.get(key)?.data);
      if (now === undefined || (was?.amount ?? 0n) === now.amount) return [];
      const delta = now.amount - (was?.amount ?? 0n);

      return [
        `  ${key}: ${delta > 0n ? "+" : "-"}${amountText(now.mint, delta > 0n ? delta : -delta)}`,
      ];
    });
    const native = BigInt(record.route.nativeAmount);
    const spends = [
      ...fill.delivers.map((token) => amountText(token.token, BigInt(token.amount))),
      ...(native > 0n ? [`${formatUnits(native, 9)} SOL, the route's native amount`] : []),
    ];
    const head = [
      `Filling ${record.intentHash} on ${chain.slug} from ${solver}, ${fill.transactions.length} transaction(s):`,
      ...fill.transactions.map((tx, index) => `  ${index + 1}. ${tx.what}`),
      `It spends ${spends.length === 0 ? "no tokens" : spends.join(" and ")} from the solver's token accounts, plus the fees.`,
    ];
    if (!rehearsal.ok) {
      failed = true;
      texts.push(...head, `The fill fails: ${rehearsal.reason}`);
      json.push({
        intentHash: record.intentHash,
        ok: false,
        reason: rehearsal.reason,
        logs: rehearsal.logs,
      });
      notes.push(...fill.notes);
      continue;
    }
    const rehearsed = [
      `The fill succeeds${rehearsal.units === undefined ? "" : `, ${rehearsal.units} compute units`}.`,
      ...(moved.length === 0 ? [] : ["Token accounts it moves:", ...moved]),
    ];
    if (!input.send) {
      texts.push(...head, ...rehearsed);
      json.push({
        intentHash: record.intentHash,
        ok: true,
        sent: false,
        solver,
        transactions: fill.transactions,
        prover: fill.prover,
        ...(rehearsal.units === undefined ? {} : { computeUnits: rehearsal.units.toString() }),
      });
      notes.push(...fill.notes);
      continue;
    }
    const action = `fill ${record.intentHash} on ${chain.slug}: spend ${spends.join(" and ") || "no tokens"}`;
    const answer = await context.approver.approve(
      action,
      `${[...head, ...rehearsed].join("\n")}\nSend it? [y/N] `,
    );
    if (answer === undefined) throw unapproved([action]);
    if (!answer) throw new CliError("not sent: you declined");
    // A Solana blockhash lasts about a minute: after a person's answer, build the fill again.
    if (!context.approver.auto) fill = await build();
    const sent = await sendPlannedSvm(url, context.svmSigner!, fill.transactions[0] as SvmTxJson);
    if (!sent.ok)
      throw new CliError(`the fill ${sent.signature} failed: ${sent.reason ?? "no reason"}`);
    remember(context, target, "filled", chain, sent);
    const lines = [
      ...(context.approver.auto ? [...head, ...rehearsed, ""] : []),
      `Filled ${record.intentHash} on ${chain.slug}: ${sent.signature}, slot ${sent.slot ?? "?"}`,
    ];
    const entry: Record<string, unknown> = {
      intentHash: record.intentHash,
      ok: true,
      sent: true,
      solver,
      fill: { signature: sent.signature, slot: (sent.slot ?? 0n).toString() },
    };
    if (fill.proves) {
      // The proof, built now that the fill is recorded, and rehearsed: its gas is the IGP's quote.
      const proof = await buildProve([record], endpoints, { from: solver });
      if (!proof.ready) {
        notes.push(`not proven: ${proof.why}`);
      } else {
        const tx = proof.transactions[0] as SvmTxJson;
        const spend = `${formatUnits(BigInt(tx.value), 9)} SOL (the IGP's gas and the message accounts' rent)`;
        const proveAction = `prove ${record.intentHash} from ${chain.slug}: spend ${spend}`;
        const ok = await context.approver.approve(
          proveAction,
          `${tx.what}\nIt spends ${spend}. Send it? [y/N] `,
        );
        if (ok === undefined) throw unapproved([proveAction]);
        if (ok) {
          const proven = await sendPlannedSvm(
            url,
            context.svmSigner!,
            (context.approver.auto
              ? proof
              : await buildProve([record], endpoints, { from: solver })
            ).transactions[0] as SvmTxJson,
          );
          if (!proven.ok) {
            throw new CliError(
              `the proof ${proven.signature} failed: ${proven.reason ?? "no reason"}`,
            );
          }
          const message = proven.logs
            .map((line) => /Dispatched message to \d+, ID (0x[0-9a-f]{64})/.exec(line)?.[1])
            .find((id) => id !== undefined) as Hex | undefined;
          remember(context, target, "proving", chain, proven, message);
          lines.push(
            `Proved it: ${proven.signature}, slot ${proven.slot ?? "?"}` +
              (message === undefined
                ? ""
                : `; the proof travels to ${record.source.chain} as Hyperlane message ${message} (dispatched by the Mailbox ${SOLANA_HYPERLANE.mailbox})`),
          );
          entry.proof = {
            signature: proven.signature,
            slot: (proven.slot ?? 0n).toString(),
            ...(message === undefined ? {} : { message }),
          };
        } else {
          notes.push("the proof was not sent: you declined. `sauce intent prove` sends it.");
        }
      }
    }
    texts.push(lines.join("\n"));
    json.push(entry);
    notes.push(
      `Once the proof arrives on ${record.source.chain}, claim the reward: ` +
        `\`sauce intent claim ${record.intentHash} --config <file> --keystore <path>\``,
    );
  }

  return {
    text: texts.join("\n\n"),
    json: { intents: json },
    ...(notes.length === 0 ? {} : { notes }),
    ...(failed ? { exitCode: 1 } : {}),
  };
}

function remember(
  context: LifecycleContext,
  target: Target,
  event: "filled" | "proving",
  chain: ReturnType<typeof requireChain>,
  sent: SvmSent,
  message?: Hex,
): void {
  context.store.save(target.record);
  context.store.append(target.record.intentHash, {
    event,
    chain: chain.slug,
    chainId: chain.id,
    tx: sent.signature,
    block: (sent.slot ?? 0n).toString(),
    time: new Date().toISOString(),
    from: context.svmSigner!.address,
    ...(message === undefined ? {} : { message }),
  });
}
