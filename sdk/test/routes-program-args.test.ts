/**
 * A program compiled for `main`'s arguments (`compileSauceProgram`'s `args`): `main` reads each as a
 * constant of its value, so it takes none as it runs, and what they decide is decided while
 * compiling. Each case is held to the program the same values written as literals compile to.
 */
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { EntryArgumentError } from "../src/routes/entry.js";

const RECIPIENT = "0x6666666666666666666666666666666666666666";
const CREATOR = "0x4444444444444444444444444444444444444444";
/** A mint's key, as a Solana program holds an address: the whole word. */
const USDC_MINT = `0x${"c6".repeat(32)}`;
const INTENTS = {
  deadline: 2_000_000_000n,
  salt: `0x${"5a".repeat(32)}`,
  executionFee: 1_000n,
} as const;

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

  it("folds them into the intents main opens, whose bodies then capture nothing", () => {
    const opened = (amount: string, recipient: string) =>
      `Arbitrum.hop({ reward: { token: USDC, amount: ${amount} }, receive: { token: USDC, amount: ${amount} * 99 / 100 }, refundee: ${CREATOR} })
    .then(() => { USDC.transfer(${recipient}, ${amount} * 99 / 100); });`;
    const bound = compileSauceProgram(
      "base",
      `function main(amount: Uint256, recipient: Address) {\n  ${opened("amount", "recipient")}\n}`,
      { intents: INTENTS, args: [1_000_000n, RECIPIENT] },
    );
    const literal = compileSauceProgram(
      "base",
      `function main() {\n  ${opened("1000000", RECIPIENT)}\n}`,
      { intents: INTENTS },
    );
    expect(bound.bodies.map((body) => body.captures)).toEqual([[]]);
    expect(Array.from(bound.bodies[0]!.bytecode)).toEqual(Array.from(literal.bodies[0]!.bytecode));
    expect(Array.from(bound.bytecode)).toEqual(Array.from(literal.bytecode));
  });

  it("on Solana leaves an Account parameter to the manifest and takes a value for each other", () => {
    const source =
      "function main(destination: Account<Writable>, mint: Address, amount: Uint256): Uint256 { return balanceOf(mint, destination) + amount; }";
    const runs = compileSauceProgram("solana", source);
    const bound = compileSauceProgram("solana", source, { args: [USDC_MINT, 7n] });
    expect(runs.entryParams.map((param) => param.name)).toEqual(["mint", "amount"]);
    expect(bound.entryParams).toEqual([]);
    expect(bound.manifest).toEqual(runs.manifest);
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
