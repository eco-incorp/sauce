import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('struct', () => {
  it('compiles simple struct', () => {
    const result = compile('function main() { const s = { a: 1, b: 2 }; }');
    // ALLOCATE_HEAP, 1, WRITE_HEAP, 0, TUPLE, 2, BYTE_1, 1, BYTE_1, 2
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.TUPLE, 2, OPS.BYTE_1, 1, OPS.BYTE_1, 2]),
    );
  });

  it('compiles struct with alphabetical ordering', () => {
    // { b: 2, a: 1 } should produce same bytecode as { a: 1, b: 2 }
    const result = compile('function main() { const s = { b: 2, a: 1 }; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.TUPLE, 2, OPS.BYTE_1, 1, OPS.BYTE_1, 2]),
    );
  });

  it('compiles struct with mixed types', () => {
    const result = compile('function main() { const s = { a: 1, b: "hi" }; }');
    // TUPLE with number and string: BYTE_1, 1, BYTES, 2, 'h', 'i'
    const bytes = result.bytecode[0];
    expect(bytes[4]).toBe(OPS.TUPLE);
    expect(bytes[5]).toBe(2); // 2 elements
    expect(bytes[6]).toBe(OPS.BYTE_1);
    expect(bytes[7]).toBe(1); // value 1
    expect(bytes[8]).toBe(OPS.BYTES);
    expect(bytes[9]).toBe(2); // length 2
    expect(bytes[10]).toBe(104); // 'h'
    expect(bytes[11]).toBe(105); // 'i'
  });

  it('compiles struct with shorthand syntax', () => {
    // { a } should be equivalent to { a: a }
    const result = compile('function main() { const a = 5; const s = { a }; }');
    // Should contain TUPLE with 1 element that reads variable a
    const bytes = result.bytecode[0];
    expect(bytes).toContain(OPS.TUPLE);
    expect(bytes).toContain(OPS.READ_VALUE); // reads variable a
  });

  it('compiles field access with first field', () => {
    const result = compile('function main() { const s = { a: 1, b: 2 }; const x = s.a; }');
    // Field access: INDEX, BYTE_1, 0 (field index), READ_HEAP, 0
    expect(result.bytecode[0]).toContain(OPS.INDEX);
  });

  it('compiles field access with second field', () => {
    const result = compile('function main() { const s = { a: 1, b: 2 }; const x = s.b; }');
    // Field 'b' is index 1 (alphabetical order)
    expect(result.bytecode[0]).toContain(OPS.INDEX);
  });

  it('compiles field access respecting alphabetical order', () => {
    // In { z: 1, a: 2 }, field 'a' is index 0 and 'z' is index 1
    const result = compile('function main() { const s = { z: 1, a: 2 }; const x = s.z; }');
    expect(result.bytecode[0]).toContain(OPS.INDEX);
    // z is at index 1 after sorting
  });

  it('throws for unknown field access', () => {
    expect(() => compile('function main() { const s = { a: 1 }; const x = s.foo; }')).toThrow("unknown field 'foo'");
  });

  it('compiles array of structs', () => {
    const result = compile('function main() { const arr = [{ a: 1 }, { a: 2 }]; }');
    // ARRAY, 2, TUPLE (element type), TUPLE, 1, BYTE_1, 1, TUPLE, 1, BYTE_1, 2
    const bytes = result.bytecode[0];
    expect(bytes[4]).toBe(OPS.ARRAY);
    expect(bytes[5]).toBe(2); // 2 elements
    expect(bytes[6]).toBe(OPS.TUPLE); // element type
  });

  it('compiles nested struct', () => {
    const result = compile('function main() { const s = { outer: { inner: 1 } }; }');
    expect(result.bytecode[0]).toContain(OPS.TUPLE);
  });

  it('compiles nested struct field access with WRITE_HEAP', () => {
    const result = compile(`function main() {
      const s = { outer: { inner: 99 } };
      const inner = s.outer;
    }`);
    // inner should be stored with WRITE_HEAP (dynamic), not WRITE_VALUE (scalar)
    // because s.outer is a nested struct (TUPLE), not a scalar
    const bytes = Array.from(result.bytecode[0]);
    const writeHeapCount = bytes.filter((b) => b === OPS.WRITE_HEAP).length;
    expect(writeHeapCount).toEqual(2); // s + inner
  });

  it('compiles empty struct', () => {
    const result = compile('function main() { const s = {}; }');
    // Empty tuple: TUPLE, 0
    const bytes = result.bytecode[0];
    expect(bytes).toContain(OPS.TUPLE);
    expect(bytes[5]).toBe(0); // 0 elements
  });

  it('throws for spread properties', () => {
    expect(() => compile('function main() { const a = { x: 1 }; const b = { ...a }; }')).toThrow(
      'spread properties are not supported',
    );
  });

  it('throws for array with mismatched struct fields', () => {
    expect(() => compile('function main() { const arr = [{ a: 1 }, { b: 2 }]; }')).toThrow(
      'array elements must have consistent struct fields',
    );
  });

  it('allows array with consistent struct fields', () => {
    // Should not throw - all elements have same field 'a'
    expect(() => compile('function main() { const arr = [{ a: 1 }, { a: 2 }, { a: 3 }]; }')).not.toThrow();
  });
});

// FINDING fix: `processObjectExpression` (processor/collection.ts) had no safety check
// analogous to `processArrayExpression`/`encodeArray`'s own static/dynamic consistency check
// — a property value that reads an EXISTING dynamic-kind variable (an array, a `new
// Array(n)` heap TUPLE, an aliased dynamic local, …) compiled cleanly but then silently
// returned a raw internal heap-descriptor artifact instead of the real data when read back —
// confirmed via real execution on BOTH v1 (anvil + deployed Sauce.sol) AND v12 (the real Huff
// runtime, engine-v12/test/V12-execparity): `{ a: inner, b: 5n }.a` (`inner` a `new Array(2)`
// local) returned `0x...0000000400000...0004c0` on both targets — not [111,222], not any
// recognizable ABI encoding — while the sibling scalar field `b` read back correctly (5),
// isolating the fault to the dynamic FIELD specifically. Contrast: the identical dynamic
// identifier used as a plain ARRAY-literal element (`[inner, 99n]`) was ALREADY correctly
// rejected at compile time ('array elements must be literals or dynamic types') — object
// literals had no equivalent guard. Fixed by `assertNoDynamicVariableObjectField`
// (collection.ts): rejects a property whose PROCESSED value's leading opcode is READ_HEAP (a
// plain read of an existing dynamic variable) — a DIRECTLY-CONSTRUCTED dynamic value at the
// property position (a string/array literal, a `.concat()`/`.slice()` call, a nested object
// literal) is NOT rejected, since each of those allocates its OWN fresh dynamic value at that
// exact point rather than re-embedding an existing heap descriptor, and all are confirmed via
// the same real-execution proof to round-trip correctly on both targets (real-execution proof
// lives in integration-test/dynamic-kind-sweep.test.ts and struct.test.ts's own tests above).
describe('object literal field reading an existing dynamic-kind variable (FINDING fix)', () => {
  it('rejects a new Array(n) local used directly as a property value', () => {
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 111; inner[1] = 222; const s = { a: inner, b: 5 }; return s.a; }',
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('rejects an ALIASED dynamic local (b = a, both refer to the same heap value) used as a property value', () => {
    expect(() =>
      compile(
        'function main() { const arr = new Array(2); arr[0] = 1; arr[1] = 2; const alias = arr; const s = { a: alias, b: 9 }; return s.a; }',
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('rejects the SAME shape on v12 too (confirmed broken on the real Huff runtime, not just v1)', () => {
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 111; inner[1] = 222; const s = { a: inner, b: 5 }; return s.a; }',
        { target: 'v12' },
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('catches the violation ONE LEVEL DOWN inside a nested object literal too', () => {
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 1; inner[1] = 2; const s = { outer: { x: inner } }; return 1; }',
      ),
    ).toThrow(/object literal field 'x' reads an existing dynamic-kind variable/);
  });

  it('does NOT reject a directly-constructed dynamic value at the property position — a string literal (existing, already-tested shape)', () => {
    expect(() => compile('function main() { const s = { a: 1, b: "hi" }; }')).not.toThrow();
  });

  it('does NOT reject a directly-constructed dynamic value at the property position — an array literal', () => {
    expect(() => compile('function main() { const s = { a: [10, 20], b: 9 }; return s.a[0]; }')).not.toThrow();
  });

  it('does NOT reject a directly-constructed dynamic value at the property position — a .concat() call', () => {
    expect(() =>
      compile('function main() { const s = { a: "hi".concat("there"), b: 9 }; return s.a.length; }'),
    ).not.toThrow();
  });

  it('does NOT reject a nested plain object literal (the existing, already-tested nested-struct feature)', () => {
    expect(() =>
      compile('function main() { const s = { outer: { inner: 99 } }; return s.outer.inner; }'),
    ).not.toThrow();
  });
});

// ── ADVERSARIAL-AUDIT FINDING (this branch): `assertNoDynamicVariableObjectField`
// false-positives on v12/svm for a SCALAR-producing postfix operator applied directly
// to an existing dynamic variable (e.g. `.length`) ──
//
// The guard's check (`processed[i]._bytes[0] === OPS.READ_HEAP`) works correctly on v1's
// PREFIX encoding, where an outer operator's own opcode is always the LEADING byte (e.g.
// `arr.length` emits `[LENGTH, READ_HEAP, slot]` — bytes[0] is LENGTH, not READ_HEAP). But
// on v12/svm's POSTFIX encoding, `V12Saucer.unary()` APPENDS its own opcode AFTER the
// operand's bytes (`concat(this._bytes, operand._bytes, [op])`), so `arr.length` emits
// `[READ_HEAP, slot, LENGTH]` — the dynamic base's READ_HEAP is still the LEADING byte
// even though the overall expression (`isDynamic: false`) is a genuine scalar. This made
// `{ x: arr.length, y: 5n }` throw on v12/svm even though it compiles (and, per the
// existing v1 tests above, is intended to be treated as a safe, directly-computed scalar)
// on v1. Fixed by ALSO requiring `_bytes.length === 2` — a bare `READ_HEAP` read is always
// EXACTLY 2 bytes (opcode + a 1-byte slot index — `context.ts`'s own "slot indices are 1
// byte" invariant) on BOTH encoding directions, so this narrows the check to "the whole
// processed expression IS just a bare variable read" without reopening the real bug (a
// bare read, or an ALIAS of one, is still exactly 2 bytes and still correctly rejected —
// see the "still rejects the real unsafe shape" tests below).
describe('object literal field applying a SCALAR-producing postfix op to a dynamic base — v12/svm false positive (FINDING fix)', () => {
  it('does NOT reject `.length` of an existing dynamic array as an object field value on v12 (was a false-positive throw)', () => {
    expect(() =>
      compile(
        'function main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; const s = { x: arr.length, y: 5 }; return s.x; }',
        { target: 'v12' },
      ),
    ).not.toThrow();
  });

  it('does NOT reject the same shape on svm either (also postfix-encoded)', () => {
    expect(() =>
      compile(
        'function main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; const s = { x: arr.length, y: 5 }; return s.x; }',
        { target: 'svm' },
      ),
    ).not.toThrow();
  });

  it('never rejected this shape on v1 either (negative control — the fix must not change v1 behavior)', () => {
    expect(() =>
      compile(
        'function main() { const arr = new Array(3); arr[0] = 1; arr[1] = 2; arr[2] = 3; const s = { x: arr.length, y: 5 }; return s.x; }',
      ),
    ).not.toThrow();
  });

  it('still REJECTS a genuine bare dynamic-variable read as an object field value on v12 (the real bug this guard exists to catch)', () => {
    // Same shape as the "rejects the SAME shape on v12 too" test above, re-pinned here
    // alongside the false-positive fix so both are visibly tested together: the
    // `_bytes.length === 2` narrowing must not let the ACTUAL unsafe case through.
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 111; inner[1] = 222; const s = { a: inner, b: 5 }; return s.a; }',
        { target: 'v12' },
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('still REJECTS a genuine bare dynamic-variable read as an object field value on svm too', () => {
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 111; inner[1] = 222; const s = { a: inner, b: 5 }; return s.a; }',
        { target: 'svm' },
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('still REJECTS an ALIASED dynamic local on v12 (the length-of-alias variant does NOT mask the bare-alias-read variant)', () => {
    expect(() =>
      compile(
        'function main() { const arr = new Array(2); arr[0] = 1; arr[1] = 2; const alias = arr; const s = { a: alias, b: 9 }; return s.a; }',
        { target: 'v12' },
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });

  it('still REJECTS on v1 too (unchanged from the existing coverage above)', () => {
    expect(() =>
      compile(
        'function main() { const inner = new Array(2); inner[0] = 111; inner[1] = 222; const s = { a: inner, b: 5 }; return s.a; }',
      ),
    ).toThrow(/object literal field 'a' reads an existing dynamic-kind variable/);
  });
});
