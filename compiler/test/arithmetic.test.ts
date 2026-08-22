import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('arithmetic', () => {
  it('compiles addition', () => {
    const result = compile('function main() { const x = 1 + 2; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.ADD, OPS.BYTE_1, 1, OPS.BYTE_1, 2]),
    );
  });

  it('compiles subtraction', () => {
    const result = compile('function main() { const x = 5 - 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SUB, OPS.BYTE_1, 5, OPS.BYTE_1, 3]),
    );
  });

  it('compiles multiplication', () => {
    const result = compile('function main() { const x = 3 * 4; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.MUL, OPS.BYTE_1, 3, OPS.BYTE_1, 4]),
    );
  });

  it('compiles division', () => {
    const result = compile('function main() { const x = 10 / 2; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.DIV, OPS.BYTE_1, 10, OPS.BYTE_1, 2]),
    );
  });

  it('compiles modulo', () => {
    const result = compile('function main() { const x = 10 % 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.MOD, OPS.BYTE_1, 10, OPS.BYTE_1, 3]),
    );
  });

  it('compiles nested expressions', () => {
    const result = compile('function main() { const x = (1 + 2) * 3; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.MUL,
        OPS.ADD,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        3,
      ]),
    );
  });

  it('compiles with variables', () => {
    const result = compile('function main() { const a = 5; const b = a + 3; }');
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
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.BYTE_1,
        3,
      ]),
    );
  });

  it('compiles exponentiation', () => {
    const result = compile('function main() { const x = 2 ** 8; }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.EXP, OPS.BYTE_1, 2, OPS.BYTE_1, 8]),
    );
  });

  it('compiles Math.sqrt', () => {
    const result = compile('function main() { const x = Math.sqrt(16); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.SQRT, OPS.BYTE_1, 16]),
    );
  });

  it('compiles Math.sqrt with variable', () => {
    const result = compile('function main() { const a = 25; const b = Math.sqrt(a); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        25,
        OPS.WRITE_VALUE,
        1,
        OPS.SQRT,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('compiles Math.mulDiv', () => {
    const result = compile('function main(a, b, c) { return Math.mulDiv(a, b, c); }');
    expect(Array.from(result.bytecode[0])).toContain(OPS.MUL_DIV);
  });

  it('compiles Math.mulDiv with literals', () => {
    const result = compile('function main() { const x = Math.mulDiv(100, 50, 25); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.MUL_DIV,
        OPS.BYTE_1,
        100,
        OPS.BYTE_1,
        50,
        OPS.BYTE_1,
        25,
      ]),
    );
  });

  it('throws on Math.mulDiv with wrong arity', () => {
    expect(() => compile('function main(a, b) { return Math.mulDiv(a, b); }')).toThrow(
      'Math.mulDiv expects 3 argument(s), got 2',
    );
  });

  it('throws on >>>', () => {
    expect(() => compile('function main() { const x = 1 >>> 2; }')).toThrow('use >> instead of >>>');
  });

  // §1.9 compiler-parity: signed/modular Math.* intrinsics — must compile on TS the same
  // set compiler-rs accepts. Byte layout follows the v1 engine's positional operand order
  // (runtime/Math.sol, runtime/Boolean.sol).
  describe('signed / modular Math.* (compiler-rs parity)', () => {
    const prelude = (op: number, operands: number[]) =>
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, op, ...operands]);

    it('compiles Math.addMod', () => {
      const result = compile('function main() { const x = Math.addMod(10, 20, 5); }');
      expect(result.bytecode[0]).toEqual(
        prelude(OPS.ADD_MOD, [OPS.BYTE_1, 10, OPS.BYTE_1, 20, OPS.BYTE_1, 5]),
      );
    });

    it('compiles Math.mulMod', () => {
      const result = compile('function main() { const x = Math.mulMod(6, 7, 5); }');
      expect(result.bytecode[0]).toEqual(
        prelude(OPS.MUL_MOD, [OPS.BYTE_1, 6, OPS.BYTE_1, 7, OPS.BYTE_1, 5]),
      );
    });

    it('compiles Math.sDiv', () => {
      const result = compile('function main() { const x = Math.sDiv(10, 3); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.S_DIV, [OPS.BYTE_1, 10, OPS.BYTE_1, 3]));
    });

    it('compiles Math.sMod', () => {
      const result = compile('function main() { const x = Math.sMod(10, 3); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.S_MOD, [OPS.BYTE_1, 10, OPS.BYTE_1, 3]));
    });

    it('compiles Math.sShr (arithmetic shift right)', () => {
      const result = compile('function main() { const x = Math.sShr(64, 2); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.S_AR, [OPS.BYTE_1, 64, OPS.BYTE_1, 2]));
    });

    it('compiles Math.signExtend (byte index emitted first for the engine)', () => {
      // Math.signExtend(value, fromByte): the v1 engine reads k (fromByte) first, then the
      // value — so operands are emitted reversed relative to source-arg order.
      const result = compile('function main() { const x = Math.signExtend(200, 0); }');
      expect(result.bytecode[0]).toEqual(
        prelude(OPS.SIGN_EXTEND, [OPS.BYTE_1, 0, OPS.BYTE_1, 200]),
      );
    });

    it('compiles Math.sLt', () => {
      const result = compile('function main() { const x = Math.sLt(3, 5); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.BOOL_SLT, [OPS.BYTE_1, 3, OPS.BYTE_1, 5]));
    });

    it('compiles Math.sGt', () => {
      const result = compile('function main() { const x = Math.sGt(3, 5); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.BOOL_SGT, [OPS.BYTE_1, 3, OPS.BYTE_1, 5]));
    });

    it('compiles Math.sLte', () => {
      const result = compile('function main() { const x = Math.sLte(3, 5); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.BOOL_SLTE, [OPS.BYTE_1, 3, OPS.BYTE_1, 5]));
    });

    it('compiles Math.sGte', () => {
      const result = compile('function main() { const x = Math.sGte(3, 5); }');
      expect(result.bytecode[0]).toEqual(prelude(OPS.BOOL_SGTE, [OPS.BYTE_1, 3, OPS.BYTE_1, 5]));
    });

    it('throws on wrong arity (Math.sDiv with 3 args)', () => {
      expect(() => compile('function main(a, b, c) { return Math.sDiv(a, b, c); }')).toThrow(
        'Math.sDiv expects 2 argument(s), got 3',
      );
    });

    it('throws on wrong arity (Math.addMod with 2 args)', () => {
      expect(() => compile('function main(a, b) { return Math.addMod(a, b); }')).toThrow(
        'Math.addMod expects 3 argument(s), got 2',
      );
    });
  });
});
