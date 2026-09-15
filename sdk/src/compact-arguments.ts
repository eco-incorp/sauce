/** The compact-v1 wire format emitted by the compiler's `compactArgs` option.
 * Values are positional (including tuple fields). Code and schema depend only on
 * source/types; request values are encoded separately and never enter code caches.
 */
export type CompactValue =
  bigint | number | boolean | string | Uint8Array | readonly CompactValue[];
type Shape = { tag: number; children: Shape[] };

function parseSchema(schema: Uint8Array): Shape {
  let position = 0;
  const read = (): number => {
    const byte = schema[position++];
    if (byte === undefined) throw new RangeError("Truncated compact schema");
    return byte;
  };
  const parse = (depth: number): Shape => {
    if (depth > 32) throw new RangeError("Compact schema exceeds 32 levels");
    const tag = read();
    if (tag === 0x20 || tag === 0x40 || tag === 0x90) return { tag, children: [] };
    const size = read() * 256 + read();
    if (tag === 0x92) {
      const end = position + size;
      const child = parse(depth + 1);
      if (position !== end) throw new RangeError("Invalid compact array schema length");
      return { tag, children: [child] };
    }
    if (tag === 0x94)
      return { tag, children: Array.from({ length: size }, () => parse(depth + 1)) };
    throw new TypeError(`Unknown compact schema tag ${tag}`);
  };
  if (schema.length > 65535) throw new RangeError("Compact schema exceeds 65535 bytes");
  const root = parse(1);
  if (position !== schema.length) throw new RangeError("Trailing compact schema bytes");
  return root;
}

/** Encode exactly the schema returned alongside the compiled program. Scalar
 * negatives preserve their 256-bit two's-complement representation. Addresses and
 * public keys can be supplied as full-width hexadecimal integers. Bytes are raw,
 * unpadded bytes; collection lengths are unsigned 32-bit big-endian counts.
 */
export function encodeCompactArguments(schema: Uint8Array, value: CompactValue): Uint8Array {
  const shape = parseSchema(schema);
  const chunks: Uint8Array[] = [Uint8Array.of(0x53, 0x41, 1, 0)];
  const count = (length: number): void => {
    if (!Number.isSafeInteger(length) || length < 0 || length > 0xffffffff)
      throw new RangeError("Compact length exceeds u32");
    chunks.push(Uint8Array.of(length >>> 24, length >>> 16, length >>> 8, length));
  };
  const encode = (type: Shape, input: CompactValue): void => {
    if (type.tag === 0x92 || type.tag === 0x94) {
      if (!Array.isArray(input))
        throw new TypeError("Compact collection requires a positional array");
      if (type.tag === 0x92) {
        count(input.length);
        for (const item of input) encode(type.children[0]!, item);
      } else {
        if (input.length !== type.children.length)
          throw new RangeError("Compact tuple field count mismatch");
        for (let i = 0; i < input.length; i++) encode(type.children[i]!, input[i]!);
      }
      return;
    }
    if (type.tag === 0x90) {
      let bytes: Uint8Array;
      if (input instanceof Uint8Array) bytes = input;
      else if (typeof input === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(input)) {
        bytes = Uint8Array.from(input.slice(2).match(/../g) ?? [], (pair) => parseInt(pair, 16));
      } else throw new TypeError("Compact bytes require Uint8Array or even-length hexadecimal");
      count(bytes.length);
      chunks.push(bytes);
      return;
    }
    if (typeof input === "number" && !Number.isSafeInteger(input))
      throw new RangeError("Compact scalar number must be a safe integer");
    if (
      typeof input !== "bigint" &&
      typeof input !== "number" &&
      typeof input !== "boolean" &&
      typeof input !== "string"
    )
      throw new TypeError("Invalid compact scalar");
    if (typeof input === "string" && !/^(?:0x[0-9a-fA-F]+|-?[0-9]+)$/.test(input))
      throw new TypeError("Invalid compact scalar text");
    let scalar = BigInt(input);
    if (scalar < -(1n << 255n) || scalar >= 1n << 256n)
      throw new RangeError("Compact scalar exceeds 256 bits");
    if (type.tag === 0x40) scalar = scalar === 0n ? 0n : 1n;
    scalar = BigInt.asUintN(256, scalar);
    const bytes: number[] = [];
    while (scalar !== 0n) {
      bytes.push(Number(scalar & 255n));
      scalar >>= 8n;
    }
    chunks.push(Uint8Array.of(bytes.length, ...bytes.reverse()));
  };
  encode(shape, value);
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!Number.isSafeInteger(length) || length > 0xffffffff)
    throw new RangeError("Compact data exceeds u32");
  const result = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

/** Strict inverse for inspection and signing: rejects non-minimal scalar widths,
 * non-canonical booleans, malformed lengths and trailing bytes. Engine decoding
 * additionally validates its bounded heap allocations before exposing any value.
 */
export function decodeCompactArguments(
  schema: Uint8Array,
  data: Uint8Array,
  options: { maxValues?: number } = {},
): CompactValue {
  // Inspection is unmetered host work. Bound the decoded object graph even when
  // a malicious array claims millions of zero-byte empty tuples.
  let remaining = options.maxValues ?? 1_000_000;
  if (!Number.isSafeInteger(remaining) || remaining < 1)
    throw new RangeError("Compact maxValues must be a positive safe integer");
  const shape = parseSchema(schema);
  let cursor = 0;
  const take = (length: number): Uint8Array => {
    if (length > data.length - cursor) throw new RangeError("Truncated compact arguments");
    const result = data.subarray(cursor, cursor + length);
    cursor += length;
    return result;
  };
  const count = (): number => take(4).reduce((n, byte) => n * 256 + byte, 0);
  if (Array.from(take(4)).join(",") !== "83,65,1,0")
    throw new TypeError("Unsupported compact arguments version");
  const decode = (type: Shape): CompactValue => {
    if (--remaining < 0) throw new RangeError("Compact decoded value limit exceeded");
    if (type.tag === 0x90) return take(count()).slice();
    if (type.tag === 0x94) return type.children.map(decode);
    if (type.tag === 0x92) {
      const length = count();
      // Every child consumes at least one data byte except a zero-field tuple.
      // Cap allocations to the engine's maximum descriptor length, independently
      // of the input's claimed count (including zero-byte tuple elements).
      if (length > 0x7ffffff) throw new RangeError("Compact collection exceeds engine descriptor");
      if (length > remaining) throw new RangeError("Compact decoded value limit exceeded");
      const result: CompactValue[] = [];
      for (let i = 0; i < length; i++) result.push(decode(type.children[0]!));
      return result;
    }
    const width = take(1)[0]!;
    if (width > 32) throw new RangeError("Compact scalar exceeds 256 bits");
    const bytes = take(width);
    if (width > 0 && bytes[0] === 0) throw new RangeError("Non-minimal compact scalar");
    const scalar = bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
    if (type.tag === 0x40) {
      if (scalar > 1n) throw new RangeError("Non-canonical compact boolean");
      return scalar === 1n;
    }
    return scalar;
  };
  const value = decode(shape);
  if (cursor !== data.length) throw new RangeError("Trailing compact arguments");
  return value;
}
