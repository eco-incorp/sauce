import { cook } from './utils.js';
import { encodeAbiParameters } from 'viem';
import type { AbiParameter } from 'viem';

const encode = (types: AbiParameter[], values: unknown[]): string => encodeAbiParameters(types, values).toLowerCase();

describe('integration: abi.encode scalars', () => {
  it('single uint256', () => {
    expect(cook('function main() { return abi.encode(42); }')).toBe(encode([{ type: 'uint256' }], [42n]));
  });

  it('two uint256', () => {
    expect(cook('function main() { return abi.encode(100, 200); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256' }], [100n, 200n]),
    );
  });

  it('three uint256', () => {
    expect(cook('function main() { return abi.encode(10, 20, 30); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 20n, 30n]),
    );
  });

  it('object with scalar fields (sorted alphabetically)', () => {
    expect(cook('function main() { return abi.encode({ x: 7, y: 13 }); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256' }], [7n, 13n]),
    );
  });

  it('uint8 value', () => {
    expect(cook('function main() { return abi.encode(255); }')).toBe(encode([{ type: 'uint256' }], [255n]));
  });

  it('bool value', () => {
    expect(cook('function main() { return abi.encode(1); }')).toBe(encode([{ type: 'uint256' }], [1n]));
  });

  it('large uint256', () => {
    const big = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
    expect(cook(`function main() { return abi.encode(${big}n); }`)).toBe(encode([{ type: 'uint256' }], [big]));
  });

  it('many scalars', () => {
    const types = Array.from({ length: 8 }, () => ({ type: 'uint256' as const }));
    const values = [11n, 22n, 33n, 44n, 55n, 66n, 77n, 88n];
    expect(cook('function main() { return abi.encode(11, 22, 33, 44, 55, 66, 77, 88); }')).toBe(encode(types, values));
  });
});

describe('integration: abi.encode strings', () => {
  it('single string', () => {
    expect(cook('function main() { return abi.encode("hello"); }')).toBe(encode([{ type: 'string' }], ['hello']));
  });

  it('empty string', () => {
    expect(cook('function main() { return abi.encode(""); }')).toBe(encode([{ type: 'string' }], ['']));
  });

  it('multiple strings', () => {
    expect(cook('function main() { return abi.encode("abc", "def", "ghi"); }')).toBe(
      encode([{ type: 'string' }, { type: 'string' }, { type: 'string' }], ['abc', 'def', 'ghi']),
    );
  });
});

describe('integration: abi.encode bytes', () => {
  it('single bytes', () => {
    expect(cook('function main() { return abi.encode(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])); }')).toBe(
      encode([{ type: 'bytes' }], ['0xdeadbeef']),
    );
  });
});

describe('integration: abi.encode mixed', () => {
  it('scalar + string', () => {
    expect(cook('function main() { return abi.encode(42, "world"); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'string' }], [42n, 'world']),
    );
  });

  it('object with scalar + string', () => {
    expect(cook('function main() { return abi.encode({ id: 99, name: "abc" }); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'string' }], [99n, 'abc']),
    );
  });
});

describe('integration: abi.encode arrays', () => {
  it('array of scalars', () => {
    expect(cook('function main() { return abi.encode([10, 20, 30]); }')).toBe(
      encode([{ type: 'uint256[]' }], [[10n, 20n, 30n]]),
    );
  });

  it('scalar + array', () => {
    expect(cook('function main() { return abi.encode(42, [10, 20]); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256[]' }], [42n, [10n, 20n]]),
    );
  });

  it('array of strings', () => {
    expect(cook('function main() { return abi.encode(["abc", "de", "f"]); }')).toBe(
      encode([{ type: 'string[]' }], [['abc', 'de', 'f']]),
    );
  });
});

describe('integration: abi.encode structs', () => {
  it('scalar + scalar struct', () => {
    // all-scalar struct is flattened by the engine
    expect(cook('function main() { return abi.encode(1, { a: 42, b: 99 }); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, 42n, 99n]),
    );
  });

  it('scalar + struct with string', () => {
    expect(cook('function main() { return abi.encode(1, { id: 77, name: "hello" }); }')).toBe(
      encode(
        [{ type: 'uint256' }, { type: 'tuple', components: [{ type: 'uint256' }, { type: 'string' }] }],
        [1n, [77n, 'hello']],
      ),
    );
  });

  it('deeply nested struct', () => {
    // all-scalar nested struct is fully flattened by the engine
    expect(cook('function main() { return abi.encode(1, { a: 2, b: { c: 42, d: 99 } }); }')).toBe(
      encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, 2n, 42n, 99n]),
    );
  });
});

describe('integration: abi.encode complex', () => {
  it('string + array + struct + bytes', () => {
    const result = cook(`
      function main() {
        return abi.encode(
          "hello",
          [100, 200, 300],
          { x: 42, y: "world" },
          Uint8Array.from([0xde, 0xad])
        );
      }
    `);
    expect(result).toBe(
      encode(
        [
          { type: 'string' },
          { type: 'uint256[]' },
          { type: 'tuple', components: [{ type: 'uint256' }, { type: 'string' }] },
          { type: 'bytes' },
        ],
        ['hello', [100n, 200n, 300n], [42n, 'world'], '0xdead'],
      ),
    );
  });
});

describe('integration: abi.decode round-trips', () => {
  it('single uint256', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(42), "uint256");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'uint256' }], [42n]));
  });

  it('multiple uint256', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(1, 2, 3), "uint256", "uint256", "uint256");
        return abi.encode(decoded[0], decoded[1], decoded[2]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, 2n, 3n]));
  });

  it('decoded tuple length', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode(1, 2, 3), "uint256", "uint256", "uint256");
        return decoded.length;
      }`),
      ),
    ).toBe(3n);
  });

  it('string', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode("hello"), "string");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'string' }], ['hello']));
  });

  it('string length', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode("hello"), "string");
        return decoded[0].length;
      }`),
      ),
    ).toBe(5n);
  });

  it('string char', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode("hello"), "string");
        return decoded[0][0];
      }`),
      ),
    ).toBe(104n);
  });

  it('bytes', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])), "bytes");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'bytes' }], ['0xdeadbeef']));
  });

  it('bytes element', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode(Uint8Array.from([0xde, 0xad, 0xbe, 0xef])), "bytes");
        return decoded[0][2];
      }`),
      ),
    ).toBe(0xben);
  });

  it('nested struct scalars', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(1, { a: 42, b: 99 }), "uint256", { a: "uint256", b: "uint256" });
        return abi.encode(decoded[0], decoded[1][0], decoded[1][1]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [1n, 42n, 99n]));
  });

  it('array', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode([10, 20, 30]), ["uint256"]);
        return abi.encode(decoded[0][0], decoded[0][1], decoded[0][2]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [10n, 20n, 30n]));
  });

  it('array sum via loop', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode([10, 20, 30, 40, 50]), ["uint256"]);
        let sum = 0;
        for (let i = 0; i < decoded[0].length; i++) {
          sum = sum + decoded[0][i];
        }
        return sum;
      }`),
      ),
    ).toBe(150n);
  });

  it('double encode-decode', () => {
    expect(
      cook(`function main() {
        const first = abi.encode(42, "hello");
        const second = abi.encode(99, first);
        const outer = abi.decode(second, "uint256", "bytes");
        const inner = abi.decode(outer[1], "uint256", "string");
        return abi.encode(inner[0], inner[1]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'string' }], [42n, 'hello']));
  });

  it('computed values', () => {
    expect(
      cook(`function main() {
        let a = 10;
        let b = 20;
        const decoded = abi.decode(abi.encode(a * b, a + b), "uint256", "uint256");
        return abi.encode(decoded[0], decoded[1]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'uint256' }], [200n, 30n]));
  });

  it('uint8 decode', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(255), "uint8");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'uint256' }], [255n]));
  });

  it('bool decode', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(1), "bool");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'uint256' }], [1n]));
  });

  it('address decode', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode(1048576), "address");
        return abi.encode(decoded[0]);
      }`),
    ).toBe(encode([{ type: 'uint256' }], [1048576n]));
  });

  it('nested struct with string', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(
          abi.encode(1, { id: 77, name: "hello" }),
          "uint256", { id: "uint256", name: "string" }
        );
        return abi.encode(decoded[0], decoded[1][0], decoded[1][1]);
      }`),
    ).toBe(encode([{ type: 'uint256' }, { type: 'uint256' }, { type: 'string' }], [1n, 77n, 'hello']));
  });

  it('multiple strings', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(abi.encode("abc", "def"), "string", "string");
        return abi.encode(decoded[0], decoded[1]);
      }`),
    ).toBe(encode([{ type: 'string' }, { type: 'string' }], ['abc', 'def']));
  });

  it('array of strings: length', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode(["abc", "de", "f"]), ["string"]);
        return decoded[0].length;
      }`),
      ),
    ).toBe(3n);
  });

  it('array of strings: element length', () => {
    expect(
      BigInt(
        cook(`function main() {
        const decoded = abi.decode(abi.encode(["abc", "de", "f"]), ["string"]);
        return decoded[0][1].length;
      }`),
      ),
    ).toBe(2n);
  });

  it('deeply nested struct with strings', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(
          abi.encode(0, { a: "abc", b: { c: 213, d: "xyz" } }),
          "uint256", { a: "string", b: { c: "uint256", d: "string" } }
        );
        return abi.encode(decoded[0], decoded[1][0], decoded[1][1][0], decoded[1][1][1]);
      }`),
    ).toBe(
      encode(
        [{ type: 'uint256' }, { type: 'string' }, { type: 'uint256' }, { type: 'string' }],
        [0n, 'abc', 213n, 'xyz'],
      ),
    );
  });

  it('all types combo', () => {
    expect(
      cook(`function main() {
        const decoded = abi.decode(
          abi.encode("hello", [100, 200, 300], { x: 42, y: "world" }, Uint8Array.from([0xde, 0xad])),
          "string", ["uint256"], { x: "uint256", y: "string" }, "bytes"
        );
        return abi.encode(decoded[0], decoded[1], decoded[2][0], decoded[2][1], decoded[3]);
      }`),
    ).toBe(
      encode(
        [{ type: 'string' }, { type: 'uint256[]' }, { type: 'uint256' }, { type: 'string' }, { type: 'bytes' }],
        ['hello', [100n, 200n, 300n], 42n, 'world', '0xdead'],
      ),
    );
  });
});
