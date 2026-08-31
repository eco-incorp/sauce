import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('concat', () => {
  it('compiles string concat', () => {
    const result = compile('function main() { const a = "hi"; const b = a.concat("!"); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        2,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        2,
        104,
        105,
        OPS.WRITE_HEAP,
        1,
        OPS.CONCAT,
        2,
        OPS.READ_HEAP,
        0,
        OPS.BYTES,
        1,
        33,
      ]),
    );
  });

  it('compiles array concat', () => {
    const result = compile(`
      function main() {
        const a = [1, 2];
        const b = [3, 4];
        const c = a.concat(b);
      }
    `);
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        3,
        OPS.WRITE_HEAP,
        0,
        OPS.ARRAY,
        2,
        OPS.BYTE_1,
        1,
        2,
        OPS.WRITE_HEAP,
        1,
        OPS.ARRAY,
        2,
        OPS.BYTE_1,
        3,
        4,
        OPS.WRITE_HEAP,
        2,
        OPS.CONCAT,
        2,
        OPS.READ_HEAP,
        0,
        OPS.READ_HEAP,
        1,
      ]),
    );
  });

  it('compiles bytes concat', () => {
    const result = compile(`
      function main() {
        const a = Uint8Array.from([0xaa]);
        const b = Uint8Array.from([0xbb]);
        const c = a.concat(b);
      }
    `);
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        3,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        1,
        0xaa,
        OPS.WRITE_HEAP,
        1,
        OPS.BYTES,
        1,
        0xbb,
        OPS.WRITE_HEAP,
        2,
        OPS.CONCAT,
        2,
        OPS.READ_HEAP,
        0,
        OPS.READ_HEAP,
        1,
      ]),
    );
  });

  it('compiles multi-operand concat', () => {
    const result = compile(`
      function main() {
        const a = "a";
        const b = "b";
        const c = "c";
        const d = a.concat(b, c);
      }
    `);
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        4,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        1,
        97,
        OPS.WRITE_HEAP,
        1,
        OPS.BYTES,
        1,
        98,
        OPS.WRITE_HEAP,
        2,
        OPS.BYTES,
        1,
        99,
        OPS.WRITE_HEAP,
        3,
        OPS.CONCAT,
        3,
        OPS.READ_HEAP,
        0,
        OPS.READ_HEAP,
        1,
        OPS.READ_HEAP,
        2,
      ]),
    );
  });

  it('compiles concat with no extra args (self-copy)', () => {
    const result = compile('function main() { const a = "hi"; const b = a.concat(); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        2,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        2,
        104,
        105,
        OPS.WRITE_HEAP,
        1,
        OPS.CONCAT,
        1,
        OPS.READ_HEAP,
        0,
      ]),
    );
  });
});

describe('slice', () => {
  it('compiles string slice', () => {
    const result = compile('function main() { const a = "hello"; const b = a.slice(1, 3); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        2,
        OPS.WRITE_HEAP,
        0,
        OPS.BYTES,
        5,
        104,
        101,
        108,
        108,
        111,
        OPS.WRITE_HEAP,
        1,
        OPS.SLICE,
        OPS.READ_HEAP,
        0,
        OPS.BYTE_1,
        1,
        OPS.SUB,
        OPS.BYTE_1,
        3,
        OPS.BYTE_1,
        1,
      ]),
    );
  });

  it('compiles array slice', () => {
    const result = compile(`
      function main() {
        const a = [10, 20, 30];
        const b = a.slice(0, 2);
      }
    `);
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_HEAP,
        2,
        OPS.WRITE_HEAP,
        0,
        OPS.ARRAY,
        3,
        OPS.BYTE_1,
        10,
        20,
        30,
        OPS.WRITE_HEAP,
        1,
        OPS.SLICE,
        OPS.READ_HEAP,
        0,
        OPS.BYTE_1,
        0,
        OPS.SUB,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        0,
      ]),
    );
  });

  it('compiles slice with variable indices', () => {
    const result = compile(`
      function main() {
        const a = [10, 20, 30, 40, 50];
        let start = 1;
        let end = 4;
        const b = a.slice(start, end);
      }
    `);
    const bytes = result.bytecode[0];
    // Find the SLICE opcode
    const sliceIdx = bytes.indexOf(OPS.SLICE);
    expect(sliceIdx).toBeGreaterThan(0);
    // After SLICE should be: READ_HEAP(a), READ_VALUE(start), SUB(READ_VALUE(end), READ_VALUE(start))
    expect(bytes[sliceIdx + 1]).toBe(OPS.READ_HEAP);
    expect(bytes[sliceIdx + 3]).toBe(OPS.READ_VALUE);
    expect(bytes[sliceIdx + 5]).toBe(OPS.SUB);
  });

  it('throws for slice with wrong arg count', () => {
    expect(() => compile('function main() { const a = [1, 2]; const b = a.slice(0); }')).toThrow(
      '.slice() expects exactly 2 arguments (start, end)',
    );
  });

  it('throws for slice with too many args', () => {
    expect(() => compile('function main() { const a = [1, 2]; const b = a.slice(0, 1, 2); }')).toThrow(
      '.slice() expects exactly 2 arguments (start, end)',
    );
  });
});

describe('unknown method', () => {
  it('throws for unknown instance method', () => {
    expect(() => compile('function main() { const a = [1, 2]; const b = a.push(3); }')).toThrow(
      'not implemented: .push()',
    );
  });
});
