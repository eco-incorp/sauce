/**
 * `main`'s arguments, EXECUTED: values encoded by `encodeEntryArguments`, appended to the program the
 * compiler emitted, and read back by that program on the released gated engine.
 *
 * What a program reads is the compiler's layout, not the ABI specification's. ABI-v1 gives each of
 * `main`'s parameters one head word, so a tuple parameter is behind an offset even when every field
 * is fixed-size, where `abi.encode` writes those fields inline. Encoding and decoding with this
 * package's own two functions shows only that they agree with each other. This suite runs the
 * encoded arguments through a real Pot and compares what `main` returns with what it was passed, in
 * both encodings.
 *
 * GATED on SAUCE_V12_RUNTIME_CREATION_HEX like every EVM execution suite, and a hard failure without
 * it in CI.
 */
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  bytesToHex,
  concatHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  hexToBigInt,
  http,
  sliceHex,
  size,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  decodeEntryArguments,
  encodeEntryArguments,
  type EntryValue,
} from "../src/routes/entry.js";
import { compileSauceProgram, type CompiledSauceProgram } from "../src/routes/sauce-route.js";
import { startGatedEngine, type GatedEngine } from "./evm/gated-engine.js";
import { freePortSync, spawnAnvil } from "./anvil-process.js";

const RUNTIME_HEX_PATH =
  process.env.SAUCE_V12_RUNTIME_CREATION_HEX ?? process.env.SAUCE_RUST_V12_RUNTIME;
const describeEvm = RUNTIME_HEX_PATH ? describe : describe.skip;

if (!RUNTIME_HEX_PATH && process.env.CI) {
  throw new Error(
    "SAUCE_V12_RUNTIME_CREATION_HEX is unset in CI. This suite must never skip there — see the " +
      '"Fetch the v12 engines" step in .github/workflows/ci.yml.',
  );
}

/** Anvil's first dev account: the Kitchen's owner and the Pot's. A public key, local only. */
const DEPLOYER = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
/** A port from the OS, so no other suite or checkout meets this one on it (`anvil-process.ts`). */
const PORT = freePortSync();
const RPC_URL = `http://127.0.0.1:${PORT}`;
const GAS_LIMIT = 10_000_000n;
const TO = "0x6666666666666666666666666666666666666666";

const transport = http(RPC_URL, { fetchOptions: { headers: { connection: "close" } } });
const publicClient = createPublicClient({ transport });
const testClient = createTestClient({ mode: "anvil", transport });
const walletClient = createWalletClient({ account: DEPLOYER, transport });

/** Each program returns what `main` read of its arguments, one word per value. */
const CASES: ReadonlyArray<{
  name: string;
  source: string;
  values: EntryValue[];
  read: bigint[];
}> = [
  {
    name: "a tuple of fixed-size fields, alone",
    source: [
      "function main(p: { a: Uint256, b: Uint256 }): { a: Uint256, b: Uint256 } {",
      "  return { a: p.a, b: p.b };",
      "}",
    ].join("\n"),
    values: [{ a: 7n, b: 9n }],
    read: [7n, 9n],
  },
  {
    name: "a tuple of fixed-size fields after a scalar",
    source: [
      "function main(x: Uint256, p: { a: Uint256, b: Uint256 }): { x: Uint256, a: Uint256, b: Uint256 } {",
      "  return { x: x, a: p.a, b: p.b };",
      "}",
    ].join("\n"),
    values: [5n, { a: 7n, b: 9n }],
    read: [5n, 7n, 9n],
  },
  {
    name: "a tuple of an address, a bool and a number, before a scalar",
    source: [
      "function main(p: { to: Address, ok: bool, n: Uint256 }, x: Uint256): { to: Address, ok: bool, n: Uint256, x: Uint256 } {",
      "  return { to: p.to, ok: p.ok, n: p.n, x: x };",
      "}",
    ].join("\n"),
    values: [{ to: TO, ok: true, n: 3n }, 5n],
    read: [BigInt(TO), 1n, 3n, 5n],
  },
  {
    name: "a tuple of fixed-size fields holding another",
    source: [
      "function main(p: { a: Uint256, q: { b: Uint256, c: Uint256 } }, x: Uint256): { a: Uint256, b: Uint256, c: Uint256, x: Uint256 } {",
      "  return { a: p.a, b: p.q.b, c: p.q.c, x: x };",
      "}",
    ].join("\n"),
    values: [{ a: 1n, q: { b: 2n, c: 3n } }, 4n],
    read: [1n, 2n, 3n, 4n],
  },
  {
    name: "two tuples of fixed-size fields around bytes",
    source: [
      "function main(p: { a: Uint256, b: Uint256 }, data: bytes, q: { c: Uint256, d: Uint256 }): { a: Uint256, b: Uint256, len: Uint256, c: Uint256, d: Uint256 } {",
      "  return { a: p.a, b: p.b, len: data.length, c: q.c, d: q.d };",
      "}",
    ].join("\n"),
    values: [{ a: 1n, b: 2n }, "0xbeefcafe", { c: 3n, d: 4n }],
    read: [1n, 2n, 4n, 3n, 4n],
  },
  // abi.encode puts these behind an offset as well, and inlines any tuple of fixed-size fields
  // inside them, as the compiler reads them.
  {
    name: "a tuple with a bytes field, holding a tuple of fixed-size fields",
    source: [
      "function main(p: { q: { b: Uint256, c: Uint256 }, data: bytes }, x: Uint256): { b: Uint256, c: Uint256, len: Uint256, x: Uint256 } {",
      "  return { b: p.q.b, c: p.q.c, len: p.data.length, x: x };",
      "}",
    ].join("\n"),
    values: [{ q: { b: 2n, c: 3n }, data: "0xbeefcafe" }, 5n],
    read: [2n, 3n, 4n, 5n],
  },
  {
    name: "an array of tuples of fixed-size fields",
    source: [
      "function main(legs: { a: Uint256, q: { b: Uint256, c: Uint256 } }[], x: Uint256): { n: Uint256, a: Uint256, b: Uint256, c: Uint256, x: Uint256 } {",
      "  return { n: legs.length, a: legs[1].a, b: legs[1].q.b, c: legs[1].q.c, x: x };",
      "}",
    ].join("\n"),
    values: [
      [
        { a: 1n, q: { b: 2n, c: 3n } },
        { a: 4n, q: { b: 5n, c: 6n } },
      ],
      7n,
    ],
    read: [2n, 4n, 5n, 6n, 7n],
  },
];

describeEvm("main's arguments, encoded by the SDK and read by the compiled program", () => {
  let anvil: ChildProcess;
  let sauce: GatedEngine;

  beforeAll(async () => {
    anvil = await spawnAnvil(PORT);
    const creationCode = readFileSync(RUNTIME_HEX_PATH as string, "utf8").trim() as Hex;
    sauce = await startGatedEngine(
      { publicClient, walletClient, testClient },
      DEPLOYER.address,
      creationCode,
    );
  }, 60_000);

  afterAll(async () => {
    if (anvil === undefined || anvil.exitCode !== null) return;
    const exited = once(anvil, "exit");
    anvil.kill();
    await exited;
  });

  /** What `main` returns when the Pot cooks `program` with `encoded` appended, in decimal. It comes
   *  back with no ABI framing: a record as its fields, one word each. */
  const returned = async (
    program: CompiledSauceProgram,
    encoded: Uint8Array,
  ): Promise<string[]> => {
    const { data = "0x" } = await publicClient.call({
      account: DEPLOYER.address,
      to: sauce.pot,
      data: sauce.cookData(concatHex([bytesToHex(program.bytecode), bytesToHex(encoded)])),
      gas: GAS_LIMIT,
    });

    return Array.from({ length: size(data) / 32 }, (_, index) =>
      hexToBigInt(sliceHex(data, index * 32, index * 32 + 32)).toString(),
    );
  };

  for (const { name, source, values, read } of CASES) {
    it(`abi-v1: ${name}`, async () => {
      const program = compileSauceProgram("base", source);
      expect(program.entryEncoding).toBe("abi-v1");
      const encoded = encodeEntryArguments(program, values);
      // Compared in decimal: jest cannot report a failed comparison of bigints from a worker.
      expect(await returned(program, encoded)).toEqual(read.map(String));
      expect(decodeEntryArguments(program, encoded)).toEqual(values);
    }, 30_000);
  }

  // An Int256 parameter, executed: what `main` reads of the word the SDK encodes is the signed
  // value, so a program that compares or subtracts it sees a negative number. ABI-v1 only: the
  // signed word is the ABI's `int256`.
  const MIN = -(1n << 255n);
  const MAX = (1n << 255n) - 1n;
  const unsigned = (value: bigint): string => BigInt.asUintN(256, value).toString();
  const SIGNED: ReadonlyArray<{
    name: string;
    source: string;
    values: EntryValue[];
    read: bigint[];
  }> = [
    {
      name: "a negative value, subtracted from",
      source: "function main(x: Int256): Int256 { return x - 1; }",
      values: [-5n],
      read: [-6n],
    },
    {
      name: "a negative value, from decimal text and from a number",
      source:
        "function main(x: Int256, y: Int256): { x: Int256, y: Int256 } { return { x: x, y: y }; }",
      values: ["-7", -8],
      read: [-7n, -8n],
    },
    {
      name: "-2^255 and 2^255 - 1, the bounds, as they are",
      source:
        "function main(a: Int256, b: Int256): { a: Int256, b: Int256 } { return { a: a, b: b }; }",
      values: [MIN, MAX],
      read: [MIN, MAX],
    },
    {
      name: "a negative value, ordered below zero",
      source: "function main(x: Int256): bool { return x < 0; }",
      values: [-5n],
      read: [1n],
    },
    {
      name: "a positive value, not ordered below zero",
      source: "function main(x: Int256): bool { return x < 0; }",
      values: [5n],
      read: [0n],
    },
    {
      name: "an array of them",
      source:
        "function main(xs: Int256[]): { n: Uint256, first: Int256, last: Int256 } { return { n: xs.length, first: xs[0], last: xs[2] }; }",
      values: [[-1n, 0n, MIN]],
      read: [3n, -1n, MIN],
    },
    {
      name: "a tuple holding one, beside a Uint256",
      source:
        "function main(p: { d: Int256, a: Uint256 }, x: Uint256): { d: Int256, a: Uint256, x: Uint256 } { return { d: p.d, a: p.a, x: x }; }",
      values: [{ d: -2n, a: 3n }, 4n],
      read: [-2n, 3n, 4n],
    },
  ];
  for (const { name, source, values, read } of SIGNED) {
    it(`abi-v1: ${name}`, async () => {
      const program = compileSauceProgram("base", source);
      expect(program.entryEncoding).toBe("abi-v1");
      const encoded = encodeEntryArguments(program, values);
      expect(await returned(program, encoded)).toEqual(read.map(unsigned));
      expect(decodeEntryArguments(program, encoded)).toEqual(
        values.map((value, index) =>
          typeof value === "string" || typeof value === "number" ? BigInt(value) : values[index],
        ),
      );
    }, 30_000);
  }

  it("binds a negative argument into the program, which then reads it as the signed literal", async () => {
    const program = compileSauceProgram(
      "base",
      "function main(x: Int256): Int256 { return x - 1; }",
      {
        args: [-5n],
      },
    );
    expect(program.entryParams).toEqual([]);
    expect(await returned(program, new Uint8Array())).toEqual([unsigned(-6n)]);
    const minimum = compileSauceProgram("base", "function main(x: Int256): Int256 { return x; }", {
      args: [MIN],
    });
    expect(await returned(minimum, new Uint8Array())).toEqual([unsigned(MIN)]);
  }, 30_000);
});
