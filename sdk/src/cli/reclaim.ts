/**
 * `sauce reclaim`: the rent a Solana owner left in what Sauce opened for its cooks — the Kitchen code
 * buffers a staged program ran from, and the lookup tables its accounts went through — listed, and
 * closed. A buffer closes with the Kitchen's own close, the owner signing, its rent back at once. A
 * lookup table closes in two steps a cluster keeps apart: deactivated first, then, once the slot it
 * was deactivated in has left the cluster's recent slot hashes (512 slots, about three and a half
 * minutes), closed, its rent back to the owner.
 *
 * The buffers are the owner's CodeBuffer accounts on the Kitchen, found by their discriminator and
 * owner. The tables are the ones whose authority the owner is and which hold the Kitchen's
 * execution-fee config, which every table a cook goes through holds, so a table of the owner's
 * own making is left alone; a table named outright is taken as named. Every transaction is the
 * owner's alone to sign: built here unsigned for any signer, or sent by `sauce reclaim` itself with
 * the owner's key.
 *
 * Nothing in use is closed. A plan hands out its cook as soon as its setup lands, on a blockhash
 * that expires about 150 blocks later; a buffer, or an active table, that a transaction named in
 * the last IN_USE_SLOTS is left open for it. A cook handed out later, for a buffer named longer ago,
 * the cluster cannot show: the plans given to keep, by their cursors, hold theirs open.
 */
import {
  address,
  createSolanaRpc,
  getBase58Decoder,
  getBase64Encoder,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  getAddressLookupTableDecoder,
  getCloseLookupTableInstruction,
  getDeactivateLookupTableInstruction,
} from "@solana-program/address-lookup-table";

import { requireChain } from "../chains/canonical.js";
import { v12SvmKitchenProgramId } from "../deployments/index.js";
import {
  buildCloseCodeBufferInstruction,
  deriveCodePda,
  deriveExecutionFeeConfigPda,
} from "../svm/index.js";
import { CliError, UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { linkLines, txLinks } from "./links.js";
import { sendPlanTx, type SvmSent } from "./solana.js";
import { requireSupported } from "./support.js";
import {
  decodeCursor,
  planBuffer,
  signableTransactions,
  unsignedSigner,
  type PlanTx,
} from "./svm-plan.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

const kitchen = (): Address => address(v12SvmKitchenProgramId());

/** A CodeBuffer account's Anchor discriminator, `sha256("account:CodeBuffer")[..8]`, and its size:
 *  the discriminator, owner, nonce, digest, capacity, len, finalized and two bumps. */
const CODE_BUFFER_DISCRIMINATOR = new Uint8Array([116, 250, 175, 3, 238, 173, 92, 241]);
const CODE_BUFFER_SIZE = 91;
/** How many slots a deactivated table waits before it closes, at the least: the recent slot hashes
 *  a cluster keeps, which must no longer hold its deactivation slot (more, where slots are skipped). */
const TABLE_COOLDOWN_SLOTS = 512n;
/** The sysvar of the recent slot hashes: a u64 count, then each slot (u64) and its hash. */
const SLOT_HASHES = address("SysvarS1otHashes111111111111111111111111111");
/** A table that is not deactivated holds the largest u64 as its deactivation slot. */
const ACTIVE = 2n ** 64n - 1n;
/** Buffers closed in one transaction: three accounts each, well inside its size. */
const CLOSES_PER_TRANSACTION = 6;
/**
 * How long after its last transaction a code buffer or a lookup table is left alone: a cook built
 * for it may still land until its blockhash expires, 150 blocks on, with room for skipped slots.
 * Closed under a cook, the cook fails — it never runs twice — but the plan it belongs to is lost.
 */
const IN_USE_SLOTS = 300n;

/** Whether something is left open, as far as the cluster and the plans given say. */
export interface Use {
  /** Left open: a transaction named it within IN_USE_SLOTS, its history could not be read, or a
   *  plan given to keep holds it. */
  readonly inUse: boolean;
  /** Named lately: the first slot it is left open no more. */
  readonly freeFromSlot?: bigint;
  /** A plan given to keep holds it. */
  readonly kept?: boolean;
}

/** An owner's code buffer, open, and the rent it holds. */
export interface OpenBuffer {
  readonly codeBuffer: Address;
  readonly code: Address;
  readonly nonce: bigint;
  /** The bytes it was made to hold, and those written and sealed, where finalized. */
  readonly capacity: number;
  readonly length: number;
  readonly finalized: boolean;
  /** Both accounts' lamports: what closing it returns. */
  readonly lamports: bigint;
  readonly use: Use;
}

/** One of an owner's lookup tables, and where it is in its close. */
export interface OwnedTable {
  readonly address: Address;
  readonly addresses: number;
  readonly state: "active" | "deactivating" | "closable";
  /** Deactivating: the first slot it can be closed in. */
  readonly closableFromSlot?: bigint;
  readonly lamports: bigint;
  readonly use: Use;
}

export interface Reclaimable {
  readonly buffers: readonly OpenBuffer[];
  readonly tables: readonly OwnedTable[];
  /** No table was named, and the endpoint refused the scan for the owner's: none could be found. */
  readonly scanRefused: boolean;
  readonly slot: bigint;
}

/** An RPC request, failing with what was asked and never the URL (a provider URL holds a key). */
async function ask<T>(url: string, what: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new CliError(`reading ${what} failed: ${message.split(url).join("<RPC_URL>")}`);
  }
}

const bytesOf = (base64: string): Uint8Array => new Uint8Array(getBase64Encoder().encode(base64));

const base58 = (bytes: Uint8Array): string => getBase58Decoder().decode(bytes);
const memcmp = (offset: number, bytes: string) => ({
  memcmp: { offset: BigInt(offset), bytes, encoding: "base58" },
});

/**
 * Whether what `accounts` make up (a code buffer and its code account, a lookup table) is in use at
 * `slot`: named by a transaction within IN_USE_SLOTS, which a cook built then could still follow. A
 * history that cannot be read counts as in use: nothing is closed on a guess.
 */
async function useOf(rpc: Rpc, accounts: readonly Address[], slot: bigint): Promise<Use> {
  try {
    const newest = (
      await Promise.all(
        accounts.map(async (account) =>
          (await rpc.getSignaturesForAddress(account, { limit: 1, commitment: "confirmed" }).send())
            .slice(0, 1)
            .map((one) => BigInt(one.slot)),
        ),
      )
    ).flat();
    if (newest.length === 0) return { inUse: false };
    const free = newest.reduce((a, b) => (b > a ? b : a)) + IN_USE_SLOTS + 1n;

    return slot >= free ? { inUse: false } : { inUse: true, freeFromSlot: free };
  } catch {
    return { inUse: true };
  }
}

/** The slots the cluster's SlotHashes holds; `undefined` where it cannot be read. */
async function recentSlotsOf(rpc: Rpc, url: string): Promise<Set<bigint> | undefined> {
  return ask(url, "the recent slot hashes", () =>
    rpc.getAccountInfo(SLOT_HASHES, { encoding: "base64" }).send(),
  ).then(
    ({ value }) => {
      if (value === null) return undefined;
      const data = bytesOf(value.data[0]);
      const view = new DataView(data.buffer, data.byteOffset);
      const count = Math.min(
        Number(view.getBigUint64(0, true)),
        Math.floor((data.length - 8) / 40),
      );

      return new Set(
        Array.from({ length: count }, (_, index) => view.getBigUint64(8 + index * 40, true)),
      );
    },
    () => undefined,
  );
}

/**
 * What `owner` has open: its code buffers, and its lookup tables — those named, or, with none named,
 * the Sauce tables a scan of the lookup-table program finds (an endpoint may refuse that scan) —
 * each with whether it is in use: named lately, or held by a plan whose accounts are `kept`.
 */
export async function reclaimable(
  rpc: Rpc,
  url: string,
  owner: Address,
  named: readonly Address[] = [],
  kept: ReadonlySet<Address> = new Set(),
): Promise<Reclaimable> {
  // The slot, and the slots a deactivated table may not close in: those its cluster still holds
  // hashes of. Read together.
  const [slot, recentSlots] = await Promise.all([
    ask(url, "the slot", () => rpc.getSlot({ commitment: "confirmed" }).send()),
    recentSlotsOf(rpc, url),
  ]);
  const found = (await ask(url, "the owner's code buffers", () =>
    rpc
      .getProgramAccounts(kitchen(), {
        encoding: "base64",
        filters: [
          { dataSize: BigInt(CODE_BUFFER_SIZE) },
          memcmp(0, base58(CODE_BUFFER_DISCRIMINATOR)),
          memcmp(8, owner),
        ] as never,
      })
      .send(),
  )) as unknown as readonly {
    pubkey: Address;
    account: { data: [string, string]; lamports: bigint | number };
  }[];
  const codes = await Promise.all(
    found.map(async (item) => (await deriveCodePda(kitchen(), item.pubkey)).address),
  );
  const codeAccounts =
    codes.length === 0
      ? []
      : (
          await ask(url, "the code buffers' code accounts", () =>
            rpc.getMultipleAccounts(codes, { encoding: "base64" }).send(),
          )
        ).value;
  const use = (accounts: readonly Address[]): Promise<Use> =>
    accounts.some((account) => kept.has(account))
      ? Promise.resolve({ inUse: true, kept: true })
      : useOf(rpc, accounts, slot);
  const bufferUses = await Promise.all(
    found.map((item, index) => use([item.pubkey, codes[index]!])),
  );
  const buffers = found.map((item, index): OpenBuffer => {
    const data = bytesOf(item.account.data[0]);
    const view = new DataView(data.buffer, data.byteOffset);

    return {
      codeBuffer: item.pubkey,
      code: codes[index]!,
      nonce: view.getBigUint64(40, true),
      capacity: view.getUint32(80, true),
      length: view.getUint32(84, true),
      finalized: data[88] === 1,
      lamports: BigInt(item.account.lamports) + BigInt(codeAccounts[index]?.lamports ?? 0n),
      use: bufferUses[index]!,
    };
  });

  const { address: feeConfig } = await deriveExecutionFeeConfigPda(kitchen());
  let scanRefused = false;
  let raw: readonly { pubkey: Address; data: Uint8Array; lamports: bigint }[];
  if (named.length > 0) {
    const { value } = await ask(url, "the lookup tables named", () =>
      rpc.getMultipleAccounts([...named], { encoding: "base64" }).send(),
    );
    raw = named.flatMap((at, index) => {
      const account = value[index];
      if (account === null || account === undefined) {
        throw new UsageError(`--lookup-table ${at}: there is no such account`);
      }
      if (account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS) {
        throw new UsageError(`--lookup-table ${at}: not an address lookup table`);
      }

      return [{ pubkey: at, data: bytesOf(account.data[0]), lamports: BigInt(account.lamports) }];
    });
  } else {
    // The authority is an Option<Pubkey> at byte 21: its tag 1, then the key.
    raw = await ask(url, "the owner's lookup tables", () =>
      rpc
        .getProgramAccounts(ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS, {
          encoding: "base64",
          filters: [memcmp(21, base58(new Uint8Array([1]))), memcmp(22, owner)] as never,
        })
        .send(),
    ).then(
      (items) =>
        (
          items as unknown as readonly {
            pubkey: Address;
            account: { data: [string, string]; lamports: bigint | number };
          }[]
        ).map((item) => ({
          pubkey: item.pubkey,
          data: bytesOf(item.account.data[0]),
          lamports: BigInt(item.account.lamports),
        })),
      () => {
        scanRefused = true;

        return [];
      },
    );
  }
  const decoder = getAddressLookupTableDecoder();
  const owned = raw.flatMap((item): Array<Omit<OwnedTable, "use">> => {
    const table = decoder.decode(item.data);
    const authority = table.authority.__option === "Some" ? table.authority.value : undefined;
    if (authority !== owner) {
      if (named.length > 0) {
        throw new UsageError(
          `--lookup-table ${item.pubkey}: its authority is ${authority ?? "no one (it is frozen)"}, not ${owner}`,
        );
      }

      return [];
    }
    // A scan finds every table the owner has: Sauce's hold the Kitchen's fee config.
    if (named.length === 0 && !table.addresses.includes(feeConfig)) return [];
    const deactivated = table.deactivationSlot !== ACTIVE;
    const closableFrom = table.deactivationSlot + TABLE_COOLDOWN_SLOTS + 1n;
    // Closable once its deactivation slot has left the recent slot hashes; read where the cluster
    // gives them, else by the count of slots, the soonest it can be.
    const cooled =
      slot > table.deactivationSlot &&
      (recentSlots === undefined ? slot >= closableFrom : !recentSlots.has(table.deactivationSlot));

    return [
      {
        address: item.pubkey,
        addresses: table.addresses.length,
        state: !deactivated ? "active" : cooled ? "closable" : "deactivating",
        ...(deactivated && !cooled
          ? { closableFromSlot: closableFrom > slot ? closableFrom : slot + 1n }
          : {}),
        lamports: item.lamports,
      },
    ];
  });
  // A deactivated table serves cooks until it can close, and takes no more addresses: past any use
  // its close could get in the way of, unless a plan given to keep holds it.
  const tables = await Promise.all(
    owned.map(async (table): Promise<OwnedTable> => ({
      ...table,
      use:
        table.state === "active" || kept.has(table.address)
          ? await use([table.address])
          : { inUse: false },
    })),
  );

  return { buffers, tables, scanRefused, slot };
}

/** The transactions that close what `found` holds, as a plan's step: the buffers not in use, and
 *  the tables not in use as far as each can go now. */
async function closing(
  found: Reclaimable,
  signer: TransactionSigner,
  keepTables: boolean,
): Promise<PlanTx[]> {
  const transactions: PlanTx[] = [];
  const buffers = found.buffers.filter((one) => !one.use.inUse);
  for (let at = 0; at < buffers.length; at += CLOSES_PER_TRANSACTION) {
    const batch = buffers.slice(at, at + CLOSES_PER_TRANSACTION);
    transactions.push({
      what: `closing code buffer${batch.length === 1 ? "" : "s"} ${batch.map((one) => one.codeBuffer).join(", ")}`,
      kind: "close",
      instructions: batch.map((one) =>
        buildCloseCodeBufferInstruction({
          kitchen: kitchen(),
          owner: signer.address,
          codeBuffer: one.codeBuffer,
          code: one.code,
        }),
      ),
    });
  }
  if (keepTables) return transactions;
  for (const table of found.tables) {
    if (table.use.inUse) continue;
    if (table.state === "active") {
      transactions.push({
        what: `deactivating lookup table ${table.address}`,
        kind: "table",
        instructions: [
          getDeactivateLookupTableInstruction({ address: table.address, authority: signer }),
        ],
      });
    } else if (table.state === "closable") {
      transactions.push({
        what: `closing lookup table ${table.address}`,
        kind: "table",
        instructions: [
          getCloseLookupTableInstruction({
            address: table.address,
            authority: signer,
            recipient: signer.address,
          }),
        ],
      });
    }
  }

  return transactions;
}

const useJson = (use: Use) =>
  !use.inUse
    ? {}
    : {
        inUse: true,
        ...(use.freeFromSlot === undefined ? {} : { freeFromSlot: use.freeFromSlot.toString() }),
        ...(use.kept === true ? { kept: true } : {}),
      };

const useText = (use: Use): string =>
  !use.inUse
    ? ""
    : use.kept === true
      ? ", kept for a plan"
      : use.freeFromSlot === undefined
        ? ", left open (its transactions could not be read)"
        : `, in use until slot ${use.freeFromSlot}`;

const sol = (lamports: bigint): string => {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");

  return `${whole}${fraction === "" ? "" : `.${fraction}`} SOL`;
};

export interface ReclaimInput {
  readonly owner: Address;
  readonly rpcUrl: string;
  /** Lookup tables to close, named: else the owner's Sauce tables, scanned for. */
  readonly lookupTables?: readonly Address[];
  /** Close the code buffers only, and leave the lookup tables for later cooks. */
  readonly keepTables?: boolean;
  /** Plans still under way, by their cursors: their code buffers and lookup tables are left open. */
  readonly keep?: readonly string[];
  /** Sends the transactions with the owner's key, once `approve` agrees; else they come back
   *  unsigned. */
  readonly signer?: TransactionSigner;
  readonly approve?: (actions: readonly string[]) => Promise<void>;
}

/** `sauce reclaim`: what the owner has open, and the transactions that close it — or, with the
 *  owner's key, those transactions sent. */
export async function reclaimCommand(input: ReclaimInput): Promise<CommandOutput> {
  const chain = requireChain("solana");
  const rpc = createSolanaRpc(input.rpcUrl);
  const kept = new Set<Address>();
  const plans = (input.keep ?? []).map((cursor) => {
    const plan = decodeCursor(cursor);
    if (plan.owner !== input.owner) {
      throw new UsageError(`a plan to keep is ${plan.owner}'s, not ${input.owner}'s`);
    }

    return plan;
  });
  const buffers = await Promise.all(plans.map((plan) => planBuffer(plan)));
  for (const [index, plan] of plans.entries()) {
    const buffer = buffers[index];
    for (const at of [
      buffer?.codeBuffer,
      buffer?.code,
      plan.table?.address,
      ...plan.lookupTables,
    ]) {
      if (at !== undefined) kept.add(at);
    }
  }
  const found = await reclaimable(rpc, input.rpcUrl, input.owner, input.lookupTables ?? [], kept);
  const signer = input.signer ?? unsignedSigner(input.owner);
  const transactions = await closing(found, signer, input.keepTables === true);
  if (transactions.length > 0) requireSupported("closing what Sauce left open", [chain]);
  const held = (one: { lamports: bigint }) => one.lamports;
  const total = [...found.buffers.map(held), ...found.tables.map(held)].reduce((a, b) => a + b, 0n);
  const waiting = found.tables.filter((table) => table.state === "deactivating");
  const seconds = (slots: bigint): number => Math.ceil(Number(slots) * 0.4);
  const leftOpen = (what: string, use: Use): string[] =>
    !use.inUse
      ? []
      : use.kept === true
        ? [`${what} is left open: a plan given to keep holds it`]
        : use.freeFromSlot === undefined
          ? [`${what} is left open: its transactions could not be read, to tell it is not in use`]
          : [
              `${what} is left open: a transaction named it lately, and a cook built for it may ` +
                `still land; reclaim from slot ${use.freeFromSlot} (now ${found.slot}, about ` +
                `${seconds(use.freeFromSlot - found.slot)}s)`,
            ];
  const notes = [
    ...found.buffers.flatMap((one) => leftOpen(`code buffer ${one.codeBuffer}`, one.use)),
    ...(input.keepTables === true
      ? []
      : found.tables.flatMap((one) => leftOpen(`lookup table ${one.address}`, one.use))),
    ...(!found.scanRefused
      ? []
      : [
          "the endpoint did not scan the lookup-table program, so no table was found: name one " +
            "with --lookup-table <address> (a run prints each table it creates), or use an " +
            "endpoint that answers getProgramAccounts",
        ]),
    ...waiting.map(
      (table) =>
        `lookup table ${table.address} is deactivated and closes from slot ` +
        `${table.closableFromSlot} (now ${found.slot}, about ` +
        `${seconds(table.closableFromSlot! - found.slot)}s): reclaim again then`,
    ),
    ...(input.keepTables === true ||
    found.tables.every((table) => table.state !== "active" || table.use.inUse)
      ? []
      : [
          "a lookup table closes in two transactions: deactivated now, closed about 512 slots " +
            "later (reclaim again then); it serves cooks until then, and none after",
        ]),
  ];
  const listing = {
    chain: chain.slug,
    owner: input.owner,
    buffers: found.buffers.map((one) => ({
      codeBuffer: one.codeBuffer,
      code: one.code,
      nonce: one.nonce.toString(),
      capacity: one.capacity,
      finalized: one.finalized,
      ...(one.finalized ? { length: one.length } : {}),
      lamports: one.lamports.toString(),
      ...useJson(one.use),
    })),
    lookupTables: found.tables.map((one) => ({
      address: one.address,
      addresses: one.addresses,
      state: one.state,
      ...(one.closableFromSlot === undefined
        ? {}
        : { closableFromSlot: one.closableFromSlot.toString() }),
      lamports: one.lamports.toString(),
      ...useJson(one.use),
    })),
    lamports: total.toString(),
  };
  const lines = [
    `${input.owner} has ${found.buffers.length} code buffer${found.buffers.length === 1 ? "" : "s"} ` +
      `and ${found.tables.length} Sauce lookup table${found.tables.length === 1 ? "" : "s"} open, ` +
      `holding ${sol(total)} in rent`,
    ...found.buffers.map(
      (one) =>
        `  code buffer ${one.codeBuffer}: ${one.finalized ? `${one.length} bytes, finalized` : `${one.capacity} bytes, not finalized`}, ${sol(one.lamports)}${useText(one.use)}`,
    ),
    ...found.tables.map(
      (one) =>
        `  lookup table ${one.address}: ${one.addresses} addresses, ${one.state}, ${sol(one.lamports)}${useText(one.use)}`,
    ),
  ];
  if (input.signer === undefined || transactions.length === 0) {
    const built = await signableTransactions(transactions, { rpc, url: input.rpcUrl, signer });
    const json = {
      ...listing,
      transactions: built.transactions,
      ...(built.lastValidBlockHeight === undefined
        ? {}
        : { expiresAtBlockHeight: built.lastValidBlockHeight.toString() }),
    };

    return {
      text:
        input.signer === undefined && transactions.length > 0
          ? JSON.stringify(json, null, 2)
          : lines.join("\n"),
      json,
      notes: [
        ...notes,
        ...(transactions.length === 0
          ? ["there is nothing to close now"]
          : [
              `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}, base64 ` +
                `and signed by no one: ${input.owner} signs each (on one blockhash that expires ` +
                "in about a minute) and sends them, with sauce send",
            ]),
      ],
    };
  }
  await input.approve?.(transactions.map((tx) => tx.what));
  const ctx = { rpc, url: input.rpcUrl, signer: input.signer };
  // Each closes something of its own: one that fails, or is refused, leaves the others to go.
  const sent: Array<{ tx: PlanTx; sent?: SvmSent; refused?: string }> = [];
  for (const tx of transactions) {
    try {
      sent.push({ tx, sent: await sendPlanTx(ctx, tx) });
    } catch (error) {
      sent.push({ tx, refused: (error as Error).message.split("\n")[0]! });
    }
  }
  const failed = sent.find((one) => one.sent?.ok !== true);

  return {
    text: [
      ...lines,
      ...sent.flatMap(({ tx, sent: one, refused }) =>
        one === undefined
          ? [`${tx.what}: not sent, ${refused}`]
          : [
              `${tx.what} ${one.signature}: ${one.ok ? "success" : "failed"}` +
                (one.reason === undefined ? "" : `, ${one.reason}`),
              ...linkLines(txLinks(chain, one.signature)),
            ],
      ),
    ].join("\n"),
    json: {
      ...listing,
      sent: sent.map(({ tx, sent: one, refused }) =>
        one === undefined
          ? { what: tx.what, hash: "", status: "failed", reason: `not sent: ${refused}` }
          : {
              what: tx.what,
              hash: one.signature,
              ...txLinks(chain, one.signature),
              status: one.ok ? "success" : "failed",
              ...(one.reason === undefined ? {} : { reason: one.reason }),
            },
      ),
    },
    notes,
    ...(failed === undefined ? {} : { exitCode: 1 }),
  };
}
