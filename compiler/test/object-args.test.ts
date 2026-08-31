import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

// Object (struct) arguments at the main() boundary. An object arg encodes as a
// TUPLE with fields sorted ALPHABETICALLY — byte-identical to an in-script object
// literal — so main() reads its fields with `param.field` (and nested
// `param.child.field`) via the same INDEX lowering as any in-script struct.
describe('compile with object (struct) args', () => {
  it('encodes an object arg as an alphabetically-ordered tuple (v1)', () => {
    // Declaration order {b,a} must still emit fields in sorted order [a, b].
    const result = compile('function main(cfg) { return cfg.a; }', {
      args: [{ b: 2n, a: 1n }],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.TUPLE, 2,            // struct → tuple, 2 fields (alphabetical: a, b)
      OPS.BYTE_1, 1,           // a = 1
      OPS.BYTE_1, 2,           // b = 2
    ]));
  });

  it('reads a top-level struct field by name (compiles to INDEX)', () => {
    const result = compile('function main(cfg) { const x = cfg.b; return x; }', {
      args: [{ a: 1n, b: 2n }],
    });

    // Field access lowers to INDEX into the param tuple (heap read of the temp).
    expect(result.bytecode[0]).toContain(OPS.INDEX);
  });

  it('rejects an unknown struct field on a main() param', () => {
    expect(() => compile('function main(cfg) { return cfg.missing; }', { args: [{ a: 1n }] })).toThrow(
      "unknown field 'missing'",
    );
  });

  it('encodes a nested struct arg (chained field access resolves)', () => {
    // top-level scalars + a nested object → nested TUPLE; chain.x reads at depth 2.
    const result = compile('function main(cfg) { return cfg.chain.vault; }', {
      args: [{ amountIn: 5n, chain: { router: 7n, vault: 9n } }],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // Outer tuple fields alphabetical: amountIn (scalar), chain (nested tuple).
    // Nested tuple fields alphabetical: router, vault.
    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1,
      OPS.TUPLE, 2,
      OPS.BYTE_1, 5,   // amountIn = 5
      OPS.TUPLE, 2,    // chain
      OPS.BYTE_1, 7,   // chain.router = 7
      OPS.BYTE_1, 9,   // chain.vault = 9
    ]));

    // The nested read compiles (two INDEX ops: cfg.chain, then .vault).
    expect(result.bytecode[0]).toContain(OPS.INDEX);
  });

  it('mixes struct, scalar, and array args in one call', () => {
    const result = compile('function main(cfg, n, pools) { return cfg.a + n + pools[0]; }', {
      args: [{ b: 2n, a: 1n }, 100n, [7n]],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 3,
      OPS.TUPLE, 2,      // cfg → { a, b }
      OPS.BYTE_1, 1,
      OPS.BYTE_1, 2,
      OPS.BYTE_1, 100,   // n
      OPS.TUPLE, 1,      // pools → [7]
      OPS.BYTE_1, 7,
    ]));
  });

  it('compiles an object arg on the v12 target (single blob, no throw)', () => {
    const result = compile('function main(cfg) { return cfg.chain.vault + cfg.amountIn; }', {
      args: [{ amountIn: 5n, chain: { router: 7n, vault: 9n } }],
      target: 'v12',
    });

    // v12 assembles one blob; the arg-prologue pushes the tuple and main reads its fields.
    expect(result.bytecode).toHaveLength(1);
    expect(result.bytecode[0].length).toBeGreaterThan(0);
    expect(result.bytecode[0]).toContain(OPS.TUPLE);
  });

  it('rejects a struct arg in staged svm mode', () => {
    expect(() =>
      compile('function main(cfg) { return cfg.a; }', {
        args: [{ a: 1n }],
        target: 'svm',
        staged: true,
      }),
    ).toThrow(/staged svm args do not support struct values/);
  });
});
