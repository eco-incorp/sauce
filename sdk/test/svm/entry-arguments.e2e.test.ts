/**
 * `main`'s arguments on Solana, EXECUTED: values encoded by `encodeEntryArguments`, appended to the
 * program, cooked through the released Kitchen and engine in LiteSVM, and read back from what `main`
 * returns. The EVM suite (`test/entry-arguments.e2e.test.ts`) has the full case list and the reason;
 * this pins that the Solana engine reads the same layout, since one encoder serves both.
 *
 * GATED on the engine artifacts like every engine-executing suite, and a hard failure without them
 * in CI (`engine-harness.ts`).
 */
import { bytesToHex, concatBytes, hexToBigInt, sliceHex, size } from "viem";

import {
  decodeEntryArguments,
  encodeEntryArguments,
  type EntryValue,
} from "../../src/routes/entry.js";
import { compileSauceProgram } from "../../src/routes/sauce-route.js";
import {
  buildComputeBudgetPrepend,
  buildCookInstruction,
  buildHeapFramePrepend,
} from "../../src/svm/index.js";
import {
  describeSvm,
  expectOk,
  HARNESS_POT_SALT,
  sendInstructions,
  startEngine,
  type EngineHarness,
} from "./engine-harness.js";

const CASES: ReadonlyArray<{
  name: string;
  source: string;
  values: EntryValue[];
  read: bigint[];
}> = [
  {
    name: "a tuple of fixed-size fields after a scalar",
    source: [
      "function main(x: Uint256, p: { a: Uint256, ok: bool }): { x: Uint256, a: Uint256, ok: bool } {",
      "  return { x: x, a: p.a, ok: p.ok };",
      "}",
    ].join("\n"),
    values: [5n, { a: 7n, ok: true }],
    read: [5n, 7n, 1n],
  },
  {
    name: "a tuple of fixed-size fields holding another, before a scalar",
    source: [
      "function main(p: { a: Uint256, q: { b: Uint256, c: Uint256 } }, x: Uint256): { a: Uint256, b: Uint256, c: Uint256, x: Uint256 } {",
      "  return { a: p.a, b: p.q.b, c: p.q.c, x: x };",
      "}",
    ].join("\n"),
    values: [{ a: 1n, q: { b: 2n, c: 3n } }, 4n],
    read: [1n, 2n, 3n, 4n],
  },
  {
    name: "a tuple with a bytes field",
    source: [
      "function main(p: { a: Uint256, data: bytes }, x: Uint256): { a: Uint256, len: Uint256, x: Uint256 } {",
      "  return { a: p.a, len: p.data.length, x: x };",
      "}",
    ].join("\n"),
    values: [{ a: 7n, data: "0xbeefcafe" }, 5n],
    read: [7n, 4n, 5n],
  },
];

describeSvm("main's arguments on Solana, as the compiled program reads them", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n);
  });

  /** What `main` returns, in decimal, one word per value. */
  const returned = async (bytecode: Uint8Array, encoded: Uint8Array): Promise<string[]> => {
    const { returnData } = expectOk(
      await sendInstructions(harness, [
        ...buildComputeBudgetPrepend({ unitLimit: 1_400_000 }),
        buildHeapFramePrepend(),
        buildCookInstruction({
          kitchen: harness.kitchen,
          owner: harness.payer.address,
          engineProgram: harness.programId,
          potSalt: HARNESS_POT_SALT,
          pot: harness.pot,
          feeConfig: harness.feeConfig,
          bytecode: concatBytes([bytecode, encoded]),
          maxExecutionFee: 0n,
          tail: [],
        }),
      ]),
    );
    const data = bytesToHex(returnData);

    return Array.from({ length: size(data) / 32 }, (_, index) =>
      hexToBigInt(sliceHex(data, index * 32, index * 32 + 32)).toString(),
    );
  };

  for (const { name, source, values, read } of CASES) {
    it(name, async () => {
      const program = compileSauceProgram("solana", source);
      const encoded = encodeEntryArguments(program, values);
      // Compared in decimal: jest cannot report a failed comparison of bigints from a worker.
      expect(await returned(program.bytecode, encoded)).toEqual(read.map(String));
      expect(decodeEntryArguments(program, encoded)).toEqual(values);
    });
  }
});
