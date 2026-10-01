/**
 * An unannotated `main` that falls off the end is a `: void` entry — the compiler infers it, so
 * nothing annotates the source first. These are the shapes a text scan for "does `main` return a
 * value?" got wrong when the SDK did annotate it (a helper's `return`, a word in a string or a
 * comment, a brace in a literal): each must still compile, and one that does return a value must
 * still be a value entry.
 */
import { compileSource } from "./helpers";

/** A compile IS the assertion: an unannotated `main` the compiler could not read as void fails. */
const compiles = (source: string): number => compileSource(source, "evm").bytecode.length;

describe("a main that falls off the end is void", () => {
  it("a bare void main", () => {
    const source = "function main() { evm.sstore(1n, 2n); }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a helper declared AFTER main does not suppress the annotation", () => {
    // The helper's `return` is not main's. Scanning to end-of-FILE saw it and left main unannotated.
    const source = [
      "function main() { evm.sstore(1n, double(2n)); }",
      "function double(x: Uint256): Uint256 { return x + x; }",
    ].join("\n");

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a thrown string containing the word "return" does not suppress it', () => {
    // The word is inside a literal, not a `return` statement.
    const source =
      'function main() { if (evm.sload(1n) > 0n) { throw "nothing to return here"; } }';

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a comment mentioning return does not suppress it", () => {
    const source = [
      "function main() {",
      "  // no return value: this is a void program",
      "  evm.sstore(1n, 2n);",
      "}",
    ].join("\n");

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a BLOCK comment between the params and the body does not derail the brace search", () => {
    // The brace inside the comment was found before any blanking, so the body walk started one level
    // in, never balanced, and read to EOF — where `helper`'s `return` suppressed the annotation.
    const source = [
      "function main() /* opens here: { */ { evm.sstore(1n, double(2n)); }",
      "function double(x: Uint256): Uint256 { return x + x; }",
    ].join("\n");

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a block comment INSIDE the body mentioning return does not suppress it", () => {
    const source = [
      "function main() {",
      "  /* no return",
      "     value here */",
      "  evm.sstore(1n, 2n);",
      "}",
    ].join("\n");

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a backtick literal in the body does not derail the scan", () => {
    // `hex` is the one tagged template the M1 subset accepts, so this is the only backtick case that
    // can also be compiled; the `{`/`return` variant below is annotation-only for that reason.
    const source = "function main() { const tag = hex`2a`; evm.sstore(1n, 2n); }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a comment naming `function main(` before the real one does not steal the match", () => {
    // The signature regex ran on the RAW source, so the comment's spelling matched first. The paren
    // walk then ran on from there and closed on `helper`'s list, whose `: void` read as
    // already-annotated — so the real `main` was left bare, which does not compile.
    const source = [
      "// mirrors function main(",
      "function helper(): void { evm.sstore(3n, 4n); }",
      "function main() { helper(); }",
    ].join("\n");

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a paren inside a comment in the param list does not mis-locate the closing paren", () => {
    // The paren walk ran on the RAW source too, so the comment's `)` closed the list early and `: void`
    // landed mid-comment.
    const source = "function main(/* takes ) nothing */) { evm.sstore(1n, 2n); }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a string containing an unbalanced brace does not truncate the body's walk", () => {
    const source = 'function main() { if (evm.sload(1n) > 0n) { throw "}"; } evm.sstore(1n, 2n); }';

    expect(compiles(source)).toBeGreaterThan(0);
  });
});

describe("a main that returns a value, or none at all, is left as it is", () => {
  it("an already-annotated main", () => {
    const source = "function main(): Uint256 { return 1n; }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("an unannotated main that returns a value", () => {
    const source = "function main() { return evm.sload(1n); }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a value-returning main whose return sits inside a nested block", () => {
    const source = "function main() { if (evm.sload(1n) > 0n) { return 1n; } return 0n; }";

    expect(compiles(source)).toBeGreaterThan(0);
  });

  it("a value-returning main whose body carries a string with an unbalanced brace", () => {
    // Counting the literal's `}` truncates the walk before the real `return`, so main gets annotated
    // `: void` while returning a value — the opposite failure to the block-comment one, equally silent.
    const source = 'function main() { if (evm.sload(1n) > 0n) { throw "}"; } return 1n; }';

    expect(compiles(source)).toBeGreaterThan(0);
  });
});
