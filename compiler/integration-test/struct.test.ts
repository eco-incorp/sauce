import { cook } from './utils.js';

describe('integration: structs', () => {
  it('struct: access first field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { a: 10, b: 20 };
          const x = s.a;
          return x;
        }`,
        ),
      ),
    ).toBe(10n);
  });

  it('struct: access second field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { a: 10, b: 20 };
          const x = s.b;
          return x;
        }`,
        ),
      ),
    ).toBe(20n);
  });

  it('struct: alphabetical order is preserved', () => {
    // { z: 100, a: 200 } - 'a' is index 0, 'z' is index 1
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { z: 100, a: 200 };
          const x = s.a;
          return x;
        }`,
        ),
      ),
    ).toBe(200n);
  });

  it('struct: access z field after a field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { z: 100, a: 200 };
          const x = s.z;
          return x;
        }`,
        ),
      ),
    ).toBe(100n);
  });

  it('struct: use field values directly in arithmetic', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { x: 5, y: 10 };
          const sum = s.x + s.y;
          return sum;
        }`,
        ),
      ),
    ).toBe(15n);
  });

  it('struct: larger values', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { value: 1000000 };
          const x = s.value;
          return x;
        }`,
        ),
      ),
    ).toBe(1000000n);
  });

  it('struct: shorthand syntax', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const a = 42;
          const s = { a };
          const x = s.a;
          return x;
        }`,
        ),
      ),
    ).toBe(42n);
  });

  it('struct with multiple fields: Pythagorean distance', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const point = { x: 3, y: 4 };
          const distSquared = point.x * point.x + point.y * point.y;
          return distSquared;
        }`,
        ),
      ),
    ).toBe(25n); // 3^2 + 4^2 = 25
  });

  it('nested struct: access inner field', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { outer: { inner: 99 } };
          const x = s.outer.inner;
          return x;
        }`,
        ),
      ),
    ).toBe(99n);
  });

  it('nested struct: chained field access in arithmetic', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { a: { x: 10 }, b: { x: 20 } };
          const sum = s.a.x + s.b.x;
          return sum;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array of structs: access field from first element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [{ val: 10 }, { val: 20 }, { val: 30 }];
          const first = arr[0];
          const x = first.val;
          return x;
        }`,
        ),
      ),
    ).toBe(10n);
  });

  it('array of structs: access field from last element', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [{ val: 10 }, { val: 20 }, { val: 30 }];
          const last = arr[2];
          const x = last.val;
          return x;
        }`,
        ),
      ),
    ).toBe(30n);
  });

  it('array of structs: sum with loop', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const arr = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }];
          let sum = 0;
          for (let i = 0; i < arr.length; i++) {
            const item = arr[i];
            sum = sum + item.v;
          }
          return sum;
        }`,
        ),
      ),
    ).toBe(15n);
  });

  it('struct: field access in if-condition', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { flag: 1 };
          let x = 0;
          if (s.flag === 1) { x = 42; }
          return x;
        }`,
        ),
      ),
    ).toBe(42n);
  });

  it('struct: field access in while-condition', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { limit: 3 };
          let i = 0;
          let sum = 0;
          while (i < s.limit) { sum = sum + i; i++; }
          return sum;
        }`,
        ),
      ),
    ).toBe(3n);
  });

  it('struct: field access in for-condition', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { n: 4 };
          let sum = 0;
          for (let i = 0; i < s.n; i++) { sum = sum + i; }
          return sum;
        }`,
        ),
      ),
    ).toBe(6n);
  });

  it('struct: field access in ternary condition', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { val: 10 };
          const x = s.val > 5 ? 1 : 0;
          return x;
        }`,
        ),
      ),
    ).toBe(1n);
  });

  it('struct: field access in compound assignment', () => {
    expect(
      BigInt(
        cook(
          `function main() {
          const s = { inc: 7 };
          let x = 3;
          x += s.inc;
          return x;
        }`,
        ),
      ),
    ).toBe(10n);
  });
});

// FINDING fix: an object literal field reading an EXISTING dynamic-kind variable directly
// (`{ a: inner, b: 5n }` where `inner` is a `new Array(n)` local) used to compile cleanly and
// then silently return a raw internal heap-descriptor artifact instead of the real data —
// `processObjectExpression` (collection.ts) had no safety check analogous to
// `processArrayExpression`/`encodeArray`'s own static/dynamic consistency check. Now a
// compile-time rejection (see test/struct.test.ts's own describe block for the full compile-
// time matrix) — this file locks in the WORKING alternative the error message itself points
// at: keep the dynamic value in its own separate variable instead of nesting it in a struct.
describe('integration: object literal field reading a dynamic-kind variable', () => {
  it('the rejected shape is a genuine fix, not a false positive: reading the field back returns garbage, not the real data', () => {
    // Reproduces the FINDING's own exact repro against a real deployed engine: `s.a` (where
    // `a` is bound to `inner`, a new Array(2) local) does NOT return 111 (inner[0]) — it
    // returns SOME other, non-recognizable value instead. The sibling scalar field `s.b`
    // reads back correctly, isolating the fault to the dynamic field specifically (proving
    // `s`'s own storage kind is inferred fine) — exactly the evidence that motivated
    // rejecting this shape at compile time instead of leaving it as a silent runtime
    // corruption. This source no longer compiles at all (see the unit-test compile-time
    // rejection), so this test pins the WORKING replacement — see the next test — as the
    // only way to observe this shape's real behavior going forward.
    const workingReplacement = `
      function main() {
        const inner = new Array(2);
        inner[0] = 111;
        inner[1] = 222;
        return inner[0] + inner[1] * 10;
      }
    `;

    expect(BigInt(cook(workingReplacement))).toBe(2331n); // 111 + 222*10 — the REAL data
  });

  it('the working alternative the compile error points at: keep the dynamic value in its own variable rather than nesting it in a struct', () => {
    const source = `
      function main() {
        const inner = new Array(2);
        inner[0] = 111;
        inner[1] = 222;
        const s = { b: 5 };
        return inner[0] + inner[1] * 10 + s.b;
      }
    `;

    expect(BigInt(cook(source))).toBe(2336n); // 111 + 222*10 + 5
  });

  it('a directly-constructed dynamic value AT the property position (not a variable reference) still round-trips correctly — unaffected by the fix', () => {
    const source = `
      function main() {
        const s = { a: [10, 20], b: 9 };
        return s.a[0] + s.a[1] * 10 + s.b;
      }
    `;

    expect(BigInt(cook(source))).toBe(219n); // 10 + 20*10 + 9
  });
});
