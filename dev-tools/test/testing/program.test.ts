/**
 * What the kit reads back from a program, with no chain: `main`'s return decoded as it declares it.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concat, numberToHex, padHex, stringToHex, type Hex } from "viem";

import { compileProgram } from "../../src/testing/program.js";
import { requireChain } from "../../src/testing/sdk.js";

const base = requireChain("base");
const word = (value: bigint | number | boolean): Hex =>
  numberToHex(typeof value === "boolean" ? (value ? 1n : 0n) : BigInt(value), { size: 32 });
/** `main` declaring `returnType`; only its declaration matters to `decode`. */
const returning = (returnType: string, body: string) =>
  compileProgram({ source: `function main(): ${returnType} {\n  return ${body};\n}\n` }, base);

describe("decode", () => {
  it("keeps a returned string a string, digits and leading zeroes included", () => {
    const program = returning("string", '"123"');
    assert.equal(program.decode(stringToHex("123")), "123");
    assert.equal(program.decode(stringToHex("007")), "007");
    assert.equal(program.decode(stringToHex("")), "");
  });

  it("reads integers as bigints, wherever the type has them", () => {
    assert.equal(returning("Uint256", "7").decode(word(7)), 7n);

    const array = returning("Uint256[]", "[1, 2]");
    assert.deepEqual(array.decode(concat([word(1), word(2)])), [1n, 2n]);

    const self = "0x00000000000000000000000000000000000000AA";
    const record = returning(
      "{ amount: Uint256; to: Address; ok: bool }",
      "{ amount: 7, to: ctx.self(), ok: true }",
    );
    assert.deepEqual(record.decode(concat([word(7), padHex(self, { size: 32 }), word(true)])), {
      amount: 7n,
      to: "0x00000000000000000000000000000000000000AA",
      ok: true,
    });
  });
});
