/**
 * A Solana plan's steps (`svm-plan.ts`), offline, against an endpoint that answers what each test
 * chooses: the cursor read back, and every cursor that is not one refused by name; the search for a
 * cook handed out — the owner's transactions since its slot, read a batch at a time, the search
 * stopping where they reach before it, and refusing rather than guessing where it cannot finish
 * (too many, or one the endpoint lists and does not return), which close goes past; the setup's
 * account checks in one read; and a cook whose lookup table is not in use yet, said so at once
 * rather than waited for. Executing plans is `cli-send.e2e.test.ts` and `mcp/test/send.e2e.test.ts`.
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { getBase58Decoder, type Address } from "@solana/kit";

import { UsageError } from "../src/cli/args.js";
import { decodeCursor, encodeCursor, type SvmPlan } from "../src/cli/svm-plan.js";
import { MAX_CODE_LEN } from "../src/svm/index.js";

/** A distinct base58 key of `bytes` bytes, each `fill`. */
const key = (fill: number, bytes = 32): string =>
  getBase58Decoder().decode(new Uint8Array(bytes).fill(fill));
const OWNER = key(7) as Address;
const MINT = key(8) as Address;
const TABLE = key(9) as Address;
const BLOCKHASH = key(10);
const signature = (index: number): string => key((index % 250) + 1, 64);

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
