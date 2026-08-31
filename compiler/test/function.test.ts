import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('function', () => {
  it('compiles basic function definition', () => {
    const result = compile('function constant() {return 1;}\nfunction main() {let x = constant();}');
    expect(result.bytecode[0]).toHaveLength(3);
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.BYTE_1, 1, OPS.STOP]));
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_FUNCTION, 0, 0]),
    );
  });

  it('compiles addition function definition', () => {
    const result = compile('function add(a, b) {const x = a + b; return x;}\nfunction main() {let y = add(2, 3)}');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        3,
        OPS.WRITE_VALUE,
        2,
        OPS.ADD,
        OPS.READ_VALUE,
        0,
        OPS.READ_VALUE,
        1,
        OPS.READ_VALUE,
        2,
        OPS.STOP,
      ]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        2,
        OPS.BYTE_1,
        2,
        OPS.BYTE_1,
        3,
      ]),
    );
  });

  it('compiles function with single parameter', () => {
    const result = compile('function double(x) { return x + x; }\nfunction main() { let y = double(5); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.ADD, OPS.READ_VALUE, 0, OPS.READ_VALUE, 0, OPS.STOP]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_FUNCTION, 0, 1, OPS.BYTE_1, 5]),
    );
  });

  it('compiles function returning param expression directly', () => {
    const result = compile('function multiply(a, b) { return a * b; }\nfunction main() { let x = multiply(3, 7); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 2, OPS.MUL, OPS.READ_VALUE, 0, OPS.READ_VALUE, 1, OPS.STOP]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        2,
        OPS.BYTE_1,
        3,
        OPS.BYTE_1,
        7,
      ]),
    );
  });

  it('compiles function with local variable and params', () => {
    const result = compile(
      'function square(x) { const result = x * x; return result; }\nfunction main() { let y = square(4); }',
    );
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        1,
        OPS.MUL,
        OPS.READ_VALUE,
        0,
        OPS.READ_VALUE,
        0,
        OPS.READ_VALUE,
        1,
        OPS.STOP,
      ]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_FUNCTION, 0, 1, OPS.BYTE_1, 4]),
    );
  });

  it('compiles multiple function definitions', () => {
    const result = compile(
      'function foo() { return 10; }\nfunction bar() { return 20; }\nfunction main() { let a = foo(); let b = bar(); }',
    );
    expect(result.bytecode).toHaveLength(3);
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.BYTE_1, 10, OPS.STOP]));
    expect(result.bytecode[1]).toEqual(new Uint8Array([OPS.BYTE_1, 20, OPS.STOP]));
    expect(result.bytecode[2]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        0,
        OPS.WRITE_VALUE,
        1,
        OPS.CALL_FUNCTION,
        1,
        0,
      ]),
    );
  });

  it('compiles function defined after main', () => {
    const result = compile('function main() { let x = helper(); }\nfunction helper() { return 42; }');
    expect(result.bytecode[0]).toHaveLength(3);
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.BYTE_1, 42, OPS.STOP]));
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_FUNCTION, 0, 0]),
    );
  });

  it('compiles function call with expression arguments', () => {
    const result = compile('function add(a, b) { return a + b; }\nfunction main() { let x = add(1 + 2, 3 * 4); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 2, OPS.ADD, OPS.READ_VALUE, 0, OPS.READ_VALUE, 1, OPS.STOP]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        2,
        OPS.ADD,
        OPS.BYTE_1,
        1,
        OPS.BYTE_1,
        2,
        OPS.MUL,
        OPS.BYTE_1,
        3,
        OPS.BYTE_1,
        4,
      ]),
    );
  });

  it('compiles function call with variable arguments', () => {
    const result = compile('function double(x) { return x + x; }\nfunction main() { let a = 5; let b = double(a); }');
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.ADD, OPS.READ_VALUE, 0, OPS.READ_VALUE, 0, OPS.STOP]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.WRITE_VALUE,
        0,
        OPS.BYTE_1,
        5,
        OPS.WRITE_VALUE,
        1,
        OPS.CALL_FUNCTION,
        0,
        1,
        OPS.READ_VALUE,
        0,
      ]),
    );
  });

  it('compiles function with no return value', () => {
    const result = compile('function noop() {}\nfunction main() { let x = noop(); }');
    expect(result.bytecode[0]).toEqual(new Uint8Array());
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.CALL_FUNCTION, 0, 0]),
    );
  });

  it('compiles function result used in expression', () => {
    const result = compile('function five() { return 5; }\nfunction main() { let x = five() + 10; }');
    expect(result.bytecode[0]).toEqual(new Uint8Array([OPS.BYTE_1, 5, OPS.STOP]));
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([OPS.ALLOCATE_VALUE, 1, OPS.WRITE_VALUE, 0, OPS.ADD, OPS.CALL_FUNCTION, 0, 0, OPS.BYTE_1, 10]),
    );
  });

  it('compiles function with conditional return', () => {
    const result = compile(
      'function max(a, b) { if (a > b) { return a; } return b; }\nfunction main() { let x = max(3, 7); }',
    );
    expect(result.bytecode[0]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        2,
        OPS.IF,
        3,
        OPS.BOOL_GT,
        OPS.READ_VALUE,
        0,
        OPS.READ_VALUE,
        1,
        OPS.READ_VALUE,
        0,
        OPS.STOP,
        OPS.READ_VALUE,
        1,
        OPS.STOP,
      ]),
    );
    expect(result.bytecode[1]).toEqual(
      new Uint8Array([
        OPS.ALLOCATE_VALUE,
        1,
        OPS.WRITE_VALUE,
        0,
        OPS.CALL_FUNCTION,
        0,
        2,
        OPS.BYTE_1,
        3,
        OPS.BYTE_1,
        7,
      ]),
    );
  });

  it('throws on undefined function call', () => {
    expect(() => compile('function main() { let x = unknown(); }')).toThrow('Function unknown is undefined.');
  });

  it('throws on duplicate function definition', () => {
    expect(() => compile('function foo() { return 1; }\nfunction foo() { return 2; }\nfunction main() {}')).toThrow();
  });
});
