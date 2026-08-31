import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('abi.encode', () => {
  it('compiles single scalar argument', () => {
    const result = compile('function main() { const x = abi.encode(42); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_HEAP, 1, OPS.WRITE_HEAP, 0, OPS.ABI_ENCODE, OPS.TUPLE, 1, OPS.BYTE_1, 42]),
    );
  });

  it('compiles multiple arguments', () => {
    const result = compile('function main() { const x = abi.encode(1, 2, 3); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        1,
        OPS.WRITE_HEAP,
        0,
        OPS.ABI_ENCODE,
        OPS.TUPLE,
        3,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        3,
      ]),
    );
  });

  it('compiles object argument as tuple', () => {
    const result = compile('function main() { const x = abi.encode({ a: 1, b: 2 }); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        1,
        OPS.WRITE_HEAP,
        0,
        OPS.ABI_ENCODE,
        OPS.TUPLE,
        2,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
      ]),
    );
  });

  it('compiles with variable arguments', () => {
    const result = compile(`
      function main() {
        let a = 10;
        let b = 20;
        const x = abi.encode(a, b);
      }
    `);
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(encodeIdx).toBeGreaterThan(0);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(2);
    expect(bytes[encodeIdx + 3]).toBe(OPS.READ_VALUE);
    expect(bytes[encodeIdx + 5]).toBe(OPS.READ_VALUE);
  });

  it('compiles string argument', () => {
    const result = compile('function main() { const x = abi.encode("hi"); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(1);
    expect(bytes[encodeIdx + 3]).toBe(OPS.BYTES);
    expect(bytes[encodeIdx + 4]).toBe(2);
    expect(bytes[encodeIdx + 5]).toBe(104); // 'h'
    expect(bytes[encodeIdx + 6]).toBe(105); // 'i'
  });

  it('compiles array argument', () => {
    const result = compile('function main() { const x = abi.encode([1, 2, 3]); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(1);
    expect(bytes[encodeIdx + 3]).toBe(OPS.ARRAY);
    expect(bytes[encodeIdx + 4]).toBe(3);
    expect(bytes[encodeIdx + 5]).toBe(OPS.BYTE_1);
  });

  it('compiles bytes argument', () => {
    const result = compile('function main() { const x = abi.encode(Uint8Array.from([0xaa, 0xbb])); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(1);
    expect(bytes[encodeIdx + 3]).toBe(OPS.BYTES);
    expect(bytes[encodeIdx + 4]).toBe(2);
    expect(bytes[encodeIdx + 5]).toBe(0xaa);
    expect(bytes[encodeIdx + 6]).toBe(0xbb);
  });

  it('compiles mixed scalar and string arguments', () => {
    const result = compile('function main() { const x = abi.encode(42, "ab"); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(2);
    expect(bytes[encodeIdx + 3]).toBe(OPS.BYTE_1);
    expect(bytes[encodeIdx + 4]).toBe(42);
    expect(bytes[encodeIdx + 5]).toBe(OPS.BYTES);
    expect(bytes[encodeIdx + 6]).toBe(2);
  });

  it('compiles object with dynamic fields', () => {
    const result = compile('function main() { const x = abi.encode({ a: 1, b: "hi" }); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(2);
    expect(bytes[encodeIdx + 3]).toBe(OPS.BYTE_1);
    expect(bytes[encodeIdx + 4]).toBe(1);
    expect(bytes[encodeIdx + 5]).toBe(OPS.BYTES);
  });

  it('compiles nested struct', () => {
    const result = compile('function main() { const x = abi.encode({ a: 1, b: { c: 2, d: "hi" } }); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(2);
    expect(bytes[encodeIdx + 3]).toBe(OPS.BYTE_1);
    expect(bytes[encodeIdx + 4]).toBe(1);
    expect(bytes[encodeIdx + 5]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 6]).toBe(2);
    expect(bytes[encodeIdx + 7]).toBe(OPS.BYTE_1);
    expect(bytes[encodeIdx + 8]).toBe(2);
    expect(bytes[encodeIdx + 9]).toBe(OPS.BYTES);
  });

  it('compiles with array argument', () => {
    const result = compile('function main() { const x = abi.encode([10, 20, 30]); }');
    const bytes = result.bytecode[0];
    const encodeIdx = bytes.indexOf(OPS.ABI_ENCODE);
    expect(bytes[encodeIdx + 1]).toBe(OPS.TUPLE);
    expect(bytes[encodeIdx + 2]).toBe(1);
    expect(bytes[encodeIdx + 3]).toBe(OPS.ARRAY);
    expect(bytes[encodeIdx + 4]).toBe(3);
    expect(bytes[encodeIdx + 5]).toBe(OPS.BYTE_1);
  });

  it('throws for zero arguments', () => {
    expect(() => compile('function main() { const x = abi.encode(); }')).toThrow(
      'abi.encode expects at least 1 argument',
    );
  });
});

describe('abi.decode', () => {
  it('compiles single type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "uint256");
      }
    `);
    const bytes = result.bytecode[0];
    const decodeIdx = bytes.indexOf(OPS.ABI_DECODE);
    expect(decodeIdx).toBeGreaterThan(0);
    expect(bytes[decodeIdx + 1]).toBe(1);
    expect(bytes[decodeIdx + 2]).toBe(OPS.READ_HEAP);
    expect(bytes[bytes.length - 1]).toBe(0x20);
  });

  it('compiles multiple type specs', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "uint256", "bytes", "uint8");
      }
    `);
    const bytes = result.bytecode[0];
    const decodeIdx = bytes.indexOf(OPS.ABI_DECODE);
    expect(decodeIdx).toBeGreaterThan(0);
    expect(bytes[decodeIdx + 1]).toBe(3);
    expect(bytes[bytes.length - 3]).toBe(0x20);
    expect(bytes[bytes.length - 2]).toBe(0x90);
    expect(bytes[bytes.length - 1]).toBe(0x01);
  });

  it('compiles address type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "address");
      }
    `);
    const bytes = result.bytecode[0];
    expect(bytes[bytes.length - 1]).toBe(0x14);
  });

  it('compiles bool type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "bool");
      }
    `);
    const bytes = result.bytecode[0];
    expect(bytes[bytes.length - 1]).toBe(0x01);
  });

  it('compiles string type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "string");
      }
    `);
    const bytes = result.bytecode[0];
    expect(bytes[bytes.length - 1]).toBe(0x90);
  });

  it('compiles uint8 through uint256', () => {
    for (let i = 1; i <= 32; i++) {
      const result = compile(`
        function main() {
          const data = Uint8Array.from([0x00]);
          const x = abi.decode(data, "uint${i * 8}");
        }
      `);
      const bytes = result.bytecode[0];
      expect(bytes[bytes.length - 1]).toBe(i);
    }
  });

  it('compiles object type spec (struct)', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, { a: "uint256", b: "string" });
      }
    `);
    const bytes = result.bytecode[0];
    const decodeIdx = bytes.indexOf(OPS.ABI_DECODE);
    expect(bytes[decodeIdx + 1]).toBe(1);
    const tail = Array.from(bytes.slice(decodeIdx)).slice(-4);
    expect(tail).toEqual([OPS.TUPLE, 2, 0x20, 0x90]);
  });

  it('compiles nested object type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, { a: "string", b: { c: "uint256", d: "string" } });
      }
    `);
    const bytes = result.bytecode[0];
    const tail = Array.from(bytes.slice(bytes.indexOf(OPS.ABI_DECODE))).slice(-7);
    expect(tail).toEqual([OPS.TUPLE, 2, 0x90, OPS.TUPLE, 2, 0x20, 0x90]);
  });

  it('compiles array type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, ["uint256"]);
      }
    `);
    const bytes = result.bytecode[0];
    const tail = Array.from(bytes.slice(bytes.indexOf(OPS.ABI_DECODE))).slice(-2);
    expect(tail).toEqual([OPS.ARRAY, 0x20]);
  });

  it('compiles array of struct type spec', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, [{ a: "uint256", b: "string" }]);
      }
    `);
    const bytes = result.bytecode[0];
    const tail = Array.from(bytes.slice(bytes.indexOf(OPS.ABI_DECODE))).slice(-5);
    expect(tail).toEqual([OPS.ARRAY, OPS.TUPLE, 2, 0x20, 0x90]);
  });

  it('throws for non-string type argument', () => {
    expect(() =>
      compile('function main() { const data = Uint8Array.from([0x00]); const x = abi.decode(data, 256); }'),
    ).toThrow('abi.decode type arguments must be string literals, objects, or arrays');
  });

  it('throws for unknown type string', () => {
    expect(() =>
      compile('function main() { const data = Uint8Array.from([0x00]); const x = abi.decode(data, "int256"); }'),
    ).toThrow("unknown ABI type: 'int256'");
  });

  it('throws for missing type arguments', () => {
    expect(() =>
      compile('function main() { const data = Uint8Array.from([0x00]); const x = abi.decode(data); }'),
    ).toThrow('abi.decode expects data and at least 1 type argument');
  });

  it('throws for array type spec with wrong element count', () => {
    expect(() =>
      compile(
        'function main() { const data = Uint8Array.from([0x00]); const x = abi.decode(data, ["uint256", "string"]); }',
      ),
    ).toThrow('array type spec must have exactly 1 element type');
  });
});

describe('abi: unknown method', () => {
  it('throws for unknown abi method', () => {
    expect(() => compile('function main() { const x = abi.foo(); }')).toThrow('not implemented: abi.foo');
  });
});

describe('abi: kind inference', () => {
  it('abi.encode result is dynamic', () => {
    const result = compile('function main() { const x = abi.encode(1); }');
    expect(result.bytecode[0]).toContain(OPS.WRITE_HEAP);
  });

  it('abi.decode result is dynamic', () => {
    const result = compile(`
      function main() {
        const data = Uint8Array.from([0x00]);
        const x = abi.decode(data, "uint256");
      }
    `);
    expect(result.bytecode[0]).toContain(OPS.WRITE_HEAP);
  });
});
