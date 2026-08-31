import { compile } from '../src/index.js';

describe('program', () => {
  it('compiles empty main function', () => {
    const result = compile('function main() {}');

    expect(result.bytecode[0]).toBeInstanceOf(Uint8Array);
    expect(result.bytecode[0].length).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it('throws on missing main function', () => {
    expect(() => compile('')).toThrow('missing main() function');
  });

  it('throws on top-level statements', () => {
    // A bare expression statement is still a disallowed top-level node. (Top-level
    // `const X = …` is now ALLOWED — it registers a compile-time constant — so it no
    // longer trips this guard; missing main() is what stops a const-only program.)
    expect(() => compile('foo();')).toThrow('top-level statements not allowed, use function main()');
  });

  it('allows a top-level const (compile-time constant used to fold a branch)', () => {
    // The const folds the `if` condition (treeshake enables folding); it emits no
    // runtime code itself — it is a compile-time-only value, not a runtime variable.
    const result = compile('const X = 1; function main() { let r = 0n; if (X) { r = 9n; } return r; }', {
      treeshake: true,
    });

    expect(result.bytecode[0]).toBeInstanceOf(Uint8Array);
    expect(result.warnings).toEqual([]);
  });
});
