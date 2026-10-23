import { bytesToHex, encodeAbiParameters, hexToBytes, numberToHex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { decodeEntryArguments, encodeEntryArguments } from "../src/routes/entry.js";
import { decodeReturned } from "../src/routes/returned.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const MIN = -(1n << 255n);
const MAX = (1n << 255n) - 1n;
const signed = {
  entryEncoding: "abi-v1" as const,
  entryParams: [{ name: "delta", type: "Int256" }],
};

describe("Int256 entry and return values", () => {
  it.each([MIN, -1n, 0n, MAX])("round-trips the signed word %s", (delta) => {
    const encoded = encodeEntryArguments(signed, [delta]);
    expect(bytesToHex(encoded)).toBe(encodeAbiParameters([{ type: "int256" }], [delta]));
    expect(decodeEntryArguments(signed, encoded)).toEqual([delta]);
  });

  it("normalizes negative integer strings and rejects values outside the signed range", () => {
    expect(encodeEntryArguments(signed, ["-42"])).toEqual(encodeEntryArguments(signed, [-42n]));
    expect(() => encodeEntryArguments(signed, [MIN - 1n])).toThrow(/signed integer/);
    expect(() => encodeEntryArguments(signed, [MAX + 1n])).toThrow(/signed integer/);
    expect(() => encodeEntryArguments(signed, ["-0x01"])).toThrow(/signed integer/);
  });

  it("keeps signedness in arrays and record fields", () => {
    const program = {
      entryEncoding: "abi-v1" as const,
      entryParams: [{ name: "position", type: "{ debt: Int256, changes: Int256[] }" }],
    };
    const values = [{ debt: -7n, changes: [MIN, -1n, MAX] }];
    expect(decodeEntryArguments(program, encodeEntryArguments(program, values))).toEqual(values);
  });

  it("decodes signed returns rather than exposing their unsigned bit patterns", () => {
    const base = requireChain("base");
    const word = (value: bigint) => numberToHex(BigInt.asUintN(256, value), { size: 32 });
    expect(decodeReturned("Int256", word(MIN), base)).toBe(MIN.toString());
    expect(decodeReturned("Int256", word(-1n), base)).toBe("-1");
    const array = new Uint8Array([...hexToBytes(word(-7n)), ...hexToBytes(word(MAX))]);
    expect(decodeReturned("Int256[]", bytesToHex(array), base)).toEqual(["-7", MAX.toString()]);
  });

  it("compiles signed entry parameters and signed protocol results", () => {
    const program = compileSauceProgram(
      "base",
      "function main(delta: Int256): Int256 { return delta / 2; }",
    );
    expect(program.entryParams).toEqual([{ name: "delta", type: "Int256" }]);
    expect(decodeEntryArguments(program, encodeEntryArguments(program, [-100n]))).toEqual([-100n]);
    expect(() =>
      compileSauceProgram(
        "ethereum",
        "function main(): Int256 { return Chainlink.EthUsdFeed.latestRoundData().answer; }",
      ),
    ).not.toThrow();
  });

  it("binds signed compile-time arguments without losing their numeric kind", () => {
    const source = "function main(delta: Int256): Int256 { delta += 1; return delta / 2; }";
    expect(compileSauceProgram("base", source, { args: [-101n] }).entryParams).toEqual([]);
    expect(() =>
      compileSauceProgram("base", source, { args: [-101n], defines: { delta: 0n } }),
    ).toThrow(/not also a define/);
  });
});
