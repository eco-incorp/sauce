import { compile } from '../src/index.js';
import { OPS } from '../src/saucer/index.js';

describe('compile with args', () => {
  it('appends invocation segment with a single bigint arg', () => {
    const result = compile('function main(x) { return x; }', {
      args: [42n],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.BYTE_1, 0x2a,        // 42
    ]));
  });

  it('appends invocation segment with multiple bigint args', () => {
    const result = compile('function main(a, b) { return a + b; }', {
      args: [10n, 20n],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 2, // call main (index 0) with 2 args
      OPS.BYTE_1, 0x0a,        // 10
      OPS.BYTE_1, 0x14,        // 20
    ]));
  });

  it('encodes hex string args as bytes', () => {
    const result = compile('function main(addr) { return addr; }', {
      args: ['0xdead'],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.BYTES, 2, 0xde, 0xad,
    ]));
  });

  it('encodes array args as tuples', () => {
    const result = compile('function main(data) { return data; }', {
      args: [[1n, 2n, 3n]],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.TUPLE, 3,            // tuple with 3 elements
      OPS.BYTE_1, 1,
      OPS.BYTE_1, 2,
      OPS.BYTE_1, 3,
    ]));
  });

  it('encodes nested arrays as nested tuples', () => {
    const result = compile('function main(pools) { return pools; }', {
      args: [
        [
          [10n, 20n],
          [30n, 40n],
        ],
      ],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.TUPLE, 2,            // outer tuple with 2 elements
      OPS.TUPLE, 2,            // inner tuple 1: [10, 20]
      OPS.BYTE_1, 10,
      OPS.BYTE_1, 20,
      OPS.TUPLE, 2,            // inner tuple 2: [30, 40]
      OPS.BYTE_1, 30,
      OPS.BYTE_1, 40,
    ]));
  });

  it('handles mixed arg types (bigint, string, array)', () => {
    const result = compile('function main(amount, addr, data) { return amount; }', {
      args: [100n, '0xff', [1n]],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 3, // call main (index 0) with 3 args
      OPS.BYTE_1, 0x64,        // 100
      OPS.BYTES, 1, 0xff,      // 0xff
      OPS.TUPLE, 1,            // [1n]
      OPS.BYTE_1, 1,
    ]));
  });

  it('does not append invocation when args is empty', () => {
    const result = compile('function main() { return 1; }', { args: [] });
    expect(result.bytecode).toHaveLength(1);
  });

  it('does not append invocation when args is not provided', () => {
    const result = compile('function main() { return 1; }');
    expect(result.bytecode).toHaveLength(1);
  });

  it('uses correct main index when helper functions exist', () => {
    const result = compile('function add(a, b) { return a + b; }\nfunction main(x) { return add(x, 1); }', {
      args: [5n],
    });

    // bytecode[0] = add, bytecode[1] = main, bytecode[2] = invocation
    expect(result.bytecode).toHaveLength(3);

    const invocation = result.bytecode[2];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 1, 1, // call main (index 1, add=0) with 1 arg
      OPS.BYTE_1, 5,
    ]));
  });

  it('encodes large bigint values correctly', () => {
    const largeValue = 2n ** 128n;
    const result = compile('function main(x) { return x; }', {
      args: [largeValue],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // 2^128 = 0x100000000000000000000000000000000 (17 bytes)
    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.BYTE_17,
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00,
    ]));
  });

  it('encodes 20-byte address string correctly', () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const result = compile('function main(addr) { return addr; }', {
      args: [addr],
    });

    expect(result.bytecode).toHaveLength(2);

    const invocation = result.bytecode[1];

    // prettier-ignore
    expect(invocation).toEqual(new Uint8Array([
      OPS.CALL_FUNCTION, 0, 1, // call main (index 0) with 1 arg
      OPS.BYTES, 20,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x01,
    ]));
  });
});
