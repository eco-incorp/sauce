/**
 * A program compiled for `main`'s arguments (`compileSauceProgram`'s `args`): `main` reads each as a
 * constant of its value, so it takes none as it runs, and what they decide is decided while
 * compiling. Each case is held to the program the same values written as literals compile to.
 */
import { getAddressDecoder } from "@solana/kit";
import { hexToBytes } from "viem";

import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { EntryArgumentError } from "../src/routes/entry.js";

const RECIPIENT = "0x6666666666666666666666666666666666666666";
/** A mint's key, as a Solana program holds an address: the whole word. */
const USDC_MINT = `0x${"c6".repeat(32)}` as const;
const bytes = (
  chain: string,
  source: string,
  options?: Parameters<typeof compileSauceProgram>[2],
) => Array.from(compileSauceProgram(chain, source, options).bytecode);

describe("a program compiled for main's arguments", () => {
  it("is the program its arguments written as literals compile to, taking none as it runs", () => {
    const program = compileSauceProgram(
      "base",
      "function main(a: Uint256, b: bool): Uint256 { if (b) { return a + 1; } return a; }",
      { args: [5n, true] },
    );
    // It takes none as it runs; its signature still says what `main` declares.
    expect(program.entryParams).toEqual([]);
    expect(program.entrySignature.params.map((param) => param.name)).toEqual(["a", "b"]);
    expect(Array.from(program.bytecode)).toEqual(
      bytes("base", "function main(): Uint256 { return 6; }"),
    );
  });

  it("takes each word as a bigint, a safe integer, decimal or 0x digits, an address's bytes, or a bool", () => {
    const source =
      "function main(a: Uint256, b: Uint256, c: Uint256, to: Address, ok: bool): Uint256 { if (ok) { return a + b + c + to; } return 0; }";
    const expected = bytes("base", source, { args: [1n, 2n, 3n, BigInt(RECIPIENT), true] });
    const address = Uint8Array.from(Buffer.from(RECIPIENT.slice(2), "hex"));
    expect(bytes("base", source, { args: [1, "2", "0x3", address, true] })).toEqual(expected);
    expect(bytes("base", source, { args: [1n, 2n, 3n, RECIPIENT, true] })).toEqual(expected);
  });

  it("on Solana leaves an Account parameter to the manifest and takes a value for each other", () => {
    const source =
      "function main(destination: Account<Writable>, mint: Address, amount: Uint256): Uint256 { return balanceOf(mint, destination) + amount; }";
    const runs = compileSauceProgram("solana", source);
    const bound = compileSauceProgram("solana", source, { args: [USDC_MINT, 7n] });
    expect(runs.entryParams.map((param) => param.name)).toEqual(["mint", "amount"]);
    expect(bound.entryParams).toEqual([]);
    expect(bound.manifest).toEqual(runs.manifest);
    // A Solana key in base58 is the same word.
    const key = getAddressDecoder().decode(hexToBytes(USDC_MINT));
    expect(bytes("solana", source, { args: [key, 7n] })).toEqual(Array.from(bound.bytecode));
  });

  it("takes a negative integer for an Int256 as its two's-complement word, and only there", () => {
    const source = "function main(delta: Int256): Int256 { return delta / 2; }";
    expect(bytes("base", source, { args: [-100n] })).toEqual(
      bytes("base", source, { args: [(1n << 256n) - 100n] }),
    );
    expect(bytes("base", source, { args: ["-100"] })).toEqual(
      bytes("base", source, { args: [-100] }),
    );
    expect(() =>
      compileSauceProgram("base", "function main(a: Uint256): Uint256 { return a; }", {
        args: [-100n],
      }),
    ).toThrow(/args\[0\]: -100 is negative, and main's a is a Uint256/);
  });

  it("on Solana refuses a swap held to a stop, which takes its stop as main runs", () => {
    const source =
      "function main(amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
      "  return Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0);\n}\n";
    const stops = compileSauceProgram("solana", source).stoppable!;
    expect(() => compileSauceProgram("solana", source, { args: [1n, 2n], stops })).toThrow(
      /compile it without args, or without stops/,
    );
    expect(compileSauceProgram("solana", source, { args: [1n, 2n] }).entryParams).toEqual([]);
  });

  it("refuses a value that is not one word, naming its place", () => {
    const source = "function main(a: Uint256): Uint256 { return a; }";
    expect(() => compileSauceProgram("base", source, { args: [[1n]] })).toThrow(EntryArgumentError);
    expect(() => compileSauceProgram("base", source, { args: [{ a: 1n }] })).toThrow(
      /args\[0\]: a program is compiled for words/,
    );
    expect(() => compileSauceProgram("base", source, { args: [-1] })).toThrow(/args\[0\]/);
  });

  it("is held by the compiler to main's parameters: their count, and each word's type", () => {
    const source =
      "function main(a: Uint256, ok: bool): Uint256 { if (ok) { return a; } return 0; }";
    const codes = (args: readonly bigint[]): unknown => {
      try {
        compileSauceProgram("base", source, { args });
      } catch (error) {
        return (error as { diagnostics?: { code?: string }[] }).diagnostics?.map((d) => d.code);
      }
      return undefined;
    };
    expect(codes([1n])).toEqual(["ArgsCount"]);
    expect(codes([1n, 1n, 1n])).toEqual(["ArgsCount"]);
    expect(codes([1n, 2n])).toEqual(["ArgOutOfRange"]);
  });
});
