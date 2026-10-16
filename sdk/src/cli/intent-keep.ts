/**
 * What the intent store keeps of a landed transaction (`keep.ts`): every intent it published, and
 * what it did to an intent the store holds or knows (`store.ts#IntentStore.know`) — filled,
 * proving, claimed, refunded, cancelled.
 *
 * Read from the chain's own evidence, never from what the command meant to send, so the two places
 * every send lands (`chain.ts#landed`, `solana.ts#svmLanded`) keep it whatever sent the
 * transaction: `sauce run`, `sauce intent publish`, `fill`, `prove`, `claim`, `refund`, `cancel`,
 * `sauce send`, and the local MCP server's `sauce_send` and `sauce_wallet_send`.
 *
 *  - On an EVM chain, a receipt that succeeded: each `IntentPublished` rebuilt and stored
 *    (`lifecycle.ts#publishedIntents`, with `funded` where the same transaction funded it), and the
 *    Portal's `IntentFulfilled` (filled), `IntentProven` (proving, once per Hyperlane message the
 *    transaction dispatched), `IntentWithdrawn` (claimed), `IntentRefunded` (refunded) and
 *    `IntentCancelled` (cancelled), each decoded strictly with the registry's declaration and
 *    counted only when the Portal that emitted it is the intent's own on that side: the
 *    destination's for a fill, a proof or a cancellation, the source's for a claim or a refund.
 *  - On Solana, a transaction that succeeded: the Portal's `fulfill`, `prove` and `cancel`
 *    instructions it carries or a program of it invoked, each counted only when the program is the
 *    intent's destination Portal, with the Hyperlane message its Mailbox logged. An intent's hash
 *    commits to its chains and its route's Portal, so it needs no cluster of its own.
 *
 * An intent the store neither holds nor knows is left alone: its record is not in the logs.
 */
import {
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import {
  bytesToHex,
  decodeEventLog,
  getAddress,
  toEventSelector,
  type AbiEvent,
  type Hex,
} from "viem";

import { requireChain, resolveChain, type CanonicalChain } from "../chains/canonical.js";
import { PortalABI } from "../protocols/eco-routes/abis.js";
import { PORTAL_DISCRIMINATORS, svmKeyOf } from "../svm/portal.js";
import type { Landed } from "./keep.js";
import { dispatchedMessages, publishedIntents, type IntentRecord } from "./lifecycle.js";
import type { IntentStore, StoreEvent, StoreEventName } from "./store.js";

/** The Portal's events a landed transaction moves an intent on by, and the side that emits each. */
const PORTAL_EVENTS = {
  IntentFulfilled: { event: "filled", side: "destination" },
  IntentProven: { event: "proving", side: "destination" },
  IntentCancelled: { event: "cancelled", side: "destination" },
  IntentWithdrawn: { event: "claimed", side: "source" },
  IntentRefunded: { event: "refunded", side: "source" },
} as const satisfies Record<
  string,
  { readonly event: StoreEventName; readonly side: "source" | "destination" }
>;
type PortalEvent = keyof typeof PORTAL_EVENTS;

const topicOf = (name: string): Hex =>
  toEventSelector(
    PortalABI.find(
      (item): item is AbiEvent & typeof item => item.type === "event" && item.name === name,
    )!,
  );

const LIFECYCLE_TOPICS = new Map<string, PortalEvent>(
  (Object.keys(PORTAL_EVENTS) as PortalEvent[]).map((name) => [topicOf(name), name]),
);
const PUBLISHED_TOPIC = topicOf("IntentPublished");

/** The Hyperlane message a Solana Mailbox logged dispatching. */
const DISPATCHED = /Dispatched message to \d+, ID (0x[0-9a-f]{64})/;

/** What happened to one intent in one transaction, in the order it happened. */
interface Happened {
  readonly record: IntentRecord;
  readonly events: StoreEventName[];
}

/** Where a transaction landed, as each event of it records. */
type Where = Pick<StoreEvent, "chain" | "chainId" | "tx" | "block" | "time" | "from">;

/** Appends what `happened` in the transaction `where` names, saving each record the store lacks;
 *  one line per intent. */
function append(
  store: IntentStore,
  happened: ReadonlyMap<string, Happened>,
  where: Where,
  messages: readonly Hex[],
): string[] {
  return [...happened.values()].map(({ record, events }) => {
    store.save(record);
    for (const event of events) {
      if (event === "proving" && messages.length > 0) {
        for (const message of messages)
          store.append(record.intentHash, { event, ...where, message });
      } else {
        store.append(record.intentHash, { event, ...where });
      }
    }

    return `intent ${record.intentHash}: ${events.join(", ")}, recorded in ${store.dir}`;
  });
}

/** Notes `event` of `intentHash` in `happened`, when the store holds or knows it and `emitter` is
 *  its Portal on `chain`, on the side the event belongs to. */
function noted(
  happened: Map<string, Happened>,
  store: IntentStore,
  intentHash: Hex,
  event: StoreEventName,
  side: "source" | "destination",
  chain: CanonicalChain,
  isPortal: (portal: Hex) => boolean,
): void {
  const record = store.recall(intentHash);
  if (record === undefined) return;
  const at = record[side];
  if (at.chainId !== chain.id || !isPortal(at.portal)) return;
  const key = record.intentHash.toLowerCase();
  const entry = happened.get(key) ?? { record, events: [] };
  if (!entry.events.includes(event)) entry.events.push(event);
  happened.set(key, entry);
}

async function keepEvm(
  store: IntentStore,
  landed: Extract<Landed, { kind: "evm" }>,
): Promise<string[]> {
  const { client, sent, from } = landed;
  if (sent.status !== "success") return [];
  const watched = (topic: Hex | undefined): boolean =>
    topic !== undefined &&
    (topic.toLowerCase() === PUBLISHED_TOPIC || LIFECYCLE_TOPICS.has(topic.toLowerCase()));
  if (!sent.logs.some((log) => watched(log.topics[0]))) return [];
  const chainId = await client.getChainId();
  const chain = resolveChain(chainId);
  if (chain === undefined) throw new Error(`chain ${chainId} is not one the SDK knows`);
  const at = { chain: chain.slug, chainId: chain.id, tx: sent.hash, from } as const;
  const lines: string[] = [];

  for (const published of await publishedIntents(client, chain, sent.logs, {
    txHash: sent.hash,
    blockNumber: sent.blockNumber,
  })) {
    const { record } = published;
    store.save(record);
    const where = {
      ...at,
      block: published.block,
      time: new Date(Number(published.time) * 1000).toISOString(),
    };
    store.append(record.intentHash, { event: "published", ...where });
    if (published.funded) store.append(record.intentHash, { event: "funded", ...where });
    lines.push(`stored intent ${record.intentHash} in ${store.dir}`);
  }

  const happened = new Map<string, Happened>();
  for (const log of sent.logs) {
    const name = LIFECYCLE_TOPICS.get(log.topics[0]?.toLowerCase() ?? "");
    if (name === undefined) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: PortalABI,
        eventName: name,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      });
    } catch {
      continue;
    }
    const { event, side } = PORTAL_EVENTS[name];
    const emitter = getAddress(log.address);
    noted(
      happened,
      store,
      (decoded.args as { intentHash: Hex }).intentHash,
      event,
      side,
      chain,
      (portal) => portal.toLowerCase() === emitter.toLowerCase(),
    );
  }
  if (happened.size === 0) return lines;
  const block = await client.getBlock({ blockNumber: sent.blockNumber });
  const where = {
    ...at,
    block: sent.blockNumber.toString(),
    time: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
  const messages = dispatchedMessages(sent.logs).map((message) => message.id);

  return [...lines, ...append(store, happened, where, messages)];
}

/** The intent hashes a Solana Portal instruction acts on, and what it does to them. */
function portalInstruction(
  data: Uint8Array,
): { readonly event: StoreEventName; readonly hashes: readonly Hex[] } | undefined {
  const is = (head: Uint8Array): boolean =>
    data.length >= head.length && head.every((byte, index) => data[index] === byte);
  const hashAt = (offset: number): Hex | undefined =>
    data.length >= offset + 32 ? bytesToHex(data.subarray(offset, offset + 32)) : undefined;
  if (is(PORTAL_DISCRIMINATORS.fulfill) || is(PORTAL_DISCRIMINATORS.cancel)) {
    const hash = hashAt(8);
    if (hash === undefined) return undefined;

    return { event: is(PORTAL_DISCRIMINATORS.fulfill) ? "filled" : "cancelled", hashes: [hash] };
  }
  if (is(PORTAL_DISCRIMINATORS.prove)) {
    // The prover (32 bytes) and the source's domain (a u64), then the hashes: a u32 count, each 32.
    const count = 8 + 32 + 8;
    if (data.length < count + 4) return undefined;
    const length = new DataView(data.buffer, data.byteOffset + count, 4).getUint32(0, true);
    const hashes: Hex[] = [];
    for (let index = 0; index < length; index++) {
      const hash = hashAt(count + 4 + 32 * index);
      if (hash === undefined) return undefined;
      hashes.push(hash);
    }

    return { event: "proving", hashes };
  }

  return undefined;
}

function keepSvm(store: IntentStore, landed: Extract<Landed, { kind: "svm" }>): string[] {
  const { sent, transaction } = landed;
  if (!sent.ok || transaction === undefined) return [];
  const decoded = getTransactionDecoder().decode(
    new Uint8Array(getBase64Encoder().encode(transaction)),
  );
  const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes) as {
    readonly staticAccounts: readonly string[];
    readonly instructions: ReadonlyArray<{
      readonly programAddressIndex: number;
      readonly data?: Uint8Array;
    }>;
  };
  const accounts = [
    ...message.staticAccounts,
    ...(landed.loaded?.writable ?? []),
    ...(landed.loaded?.readonly ?? []),
  ];
  // Its own instructions, and those a program invoked: a fill another program makes through the
  // Portal is the Portal's fill all the same.
  const base58 = getBase58Encoder();
  const invoked = [
    ...message.instructions,
    ...(landed.inner ?? []).flatMap((group) =>
      group.instructions.map((instruction) => ({
        programAddressIndex: instruction.programIdIndex,
        data: new Uint8Array(base58.encode(instruction.data)),
      })),
    ),
  ];
  const chain = requireChain("solana");
  const happened = new Map<string, Happened>();
  for (const instruction of invoked) {
    const program = accounts[instruction.programAddressIndex];
    const acted = portalInstruction(instruction.data ?? new Uint8Array());
    if (program === undefined || acted === undefined) continue;
    for (const hash of acted.hashes) {
      noted(
        happened,
        store,
        hash,
        acted.event,
        "destination",
        chain,
        (portal) => svmKeyOf(portal) === program,
      );
    }
  }
  if (happened.size === 0) return [];
  const messages = sent.logs.flatMap((line) => {
    const found = DISPATCHED.exec(line);

    return found === null ? [] : [found[1] as Hex];
  });

  return append(
    store,
    happened,
    {
      chain: chain.slug,
      chainId: chain.id,
      tx: sent.signature,
      block: (sent.slot ?? 0n).toString(),
      time: new Date().toISOString(),
      ...(message.staticAccounts[0] === undefined ? {} : { from: message.staticAccounts[0] }),
    },
    messages,
  );
}

/** What `landed` did to intents, kept in `store`: the lines that say so. */
export async function keepIntents(store: IntentStore, landed: Landed): Promise<string[]> {
  return landed.kind === "evm" ? keepEvm(store, landed) : keepSvm(store, landed);
}
