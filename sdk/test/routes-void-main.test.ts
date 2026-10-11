/**
 * A `main` that falls off the end is void: the compiler infers it, from the program's own syntax
 * tree, so nothing annotates the text. Every case that used to trip a text scan for "does `main`
 * return a value?" — a helper after `main`, a string or comment holding `return`, `{` or `)` —
 * compiles, to exactly the program its hand-annotated twin compiles to.
 */
import { compileSource } from "./helpers";

const bytes = (source: string): number[] => Array.from(compileSource(source, "evm").bytecode);

/** `source` with `main` annotated by hand, as the old seam wrote it. */
const annotated = (source: string): string =>
  source.replace(/function main\(([^]*?)\) /, "function main($1): void ");

describe("a main that falls off the end compiles as void", () => {
  it.each([
    ["a bare void main", "function main() { evm.sstore(1n, 2n); }"],
    [
      "a helper declared AFTER main",
      [
        "function main() { evm.sstore(1n, double(2n)); }",
        "function double(x: Uint256): Uint256 { return x + x; }",
      ].join("\n"),
    ],
    [
      'a thrown string containing the word "return"',
      'function main() { if (evm.sload(1n) > 0n) { throw "nothing to return here"; } }',
    ],
    [
      "a comment mentioning return",
      [
        "function main() {",
        "  // no return value: this is a void program",
        "  evm.sstore(1n, 2n);",
        "}",
      ].join("\n"),
    ],
    [
      "a block comment holding a brace between the params and the body",
      [
        "function main() /* opens here: { */ { evm.sstore(1n, double(2n)); }",
        "function double(x: Uint256): Uint256 { return x + x; }",
      ].join("\n"),
    ],
    ["a hex literal in the body", "function main() { const tag = hex`2a`; evm.sstore(1n, 2n); }"],
    [
      "a string holding an unbalanced brace",
      'function main() { if (evm.sload(1n) > 0n) { throw "}"; } evm.sstore(1n, 2n); }',
    ],
  ])("%s", (_case, source) => {
    expect(bytes(source)).toEqual(bytes(annotated(source)));
  });

  it("a comment naming `function main(` before the real one", () => {
    const source = [
      "// mirrors function main(",
      "function helper(): void { evm.sstore(3n, 4n); }",
      "function main() { helper(); }",
    ].join("\n");

    expect(bytes(source)).toEqual(
      bytes(source.replace("function main() {", "function main(): void {")),
    );
  });

  it("a paren inside a comment in the param list", () => {
    const source = "function main(/* takes ) nothing */) { evm.sstore(1n, 2n); }";

    expect(bytes(source)).toEqual(
      bytes("function main(/* takes ) nothing */): void { evm.sstore(1n, 2n); }"),
    );
  });
});

describe("a main that returns a value is not void", () => {
  it.each([
    ["an annotated main", "function main(): Uint256 { return 1n; }"],
    ["an unannotated main returning a value", "function main() { return evm.sload(1n); }"],
    [
      "a return inside a nested block",
      "function main() { if (evm.sload(1n) > 0n) { return 1n; } return 0n; }",
    ],
    [
      "a body holding a string with an unbalanced brace",
      'function main() { if (evm.sload(1n) > 0n) { throw "}"; } return 1n; }',
    ],
  ])("%s", (_case, source) => {
    expect(bytes(source).length).toBeGreaterThan(0);
  });
});
