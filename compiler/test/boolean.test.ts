import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('boolean', () => {
  it('compiles equality', () => {
    const result = compile('function main() { const x = 1 === 1; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_EQ, OPS.BYTE_1, 1, OPS.BYTE_1, 1]),
    );
  });

  it('compiles inequality', () => {
    const result = compile('function main() { const x = 5 !== 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_NEQ, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles greater than', () => {
    const result = compile('function main() { const x = 5 > 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_GT, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles less than', () => {
    const result = compile('function main() { const x = 5 < 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_LT, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles greater than or equal', () => {
    const result = compile('function main() { const x = 5 >= 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_GTE, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles less than or equal', () => {
    const result = compile('function main() { const x = 5 <= 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_LTE, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles logical AND', () => {
    const result = compile('function main() { const x = 1 === 1 && 2 === 2; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BOOL_AND,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        1,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        2,
      ]),
    );
  });

  it('compiles logical OR', () => {
    const result = compile('function main() { const x = 1 === 1 || 2 === 2; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.BOOL_OR,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        1,
        OPS.BOOL_EQ,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        2,
      ]),
    );
  });

  it('compiles logical NOT', () => {
    const result = compile('function main() { const a = 1; const b = !a; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.BOOL_NOT,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('compiles equality with zero as BOOL_ZERO', () => {
    const result = compile('function main() { const x = 0 === 0; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BOOL_ZERO, OPS.BYTE_1, 0]),
    );
  });

  it('compiles variable === 0 as BOOL_ZERO', () => {
    const result = compile('function main() { const a = 5; const b = a === 0; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.WRITE_VALUE,
        1,
        OPS.BOOL_ZERO,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('compiles variable !== 0 as BOOL_NOT_ZERO', () => {
    const result = compile('function main() { const a = 5; const b = a !== 0; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.WRITE_VALUE,
        1,
        OPS.BOOL_NOT_ZERO,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('throws on loose equality', () => {
    expect(() => compile('function main() { const x = 1 == 1; }')).toThrow('use === instead of ==');
  });

  it('throws on loose inequality', () => {
    expect(() => compile('function main() { const x = 1 != 1; }')).toThrow('use !== instead of !=');
  });
});
