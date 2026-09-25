/**
 * What a SauceScript string literal MEANS in a `bytes` argument: raw UTF-8, with no hex decoding.
 *
 * `""` is the empty-bytes literal. `"0x"` is **two bytes**, the ASCII `0` and `x` — it is not an
 * empty-bytes spelling, and `"0x1234"` is six ASCII bytes rather than the two bytes `0x12 0x34`.
 *
 * This exists because compiler 0.7.0 started rejecting `0x00` in a bytes position (it is a number),
 * every recipe placeholder had to change, and `"0x"` was chosen on the strength of its COMPILING.
 * It compiled and shipped two junk bytes into every `bytes` argument the callee reads — a non-empty
 * CCIP `extraArgs` fails its tag decode, a non-empty Across `message` makes the recipient a message
 * handler. Acceptance is not semantics, so the emission is asserted here in bytes.
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { compileSauceFunctionRust } from "./helpers";

const ACROSS = resolve(process.cwd(), "src", "protocols", "across");
const PROTOCOLS = resolve(process.cwd(), "src", "protocols");

/** `90LL` is a length-prefixed literal push; `LL` is the payload length in bytes. */
const literalPushes = (bytecode: Uint8Array): string[] =>
  Buffer.from(bytecode)
    .toString("hex")
    .match(/90[0-9a-f]{2}/g) ?? [];

const compileWithMessage = (literal: string): Uint8Array =>
  compileSauceFunctionRust(
    [
      'import { AcrossSpokePoolABI as ISpokePool } from "./abis";',
      "",
      "function main(spokePoolAddress: Address, token: Address, amount: Uint256, destinationChainId: Uint256, recipient: Address): Uint256 {",
      "  const spokePool = ISpokePool.at(spokePoolAddress);",
      `  spokePool.deposit(recipient, token, amount, destinationChainId, 0, 0, ${literal}, 0);`,
      "  return 1;",
      "}",
    ].join("\n"),
    ACROSS,
  ).bytecode;

describe("a string literal in a bytes argument is raw UTF-8", () => {
  it.each([
    ['""', "9000", "empty"],
    ['"0x"', "9002", "two ASCII bytes — NOT empty"],
    ['"ab"', "9002", 'two ASCII bytes, same length as `"0x"`'],
    ['"0x1234"', "9006", "six ASCII bytes, not two hex bytes"],
  ])("%s pushes %s (%s)", (literal, push) => {
    expect(literalPushes(compileWithMessage(literal))).toContain(push);
  });

  // `0x00` is what the recipes used before 0.7.0, and it is a NUMBER — the rejection is the reason
  // the sweep happened at all.
  it("a bare 0x00 is rejected as a number, not accepted as bytes", () => {
    expect(() => compileWithMessage("0x00")).toThrow(/expected a bytes value, found a number/);
  });
});

describe('no recipe spells empty bytes as `"0x"`', () => {
  const sources = readdirSync(PROTOCOLS)
    .map((slug) => join(PROTOCOLS, slug, "functions.ts"))
    .filter(existsSync);

  it("every protocol has a functions.ts to check", () => {
    expect(sources.length).toBeGreaterThan(100);
  });

  it('none of them contains the two-byte `"0x"` placeholder', () => {
    const offenders = sources.filter((path) => readFileSync(path, "utf8").includes('"0x"'));

    expect(offenders.map((p) => p.replace(`${PROTOCOLS}/`, ""))).toEqual([]);
  });
});
