/**
 * A plain integer literal and its `n` spelling are the same integer: `1` and `1n` compile to the
 * same program, on both targets.
 *
 * The skills and the manual write SauceScript's integers plainly (`0`, `3000`, `10 ** 18`, an
 * address as its hex) and `docs/scripts/integer-literals.mjs` holds them to it, on the strength of
 * this: the compiler reads each literal from its text as a 256-bit integer, so a value past 2^53 is
 * exact, and the `n` changes nothing. Asserted through the SDK's `./compiler` subpath against
 * whatever compiler the workspaces resolve, so a compiler that started to tell them apart fails here.
 */
import { compile } from "../src/compiler.js";

const ENTRY = "main.js";

function bytecode(target: "evm" | "svm", source: string, optimize: boolean): string {
  const result = compile({
    target,
    entry: ENTRY,
    optimize,
    resolve: (path: string) => (path === ENTRY ? new TextEncoder().encode(source) : undefined),
  });
  return Buffer.from(result.bytecode).toString("hex");
}

/** Each program with `$` where a literal's `n` goes: `$` dropped is the plain spelling. */
const PROGRAMS: ReadonlyArray<readonly [string, string, ReadonlyArray<"evm" | "svm">?]> = [
  ["zero and one", "function main(a: Uint256): Uint256 { if (a > 0$) { return 1$; } return 0$; }"],
  ["a fee tier", "function main(a: Uint256): Uint256 { return a * 3000$ / 1000000$; }"],
  ["past 2^53", "function main(a: Uint256): Uint256 { return a + 1000000000000000000000$; }"],
  ["2^53 + 1", "function main(a: Uint256): Uint256 { return a * 9007199254740993$; }"],
  [
    "the largest integer",
    "function main(a: Uint256): Uint256 { return a & 115792089237316195423570985008687907853269984665640564039457584007913129639935$; }",
  ],
  ["hex", "function main(a: Uint256): Uint256 { return a & 0xff$ | 0xFF00$; }"],
  [
    "an address",
    "function main(a: Address): Uint256 { if (a == 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913$) { return 1$; } return 0$; }",
  ],
  ["separators", "function main(a: Uint256): Uint256 { return a + 1_000_000$; }"],
  ["negation", "function main(a: Int256): Int256 { return a + -1$; }"],
  ["the maximum, ~0", "function main(): Uint256 { return ~0$; }"],
  ["a power", "function main(a: Uint256): Uint256 { return a * 10$ ** 18$; }"],
  ["folded division", "function main(): Uint256 { return 99$ / 100$ + 7$ / 2$; }"],
  ["beside a Uint256", "function main(a: Uint256): Uint256 { let x = 5$; x = x + a; return x; }"],
  [
    "a loop",
    "function main(a: Uint256): Uint256 { let s = 0$; for (let i = 0$; i < a; i += 1$) { s += i; } return s; }",
  ],
  [
    "a helper's argument",
    "function f(x: Uint256): Uint256 { return x * 2$; }\nfunction main(): Uint256 { return f(21$); }",
  ],
  [
    "a module const and a lookup table",
    "const FEE = 3000$;\nconst FEES = [100$, 500$, 3000$];\nfunction main(a: Uint256): Uint256 { return a * FEE + FEES[1$]; }",
  ],
  [
    "arrays and records",
    "function main(a: Uint256): Uint256 { const xs = [a, 2$]; const r = { x: 1$, y: a }; return xs[0$] + r.x; }",
  ],
  ["a builtin's arguments", "function main(a: Uint256): bytes { return a.toBytesBe(32$); }"],
  [
    "signed math",
    "function main(a: Uint256): Int256 { return Int256.fromBits(a) / -2$ + Int256(Math.mulDiv(a, 30$, 10000$)); }",
  ],
  [
    "signed remainder and arithmetic shift",
    "function main(a: Int256): Int256 { return (a % 3$) >> 1$; }",
  ],
  [
    "checked integer conversions",
    "function main(a: Uint256): Uint256 { return Uint256(Int256(a) + 1$); }",
  ],
  [
    "signed bit roundtrip",
    "function main(): Uint256 { return Uint256.fromBits(Int256.fromBits(~0$) / 2$); }",
  ],
  ["a signed constant", "function main(): Int256 { const d: Int256 = 1$ - 2$; return d; }"],
  [
    "the smallest signed integer",
    "function main(): Int256 { return -57896044618658097711785492504343953926634992332820282019728792003956564819968$; }",
  ],
  ["a script", "let total: Uint256 = 0$;\ntotal = total + 5$;"],
  [
    "evm storage and value",
    "function main(to: Address): void { evm.sstore(0$, evm.sload(0$) + 1$); evm.call(to, 1000$, hex`d0e30db0`); }",
    ["evm"],
  ],
  [
    "svm account data",
    "function main(acct: Account): Uint256 { return svm.sload(acct, 64$, 8$).toLe(); }",
    ["svm"],
  ],
];

const BOTH: ReadonlyArray<"evm" | "svm"> = ["evm", "svm"];

describe("a plain integer literal compiles as its `n` spelling does", () => {
  for (const [name, program, targets = BOTH] of PROGRAMS) {
    for (const target of targets) {
      it(`${name}, ${target}`, () => {
        for (const optimize of [true, false]) {
          const plain = bytecode(target, program.replaceAll("$", ""), optimize);
          expect(plain).toBe(bytecode(target, program.replaceAll("$", "n"), optimize));
        }
      });
    }
  }

  it("negative control: a different integer is a different program", () => {
    const one = "function main(a: Uint256): Uint256 { return a + 1000000000000000000000; }";
    const other = one.replace("1000000000000000000000", "1000000000000000000001");

    expect(bytecode("evm", one, true)).not.toBe(bytecode("evm", other, true));
  });
});

describe("signed integer semantics", () => {
  for (const target of BOTH) {
    it.each([
      ["division rounds toward zero", "Int256", "-7 / 2", "-3"],
      ["remainder keeps the dividend's sign", "Int256", "-7 % 3", "-1"],
      ["right shift extends the sign", "Int256", "-7 >> 1", "-4"],
      ["unsigned bits become signed", "Int256", "Int256.fromBits(~0)", "-1"],
      ["signed bits become unsigned", "Uint256", "Uint256.fromBits(-1)", "~0"],
      ["negative values sort below unsigned values", "bool", "-1 < 0", "true"],
    ])("%s, " + target, (_name, type, expression, expected) => {
      expect(bytecode(target, `function main(): ${type} { return ${expression}; }`, true)).toBe(
        bytecode(target, `function main(): ${type} { return ${expected}; }`, true),
      );
    });

    it.each(["Int256(~0)", "Uint256(-1)"])(
      "rejects an out-of-range checked conversion %s, " + target,
      (expression) => {
        for (const optimize of [true, false]) {
          expect(() =>
            bytecode(target, `function main() { return ${expression}; }`, optimize),
          ).toThrow(/outside .*range/);
        }
      },
    );
  }
});
