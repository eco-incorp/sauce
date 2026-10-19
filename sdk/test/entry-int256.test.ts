/**
 * `Int256` on the host side: the `main(...)` parameters the SDK encodes values for, the values it
 * reads back, the arguments it binds into a program as constants, and what a cook returns.
 *
 * The compiler reads an ABI `intN` as `Int256`, so a program may declare `main(delta: Int256)` and
 * return an `Int256`. The host must take a negative value for it (as the ABI's `int256`, its
 * two's-complement word), refuse one outside -2^255..2^255 - 1, and print a returned negative as
 * `-5`, not as 2^256 - 5. Executing these against the engine is `entry-arguments.e2e.test.ts`,
 * `cli-int256.e2e.test.ts` and the MCP chain suite.
 */
import { bytesToHex, encodeAbiParameters, hexToBytes, numberToHex, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { argumentValues, priceLimitNotes } from "../src/cli/commands.js";
import { svmKeyArguments } from "../src/cli/solana.js";
import { annotatedType } from "../src/sauce-script/declarations.js";
import {
  bindEntryArguments,
  decodeEntryArguments,
  encodeEntryArguments,
  mainParams,
  parseEntryType,
  type EntryValue,
} from "../src/routes/entry.js";
import { decodeReturned, returnedLine, returnedText } from "../src/routes/returned.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const MIN = -(1n << 255n);
const MAX = (1n << 255n) - 1n;
const TO = "0x6666666666666666666666666666666666666666";

/** A word as the engine returns it: 32 bytes, two's complement for a negative. */
const word = (value: bigint): Hex => numberToHex(BigInt.asUintN(256, value), { size: 32 });
const words = (...values: bigint[]): Hex =>
  `0x${values.map((value) => word(value).slice(2)).join("")}` as Hex;

const entry = (...params: Array<[string, string]>) => ({
  entryEncoding: "abi-v1" as const,
  entryParams: params.map(([name, type]) => ({ name, type })),
});

describe("Int256 entry parameters", () => {
  it("reads the annotation, and an unannotated parameter is still a Uint256", () => {
    expect(
      mainParams("function main(delta: Int256, amount, deltas: Int256[]) {}").map(
        (param) => param.type,
      ),
    ).toEqual(["Int256", "Uint256", "Int256[]"]);
    expect(parseEntryType("Int256")).toEqual({ kind: "int" });
    expect(parseEntryType("Uint256")).toEqual({ kind: "uint" });
  });

  it("encodes a negative value as the ABI's int256, and a Uint256 as before", () => {
    const program = entry(["delta", "Int256"]);
    for (const value of [-5n, 0n, 7n, MIN, MAX]) {
      expect(bytesToHex(encodeEntryArguments(program, [value]))).toBe(
        encodeAbiParameters([{ type: "int256" }], [value]),
      );
    }
    expect(bytesToHex(encodeEntryArguments(program, [-5n]))).toBe(word(-5n));
    expect(bytesToHex(encodeEntryArguments(program, [MIN]))).toBe(`0x80${"00".repeat(31)}`);
    expect(bytesToHex(encodeEntryArguments(program, [MAX]))).toBe(`0x7f${"ff".repeat(31)}`);
  });

  it.each<[string, EntryValue]>([
    ["a bigint", -5n],
    ["a safe-integer number", -5],
    ["decimal digits", "-5"],
    ["unsigned digits", "5"],
    ["hex magnitude", "0x5"],
    ["negative hex magnitude", "-0x5"],
  ])("takes %s", (_, value) => {
    const encoded = encodeEntryArguments(entry(["delta", "Int256"]), [value]);
    const expected = typeof value === "string" && !value.startsWith("-") ? 5n : -5n;
    expect(bytesToHex(encoded)).toBe(word(expected));
  });

  it("accepts -2^255 and 2^255 - 1, and refuses a value one past either", () => {
    const program = entry(["delta", "Int256"]);
    const message =
      /argument 1 \(delta: Int256\): .* is not a signed integer from -2\^255 to 2\^255 - 1/;
    expect(() => encodeEntryArguments(program, [MIN])).not.toThrow();
    expect(() => encodeEntryArguments(program, [MAX])).not.toThrow();
    expect(() => encodeEntryArguments(program, [MIN - 1n])).toThrow(message);
    expect(() => encodeEntryArguments(program, [MAX + 1n])).toThrow(message);
    expect(() => encodeEntryArguments(program, [(MIN - 1n).toString()])).toThrow(message);
    expect(() => encodeEntryArguments(program, [(MAX + 1n).toString()])).toThrow(message);
    // A two's-complement word is not a value: the unsigned reading of -5 is far past 2^255 - 1.
    expect(() => encodeEntryArguments(program, [(1n << 256n) - 5n])).toThrow(message);
    expect(() => encodeEntryArguments(program, [`0x${"ff".repeat(32)}`])).toThrow(message);
  });

  it("refuses what is not an integer", () => {
    const program = entry(["delta", "Int256"]);
    for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, "1.5", "--5", "five", "", true]) {
      expect(() => encodeEntryArguments(program, [value as EntryValue])).toThrow(
        /argument 1 \(delta: Int256\)/,
      );
    }
  });

  it("still refuses a negative for a Uint256", () => {
    expect(() => encodeEntryArguments(entry(["amount", "Uint256"]), [-1n])).toThrow(
      /argument 1 \(amount: Uint256\): -1n is not an unsigned integer/,
    );
  });

  it("encodes an array of them, and an Int256 in a tuple, as main reads them", () => {
    const deltas = [-1n, 0n, MAX, MIN];
    expect(bytesToHex(encodeEntryArguments(entry(["deltas", "Int256[]"]), [deltas]))).toBe(
      encodeAbiParameters([{ type: "int256[]" }], [deltas]),
    );
    expect(() => encodeEntryArguments(entry(["deltas", "Int256[]"]), [[0n, MAX + 1n]])).toThrow(
      /argument 1 \(deltas: Int256\[\]\)\[1\]: .* is not a signed integer/,
    );
    // The tuple is behind an offset word, its fields one word each.
    const pair = entry(["amount", "Uint256"], ["leg", "{ delta: Int256, to: Address }"]);
    expect(bytesToHex(encodeEntryArguments(pair, [9n, { delta: -2n, to: TO }]))).toBe(
      `0x${[word(9n), word(0x40n), word(-2n), word(BigInt(TO))].map((w) => w.slice(2)).join("")}`,
    );
    expect(encodeEntryArguments(pair, [9n, [-2n, TO]])).toEqual(
      encodeEntryArguments(pair, [9n, { delta: -2n, to: TO }]),
    );
    // An array of tuples holding an Int256: the tuples are inline, as abi.encode writes them.
    const legs = entry(["legs", "{ delta: Int256, amount: Uint256 }[]"]);
    expect(
      bytesToHex(
        encodeEntryArguments(legs, [
          [
            { delta: -1n, amount: 1n },
            { delta: MIN, amount: 2n },
          ],
        ]),
      ),
    ).toBe(
      encodeAbiParameters(
        [
          {
            type: "tuple[]",
            components: [
              { name: "delta", type: "int256" },
              { name: "amount", type: "uint256" },
            ],
          },
        ],
        [
          [
            { delta: -1n, amount: 1n },
            { delta: MIN, amount: 2n },
          ],
        ],
      ),
    );
  });

  it("reads them back signed, strictly", () => {
    const program = entry(
      ["delta", "Int256"],
      ["deltas", "Int256[]"],
      ["leg", "{ delta: Int256, amount: Uint256 }"],
      ["amount", "Uint256"],
    );
    const values = [-5n, [MIN, -1n, 0n, MAX], { delta: -2n, amount: 3n }, (1n << 256n) - 1n];
    const encoded = encodeEntryArguments(program, values);
    expect(decodeEntryArguments(program, encoded)).toEqual(values);
    // The word that is -5 is not a Uint256's 2^256 - 5 to a reader that knows the parameter.
    expect(decodeEntryArguments(entry(["x", "Int256"]), hexToBytes(word(-5n)))).toEqual([-5n]);
    expect(decodeEntryArguments(entry(["x", "Uint256"]), hexToBytes(word(-5n)))).toEqual([
      (1n << 256n) - 5n,
    ]);
    // Padding is still not the canonical encoding.
    expect(() =>
      decodeEntryArguments(entry(["x", "Int256"]), new Uint8Array([...hexToBytes(word(-5n)), 0])),
    ).toThrow(/not the canonical encoding/);
  });
});

describe("Int256 arguments bound into a program", () => {
  const SOURCE = "function main(x: Int256): Int256 {\n  return x - 1;\n}\n";

  it("binds a non-negative value as a define, as a Uint256 is", () => {
    const bound = bindEntryArguments(SOURCE, [5n]);
    expect(bound.constants).toEqual({ x: 5n });
    expect(bound.declared).toEqual([]);
    expect(bound.source).not.toContain("const x");
  });

  it("declares a negative value in the source, after its last line, since no define spells it", () => {
    const bound = bindEntryArguments(SOURCE, ["-5"]);
    expect(bound.constants).toEqual({});
    expect(bound.declared).toEqual(["x"]);
    // The parameter list is blanked in place, so every line before the end is the source's own.
    expect(
      bound.source.startsWith(`function main(${" ".repeat("x: Int256".length)}): Int256 {\n`),
    ).toBe(true);
    expect(bound.source.indexOf("  return x - 1;\n}\n")).toBe(
      SOURCE.indexOf("  return x - 1;\n}\n"),
    );
    expect(bound.source.endsWith("\nconst x: Int256 = -5;\n")).toBe(true);
    expect(bindEntryArguments(SOURCE, [MIN]).source).toContain(`const x: Int256 = ${MIN};`);
  });

  it("binds every kind of word together, a negative one among them", () => {
    const bound = bindEntryArguments(
      "function main(a: Uint256, d: Int256, who: Address, ok: bool, e: Int256) {}",
      [1n, -2n, TO, true, 3n],
    );
    expect(bound.constants).toEqual({ a: 1n, who: BigInt(TO), ok: true, e: 3n });
    expect(bound.declared).toEqual(["d"]);
    expect(bound.addresses).toEqual(["who"]);
  });

  it("refuses an Int256 outside its range, and an array of them (no one word holds it)", () => {
    expect(() => bindEntryArguments(SOURCE, [MIN - 1n])).toThrow(
      /argument 1 \(x: Int256\): .* is not a signed integer/,
    );
    expect(() => bindEntryArguments(SOURCE, [MAX + 1n])).toThrow(/is not a signed integer/);
    expect(() => bindEntryArguments("function main(xs: Int256[]) {}", [[1n]])).toThrow(
      /only one word binds as a constant/,
    );
  });

  it.each(["ethereum", "base", "solana"])("compiles with a negative value, for %s", (chain) => {
    const negative = compileSauceProgram(chain, SOURCE, { args: [-5n] });
    expect(negative.entryParams).toEqual([]);
    // As if the body read x as the literal -5: the same program written out.
    const written = compileSauceProgram(chain, "function main(): Int256 {\n  return -5 - 1;\n}\n");
    expect(Array.from(negative.bytecode)).toEqual(Array.from(written.bytecode));
    // The minimum (read, not decremented past it) and a value that is not a negative one compile
    // too; a program that does decrement the minimum is refused where it is compiled.
    const same = "function main(x: Int256): Int256 {\n  return x;\n}\n";
    expect(() => compileSauceProgram(chain, same, { args: [MIN] })).not.toThrow();
    expect(() => compileSauceProgram(chain, SOURCE, { args: [5n] })).not.toThrow();
    expect(() => compileSauceProgram(chain, SOURCE, { args: [MIN] })).toThrow(
      /outside Int256's range/,
    );
  });

  it("refuses a define that would replace the declared value", () => {
    expect(() =>
      compileSauceProgram("ethereum", SOURCE, { args: [-5n], defines: { x: 1n } }),
    ).toThrow(/x is main's parameter, given in args; it is not also a define/);
  });
});

describe("what a cook returns as an Int256", () => {
  const base = requireChain("base");

  it("reads a negative word as signed, and a Uint256's as unsigned", () => {
    expect(decodeReturned("Int256", word(-6n), base)).toBe("-6");
    expect(decodeReturned("Int256", word(MIN), base)).toBe(MIN.toString());
    expect(decodeReturned("Int256", word(MAX), base)).toBe(MAX.toString());
    expect(decodeReturned("Int256", word(7n), base)).toBe("7");
    // The same word, read as the type that is unsigned.
    expect(decodeReturned("Uint256", word(-6n), base)).toBe(((1n << 256n) - 6n).toString());
  });

  it("reads one in an array and in a record", () => {
    expect(decodeReturned("Int256[]", words(-1n, 0n, 2n, MIN), base)).toEqual([
      "-1",
      "0",
      "2",
      MIN.toString(),
    ]);
    expect(decodeReturned("{ delta: Int256, amount: Uint256 }", words(-4n, 4n), base)).toEqual({
      delta: "-4",
      amount: "4",
    });
    expect(
      decodeReturned("{ delta: Int256, amount: Uint256 }[]", words(-4n, 4n, 5n, 6n), base),
    ).toEqual([
      { delta: "-4", amount: "4" },
      { delta: "5", amount: "6" },
    ]);
  });

  it("prints it negative, in text and as JSON", () => {
    expect(returnedLine("Int256", word(-6n), base)).toBe("main returns Int256: -6");
    expect(returnedText(decodeReturned("Int256[]", words(-1n, 2n), base)!)).toBe("[-1, 2]");
    expect(returnedText(decodeReturned("{ d: Int256 }", word(-9n), base)!)).toBe("{ d: -9 }");
    expect(JSON.stringify(decodeReturned("{ d: Int256 }", word(-9n), base))).toBe('{"d":"-9"}');
    // A shape that does not fit is not guessed at, as for every type.
    expect(decodeReturned("Int256", words(-1n, 1n), base)).toBeUndefined();
  });
});

describe("an Int256 where the command reads the integers it was given", () => {
  const args = (...values: string[]) => ({ from: "--args" as const, values });

  it("takes a negative --args word as the value itself, whatever the parameter", () => {
    expect(argumentValues([{ name: "x", type: "Int256" }], args("-5"))).toEqual(["-5"]);
    expect(argumentValues([{ name: "xs", type: "Int256[]" }], args("[-5, 6]"))).toEqual([[-5, 6]]);
  });

  it("notes a price limit that is an Int256 below the pool's bounds, as it does a Uint256", () => {
    const note = (type: string, value: string) =>
      priceLimitNotes({ defines: {} }, [{ name: "sqrtPriceLimitX96", type }], args(value));
    expect(note("Int256", "-5")).toEqual([expect.stringMatching(/is below MIN_SQRT_RATIO/)]);
    expect(note("Int256", "0")).toEqual([]);
    expect(note("Int256", "79228162514264337593543950336")).toEqual([]);
    expect(note("Uint256", "1")).toEqual([expect.stringMatching(/is below MIN_SQRT_RATIO/)]);
    // A negative word is no Uint256 here: encoding it is the one that refuses, in its own words.
    expect(note("Uint256", "-5")).toEqual([]);
  });

  it("hands a Solana program's Int256 arguments to the names derived from them", () => {
    const program = {
      chain: requireChain("solana"),
      entryParams: [
        { name: "index", type: "Int256" },
        { name: "other", type: "Uint256" },
        { name: "back", type: "Int256" },
      ],
    } as unknown as Parameters<typeof svmKeyArguments>[0];
    expect(svmKeyArguments(program, args("300", "7", "-5")).integers).toEqual({
      index: 300n,
      other: 7n,
      back: -5n,
    });
  });
});

describe("the declarations for a library function annotated Int256", () => {
  it("are a number going in and a bigint coming out, as for Uint256", () => {
    for (const type of ["Int256", "Uint256"]) {
      expect(annotatedType(type, true)).toBe("SauceInt");
      expect(annotatedType(type, false)).toBe("bigint");
      expect(annotatedType(`${type}[]`, true)).toBe(
        "(ReadonlyArray<SauceInt> | SauceArray<SauceInt>)",
      );
    }
  });
});
