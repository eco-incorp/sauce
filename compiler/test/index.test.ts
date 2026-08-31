import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('index', () => {
  it('compiles array index with literal', () => {
    const result = compile('function main() { const arr = [1, 2, 3]; const x = arr[0]; }');
    // ALLOCATE_VALUE, 1 (for x),
    // ALLOCATE_HEAP, 1 (for arr),
    // WRITE_HEAP, 0, ARRAY, 3, BYTE_1, 1, 2, 3,
    // WRITE_VALUE, 0, INDEX, BYTE_1, 0, READ_HEAP, 0
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.ALLOCATE_HEAP,
        1,
        OPS.WRITE_HEAP,
        0,
        OPS.ARRAY,
        3,
        OPS.BYTE_1,
        1,
        2,
        3,
        OPS.WRITE_VALUE,
        0,
        OPS.INDEX,
        OPS.BYTE_1,
        0,
        OPS.READ_HEAP,
        0,
      ]),
    );
  });

  it('compiles string index with literal', () => {
    const result = compile('function main() { const s = "abc"; const c = s[1]; }');
    // ALLOCATE_VALUE, 1 (for c),
    // ALLOCATE_HEAP, 1 (for s),
    // WRITE_HEAP, 0, BYTES, 3, a, b, c,
    // WRITE_VALUE, 0, INDEX, BYTE_1, 1, READ_HEAP, 0
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.ALLOCATE_HEAP,
        1,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        3,
        97,
        98,
        99,
        OPS.WRITE_VALUE,
        0,
        OPS.INDEX,
        OPS.BYTE_1,
        1,
        OPS.READ_HEAP,
        0,
      ]),
    );
  });

  it('compiles length property', () => {
    const result = compile('function main() { const arr = [1, 2, 3]; const len = arr.length; }');
    // ALLOCATE_VALUE, 1 (for len),
    // ALLOCATE_HEAP, 1 (for arr),
    // WRITE_HEAP, 0, ARRAY, 3, BYTE_1, 1, 2, 3,
    // WRITE_VALUE, 0, LENGTH, READ_HEAP, 0
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.ALLOCATE_HEAP,
        1,
        OPS.WRITE_HEAP,
        0,
        OPS.ARRAY,
        3,
        OPS.BYTE_1,
        1,
        2,
        3,
        OPS.WRITE_VALUE,
        0,
        OPS.LENGTH,
        OPS.READ_HEAP,
        0,
      ]),
    );
  });

  it('throws for unsupported property access', () => {
    expect(() => compile('function main() { const obj = [1]; const x = obj.foo; }')).toThrow(
      "property 'foo' access not supported",
    );
  });

  // Sweep-finding regression lock (see CLAUDE.md's "Same-file user-function return-kind
  // inference" note, "sweep finding 13"): an object-literal-shaped LOCAL's property
  // read/write and a function PARAMETER's property read are all rejected outright at
  // compile time on every target — there is no object-shaped-local code path at all
  // outside an object literal's own field access (`p.x` where `p = { x: ..., y: ... }`
  // resolves via `structType` tracking; a plain array or an opaque parameter has none),
  // so there is no object-shaped value whose STORAGE KIND could ever be mis-inferred the
  // way this whole bug family is about.
  it('throws for unsupported property assignment on an array-shaped local', () => {
    // A mutable (new Array(n)) target, not a packed literal — a packed literal hits the
    // (separate, pre-existing) immutablePacked rejection first, never reaching the
    // property-assignment check this test is about.
    expect(() => compile('function main() { const obj = new Array(1); obj.foo = 2; }')).toThrow(
      "property 'foo' assignment not supported",
    );
  });

  it('throws for property access on a bare function parameter (no struct/element type known)', () => {
    expect(() => compile('function h(p) { return p.x; } function main() { return h(1); }')).toThrow(
      "property 'x' access not supported",
    );
  });

  it('compiles array index with variable', () => {
    const result = compile('function main() { const arr = [1, 2, 3]; let i = 1; const x = arr[i]; }');
    // Should contain INDEX followed by READ_VALUE (for i) and READ_HEAP (for arr)
    expect(result.bytecode[0]).toContain(OPS.INDEX);
    expect(result.bytecode[0]).toContain(OPS.READ_VALUE);
  });

  it('compiles array index with expression', () => {
    const result = compile('function main() { const arr = [1, 2, 3]; let i = 0; const x = arr[i + 1]; }');
    // Should contain INDEX followed by ADD operation
    expect(result.bytecode[0]).toContain(OPS.INDEX);
    expect(result.bytecode[0]).toContain(OPS.ADD);
  });

  it('compiles string length', () => {
    const result = compile('function main() { const s = "hello"; const len = s.length; }');
    expect(result.bytecode[0]).toContain(OPS.LENGTH);
  });

  it('compiles bytes length', () => {
    const result = compile('function main() { const b = new Uint8Array([1, 2, 3]); const len = b.length; }');
    expect(result.bytecode[0]).toContain(OPS.LENGTH);
  });
});

describe('array mutation (v1)', () => {
  it('compiles new Array(n) → NEW_ARRAY', () => {
    const result = compile('function main() { let a = new Array(3); return a; }');
    expect(result.bytecode[0]).toContain(OPS.NEW_ARRAY);
    // `new Array(n)` is a heap descriptor (TUPLE), so it is stored via HEAP slots —
    // VALUE storage (bytes32) would drop the descriptor, breaking `a[i]` round-trips.
    expect(Array.from(result.bytecode[0])).toEqual([
      OPS.ALLOCATE_HEAP,
      1, // one heap slot for `a`
      OPS.WRITE_HEAP,
      0,
      OPS.NEW_ARRAY,
      OPS.BYTE_1,
      3, // a = new Array(3)
      OPS.READ_HEAP,
      0, // return a
      OPS.STOP,
    ]);
  });

  it('throws when new Array has wrong arity', () => {
    expect(() => compile('function main() { let a = new Array(1, 2); return a; }')).toThrow(
      'new Array expects exactly 1 argument',
    );
  });

  it('compiles arr[i] = x on a new Array → SET_INDEX, prefix [value][index][array]', () => {
    const result = compile('function main() { let a = new Array(3); a[0] = 9; return a; }');
    expect(result.bytecode[0]).toContain(OPS.SET_INDEX);
    // The `new Array` descriptor round-trips through HEAP slots (ALLOCATE_HEAP/
    // WRITE_HEAP/READ_HEAP) — SET_INDEX reads the descriptor, mutates it, writes back.
    expect(Array.from(result.bytecode[0])).toEqual([
      OPS.ALLOCATE_HEAP,
      1,
      OPS.WRITE_HEAP,
      0,
      OPS.NEW_ARRAY,
      OPS.BYTE_1,
      3, // a = new Array(3)
      OPS.WRITE_HEAP,
      0, // a =
      OPS.SET_INDEX,
      OPS.BYTE_1,
      9,
      OPS.BYTE_1,
      0,
      OPS.READ_HEAP,
      0, //   setIndex(value 9, index 0, array a)
      OPS.READ_HEAP,
      0, // return a
      OPS.STOP,
    ]);
  });

  it('compiles obj.field = x → SET_INDEX with field index (object literal is a TUPLE)', () => {
    const result = compile('function main() { let p = { x: 1, y: 2 }; p.x = 9; return p; }');
    expect(result.bytecode[0]).toContain(OPS.SET_INDEX);
    expect(Array.from(result.bytecode[0])).toEqual([
      OPS.ALLOCATE_HEAP,
      1, // a TUPLE lives on the heap
      OPS.WRITE_HEAP,
      0,
      OPS.TUPLE,
      2,
      OPS.BYTE_1,
      1,
      OPS.BYTE_1,
      2, // p = { x: 1, y: 2 }
      OPS.WRITE_HEAP,
      0, // p =
      OPS.SET_INDEX,
      OPS.BYTE_1,
      9,
      OPS.BYTE_1,
      0,
      OPS.READ_HEAP,
      0, //   setIndex(value 9, field 0 = x, array p)
      OPS.READ_HEAP,
      0, // return p
      OPS.STOP,
    ]);
  });

  it('compiles compound arr[i] += y on a new Array → INDEX read then SET_INDEX write', () => {
    const result = compile('function main() { let a = new Array(3); let i = 1; a[i] += 5; return a; }');
    expect(result.bytecode[0]).toContain(OPS.SET_INDEX);
    expect(result.bytecode[0]).toContain(OPS.INDEX);
    expect(result.bytecode[0]).toContain(OPS.ADD);
  });

  it('rejects element assignment to an immutable packed array literal', () => {
    // A static packed array literal is immutable — the engine reverts SET_INDEX on
    // it, so the compiler rejects the assignment up front.
    expect(() => compile('function main() { let a = [1, 2, 3]; a[0] = 9; return a; }')).toThrow(
      /array literals are immutable/,
    );
  });

  it('clears the immutable-packed flag when a packed-literal var is reassigned (ternary)', () => {
    // `a` starts as an immutable packed literal, then is reassigned via a ternary to
    // a mutable new Array. The stale flag must clear so `a[0] = …` is allowed again.
    expect(() =>
      compile('function main(c) { let a = [1, 2, 3]; a = c ? new Array(3) : new Array(3); a[0] = 9; return a; }'),
    ).not.toThrow();
  });

  it('keeps rejecting when a ternary branch still yields a packed literal', () => {
    // If EITHER branch is a packed literal the variable may hold one at runtime, so
    // element assignment stays rejected (conservative — matches the engine).
    expect(() =>
      compile('function main(c) { let a = new Array(3); a = c ? [1, 2, 3] : new Array(3); a[0] = 9; return a; }'),
    ).toThrow(/array literals are immutable/);
  });

  it('evaluates a side-effecting compound index exactly once', () => {
    // `a[f()] += 5` feeds the index to both the INDEX read and the SET_INDEX write.
    // A non-pure index is hoisted into a scratch local, so f() (CALL_FUNCTION) is
    // emitted ONCE across all segments — 1, not 2 (f's own body has no call).
    const result = compile(
      'function f() { return 1; } function main() { let a = new Array(3); a[f()] += 5; return a[0]; }',
    );
    const calls = result.bytecode.reduce(
      (n, seg) => n + Array.from(seg).filter((b) => b === OPS.CALL_FUNCTION).length,
      0,
    );
    expect(calls).toBe(1);
  });
});
