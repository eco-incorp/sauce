/**
 * What the `sauce` command keeps of the transactions it sends: the hook every store it keeps
 * attaches to — the Pot store (`pot-store.ts`) and the intent store (`store.ts`), and beside them
 * any other store a landed transaction feeds.
 *
 * The two places every send lands — `chain.ts#landed`, which every EVM transaction the command
 * sends or broadcasts passes, and `solana.ts#svmLanded`, every Solana one — hand each landed
 * transaction to {@link keepLanded}, which gives it to each store of the scope it runs in. A
 * store's part reads what it keeps from the transaction itself (its logs, its instructions),
 * writes it, and says so; a part that fails is said as a warning and never thrown: what was sent
 * stands.
 *
 * A scope is set by whoever keeps the stores, on the command's own directories: `run.ts#runCli`
 * for the command it runs, and the LOCAL MCP server (over stdio) for each tool call
 * (`mcp/src/tools.ts`), so an agent with only the server keeps what the command would. Nothing
 * else sets one, so a send outside a scope — the HTTP server, a test — keeps nothing. Each scope
 * is its call's own (`AsyncLocalStorage`), so two at once in one process keep apart.
 *
 * NODE-ONLY, like the rest of `cli/`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { Address, PublicClient } from "viem";

import type { Sent } from "./chain.js";
import { keepIntents } from "./intent-keep.js";
import type { IntentRecord } from "./lifecycle.js";
import type { PotStore } from "./pot-store.js";
import { keepPots, type InnerInstructions } from "./pots.js";
import type { SvmSent } from "./solana.js";
import type { IntentStore } from "./store.js";

/** A transaction that landed, as a store reads what it keeps of it. */
export type Landed =
  | {
      readonly kind: "evm";
      /** The endpoint that served its receipt. */
      readonly client: PublicClient;
      readonly sent: Sent;
      /** Its sender. */
      readonly from: Address;
    }
  | {
      readonly kind: "svm";
      readonly sent: SvmSent;
      /** The transaction, base64, as the cluster returned it; absent where the node did not. */
      readonly transaction?: string;
      /** The accounts it loaded through lookup tables, as the node reports them. */
      readonly loaded?: {
        readonly writable: readonly string[];
        readonly readonly: readonly string[];
      };
      /** The instructions its programs invoked, as the node reports them. */
      readonly inner?: InnerInstructions;
    };

/** The stores a scope keeps, each in the command's own directory; one absent is not kept. */
export interface LocalStores {
  /** Every Pot a transaction deploys. */
  readonly pots?: PotStore;
  /** Every intent a transaction publishes, and what one does to an intent the store holds or
   *  knows ({@link knowIntents}): filled, proving, claimed, refunded, cancelled. */
  readonly intents?: IntentStore;
}

/** A scope: what it keeps, and where it says what it kept. */
export interface Keeping {
  readonly stores: LocalStores;
  /** The command's stderr, or a tool result's notes. */
  readonly say: (line: string) => void;
}

const scopes = new AsyncLocalStorage<Keeping>();

/** Runs `run` with every transaction it lands kept in `keeping`'s stores. */
export const keeping = <T>(keeping: Keeping, run: () => Promise<T>): Promise<T> =>
  scopes.run(keeping, run);

/** Whether `stores` keeps anything at all. */
export const keepsAny = (stores: LocalStores): boolean =>
  Object.values(stores).some((store) => store !== undefined);

/** Says `line` where the scope says what it kept: a warning of what could not be kept, say. */
export function sayKept(line: string): void {
  scopes.getStore()?.say(line);
}

/**
 * Tells the scope's intent store of intents the command or tool is acting on, which it may not
 * hold yet — named by a file, a record or a transaction — so a transaction that lands an event of
 * one records it (`store.ts#IntentStore.know`). Outside a scope that keeps intents, nothing.
 */
export function knowIntents(records: readonly IntentRecord[]): void {
  scopes.getStore()?.stores.intents?.know(records);
}

/** Hands `landed` to each store of the scope it runs in, which says what it kept. */
export async function keepLanded(landed: Landed): Promise<void> {
  const scope = scopes.getStore();
  if (scope === undefined) return;
  const { pots, intents } = scope.stores;
  const parts: ReadonlyArray<
    readonly [string, () => readonly string[] | Promise<readonly string[]>]
  > = [
    ...(pots === undefined ? [] : [[pots.dir, () => keepPots(pots, landed)] as const]),
    ...(intents === undefined ? [] : [[intents.dir, () => keepIntents(intents, landed)] as const]),
  ];
  for (const [dir, part] of parts) {
    try {
      for (const line of await part()) scope.say(line);
    } catch (error) {
      const tx = landed.kind === "evm" ? landed.sent.hash : landed.sent.signature;
      scope.say(
        `warning: what ${tx} did was not kept in ${dir}: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}
