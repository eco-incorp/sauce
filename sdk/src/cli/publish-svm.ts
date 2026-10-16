/**
 * `sauce intent publish --chain solana`: the intents a file opens, published from a Solana wallet
 * through Solana's eco-routes Portal, the reward escrowed there.
 *
 * The file is the same intent file an EVM chain publishes — `Base(() => { … }).reward({ … })`, its
 * reward's names (`USDC`) resolved on Solana — and its intents are built the same way, by the SDK's
 * own lowering (`publish.ts#fixedIntents`), with every value fixed before anything runs. What
 * differs is the publication: no program runs on Solana to open an intent, so the wallet calls the
 * Portal itself, one transaction an intent: `fund` (the reward moved from the wallet into the
 * intent's vault, which `fund` derives, so no vault can be wrong) then `publish` (the intent
 * announced). Simulated on the cluster first; nothing is sent where the simulation fails.
 *
 * Its fill, proof and cancellation happen on the destination as for any intent (`sauce intent fill`,
 * `prove`, `cancel`), the proof carried to Solana's HyperProver; its claim and refund are Solana's
 * (`sauce intent claim`, `refund`, with `--keypair`).
 */
import type { Address as SvmAddress, KeyPairSigner } from "@solana/kit";
import { formatUnits, type Hex } from "viem";

import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { hashIntent } from "../routes/encode.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import { svmKeyOf, universalOfSvmKey } from "../svm/portal.js";
import { CliError, UsageError } from "./args.js";
import {
  refusePastDeadline,
  type CliFiles,
  type CommandOutput,
  type ProgramInput,
} from "./commands.js";
import { knowIntents } from "./keep.js";
import { intentRecord, type IntentRecord } from "./lifecycle.js";
import { svmPublishPlan, type SvmFunderHold } from "./lifecycle-svm-source.js";
import { svmRpc, type SvmTxJson } from "./lifecycle-svm.js";
import { linkLines, txLinks } from "./links.js";
import { fixedIntents } from "./publish.js";
import { sendPlannedSvm } from "./solana.js";
import { intentDestinations, requireSupported } from "./support.js";

export interface SvmPublishInput extends ProgramInput {
  /** Print the unsigned transactions instead of sending them. */
  readonly format?: "json";
  /** Simulate each transaction on the cluster, and send nothing. */
  readonly dryRun: boolean;
  /** Solana's endpoint. */
  readonly rpcUrl: string;
  /** `--keypair` or a Solana `--wallet`: pays the fee and funds the reward. */
  readonly signer?: KeyPairSigner;
  /** Whose wallet, where no signer is given: for a dry run, or the unsigned transactions. */
  readonly from?: SvmAddress;
}

const holdText = (entry: SvmFunderHold, what: "holds" | "reward"): string => {
  const amount = what === "holds" ? entry.holds : entry.reward;
  const symbol = entry.symbol ?? (entry.token === "native" ? "SOL" : entry.token);

  return entry.decimals === undefined
    ? `${amount} ${symbol} (base units)`
    : `${formatUnits(amount, entry.decimals)} ${symbol}`;
};

/** `sauce intent publish` from Solana: send, simulate or print each intent's `fund` and
 *  `publish`. */
export async function publishSvmCommand(
  input: SvmPublishInput,
  files: CliFiles,
): Promise<CommandOutput> {
  refusePastDeadline(input);
  const intents = fixedIntents(input, files);
  if (input.format !== undefined || !input.dryRun) {
    requireSupported("publishing intents", [input.chain, ...intentDestinations(intents)]);
  }
  const from = input.signer?.address ?? input.from;
  if (from === undefined) {
    throw new UsageError(
      "publishing from Solana needs the wallet that funds the reward: --keypair <path> or a " +
        "Solana --wallet, or --from <key> with --dry-run or --format json",
    );
  }
  const portal = svmKeyOf(ecoRoutesPortal(input.chain));
  const rpc = svmRpc(input.rpcUrl);
  const plans: Array<
    Awaited<ReturnType<typeof svmPublishPlan>> & {
      readonly hash: Hex;
      readonly lowered: LoweredIntent;
      readonly record: IntentRecord;
    }
  > = [];
  for (const lowered of intents) {
    const plan = await svmPublishPlan(rpc, input.chain, lowered.intent, portal, from);
    plans.push({
      ...plan,
      hash: hashIntent(lowered.intent).intentHash,
      lowered,
      record: intentRecord(lowered.intent, {
        sourcePortal: universalOfSvmKey(portal),
        vault: universalOfSvmKey(plan.vault),
      }),
    });
  }
  const intentJson = (plan: (typeof plans)[number]) => ({
    intentHash: plan.hash,
    destination: plan.lowered.destination.slug,
    vault: plan.vault,
    record: plan.record,
  });
  const summary = plans.map(
    (plan) =>
      `intent ${plan.hash} to ${plan.lowered.destination.slug}: its reward, ` +
      `${plan.funder.map((entry) => holdText(entry, "reward")).join(" and ")}, funded from ${from} ` +
      `into its vault ${plan.vault}, then published`,
  );
  const notes = plans.flatMap((plan) => plan.notes);

  if (input.format !== undefined) {
    const json = {
      chainId: input.chain.id,
      portal,
      intents: plans.map((plan) => ({ ...intentJson(plan), transactions: plan.transactions })),
    };

    return {
      text: JSON.stringify(json, null, 2),
      json,
      notes: [
        ...summary,
        ...notes,
        `Sign each with ${from}, which pays its fee and funds the reward, and send them in ` +
          "order, the fund first, within about a minute: their blockhash expires after that, " +
          "and they must be built again. A publish that fails after its fund leaves the reward " +
          "in the vault: publish again, or refund it after the reward's deadline.",
      ],
    };
  }
  if (input.dryRun) {
    const ok = plans.every((plan) => plan.ok);

    return {
      text: [
        ...summary,
        ...plans.map(
          (plan) =>
            `intent ${plan.hash}: ${plan.ok ? "its fund and publish succeed" : `fails: ${plan.reason ?? "no reason"}`}`,
        ),
      ].join("\n"),
      json: {
        ok,
        from,
        intents: plans.map((plan) => ({
          ...intentJson(plan),
          ok: plan.ok,
          ...(plan.reason === undefined ? {} : { reason: plan.reason }),
          funder: plan.funder.map((entry) => ({
            token: entry.token,
            ...(entry.symbol === undefined ? {} : { symbol: entry.symbol }),
            holds: entry.holds.toString(),
            reward: entry.reward.toString(),
          })),
        })),
      },
      notes: [
        ...notes,
        `This simulates publishing on ${input.chain.slug} only. What the intent does runs on ` +
          `${[...new Set(plans.map((plan) => plan.lowered.destination.slug))].join(" and ")}, when ` +
          "a solver fills it: `sauce intent fill` with the intent's hash and the destination's " +
          "endpoint simulates that.",
      ],
      ...(ok ? {} : { exitCode: 1 }),
    };
  }
  if (input.signer === undefined) {
    throw new UsageError(
      "missing a signer to publish from: --keypair <path> or a Solana --wallet (or print the " +
        "unsigned transactions with --format json)",
    );
  }
  const failed = plans.find((plan) => !plan.ok);
  if (failed !== undefined) {
    throw new CliError(
      `intent ${failed.hash} would fail to publish, so nothing was sent: ${failed.reason ?? "no reason"}`,
    );
  }
  // The store learns of each intent before its `fund` lands, so the funding is recorded too.
  knowIntents(plans.map((plan) => plan.record));
  const sent: Array<{
    readonly tx: SvmTxJson;
    readonly signature: string;
    readonly slot?: bigint;
  }> = [];
  for (const plan of plans) {
    for (const tx of plan.transactions) {
      const result = await sendPlannedSvm(input.rpcUrl, input.signer, tx);
      if (!result.ok) {
        throw new CliError(
          `${tx.what}: ${result.signature} failed: ${result.reason ?? "no reason"}` +
            (sent.length === 0
              ? ""
              : ` (sent so far: ${sent.map((entry) => entry.signature).join(", ")}; what was ` +
                "funded stays in its vault: publish again, or refund it after the reward's " +
                "deadline)"),
        );
      }
      sent.push({
        tx,
        signature: result.signature,
        ...(result.slot === undefined ? {} : { slot: result.slot }),
      });
    }
  }

  return {
    text: [
      ...summary,
      ...sent.flatMap(({ tx, signature, slot }) => [
        `${tx.what}: ${signature}${slot === undefined ? "" : `, slot ${slot}`}`,
        ...linkLines(txLinks(input.chain, signature)),
      ]),
    ].join("\n"),
    json: {
      from,
      portal,
      intents: plans.map(intentJson),
      transactions: sent.map(({ tx, signature, slot }) => ({
        what: tx.what,
        signature,
        ...txLinks(input.chain, signature),
        ...(slot === undefined ? {} : { slot: slot.toString() }),
      })),
    },
    ...(notes.length === 0 ? {} : { notes }),
  };
}
