import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('bitwise', () => {
  it('compiles bitwise AND', () => {
    const result = compile('function main() { const x = 7 & 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.AND, OPS.BYTE_1, 7, OPS.BYTE_1, 3]),
    );
  });

  it('compiles bitwise OR', () => {
    const result = compile('function main() { const x = 5 | 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.OR, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles bitwise XOR', () => {
    const result = compile('function main() { const x = 6 ^ 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.XOR, OPS.BYTE_1, 6, OPS.BYTE_1, 3]),
    );
  });

  it('compiles bitwise NOT', () => {
    const result = compile('function main() { const x = ~7; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.NOT, OPS.BYTE_1, 7]),
    );
  });

  it('compiles left shift', () => {
    const result = compile('function main() { const x = 1 << 8; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SHL, OPS.BYTE_1, 1, OPS.BYTE_1, 8]),
    );
  });

  it('compiles right shift', () => {
    const result = compile('function main() { const x = 256 >> 4; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SHR, OPS.BYTE_2, 1, 0, OPS.BYTE_1, 4]),
    );
  });

  it('compiles nested bitwise', () => {
    const result = compile('function main() { const x = (5 & 3) | 8; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.OR,
        OPS.AND,
        OPS.BYTE_1,
        5,
        OPS.BYTE_1,
        3,
        OPS.BYTE_1,
        8,
      ]),
    );
  });

  it('compiles bitwise NOT with variable', () => {
    const result = compile('function main() { const a = 42; const b = ~a; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        42,
        OPS.WRITE_VALUE,
        1,
        OPS.NOT,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });
});
