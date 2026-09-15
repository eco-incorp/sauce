import { decodeCompactArguments, encodeCompactArguments } from "../src/compact-arguments.js";

// Same independent wire vector executed by the EVM and SVM conformance suites:
// (Uint256[][], Uint256, bytes), with a zero-length row and a mutable second row.
const schema = Uint8Array.of(0x94, 0, 3, 0x92, 0, 4, 0x92, 0, 1, 0x20, 0x20, 0x90);
const wire = Uint8Array.of(
  0x53,
  0x41,
  1,
  0,
  0,
  0,
  0,
  2,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  2,
  1,
  5,
  1,
  7,
  1,
  1,
  0,
  0,
  0,
  3,
  0xaa,
  0xbb,
  0xcc,
);

test("encodes the cross-engine nested/aliasing vector", () => {
  expect(encodeCompactArguments(schema, [[[], [5n, 7n]], 1n, "0xaabbcc"])).toEqual(wire);
  expect(decodeCompactArguments(schema, wire)).toEqual([
    [[], [5n, 7n]],
    1n,
    Uint8Array.of(0xaa, 0xbb, 0xcc),
  ]);
});

test("preserves full-width and signed bit patterns without baking values into the schema", () => {
  const scalar = Uint8Array.of(0x20);
  const maximum = Uint8Array.from([0x53, 0x41, 1, 0, 32, ...Array<number>(32).fill(255)]);
  expect(encodeCompactArguments(scalar, (1n << 256n) - 1n)).toEqual(maximum);
  expect(encodeCompactArguments(scalar, -1n)).toEqual(maximum);
  expect(decodeCompactArguments(scalar, maximum)).toBe((1n << 256n) - 1n);
  expect(encodeCompactArguments(scalar, 0n)).toEqual(Uint8Array.of(0x53, 0x41, 1, 0, 0));
  expect(() => encodeCompactArguments(scalar, 1n << 256n)).toThrow(RangeError);
  expect(() => encodeCompactArguments(scalar, -(1n << 255n) - 1n)).toThrow(RangeError);
  expect(() => encodeCompactArguments(scalar, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
});

test("rejects every truncated prefix, trailing data and noncanonical scalars", () => {
  for (let end = 0; end < wire.length; end++)
    expect(() => decodeCompactArguments(schema, wire.slice(0, end))).toThrow();
  expect(() => decodeCompactArguments(schema, Uint8Array.from([...wire, 0]))).toThrow();
  expect(() =>
    decodeCompactArguments(Uint8Array.of(0x20), Uint8Array.of(0x53, 0x41, 1, 0, 1, 0)),
  ).toThrow();
  expect(() =>
    decodeCompactArguments(Uint8Array.of(0x40), Uint8Array.of(0x53, 0x41, 1, 0, 1, 2)),
  ).toThrow();
});

test("validates schema extents, tuple arity, byte hex and scalar widths", () => {
  for (const bad of [[], [0xff], [0x92, 0, 2, 0x20], [0x94, 0, 1], [0x20, 0x20]]) {
    expect(() => encodeCompactArguments(Uint8Array.from(bad), [])).toThrow();
  }
  expect(() => encodeCompactArguments(schema, [])).toThrow();
  for (const bad of ["0xa", "0xgg", "abc"])
    expect(() => encodeCompactArguments(Uint8Array.of(0x90), bad)).toThrow();
  expect(() =>
    decodeCompactArguments(Uint8Array.of(0x20), Uint8Array.of(0x53, 0x41, 1, 0, 33)),
  ).toThrow();
});

test("bounds nested decoded allocations, including zero-byte tuple arrays", () => {
  const emptyTupleArray = Uint8Array.of(0x92, 0, 3, 0x94, 0, 0);
  const tiny = encodeCompactArguments(emptyTupleArray, [[], [], []]);
  expect(decodeCompactArguments(emptyTupleArray, tiny, { maxValues: 4 })).toEqual([[], [], []]);
  expect(() => decodeCompactArguments(emptyTupleArray, tiny, { maxValues: 3 })).toThrow(
    /value limit/,
  );
  const hostile = Uint8Array.of(0x53, 0x41, 1, 0, 7, 255, 255, 255);
  expect(() => decodeCompactArguments(emptyTupleArray, hostile)).toThrow(/value limit/);
  expect(() => decodeCompactArguments(schema, wire, { maxValues: 0 })).toThrow(/maxValues/);
});
