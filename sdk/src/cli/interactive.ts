/**
 * `sauce intent` at a terminal: a picker over the intents the store keeps, each with where it
 * stands (read live where an endpoint is given), then a menu of what to do with the one picked —
 * its status, the fill (rehearsed, or sent with a signer), the proof, the claim, the refund, the
 * cancellation. Every action runs the very function its own command runs (`intent-commands.ts`,
 * `fill.ts`), with the same approvals, so nothing here decides anything a flag would not.
 */
import { requireChain } from "../chains/canonical.js";
import type { CommandOutput } from "./commands.js";
import { fillCommand } from "./fill.js";
import {
  cancelCommand,
  claimCommand,
  proveCommand,
  refundCommand,
  showCommand,
  type LifecycleContext,
  type Target,
} from "./intent-commands.js";
import { intentOf, intentStatus, type IntentStatus } from "./lifecycle.js";
import { askChoice, type Ask } from "./prompt.js";

/** Where the picker writes. */
export interface InteractiveIo {
  readonly ask: Ask;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

type Action =
  "status" | "fill" | "send-fill" | "prove" | "claim" | "refund" | "cancel" | "back" | "quit";

const iso = (seconds: string): string => new Date(Number(seconds) * 1000).toISOString();

/** Prints a command's output the way `runCli` does: notes to stderr, the result to stdout. */
function print(io: InteractiveIo, output: CommandOutput): void {
  for (const note of output.notes ?? []) io.stderr(`${note}\n`);
  io.stdout(`${output.text}\n`);
}

/** The live status of `target`: `undefined` where no endpoint reads it, and why not where a
 *  read failed. */
type Read = { readonly status?: IntentStatus; readonly failed?: string };

async function statusOf(target: Target, context: LifecycleContext): Promise<Read> {
  const endpoints: Record<string, string> = {};
  for (const id of [target.record.source.chainId, target.record.destination.chainId]) {
    const url = context.endpoint(requireChain(id));
    if (url !== undefined) endpoints[String(id)] = url;
  }
  if (Object.keys(endpoints).length === 0) return {};
  try {
    return { status: await intentStatus(target.record, endpoints) };
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) };
  }
}

/** The actions after which the menu keeps the status it read: a rehearsed fill sends nothing.
 *  `status` is asked for to see the chain as it is now, so the menu reads it again after one. */
const READ_ONLY: ReadonlySet<Action> = new Set(["fill"]);

/** The picker, then the menu for the intent picked, until the person quits. */
export async function interactiveIntents(
  io: InteractiveIo,
  context: LifecycleContext,
): Promise<number> {
  for (;;) {
    const { intents: stored, warnings } = context.store.list();
    for (const warning of warnings) io.stderr(`${warning}\n`);
    if (stored.length === 0) {
      io.stdout(`No intents in ${context.store.dir}. Import one (\`sauce intent import\`).\n`);

      return 0;
    }
    const rows = await Promise.all(
      stored.map(async (entry) => ({
        target: { record: entry.record, stored: entry } as Target,
        read: await statusOf({ record: entry.record, stored: entry }, context),
      })),
    );
    const picked = await askChoice(io.ask, "Intents:", [
      ...rows.map(({ target, read }) => ({
        label:
          `${target.record.intentHash.slice(0, 18)}…  ${target.record.source.chain} -> ` +
          `${target.record.destination.chain}  ` +
          `${read.status?.state ?? (read.failed === undefined ? (target.stored?.events.at(-1)?.event ?? "stored") : "not read")}` +
          `  fill by ${iso(target.record.route.deadline)}`,
        value: { target, read } as const,
      })),
      { label: "quit", value: undefined },
    ]);
    if (picked === undefined) return 0;
    const leave = await menu(io, context, picked.target, picked.read);
    if (leave) return 0;
  }
}

/** The menu for one intent, starting from the status the picker read; `true` when the person
 *  quits. The status is read again after an action that sends something, and only then. */
async function menu(
  io: InteractiveIo,
  context: LifecycleContext,
  target: Target,
  read: Read,
): Promise<boolean> {
  for (;;) {
    if (read.failed !== undefined) io.stderr(`its status could not be read: ${read.failed}\n`);
    const status = read.status;
    const can = status?.can;
    const mark = (ok: boolean | undefined, why: string | undefined): string =>
      ok === undefined ? "" : ok ? "" : ` (not now: ${why})`;
    const choices: Array<{ label: string; value: Action }> = [
      { label: "status", value: "status" },
      { label: `fill, rehearsed${mark(can?.fill.ok, can?.fill.why)}`, value: "fill" },
      ...(context.account === undefined
        ? []
        : [
            {
              label: `fill, and send it${mark(can?.fill.ok, can?.fill.why)}`,
              value: "send-fill" as const,
            },
          ]),
      { label: `prove${mark(can?.prove.ok, can?.prove.why)}`, value: "prove" },
      { label: `claim${mark(can?.claim.ok, can?.claim.why)}`, value: "claim" },
      { label: `refund${mark(can?.refund.ok, can?.refund.why)}`, value: "refund" },
      { label: `cancel${mark(can?.cancel.ok, can?.cancel.why)}`, value: "cancel" },
      { label: "back to the list", value: "back" },
      { label: "quit", value: "quit" },
    ];
    const action = await askChoice(
      io.ask,
      `${target.record.intentHash} (${status?.state ?? "not read"}):`,
      choices,
    );
    if (action === undefined || action === "quit") return true;
    if (action === "back") return false;
    try {
      print(io, await run(action, target, context));
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (READ_ONLY.has(action)) continue;
    // The store may hold new events for it now, and the chain a new state.
    if (context.store.has(target.record.intentHash)) {
      target = { record: target.record, stored: context.store.load(target.record.intentHash) };
    }
    read = await statusOf(target, context);
  }
}

function run(action: Action, target: Target, context: LifecycleContext): Promise<CommandOutput> {
  switch (action) {
    case "status":
      return showCommand(target, context);
    case "fill":
    case "send-fill": {
      const intent = intentOf(target.record);
      const source = requireChain(target.record.source.chainId);
      const destination = requireChain(target.record.destination.chainId);

      return fillCommand({
        intents: [{ intent, source, destination, sourcePortal: target.record.source.portal }],
        from: target.record.intentHash,
        labels: [],
        endpointOf: (chain) => {
          const url = context.endpoint(chain);
          if (url === undefined) throw new Error(`a fill needs ${chain.slug}'s endpoint`);

          return url;
        },
        sourceEndpointOf: (chain) => context.endpoint(chain),
        endpointFlag: "--config",
        ...(action === "send-fill" && context.account !== undefined
          ? {
              send: {
                account: context.account,
                approver: context.approver,
                store: context.store,
              },
            }
          : {}),
      });
    }
    case "prove":
      return proveCommand([target], context);
    case "claim":
      return claimCommand([target], context);
    case "refund":
      return refundCommand([target], context);
    case "cancel":
      return cancelCommand([target], context, { prove: false });
    default:
      throw new Error(`internal: no action ${action}`);
  }
}
