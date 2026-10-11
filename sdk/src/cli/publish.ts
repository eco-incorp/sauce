/**
 * `sauce intent publish <file>`: the file cooked on the signer's own Pot, which publishes the
 * intents it opens. Every publish is a cook: an intent is `@sauce/hop`'s classes, built while the
 * file compiles and encoded as the program runs, so there is no intent to send from a wallet
 * without running it, and no second encoder to build one with.
 *
 * The reward reaches the Pot through `--fund` (`funding.ts`): the program is wrapped to pull each
 * amount from the signer first, then each intent pays its reward from the Pot into its vault (or
 * through `publishAndFund`, `--intent-fund-via`). Each intent's hash and record come from the
 * Portal's `IntentPublished`: the rehearsal's logs for `--dry-run`, the receipt's once it is sent,
 * which the store keeps (`run.ts#storing`).
 *
 * So the command is `sauce run` (send), `sauce simulate` (`--dry-run`) and `sauce tx` (`--format`)
 * on the signer's Pot, for a file that opens at least one intent.
 */
import type { PrivateKeyAccount } from "viem/accounts";

import type { EndpointOf } from "./approvals.js";
import { CliError, UsageError } from "./args.js";
import type { Sent } from "./chain.js";
import {
  priceLimitNotes,
  probeProgram,
  refusePastDeadline,
  runCommand,
  txCommand,
  type Approver,
  type CliFiles,
  type CommandOutput,
  type CookInput,
} from "./commands.js";
import type { FundRequest } from "./funding.js";
import { simulateCommand } from "./simulate.js";

export interface PublishInput extends CookInput {
  /** Print the unsigned cook, in this format, instead of sending it. */
  readonly format?: "json" | "cast";
  /** Rehearse the cook from the Pot's owner, and send nothing. */
  readonly dryRun: boolean;
  readonly rpcUrl?: string;
  /** The signer, which owns the Pot and sends the cook. */
  readonly account?: PrivateKeyAccount;
  /** Who approves what the cook needs sent first: the Pot's deployment, `--fund`'s approvals. */
  readonly approver?: Approver;
  /** Another chain's endpoint, for what the cook needs sent first there (as `sauce run` has it). */
  readonly endpointOf?: EndpointOf;
  /** `--assume-balance`, with a dry run: what the Pot holds, for the rehearsal only. */
  readonly assume?: readonly FundRequest[];
  /** Called with the cook once it is sent, for what it published (the store); returns notes. */
  readonly onSent?: (sent: Sent) => Promise<readonly string[]>;
}

/** `sauce intent publish <file>`: rehearse, print or send the cook that publishes its intents. */
export async function publishCommand(input: PublishInput, files: CliFiles): Promise<CommandOutput> {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce intent publish cooks the file on ${input.chain.slug}, and the eco-routes Portal this ` +
        "SDK publishes through is EVM only. Publishing from Solana is not supported: open the " +
        "intent from an EVM chain; its destination may be Solana.",
    );
  }
  // What no funding path can fix, refused or named first, for every front end: a deadline that has
  // passed, and a price limit at a bound, which fills nothing on the destination.
  refusePastDeadline(input);
  const probe = probeProgram(input, files);
  if (probe.bodies.length === 0) {
    throw new UsageError(
      `${input.file} opens no intent — there is nothing to publish. Run it on a Pot with ` +
        "`sauce run` instead.",
    );
  }
  const limits = priceLimitNotes(input, probe.entryParams, input.args);
  const noted = (output: CommandOutput): CommandOutput =>
    limits.length === 0 ? output : { ...output, notes: [...limits, ...(output.notes ?? [])] };
  if (input.format !== undefined) {
    if (input.fund !== undefined) {
      throw new UsageError(
        "--fund pulls the reward into the Pot with what it signs or sends first, and --format " +
          "prints only the cook: fund the Pot yourself, or publish with a signer",
      );
    }

    return noted(await txCommand(input, files));
  }
  if (input.rpcUrl === undefined) {
    throw new UsageError(
      "missing --rpc-url <url> (or --config <file>): the source chain's endpoint",
    );
  }
  if (input.dryRun) {
    const output = await simulateCommand(
      { ...input, rpcUrl: input.rpcUrl, assume: input.assume ?? [] },
      files,
    );
    const published = (output.json as { intents?: unknown[] }).intents ?? [];
    if (output.exitCode === undefined && published.length === 0) {
      return noted({
        ...output,
        notes: [
          ...(output.notes ?? []),
          "The rehearsal shows no intent published: the endpoint returned no logs (no " +
            "eth_simulateV1), so the intents' hashes are not known until it is sent.",
        ],
      });
    }

    return noted(
      published.length === 0
        ? output
        : {
            ...output,
            notes: [
              ...(output.notes ?? []),
              "A preview: each hash is the rehearsal's. Published, an intent has its own, from " +
                "the salt and deadlines picked when it is sent; read it from the receipt.",
            ],
          },
    );
  }
  if (input.account === undefined || input.approver === undefined) {
    throw new UsageError(
      "missing a signer to publish from: --wallet <name>, --keystore <path> or --private-key " +
        "<hex> (or rehearse with --dry-run, or print the unsigned cook with --format json)",
    );
  }
  const output = await runCommand(
    {
      ...input,
      rpcUrl: input.rpcUrl,
      account: input.account,
      approver: input.approver,
      ...(input.onSent === undefined ? {} : { onSent: input.onSent }),
    },
    files,
  );
  const published = (output.json as { intents?: unknown[] }).intents ?? [];
  if (output.exitCode === undefined && published.length === 0) {
    throw new CliError(
      `the cook landed and published no intent: ${JSON.stringify(output.json.cook ?? {})}`,
    );
  }

  return noted(output);
}
