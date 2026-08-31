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

  it('a source with no main at all', () => {
    const source = 'function helper(x: Uint256): Uint256 { return x; }';

    expect(ensureVoidMain(source)).toBe(source);
  });
});
