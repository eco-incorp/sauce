/**
 * `ensureVoidMain` — the single compile seam's `: void` annotation, and the two ways the scan for
 * "does `main` return a value?" can read something that is not `main`'s own code.
 *
 * Each case COMPILES: an unannotated `main` that falls off the end is a compile error, so a missing
 * `: void` fails here rather than only showing up as a differently-shaped string.
 */
import { ensureVoidMain } from '../src/routes/rs-compile.js';
import { compileSource } from './helpers';

/** `compileSource` runs `ensureVoidMain` itself, so a compile IS the assertion. */
const compiles = (source: string): number => compileSource(source, 'evm').bytecode.length;

describe('ensureVoidMain annotates a main that falls off the end', () => {
  it('a bare void main', () => {
    const source = 'function main() { evm.sstore(1n, 2n); }';

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a helper declared AFTER main does not suppress the annotation', () => {
    // The helper's `return` is not main's. Scanning to end-of-FILE saw it and left main unannotated.
    const source = [
      'function main() { evm.sstore(1n, double(2n)); }',
      'function double(x: Uint256): Uint256 { return x + x; }',
    ].join('\n');

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a thrown string containing the word "return" does not suppress it', () => {
    // The word is inside a literal, not a `return` statement.
    const source = 'function main() { if (evm.sload(1n) > 0n) { throw "nothing to return here"; } }';

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a comment mentioning return does not suppress it', () => {
    const source = ['function main() {', '  // no return value: this is a void program', '  evm.sstore(1n, 2n);', '}'].join(
      '\n',
    );

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a BLOCK comment between the params and the body does not derail the brace search', () => {
    // The brace inside the comment was found before any blanking, so the body walk started one level
    // in, never balanced, and read to EOF — where `helper`'s `return` suppressed the annotation.
    const source = [
      'function main() /* opens here: { */ { evm.sstore(1n, double(2n)); }',
      'function double(x: Uint256): Uint256 { return x + x; }',
    ].join('\n');

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a block comment INSIDE the body mentioning return does not suppress it', () => {
    const source = ['function main() {', '  /* no return', '     value here */', '  evm.sstore(1n, 2n);', '}'].join('\n');

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a backtick literal in the body does not derail the scan', () => {
    // `hex` is the one tagged template the M1 subset accepts, so this is the only backtick case that
    // can also be compiled; the `{`/`return` variant below is annotation-only for that reason.
    const source = 'function main() { const tag = hex`2a`; evm.sstore(1n, 2n); }';

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a template literal carrying a brace and the word return does not suppress it', () => {
    // NOT compiled: an untagged template literal is outside the M1 subset ("this expression is not
    // supported"), so the annotation is the whole assertion here. `mainBody` still has to blank it —
    // the generators emit plain JS and nothing stops one carrying a backtick.
    const source = 'function main() { const label = `{ return }`; evm.sstore(1n, 2n); }';

    expect(ensureVoidMain(source)).toContain('function main(): void');
  });

  it("a string containing an unbalanced brace does not truncate the body's walk", () => {
    const source = 'function main() { if (evm.sload(1n) > 0n) { throw "}"; } evm.sstore(1n, 2n); }';

    expect(ensureVoidMain(source)).toContain('function main(): void');
    expect(compiles(source)).toBeGreaterThan(0);
  });
});

describe('ensureVoidMain leaves a main it must not touch alone', () => {
  it('an already-annotated main', () => {
    const source = 'function main(): Uint256 { return 1n; }';

    expect(ensureVoidMain(source)).toBe(source);
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('an unannotated main that returns a value', () => {
    const source = 'function main() { return evm.sload(1n); }';

    expect(ensureVoidMain(source)).toBe(source);
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a value-returning main whose return sits inside a nested block', () => {
    const source = 'function main() { if (evm.sload(1n) > 0n) { return 1n; } return 0n; }';

    expect(ensureVoidMain(source)).toBe(source);
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a value-returning main whose body carries a string with an unbalanced brace', () => {
    // Counting the literal's `}` truncates the walk before the real `return`, so main gets annotated
    // `: void` while returning a value — the opposite failure to the block-comment one, equally silent.
    const source = 'function main() { if (evm.sload(1n) > 0n) { throw "}"; } return 1n; }';

    expect(ensureVoidMain(source)).toBe(source);
    expect(compiles(source)).toBeGreaterThan(0);
  });

  it('a source with no main at all', () => {
    const source = 'function helper(x: Uint256): Uint256 { return x; }';

    expect(ensureVoidMain(source)).toBe(source);
  });
});
