/**
 * What a command sends before what it was asked to do, approved by its user first — once, for all
 * of it. Today that is the Pot a cook needs when the Pot has no code; a command that needs more set
 * up first (another chain's Pot, a receiver there) adds its {@link SetupStep}s to the same list,
 * and the user is asked one question for every step. `-y`/`--yes` approves them all, saying so for
 * each; with no one to ask (no terminal, or `--json`) nothing is sent, and the refusal names each
 * step. The same steps, unsigned, lead a plan (`sauce tx`, an MCP tool's `transactions`), where
 * there is nothing to ask: the plan is what the user approves.
 *
 * `approveAll` sends nothing: the caller sends each step, in order, once it resolves.
 */
import { formatEther, type Address, type Hex, type PublicClient } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { CliError } from "./args.js";
import type { Sent, TxRequest } from "./chain.js";
import { nativeSymbol } from "../evm/effects.js";

/** Asks a yes/no question at the terminal; `undefined` when there is no terminal to ask on. */
export type Confirm = (question: string) => Promise<boolean | undefined>;

/**
 * Who approves what a command does before what it was asked to: deploying a missing Pot, approving
 * Permit2 for a token, approving the Pot for an amount. The person at the terminal, or `--yes`,
 * which approves everything and says so for each.
 */
export interface Approver {
  /** `--yes` (or `--auto-approve`). */
  readonly auto: boolean;
  /** Whether a question can reach anyone: false with no terminal to ask on, or with `--json`. */
  readonly canAsk: boolean;
  /** Why no question can, when it is not the missing terminal: `--json asks nothing`. */
  readonly why?: string;
  /**
   * Approves `action` (`deploy Pot 0x…`): with `--yes`, says `auto-approved: <action>` and goes
   * ahead; else asks `question`. `undefined` when there is no one to ask.
   */
  readonly approve: (action: string, question: string) => Promise<boolean | undefined>;
}

/**
 * Refuses a command that needs approvals no one can give, before anything is sent: naming every
 * action it would need approved, why it cannot ask (`why`: no terminal by default, or `--json`),
 * and how to approve them.
 */
export function unapproved(
  actions: readonly string[],
  why = "there is no terminal to ask on",
): CliError {
  return new CliError(
    `nothing was sent: this run needs ${actions.length === 1 ? "an approval" : "approvals"}, and ` +
      `${why}:\n` +
      actions.map((action) => `  ${action}\n`).join("") +
      "Pass --yes (-y) to approve them (and --password-file with a keystore).",
  );
}

/** One transaction a command would send first, as its user is asked about it. */
export interface PendingApproval {
  /** What `--yes` reports approving, and a refusal lists: `deploy Pot 0x…`. */
  readonly action: string;
  /** Why it is needed: `Your Pot 0x… on base isn't deployed yet`. */
  readonly reason: string;
  /** What the question offers when it is the only one: `Deploy it now`. */
  readonly offer: string;
  /** What it costs, as a question says it: `about 274,512 gas, ~0.00008 ETH`. */
  readonly estimate: string;
  /** How to do it by hand instead, for a refusal: `deploy it yourself with sauce pot --deploy …`. */
  readonly byHand?: string;
}

/** A transaction a command sends first, once approved: its question, its plan entry, its send. */
export interface SetupStep extends PendingApproval {
  /** The transaction, unsigned, as a plan lists it ahead of the cook: `sauce tx`, an MCP tool. */
  readonly planned: {
    readonly what: string;
    readonly chainId: number;
    readonly to: Address;
    readonly data: Hex;
    /** Wei, a hex quantity: the entry is what a wallet's send tool takes (`handoff.ts`). */
    readonly value: Hex;
    readonly [mark: string]: unknown;
  };
  /** Signs and sends it, and waits until what it makes is there; what was sent. Throws if it
   *  failed, naming what is not there. */
  readonly send: () => Promise<Sent>;
}

/** A chain as a setup step reaches it: a client, and where the command signs, its signer's send. */
export interface ChainReach {
  readonly chain: CanonicalChain;
  readonly client: PublicClient;
  /** Who sends: the signer, or for an unsigned plan the Pot's owner where it is known. */
  readonly from?: Address;
  /** Sends `tx` from the command's signer through `chain.ts#sendAndWait` — the wallet guard and its
   *  policy, a rehearsal first — and waits; only where the command signs (`sauce run`). */
  readonly send?: (tx: TxRequest) => Promise<Sent>;
}

/**
 * What a command's setup steps reach (`RunInput.setup`, `TxInput.setup`): the cook's chain, and any
 * other through the command's own endpoint for it (`--config`, the built-in public ones) and its
 * own signer, so a step opens no transport and touches no key of its own.
 */
export interface SetupReach {
  /** The cook's chain; `undefined` for an unsigned plan built with no endpoint. */
  readonly cook: ChainReach | undefined;
  /** `chain`, the cook's or another. Refuses a chain the command has no endpoint for, and — where
   *  the command signs — a chain the release does not send on. */
  readonly on: (chain: CanonicalChain) => Promise<ChainReach>;
}

/** Finds a chain's endpoint as the command does: `--config`, else a built-in public one. */
export type EndpointOf = (
  chain: CanonicalChain,
) => string | undefined | Promise<string | undefined>;

/** The one question for every step of `pending`, before the command goes on to `then` (`run`). */
export function approvalQuestion(pending: readonly PendingApproval[], then: string): string {
  if (pending.length === 1) {
    const only = pending[0]!;

    return `${only.reason}. ${only.offer} (one transaction, ${only.estimate}), then ${then}? [deploy/cancel] `;
  }

  return [
    `Before it can ${then}, it sends ${pending.length} transactions:`,
    ...pending.map(
      (each, index) => `  ${index + 1}. ${each.reason}: ${each.action} (${each.estimate})`,
    ),
    `Send them, then ${then}? [deploy/cancel] `,
  ].join("\n");
}

/**
 * Approves every step of `pending` at once: with `--yes` each is reported as approved; else one
 * question is asked. Throws, having sent nothing, when no one can be asked or the answer is not
 * yes, naming the steps and how to approve them (or do them by hand).
 */
export async function approveAll(
  approver: Approver,
  pending: readonly PendingApproval[],
  then = "run",
): Promise<void> {
  if (pending.length === 0) return;
  if (approver.auto) {
    for (const each of pending) await approver.approve(each.action, "");

    return;
  }
  if (!approver.canAsk)
    throw unapproved(
      pending.map((each) => each.action),
      approver.why,
    );
  const agreed = await approver.approve(
    pending.map((each) => each.action).join("; "),
    approvalQuestion(pending, then),
  );
  if (agreed === true) return;
  const byHand = pending.flatMap((each) => (each.byHand === undefined ? [] : [each.byHand]));
  throw new CliError(
    `${pending.map((each) => each.reason).join("; ")}, so nothing was sent: ` +
      (agreed === undefined
        ? `pass --yes (-y) to approve ${pending.length === 1 ? "it" : "them"} first`
        : "run again and answer deploy, or pass --yes (-y)") +
      (byHand.length === 0 ? "" : `, or ${byHand.join("; or ")}`),
  );
}

/**
 * What sending `tx` from `from` costs, as a question says it: its gas and, at the current gas price,
 * the native coin; `its gas` where the endpoint cannot estimate it.
 */
export async function gasEstimate(
  client: PublicClient,
  from: Address,
  tx: TxRequest,
  chain: CanonicalChain,
): Promise<string> {
  try {
    const [gas, price] = await Promise.all([
      client.estimateGas({ account: from, to: tx.to, data: tx.data, value: tx.value }),
      client.getGasPrice(),
    ]);

    return `about ${gas.toLocaleString("en-US")} gas, ~${formatEther(gas * price)} ${nativeSymbol(chain)}`;
  } catch {
    return "its gas";
  }
}
