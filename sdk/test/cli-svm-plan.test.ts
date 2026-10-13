/**
 * A Solana plan's steps (`svm-plan.ts`), offline, against an endpoint that answers what each test
 * chooses: the cursor read back, and every cursor that is not one refused by name; the search for a
 * cook handed out — the owner's transactions since its slot, read a batch at a time, the search
 * stopping where they reach before it, and refusing rather than guessing where it cannot finish
 * (too many, or one the endpoint lists and does not return), which close goes past; the setup's
 * account checks in one read; a cook whose lookup table is not in use yet, said so at once rather
 * than waited for; and what a wallet's send takes from a tool's result. Executing plans is
 * `cli-send.e2e.test.ts` and `mcp/test/send.e2e.test.ts`.
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";
import { getAddressLookupTableEncoder } from "@solana-program/address-lookup-table";

import { v12SvmKitchenProgramId } from "../src/deployments/index.js";
import { UsageError } from "../src/cli/args.js";
import {
  decodeCursor,
  encodeCursor,
  nextStep,
  unsignedSigner,
  type StepContext,
  type SvmPlan,
} from "../src/cli/svm-plan.js";
import { plannedCursor, plannedHandedOut } from "../src/cli/wallet-send.js";
import { KITCHEN_DISCRIMINATORS, MAX_CODE_LEN } from "../src/svm/index.js";

/** A distinct base58 key of `bytes` bytes, each `fill`. */
const key = (fill: number, bytes = 32): string =>
  getBase58Decoder().decode(new Uint8Array(bytes).fill(fill));
const OWNER = key(7) as Address;
const MINT = key(8) as Address;
const TABLE = key(9) as Address;
const BLOCKHASH = key(10);
const OTHER_BLOCKHASH = key(11);
const signature = (index: number): string => key((index % 250) + 1, 64);
const URL = "http://endpoint.invalid/secret-key";

const plan = (fields: Partial<SvmPlan> = {}): SvmPlan => ({
  owner: OWNER,
  salt: `0x${"11".repeat(32)}`,
  via: "kitchen",
  tail: [],
  lookupTables: [],
  pot: "there",
  tokenAccounts: [],
  payload: new Uint8Array([1, 2, 3]),
  labels: [],
  ...fields,
});

type Handler = (...params: never[]) => unknown;

/** An endpoint answering each method with its handler, and refusing any other by name; `calls`
 *  records every request, in order. */
function endpoint(handlers: Record<string, Handler>, calls: string[] = []): StepContext["rpc"] {
  return new Proxy(
    {},
    {
      get:
        (_, method: string) =>
        (...params: never[]) => ({
          send: async () => {
            calls.push(method);
            const handler = handlers[method];
            if (handler === undefined)
              throw new Error(`the endpoint was not to be asked ${method}`);

            return handler(...params);
          },
        }),
    },
  ) as StepContext["rpc"];
}

const context = (rpc: StepContext["rpc"]): StepContext => ({
  rpc,
  url: URL,
  signer: unsignedSigner(OWNER),
  fee: 5_000n,
});

/** What a cook step reads once nothing stands in its way: a blockhash, and a rehearsal. */
const COOK_READS = {
  getLatestBlockhash: () => ({
    context: { slot: 2_000n },
    value: { blockhash: OTHER_BLOCKHASH, lastValidBlockHeight: 3_000n },
  }),
  simulateTransaction: () => ({
    context: { slot: 2_000n },
    value: { err: null, logs: [], unitsConsumed: 10_000n, returnData: null },
  }),
};

/** A cursor of `fields`, as `encodeCursor` writes one. */
const cursorOf = (fields: unknown): string =>
  `sauce-plan-1.${deflateRawSync(Buffer.from(JSON.stringify(fields))).toString("base64")}`;

/** A plan's cursor content, as JSON, with `change` made. */
const raw = (change: Record<string, unknown> = {}): Record<string, unknown> => ({
  owner: OWNER,
  salt: `0x${"11".repeat(32)}`,
  via: "kitchen",
  tail: [[MINT, 1]],
  lookupTables: [],
  pot: "there",
  tokenAccounts: [],
  payload: Buffer.from([1, 2, 3]).toString("base64"),
  labels: [],
  ...change,
});

const sha256Of = (bytes: Uint8Array): string =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;

describe("a plan's cursor", () => {
  it("reads back the plan it was made from", () => {
    const made = plan({
      maxExecutionFee: 9n,
      tail: [{ address: MINT, role: 1 }],
      staged: { nonce: 2n ** 64n - 1n, sha256: new Uint8Array(32).fill(3), length: 3 },
      payload: undefined,
      table: { addresses: [MINT], address: TABLE, recentSlot: 5n },
      cook: { blockhash: BLOCKHASH, lastValidBlockHeight: 6n, slot: 7n },
      cooked: { ok: true, signature: signature(1) },
      labels: [[MINT, "the mint"]],
      returnType: "Uint256",
    });
    const { payload: _, ...expected } = made;
    expect(decodeCursor(encodeCursor(made))).toEqual(expected);
  });

  const LONG = Array.from({ length: 257 }, () => MINT);
  it.each<[string, () => string, RegExp]>([
    ["another string", () => "a cursor", /not a plan's cursor/],
    ["a truncated cursor", () => encodeCursor(plan()).slice(0, -12), /it does not decode/],
    [
      "one that is not JSON",
      () => `sauce-plan-1.${deflateRawSync("plan").toString("base64")}`,
      /it does not decode/,
    ],
    ["a list", () => cursorOf([]), /not a plan/],
    [
      "one past the largest a plan decodes to",
      () => cursorOf(raw({ returnType: "x".repeat(4 * MAX_CODE_LEN + 1) })),
      /it does not decode/,
    ],
    ["another via", () => cursorOf(raw({ via: "relay" })), /via is neither kitchen nor engine/],
    ["a short salt", () => cursorOf(raw({ salt: "0x11" })), /salt is not 32 bytes/],
    [
      "an owner that is no address",
      () => cursorOf(raw({ owner: "me" })),
      /owner is not an address/,
    ],
    ["another pot", () => cursorOf(raw({ pot: "maybe" })), /cursor: pot/],
    [
      "too many accounts",
      () => cursorOf(raw({ tail: LONG.map((at) => [at, 0]) })),
      /tail is not a list/,
    ],
    [
      "an account role past signer and writable",
      () => cursorOf(raw({ tail: [[MINT, 4]] })),
      /an account's role/,
    ],
    [
      "too many token accounts",
      () => cursorOf(raw({ tokenAccounts: LONG.slice(0, 65).map((at) => [at, at, at, at, "x"]) })),
      /tokenAccounts is not a list/,
    ],
    [
      "too many lookup tables",
      () => cursorOf(raw({ lookupTables: LONG.slice(0, 65) })),
      /lookupTables is not a list/,
    ],
    [
      "too many labels",
      () => cursorOf(raw({ labels: LONG.map((at) => [at, "x"]) })),
      /labels is not a list/,
    ],
    ["a payload that is no base64 text", () => cursorOf(raw({ payload: 12 })), /payload/],
    [
      "a payload past the largest program",
      () => cursorOf(raw({ payload: Buffer.alloc(MAX_CODE_LEN + 1).toString("base64") })),
      /payload/,
    ],
    ["an empty payload", () => cursorOf(raw({ payload: "" })), /payload/],
    [
      "staged that is not a list",
      () => cursorOf(raw({ staged: "staged" })),
      /staged is not a list/,
    ],
    ["staged with a short digest", () => cursorOf(raw({ staged: ["1", "0x12", 3] })), /sha256/],
    [
      "staged with a nonce past a u64",
      () => cursorOf(raw({ staged: [`${2n ** 64n}`, `0x${"00".repeat(32)}`, 3] })),
      /nonce is not an integer/,
    ],
    [
      "staged with no length",
      () => cursorOf(raw({ staged: ["1", `0x${"00".repeat(32)}`, 0] })),
      /length/,
    ],
    [
      "staged past the largest program",
      () =>
        cursorOf(
          raw({ payload: undefined, staged: ["1", `0x${"00".repeat(32)}`, MAX_CODE_LEN + 1] }),
        ),
      /length/,
    ],
    [
      "staged over other bytes than its payload",
      () => cursorOf(raw({ staged: ["1", `0x${"00".repeat(32)}`, 3] })),
      /not the payload's/,
    ],
    [
      "staged for a longer payload than it carries",
      () => cursorOf(raw({ staged: ["1", `0x${"00".repeat(32)}`, 4] })),
      /not the payload's/,
    ],
    ["a table that is no object", () => cursorOf(raw({ table: "table" })), /cursor: table/],
    [
      "a table with no addresses",
      () => cursorOf(raw({ table: {} })),
      /the table's addresses is not a list/,
    ],
    [
      "a table at no address",
      () => cursorOf(raw({ table: { addresses: [], address: "t" } })),
      /the table is not an address/,
    ],
    [
      "a table at a slot that is no integer",
      () => cursorOf(raw({ table: { addresses: [], recentSlot: 5 } })),
      /recentSlot is not an integer/,
    ],
    [
      "a cook of two entries",
      () => cursorOf(raw({ cook: [BLOCKHASH, "1"] })),
      /the cook's slot is not an integer/,
    ],
    [
      "a cook of four entries",
      () => cursorOf(raw({ cook: [BLOCKHASH, "1", "2", "3"] })),
      /cook is not a list/,
    ],
    [
      "a cook on no blockhash",
      () => cursorOf(raw({ cook: ["0x00", "1", "2"] })),
      /the cook's blockhash/,
    ],
    [
      "a cook valid past a u64 block height",
      () => cursorOf(raw({ cook: [BLOCKHASH, `${2n ** 64n}`, "2"] })),
      /last valid block height is not an integer/,
    ],
    ["a cooked that is not a pair", () => cursorOf(raw({ cooked: [1, signature(1)] })), /cooked/],
    ["a cooked with no signature", () => cursorOf(raw({ cooked: [true, "signed"] })), /cooked/],
    ["a return type that is no text", () => cursorOf(raw({ returnType: 7 })), /returnType/],
    [
      "a fee that is no integer",
      () => cursorOf(raw({ maxExecutionFee: "-1" })),
      /maxExecutionFee is not an integer/,
    ],
  ])("refuses %s", (_, cursor, why) => {
    const read = () => decodeCursor(cursor());
    expect(read).toThrow(UsageError);
    expect(read).toThrow(why);
  });

  it("takes staged over the payload it carries", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const decoded = decodeCursor(
      cursorOf(raw({ staged: ["1", sha256Of(payload), payload.length] })),
    );
    expect(decoded.staged?.length).toBe(3);
  });
});

/** A transaction of the owner's on `blockhash`: a Kitchen cook, or a call that is not one. */
function ownerTransaction(blockhash: string, cook: boolean): string {
  const data = cook
    ? new Uint8Array([...KITCHEN_DISCRIMINATORS.cook, ...new Uint8Array(40)])
    : new Uint8Array([2, 0, 0, 0]);

  return getBase64EncodedWireTransaction(
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayer(OWNER, message),
        (message) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: blockhash as Blockhash, lastValidBlockHeight: 1n },
            message,
          ),
        (message) =>
          appendTransactionMessageInstruction(
            {
              programAddress: cook
                ? address(v12SvmKitchenProgramId())
                : address("11111111111111111111111111111111"),
              data,
            },
            message,
          ),
      ),
    ),
  );
}

describe("the search for a cook handed out, past its blockhash", () => {
  const HANDED = { blockhash: BLOCKHASH, lastValidBlockHeight: 100n, slot: 1_000n };
  const handedOut = plan({ cook: HANDED });

  /** The owner's history: `slots[i]` is the slot of its i-th newest transaction, `cookAt` the
   *  index of the cook among them; what each request asked is kept. */
  function history(slots: readonly bigint[], cookAt?: number, missingAt?: number) {
    const fetched: number[] = [];
    const pages: Array<string | undefined> = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const handlers: Record<string, Handler> = {
      ...COOK_READS,
      getBlockHeight: () => 200n,
      getSignaturesForAddress: (_owner: never, config: never) => {
        const { before, limit } = config as { before?: string; limit: number };
        pages.push(before);
        const from = before === undefined ? 0 : Number(before.split(":")[1]) + 1;

        return slots.slice(from, from + limit).map((slot, offset) => ({
          signature: `${signature(from + offset)}:${from + offset}`,
          slot,
          err: null,
        }));
      },
      getTransaction: async (wanted: never) => {
        const index = Number(String(wanted).split(":")[1]);
        fetched.push(index);
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        if (index === missingAt) return null;

        return {
          slot: slots[index],
          transaction: [
            ownerTransaction(index === cookAt ? BLOCKHASH : OTHER_BLOCKHASH, index === cookAt),
            "base64",
          ],
          meta: { err: null },
        };
      },
    };

    return { handlers, fetched, pages, mostInFlight: () => mostInFlight };
  }

  it("finds the cook on its blockhash, and moves on past it", async () => {
    const owner = history([1_003n, 1_002n, 1_001n], 1);
    const step = await nextStep(handedOut, context(endpoint(owner.handlers)));
    expect(step.name).toBe("done");
    expect(step.plan.cooked).toEqual({ ok: true, signature: `${signature(1)}:1` });
  });

  it("reads no transaction from before the cook was handed out, nor a page past them", async () => {
    const slots = [1_002n, 1_001n, 1_000n, ...Array.from({ length: 97 }, () => 999n)];
    const owner = history(slots);
    const step = await nextStep(handedOut, context(endpoint(owner.handlers)));
    expect(owner.fetched.sort()).toEqual([0, 1, 2]);
    expect(owner.pages).toEqual([undefined]);
    // The cook never landed: a fresh one is built.
    expect(step.name).toBe("cook");
    expect(step.plan.cook).toBeUndefined();
    expect(step.transactions).toHaveLength(1);
  });

  it("reads a page's transactions several at a time", async () => {
    const owner = history([...Array.from({ length: 150 }, () => 1_500n), 999n]);
    await nextStep(handedOut, context(endpoint(owner.handlers)));
    expect(owner.fetched).toHaveLength(150);
    expect(owner.pages).toHaveLength(2);
    expect(owner.mostInFlight()).toBeGreaterThan(1);
  });

  it("refuses past 500 of the owner's transactions rather than guess, and close goes past", async () => {
    const owner = history(Array.from({ length: 700 }, () => 1_500n));
    const asked = nextStep(handedOut, context(endpoint(owner.handlers)));
    await expect(asked).rejects.toThrow(
      `${OWNER} sent more than 500 transactions since the cook was handed out, too many to look ` +
        "through for it: give the cook's signature if it was sent, or close",
    );
    expect(owner.fetched).toHaveLength(500);
    // Closing never cooks, so what the search cannot tell does not hold it up.
    const closing = await nextStep(handedOut, context(endpoint(owner.handlers)), { close: true });
    expect(closing.name).toBe("done");
    expect(closing.plan.closing).toBe(true);
    expect(closing.notes.join("\n")).toMatch(
      /whether the cook handed out landed could not be told/,
    );
  });

  it("refuses where the endpoint lists a transaction it then does not return", async () => {
    const owner = history([1_003n, 1_002n, 1_001n, 999n], undefined, 1);
    await expect(nextStep(handedOut, context(endpoint(owner.handlers)))).rejects.toThrow(
      /lists .* among .*'s transactions, and does not return it: whether the cook handed out landed cannot be told/,
    );
    // The cook found beside it is an answer all the same.
    const found = history([1_003n, 1_002n, 1_001n, 999n], 2, 1);
    const step = await nextStep(handedOut, context(endpoint(found.handlers)));
    expect(step.plan.cooked).toEqual({ ok: true, signature: `${signature(2)}:2` });
  });

  it("refuses where the endpoint cannot list the owner's transactions, never naming it", async () => {
    const failing = endpoint({
      getBlockHeight: () => 200n,
      getSignaturesForAddress: () => {
        throw new Error(`fetch failed for ${URL}`);
      },
    });
    const asked = nextStep(handedOut, context(failing));
    await expect(asked).rejects.toThrow(
      "reading the owner's transactions since the cook was handed out failed: fetch failed for <RPC_URL>",
    );
  });
});

describe("the setup a plan still needs", () => {
  it("checks the Pot and every token account in one read", async () => {
    const accounts = [key(20), key(21), key(22)].map((at, index) => ({
      address: at as Address,
      holder: OWNER,
      mint: MINT,
      program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address,
      label: `account ${index}`,
    }));
    const calls: string[] = [];
    const rpc = endpoint(
      {
        getMultipleAccounts: (keys: never) => ({
          context: { slot: 1n },
          value: (keys as string[]).map((at) =>
            at === accounts[0]!.address
              ? { data: ["", "base64"], executable: false, lamports: 1n, owner: MINT, space: 0n }
              : null,
          ),
        }),
      },
      calls,
    );
    const step = await nextStep(plan({ pot: "setup", tokenAccounts: accounts }), context(rpc));
    expect(calls).toEqual(["getMultipleAccounts"]);
    expect(step.name).toBe("setup");
    expect(step.transactions.map((tx) => tx.what)).toEqual([
      "creating the Pot",
      "creating the token accounts",
    ]);
    expect(step.transactions[1]!.accounts!.map((one) => one.label)).toEqual([
      "account 1",
      "account 2",
    ]);
  });
});

describe("a cook through a lookup table extended a moment ago", () => {
  const tableAccount = (lastExtendedSlot: bigint) => ({
    context: { slot: 1n },
    value: {
      data: [
        Buffer.from(
          getAddressLookupTableEncoder().encode({
            deactivationSlot: 2n ** 64n - 1n,
            lastExtendedSlot,
            lastExtendedSlotStartIndex: 0,
            authority: OWNER,
            addresses: [MINT],
          }),
        ).toString("base64"),
        "base64",
      ],
      executable: false,
      lamports: 1n,
      owner: "AddressLookupTab1e1111111111111111111111111",
      space: 88n,
    },
  });
  const through = plan({ lookupTables: [TABLE], tail: [{ address: MINT, role: 0 }] });

  it("is not ready until the slot after its extension, and says so at once", async () => {
    const calls: string[] = [];
    const rpc = endpoint({ getAccountInfo: () => tableAccount(500n), getSlot: () => 500n }, calls);
    const step = await nextStep(through, context(rpc));
    expect(step.name).toBe("cook");
    expect(step.transactions).toEqual([]);
    expect(step.readyAt).toBe(501n);
    expect(step.wait).toBe(
      `not ready yet: lookup table ${TABLE} is usable from slot 501 (now 500); ask again`,
    );
    expect(step.plan).toEqual(through);
    // Read once, never polled.
    expect(calls.filter((call) => call === "getSlot")).toHaveLength(1);
  });

  it("is built once the cluster is past that slot", async () => {
    const rpc = endpoint({
      ...COOK_READS,
      getAccountInfo: () => tableAccount(500n),
      getSlot: () => 501n,
    });
    const step = await nextStep(through, context(rpc));
    expect(step.wait).toBeUndefined();
    expect(step.transactions).toHaveLength(1);
    expect(step.transactions[0]!.lookupTables).toEqual({ [TABLE]: [MINT] });
  });
});

describe("what a wallet's send takes of a plan, from a tool's result", () => {
  const cook = { what: "cook on Pot", transaction: "AQAB", feePayer: OWNER };
  const setup = { what: "creating the Pot", transaction: "AQAC", feePayer: OWNER };

  it("takes sauce_tx's one cook, or its step's transactions, and its cursor", () => {
    const single = { transaction: "AQAB", cursor: "c1" };
    expect(plannedCursor(single)).toBe("c1");
    expect(plannedHandedOut(single)).toEqual([{ what: "the cook", transaction: "AQAB" }]);
    const step = { step: "setup", transactions: [setup], cursor: "c2" };
    expect(plannedCursor(JSON.stringify(step))).toBe("c2");
    expect(plannedHandedOut(JSON.stringify(step))).toEqual([
      { what: "creating the Pot", transaction: "AQAC" },
    ]);
  });

  it("takes a send's next step, its transactions and its cursor", () => {
    const sent = { ok: true, sent: [], next: { step: "cook", transactions: [cook], cursor: "c3" } };
    expect(plannedCursor(sent)).toBe("c3");
    expect(plannedHandedOut(sent)).toEqual([{ what: "cook on Pot", transaction: "AQAB" }]);
    expect(plannedHandedOut(JSON.stringify(sent))).toEqual(plannedHandedOut(sent));
    // A next step with nothing to sign hands nothing out.
    expect(
      plannedHandedOut({ next: { step: "cook", wait: "not ready yet", cursor: "c4" } }),
    ).toEqual([]);
  });

  it("takes nothing from what carries no plan", () => {
    for (const value of ["not json", "[]", null, 7, [cook], { next: null }, { cursor: 5 }]) {
      expect(plannedCursor(value)).toBeUndefined();
      expect(plannedHandedOut(value)).toEqual([]);
    }
    expect(plannedHandedOut({ transactions: [{ what: "no transaction" }, null, cook] })).toEqual([
      { what: "cook on Pot", transaction: "AQAB" },
    ]);
  });
});
