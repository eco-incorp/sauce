/**
 * `sauce reclaim`'s reading of what an owner left open, offline, against an endpoint that answers
 * what each test chooses: lookup tables named outright — taken as named, and refused by name where
 * there is no such account, it is no lookup table, or the owner is not its authority — an endpoint
 * that refuses to scan the lookup-table program, a cluster whose recent slot hashes cannot be read
 * (a deactivated table then closes by the count of slots), the slot and those hashes read together,
 * and a plan to keep that is another owner's. Closing on a cluster is `cli-reclaim.e2e.test.ts`.
 */
import { getBase58Decoder, type Address } from "@solana/kit";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM_ADDRESS,
  getAddressLookupTableEncoder,
} from "@solana-program/address-lookup-table";

import { UsageError } from "../src/cli/args.js";
import { reclaimable, reclaimCommand } from "../src/cli/reclaim.js";
import { encodeCursor } from "../src/cli/svm-plan.js";
import { v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { deriveExecutionFeeConfigPda } from "../src/svm/index.js";

const key = (fill: number): Address =>
  getBase58Decoder().decode(new Uint8Array(32).fill(fill)) as Address;
const OWNER = key(7);
const OTHER = key(8);
const TABLE = key(9);
const URL = "http://endpoint.invalid/secret-key";
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

describe("a plan to keep", () => {
  it("is refused when it is another owner's, before any endpoint is asked", async () => {
    const cursor = encodeCursor({
      owner: OTHER,
      salt: `0x${"11".repeat(32)}`,
      via: "kitchen",
      tail: [],
      lookupTables: [],
      pot: "there",
      tokenAccounts: [],
      payload: new Uint8Array([1, 2, 3]),
      labels: [],
    });
    const asked = reclaimCommand({ owner: OWNER, rpcUrl: "http://127.0.0.1:9/", keep: [cursor] });
    await expect(asked).rejects.toThrow(UsageError);
    await expect(asked).rejects.toThrow(`a plan to keep is ${OTHER}'s, not ${OWNER}'s`);
  });
});
