/**
 * `sauce reclaim`'s reading of what an owner left open, offline, against an endpoint that answers
 * what each test chooses: lookup tables named outright — taken as named, and refused by name where
 * there is no such account, it is no lookup table, or the owner is not its authority — an endpoint
 * that refuses to scan the lookup-table program, a cluster whose recent slot hashes cannot be read
 * (a deactivated table then closes by the count of slots), the slot and those hashes read together,
 * a plan to keep that is another owner's, or a file that holds none, and tables a plan given to keep
 * holds, deactivated or closable — kept, nothing built for them, said so — and an owner with more
 * open than one run handles: the histories read a few at a time, a run's share taken (the tables it
 * can act on first) and the rest said to remain; and histories the endpoint cannot read, whose
 * buffers and tables are kept as in use and said so, in one note, never naming the endpoint.
 * Closing on a cluster is `cli-reclaim.e2e.test.ts`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBase58Decoder, type Address } from "@solana/kit";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  getAddressLookupTableEncoder,
} from "@solana-program/address-lookup-table";

import { requireChain } from "../src/chains/canonical.js";
import { UsageError } from "../src/cli/args.js";
import { reclaimable, reclaimCommand } from "../src/cli/reclaim.js";
import { encodeCursor } from "../src/cli/svm-plan.js";
import { v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { deriveExecutionFeeConfigPda } from "../src/svm/index.js";
import { sauce } from "./cli-anvil.js";
import { releasedProgramAccounts, type RpcAccount } from "./svm/release-accounts.js";

const key = (fill: number): Address =>
  getBase58Decoder().decode(new Uint8Array(32).fill(fill)) as Address;
const OWNER = key(7);
const OTHER = key(8);
const TABLE = key(9);
const URL = "http://endpoint.invalid/secret-key";
const SOLANA = requireChain("solana");
const SLOT_HASHES = "SysvarS1otHashes111111111111111111111111111";
const ACTIVE = 2n ** 64n - 1n;

type Handler = (...params: never[]) => unknown;
type Rpc = Parameters<typeof reclaimable>[0];

/** An endpoint answering each method with its handler, and refusing any other by name. */
function endpoint(handlers: Record<string, Handler>): Rpc {
  return new Proxy(
    {},
    {
      get:
        (_, method: string) =>
        (...params: never[]) => ({
          send: async () => {
            const handler = handlers[method];
            if (handler === undefined)
              throw new Error(`the endpoint was not to be asked ${method}`);

            return handler(...params);
          },
        }),
    },
  ) as Rpc;
}

/** A lookup table's account: `authority` (none when frozen), deactivated at `deactivationSlot`. */
const tableAccount = (
  authority: Address | null,
  addresses: readonly Address[],
  deactivationSlot = ACTIVE,
  owner: string = ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
) => ({
  data: [
    Buffer.from(
      getAddressLookupTableEncoder().encode({
        deactivationSlot,
        lastExtendedSlot: 10n,
        lastExtendedSlotStartIndex: 0,
        authority,
        addresses: [...addresses],
      }),
    ).toString("base64"),
    "base64",
  ],
  executable: false,
  lamports: 1_000_000n,
  owner,
  space: 56n + 32n * BigInt(addresses.length),
});

/** The SlotHashes sysvar holding `slots`. */
const slotHashes = (slots: readonly bigint[]) => {
  const data = Buffer.alloc(8 + 40 * slots.length);
  data.writeBigUInt64LE(BigInt(slots.length), 0);
  slots.forEach((slot, index) => data.writeBigUInt64LE(slot, 8 + 40 * index));

  return {
    data: [data.toString("base64"), "base64"],
    executable: false,
    lamports: 1n,
    owner: "Sysvar1111111111111111111111111111111111111",
    space: BigInt(data.length),
  };
};

/** What every read of `reclaimable` asks, answered for a cluster at `slot` with no code buffer. */
const cluster = (slot: bigint, more: Record<string, Handler> = {}): Record<string, Handler> => ({
  getSlot: () => slot,
  getAccountInfo: (at: never) => ({
    context: { slot },
    value: String(at) === SLOT_HASHES ? slotHashes([slot - 1n]) : null,
  }),
  getProgramAccounts: (program: never) => {
    if (String(program) === v12SvmKitchenProgramId()) return [];
    throw new Error("this endpoint does not scan");
  },
  getSignaturesForAddress: () => [],
  ...more,
});

describe("lookup tables named outright", () => {
  const named = (account: unknown) =>
    endpoint(
      cluster(1_000n, {
        getMultipleAccounts: () => ({ context: { slot: 1_000n }, value: [account] }),
      }),
    );

  it("takes one the owner is the authority of as named, Sauce's or not", async () => {
    const found = await reclaimable(named(tableAccount(OWNER, [OTHER])), URL, OWNER, [TABLE]);
    // Named, the tables are not scanned for: no scan was refused.
    expect(found.scanRefused).toBe(false);
    expect(found.tables).toEqual([
      {
        address: TABLE,
        addresses: 1,
        state: "active",
        lamports: 1_000_000n,
        use: { inUse: false },
      },
    ]);
  });

  it.each<[string, unknown, string]>([
    ["no such account", null, `--lookup-table ${TABLE}: there is no such account`],
    [
      "an account no lookup table",
      tableAccount(OWNER, [], ACTIVE, "11111111111111111111111111111111"),
      `--lookup-table ${TABLE}: not an address lookup table`,
    ],
    [
      "a table another key is the authority of",
      tableAccount(OTHER, []),
      `--lookup-table ${TABLE}: its authority is ${OTHER}, not ${OWNER}`,
    ],
    [
      "a frozen table",
      tableAccount(null, []),
      `--lookup-table ${TABLE}: its authority is no one (it is frozen), not ${OWNER}`,
    ],
  ])("refuses %s, by name", async (_, account, why) => {
    const asked = reclaimable(named(account), URL, OWNER, [TABLE]);
    await expect(asked).rejects.toThrow(UsageError);
    await expect(asked).rejects.toThrow(why);
  });
});

describe("an endpoint that refuses to scan the lookup-table program", () => {
  it("finds no table, and says the scan was refused", async () => {
    const found = await reclaimable(endpoint(cluster(1_000n)), URL, OWNER);
    expect(found.scanRefused).toBe(true);
    expect(found.tables).toEqual([]);
  });
});

describe("a cluster whose recent slot hashes cannot be read", () => {
  const deactivatedAt = async (slot: bigint, hashes: Handler) => {
    const { address: feeConfig } = await deriveExecutionFeeConfigPda(
      v12SvmKitchenProgramId() as Address,
    );
    const rpc = endpoint(
      cluster(slot, {
        getAccountInfo: hashes,
        getProgramAccounts: (program: never) =>
          String(program) === v12SvmKitchenProgramId()
            ? []
            : [{ pubkey: TABLE, account: tableAccount(OWNER, [feeConfig], 1_000n) }],
      }),
    );

    return (await reclaimable(rpc, URL, OWNER)).tables[0]!;
  };
  const unread: ReadonlyArray<readonly [string, Handler]> = [
    ["not there", () => ({ context: { slot: 1n }, value: null })],
    [
      "failing",
      () => {
        throw new Error("no sysvar here");
      },
    ],
  ];

  it.each(unread)(
    "closes a deactivated table by the count of slots, the hashes %s",
    async (_, hashes) => {
      // Deactivated at slot 1000: closable from 1513, the soonest its slot leaves the hashes.
      expect(await deactivatedAt(1_200n, hashes)).toMatchObject({
        state: "deactivating",
        closableFromSlot: 1_513n,
      });
      expect((await deactivatedAt(1_513n, hashes)).state).toBe("closable");
    },
  );

  it("reads them where the cluster gives them, rather than count", async () => {
    // Past the count of slots, but its slot still held: not closable yet.
    const held = () => ({ context: { slot: 1_600n }, value: slotHashes([1_000n]) });
    expect((await deactivatedAt(1_600n, held)).state).toBe("deactivating");
  });
});

describe("the slot and the recent slot hashes", () => {
  it("are read together", async () => {
    let inFlight = 0;
    let most = 0;
    const together = async <T>(answer: T): Promise<T> => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return answer;
    };
    const rpc = endpoint(
      cluster(1_000n, {
        getSlot: () => together(1_000n),
        getAccountInfo: () => together({ context: { slot: 1_000n }, value: slotHashes([999n]) }),
      }),
    );
    await reclaimable(rpc, URL, OWNER);
    expect(most).toBe(2);
  });
});

/** A plan's cursor: `owner`'s, through `lookupTables`. */
const cursorFor = (owner: Address, lookupTables: readonly Address[] = []) =>
  encodeCursor({
    chain: SOLANA,
    owner,
    salt: `0x${"11".repeat(32)}`,
    via: "kitchen",
    tail: [],
    lookupTables,
    pot: "there",
    tokenAccounts: [],
    payload: new Uint8Array([1, 2, 3]),
    labels: [],
  });

describe("a plan to keep", () => {
  it("is refused when it is another owner's, before any endpoint is asked", async () => {
    const cursor = cursorFor(OTHER);
    const asked = reclaimCommand({
      chain: SOLANA,
      owner: OWNER,
      rpcUrl: "http://127.0.0.1:9/",
      keep: [cursor],
    });
    await expect(asked).rejects.toThrow(UsageError);
    await expect(asked).rejects.toThrow(`a plan to keep is ${OTHER}'s, not ${OWNER}'s`);
  });

  describe("from a file, --keep @file", () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "sauce-reclaim-keep-"));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const keep = async (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);

      return sauce(
        ...["reclaim", "--chain", "solana", "--owner", OWNER, "--keep", `@${path}`],
        ...["--rpc-url", "http://127.0.0.1:9/"],
      );
    };

    it("is refused, by what is wrong with it, where the file holds no cursor", async () => {
      const broken = await keep("broken.json", '{ "cursor": "sauce-plan-1.');
      expect(broken.code).toBe(2);
      expect(broken.stderr).toMatch(/--keep @file: the file holds no JSON that parses/);
      const none = await keep(
        "none.json",
        JSON.stringify({ step: "cook", next: { step: "done" } }),
      );
      expect(none.code).toBe(2);
      expect(none.stderr).toMatch(
        /--keep @file: the file holds JSON with no cursor \(nor next\.cursor\)/,
      );
    });

    it("takes the cursor a step was printed with, or a send's next one", async () => {
      // Another owner's, so the run stops at it, before any endpoint is asked.
      const cursor = cursorFor(OTHER);
      for (const text of [
        JSON.stringify({ step: "cook", cursor }),
        JSON.stringify({ ok: true, next: { step: "cook", cursor } }),
        `${cursor}\n`,
      ]) {
        const run = await keep("step.json", text);
        expect(run.stderr).toMatch(`a plan to keep is ${OTHER}'s, not ${OWNER}'s`);
      }
    });
  });
});

/** A code buffer as the Kitchen scan returns it. */
const bufferItem = (index: number) => ({
  pubkey: key(100 + index),
  account: { data: [Buffer.alloc(91).toString("base64"), "base64"], lamports: 1_000n },
});

describe("an owner with more open than one run handles", () => {
  const feeConfig = async () =>
    (await deriveExecutionFeeConfigPda(v12SvmKitchenProgramId() as Address)).address;
  /** A Sauce table as the scan returns it, deactivated at `deactivationSlot`. */
  const tableItem = async (index: number, deactivationSlot = ACTIVE) => ({
    pubkey: key(200 + index),
    account: tableAccount(OWNER, [await feeConfig()], deactivationSlot),
  });

  it("reads at most eight transaction histories at once", async () => {
    const tables = await Promise.all(Array.from({ length: 10 }, (_, index) => tableItem(index)));
    let inFlight = 0;
    let most = 0;
    const rpc = endpoint(
      cluster(1_000n, {
        getProgramAccounts: (program: never) =>
          String(program) === v12SvmKitchenProgramId()
            ? Array.from({ length: 20 }, (_, index) => bufferItem(index))
            : tables,
        getMultipleAccounts: (keys: never) => ({
          context: { slot: 1_000n },
          value: (keys as unknown[]).map(() => null),
        }),
        getSignaturesForAddress: async () => {
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight -= 1;

          return [];
        },
      }),
    );
    const found = await reclaimable(rpc, URL, OWNER);
    expect(found.buffers).toHaveLength(20);
    expect(found.tables).toHaveLength(10);
    expect(most).toBe(8);
  });

  it("takes 32 code buffers and 24 lookup tables a run, the tables it can act on first", async () => {
    // 28 deactivating, scanned first; then one active, and one closable.
    const tables = [
      ...(await Promise.all(Array.from({ length: 28 }, (_, index) => tableItem(index, 990n)))),
      await tableItem(28),
      await tableItem(29, 500n),
    ];
    const read: number[] = [];
    const rpc = endpoint(
      cluster(1_000n, {
        getAccountInfo: () => ({ context: { slot: 1_000n }, value: slotHashes([990n]) }),
        getProgramAccounts: (program: never) =>
          String(program) === v12SvmKitchenProgramId()
            ? Array.from({ length: 40 }, (_, index) => bufferItem(index))
            : tables,
        getMultipleAccounts: (keys: never) => {
          read.push((keys as unknown[]).length);

          return { context: { slot: 1_000n }, value: (keys as unknown[]).map(() => null) };
        },
      }),
    );
    const found = await reclaimable(rpc, URL, OWNER);
    expect(found.buffers.map((one) => one.codeBuffer)).toEqual(
      Array.from({ length: 32 }, (_, index) => key(100 + index)),
    );
    expect(read).toEqual([32]);
    expect(found.tables).toHaveLength(24);
    expect(found.tables.slice(0, 2).map((one) => [one.address, one.state])).toEqual([
      [key(229), "closable"],
      [key(228), "active"],
    ]);
    expect(found.remaining).toEqual({ buffers: 8, tables: 6 });
  });

  it("refuses more tables named than a run takes, before any endpoint is asked", async () => {
    const named = Array.from({ length: 25 }, (_, index) => key(200 + index));
    const asked = reclaimable(endpoint({}), URL, OWNER, named);
    await expect(asked).rejects.toThrow(UsageError);
    await expect(asked).rejects.toThrow(/25 lookup tables named: a run takes 24 at most/);
  });

  describe("as the command says it", () => {
    const original = globalThis.fetch;
    beforeAll(async () => {
      // A cluster running the release, which the closes are checked against before they are built.
      const released: Record<string, RpcAccount> = await releasedProgramAccounts();
      globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
        if (String(input) !== URL) return original(input as string, init as RequestInit);
        const { id, method, params } = JSON.parse(init!.body!) as {
          id: unknown;
          method: string;
          params: unknown[];
        };
        const kitchenScan = () =>
          Array.from({ length: 40 }, (_, index) => ({
            pubkey: key(100 + index),
            account: {
              data: [Buffer.alloc(91).toString("base64"), "base64"],
              executable: false,
              lamports: 1_000,
              owner: v12SvmKitchenProgramId(),
              rentEpoch: 0,
              space: 91,
            },
          }));
        const answers: Record<string, () => unknown> = {
          getSlot: () => 1_000,
          getAccountInfo: () => ({
            context: { slot: 1_000 },
            value: released[String(params[0])] ?? null,
          }),
          getProgramAccounts: () => (params[0] === v12SvmKitchenProgramId() ? kitchenScan() : []),
          getMultipleAccounts: () => ({
            context: { slot: 1_000 },
            value: (params[0] as unknown[]).map(() => null),
          }),
          getSignaturesForAddress: () => [],
          getLatestBlockhash: () => ({
            context: { slot: 1_000 },
            value: { blockhash: key(10), lastValidBlockHeight: 1_150 },
          }),
        };

        return Response.json({ jsonrpc: "2.0", id, result: answers[method]!() });
      }) as typeof fetch;
    });
    afterAll(() => {
      globalThis.fetch = original;
    });

    it("closes a run's share, and says how many remain for the next", async () => {
      const output = await reclaimCommand({ chain: SOLANA, owner: OWNER, rpcUrl: URL });
      const json = output.json as {
        buffers: unknown[];
        remaining?: { buffers: number; lookupTables: number };
        transactions: unknown[];
      };
      expect(json.buffers).toHaveLength(32);
      expect(json.remaining).toEqual({ buffers: 8, lookupTables: 0 });
      // Six closes a transaction.
      expect(json.transactions).toHaveLength(6);
      expect(output.notes).toContain(
        "40 code buffers are open, more than a run takes: this one lists and closes 32, and the " +
          "other 8 are for the next run, once these are closed",
      );
    });
  });
});

describe("lookup tables a plan given to keep holds, past their activity", () => {
  // Deactivated at 990, which the cluster's slot hashes still hold; deactivated at 500, closable.
  const DEACTIVATING = key(30);
  const CLOSABLE = key(31);
  const NOT_KEPT = key(32);
  const original = globalThis.fetch;
  beforeAll(async () => {
    const { address: feeConfig } = await deriveExecutionFeeConfigPda(
      v12SvmKitchenProgramId() as Address,
    );
    const asRpc = (account: ReturnType<typeof tableAccount>) => ({
      ...account,
      lamports: 1_000_000,
      rentEpoch: 0,
      space: Number(account.space),
    });
    const tables = [
      { pubkey: DEACTIVATING, account: asRpc(tableAccount(OWNER, [feeConfig], 990n)) },
      { pubkey: CLOSABLE, account: asRpc(tableAccount(OWNER, [feeConfig], 500n)) },
      { pubkey: NOT_KEPT, account: asRpc(tableAccount(OWNER, [feeConfig], 500n)) },
    ];
    const hashes = slotHashes([990n]);
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) !== URL) return original(input as string, init as RequestInit);
      const { id, method, params } = JSON.parse(init!.body!) as {
        id: unknown;
        method: string;
        params: unknown[];
      };
      const answers: Record<string, () => unknown> = {
        getSlot: () => 1_000,
        getAccountInfo: () => ({
          context: { slot: 1_000 },
          value: { ...hashes, lamports: 1, rentEpoch: 0, space: Number(hashes.space) },
        }),
        getProgramAccounts: () => (params[0] === v12SvmKitchenProgramId() ? [] : tables),
        getSignaturesForAddress: () => [],
        getLatestBlockhash: () => ({
          context: { slot: 1_000 },
          value: { blockhash: key(10), lastValidBlockHeight: 1_150 },
        }),
      };

      return Response.json({ jsonrpc: "2.0", id, result: answers[method]!() });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = original;
  });

  it("keeps them, deactivated or closable: nothing is built for them, and each is said kept", async () => {
    const output = await reclaimCommand({
      chain: SOLANA,
      owner: OWNER,
      rpcUrl: URL,
      keep: [cursorFor(OWNER, [DEACTIVATING, CLOSABLE])],
    });
    const json = output.json as {
      lookupTables: Array<{ address: string; state: string; inUse?: boolean; kept?: boolean }>;
      transactions: Array<{ what: string }>;
    };
    const byAddress = new Map(json.lookupTables.map((one) => [one.address, one]));
    expect(byAddress.get(DEACTIVATING)).toMatchObject({
      state: "deactivating",
      inUse: true,
      kept: true,
    });
    expect(byAddress.get(CLOSABLE)).toMatchObject({ state: "closable", inUse: true, kept: true });
    expect(byAddress.get(NOT_KEPT)).toMatchObject({ state: "closable" });
    expect(byAddress.get(NOT_KEPT)!.kept).toBeUndefined();
    // Only the table no plan holds is closed.
    expect(json.transactions.map((tx) => tx.what)).toEqual([`closing lookup table ${NOT_KEPT}`]);
    for (const table of [DEACTIVATING, CLOSABLE]) {
      expect(output.notes).toContain(
        `lookup table ${table} is left open: a plan given to keep holds it`,
      );
    }
  });
});

describe("transaction histories the endpoint cannot read", () => {
  const original = globalThis.fetch;
  beforeAll(async () => {
    const { address: feeConfig } = await deriveExecutionFeeConfigPda(
      v12SvmKitchenProgramId() as Address,
    );
    const table = tableAccount(OWNER, [feeConfig]);
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      if (String(input) !== URL) return original(input as string, init as RequestInit);
      const { id, method, params } = JSON.parse(init!.body!) as {
        id: unknown;
        method: string;
        params: unknown[];
      };
      if (method === "getSignaturesForAddress") {
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: `history unavailable at ${URL}` },
        });
      }
      const answers: Record<string, () => unknown> = {
        getSlot: () => 1_000,
        getAccountInfo: () => ({ context: { slot: 1_000 }, value: null }),
        getProgramAccounts: () =>
          params[0] === v12SvmKitchenProgramId()
            ? [0, 1].map((index) => ({
                pubkey: key(100 + index),
                account: {
                  data: [Buffer.alloc(91).toString("base64"), "base64"],
                  executable: false,
                  lamports: 1_000,
                  owner: v12SvmKitchenProgramId(),
                  rentEpoch: 0,
                  space: 91,
                },
              }))
            : [
                {
                  pubkey: TABLE,
                  account: { ...table, lamports: 1_000_000, rentEpoch: 0, space: 88 },
                },
              ],
        getMultipleAccounts: () => ({
          context: { slot: 1_000 },
          value: (params[0] as unknown[]).map(() => null),
        }),
      };

      return Response.json({ jsonrpc: "2.0", id, result: answers[method]!() });
    }) as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = original;
  });

  it("keeps what they make up as in use, closes none of it, and says so once", async () => {
    const output = await reclaimCommand({ chain: SOLANA, owner: OWNER, rpcUrl: URL });
    const json = output.json as {
      buffers: Array<{ inUse?: boolean; historyUnread?: boolean }>;
      lookupTables: Array<{ inUse?: boolean; historyUnread?: boolean }>;
      transactions: unknown[];
    };
    expect(json.buffers).toHaveLength(2);
    for (const one of [...json.buffers, ...json.lookupTables]) {
      expect(one).toMatchObject({ inUse: true, historyUnread: true });
    }
    expect(json.transactions).toEqual([]);
    const unread = output.notes!.filter((note) => /could not be read/.test(note));
    expect(unread).toEqual([
      "the history of 5 accounts (2 code buffers, 1 lookup table) could not be read: " +
        "JSON-RPC error: Internal JSON-RPC error (history unavailable at <RPC_URL>); they are " +
        "kept as in use, and none is closed: reclaim again, through another endpoint if it keeps " +
        "failing",
    ]);
    expect(JSON.stringify(output)).not.toContain(URL);
  });
});
