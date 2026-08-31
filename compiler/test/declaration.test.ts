import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('declaration', () => {
  it('compiles const declaration', () => {
    const result = compile('function main() { const x = 1; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BYTE_1, 1]));
  });

  it('compiles let declaration', () => {
    const result = compile('function main() { let x = 1; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.BYTE_1, 1]));
  });

  it('throws on var declaration', () => {
    expect(() => compile('function main() { var x = 1; }')).toThrow('var is not supported, use const or let');
  });

  it('compiles variable reference', () => {
    const result = compile('function main() { const a = 2; const b = a; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 2, OPS.WRITE_VALUE, 0, OPS.BYTE_1, 2, OPS.WRITE_VALUE, 1, OPS.READ_VALUE, 0]),
    );
  });

  it('throws on undefined variable', () => {
    expect(() => compile('function main() { const b = a; }')).toThrow('undefined variable: a');
  });

  it('compiles prefix increment assignment', () => {
    const result = compile('function main() { let b = 5; let a = ++b; }');
    // ++b: update b first, then assign new b to a
    // b = b + 1: WRITE_VALUE 0 ADD READ_VALUE 0 BYTE_1 1
    // a = b:     WRITE_VALUE 1 READ_VALUE 0
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('compiles postfix increment assignment', () => {
    const result = compile('function main() { let b = 5; let a = b++; }');
    // b++: assign old b to a first, then update b
    // a = b:     WRITE_VALUE 1 READ_VALUE 0
    // b = b + 1: WRITE_VALUE 0 ADD READ_VALUE 0 BYTE_1 1
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
        OPS.READ_VALUE,
        0,
        OPS.WRITE_VALUE,
        0,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
      ]),
    );
  });

  it('compiles prefix decrement assignment', () => {
    const result = compile('function main() { let b = 5; let a = --b; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.WRITE_VALUE,
        0,
        OPS.SUB,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        1,
        OPS.WRITE_VALUE,
        1,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });
});
