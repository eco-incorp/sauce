import { OPS } from './ops.js';
import { BYTE_OPS, BYTE_WIDTH } from './integer.js';

// Structural view of a builder node — both v1 Saucer and v12 V12Saucer expose
// `_bytes`, and array literals encode identically for either target. Named so it
// doesn't shadow the real Saucer class.
type BuilderNode = { _bytes: Uint8Array };

const MAX_BYTE_1 = 0xff;
const MAX_BYTE_2 = 0xffff;

const isStaticType = (op: number): boolean => op in BYTE_WIDTH;

const isDynamicLiteral = (op: number): boolean =>
  op === OPS.BYTES || op === OPS.BYTES_2 || op === OPS.ARRAY || op === OPS.ARRAY_2 || op === OPS.TUPLE;

// Runtime-computed expressions that produce dynamic (bytes) values
const isRuntimeDynamic = (op: number): boolean =>
  op === OPS.READ_HEAP || op === OPS.CONCAT || op === OPS.SLICE || op === OPS.ABI_ENCODE;

const isDynamicType = (op: number): boolean => isDynamicLiteral(op) || isRuntimeDynamic(op);

const allStatic = (elements: BuilderNode[]): boolean => elements.every((e) => isStaticType(e._bytes[0]));

const allDynamic = (elements: BuilderNode[]): boolean => elements.every((e) => isDynamicType(e._bytes[0]));

const maxByteWidth = (elements: BuilderNode[]): number => Math.max(...elements.map((e) => BYTE_WIDTH[e._bytes[0]]));

const padToWidth = (bytes: Uint8Array, width: number): number[] => {
  const valueBytes = bytes.slice(1); // Skip opcode
  const padding = width - valueBytes.length;

  return [...Array<number>(padding).fill(0), ...valueBytes];
};

const packStaticElements = (elements: BuilderNode[], width: number): number[] =>
  elements.flatMap((e) => padToWidth(e._bytes, width));

const packDynamicElements = (elements: BuilderNode[]): number[] => elements.flatMap((e) => Array.from(e._bytes));

const encodeLength = (length: number): { op: number; bytes: number[] } =>
  length <= MAX_BYTE_1
    ? { op: OPS.ARRAY, bytes: [length] }
    : { op: OPS.ARRAY_2, bytes: [(length >> 8) & 0xff, length & 0xff] };

/**
 * `forcedWidth` (optional): only ever passed by `processReturnStatement`'s width-forcing branch
 * for a return-position array literal the ts-frontend's local-array return-escape fold
 * synthesized (see ts-frontend.ts's "Forcing uint256 element width" doc note) — NOT a general
 * width-selection knob for an ordinary, directly user-written array literal, which keeps its
 * existing auto-narrowed encoding (via `maxByteWidth`) completely unchanged either way.
 * `Math.max(forcedWidth, natural)` means a forced width can only WIDEN a value's encoding,
 * never truncate one — `packStaticElements`/`padToWidth` need no change at all, since they
 * already zero-left-pad to whatever `width` they're given. Only meaningful in the `allStatic`
 * branch (every element the fold synthesizes is a non-negative bigint literal, which always
 * encodes as a STATIC type) — passing it alongside a dynamic-element array throws defensively,
 * since there is no such caller today and honoring it silently would be misleading.
 */
export const encodeArray = (elements: BuilderNode[], forcedWidth?: number): Uint8Array => {
  if (elements.length === 0) return new Uint8Array([OPS.ARRAY, 0, OPS.BYTE_1]);

  if (elements.length > MAX_BYTE_2)
    throw new Error(`array too large: ${elements.length} elements exceeds ${MAX_BYTE_2}`);

  const { op, bytes: lengthBytes } = encodeLength(elements.length);

  if (allStatic(elements)) {
    const natural = maxByteWidth(elements);
    const width = forcedWidth !== undefined ? Math.max(forcedWidth, natural) : natural;

    if (!(width in BYTE_OPS)) throw new Error(`invalid forced array element width: ${width} (must be 1..32)`);

    return new Uint8Array([op, ...lengthBytes, BYTE_OPS[width], ...packStaticElements(elements, width)]);
  }

  if (forcedWidth !== undefined) {
    // Defensive, unreachable in practice today: the only caller of `forcedWidth`
    // (the return-array escape fold) only ever synthesizes non-negative bigint element
    // literals, which always take the `allStatic` branch above — this guards against a
    // future caller misapplying `forcedWidth` to a dynamic-element array literal, where
    // "width" has no meaning.
    throw new Error('forcedWidth is only supported for a static (fixed-width) array literal');
  }

  if (!allDynamic(elements))
    throw new Error('array elements must be literals or dynamic types (strings, arrays, bytes)');

  // For runtime-computed elements (READ_HEAP, CONCAT, etc.), use BYTES as the element type marker
  const firstOp = elements[0]._bytes[0];
  const elementType = isDynamicLiteral(firstOp) ? firstOp : OPS.BYTES;

  return new Uint8Array([op, ...lengthBytes, elementType, ...packDynamicElements(elements)]);
};

export const encodeIndex = (index: BuilderNode, array: BuilderNode): Uint8Array =>
  new Uint8Array([OPS.INDEX, ...index._bytes, ...array._bytes]);

// In-place element assignment `arr[i] = value`. v1 prefix order:
// [SET_INDEX][value][index][array] — value first, array last.
export const encodeSetIndex = (value: BuilderNode, index: BuilderNode, array: BuilderNode): Uint8Array =>
  new Uint8Array([OPS.SET_INDEX, ...value._bytes, ...index._bytes, ...array._bytes]);

// `new Array(n)` → zero-initialized TUPLE of n slots. v1 prefix: [NEW_ARRAY][count].
export const encodeNewArray = (count: BuilderNode): Uint8Array => new Uint8Array([OPS.NEW_ARRAY, ...count._bytes]);

// Whether a value's encoded bytes are a STATIC PACKED array literal — element-
// width-packed (element-type byte 0x01..0x20) and therefore immutable: the engine
// reverts SET_INDEX on it (only TUPLE and dynamic arrays, element-type byte > 0x20,
// are in-place mutable). Mirrors the engine's `do_set_idx_array` subtype check so
// the compiler rejects exactly the targets the runtime would reject — no false
// positives. TUPLE / NEW_ARRAY / dynamic-element arrays / scalars all return false.
export const isImmutablePackedArray = (bytes: Uint8Array): boolean => {
  const op = bytes[0];

  if (op !== OPS.ARRAY && op !== OPS.ARRAY_2) return false;

  const elementType = bytes[op === OPS.ARRAY ? 2 : 3];

  return elementType >= 0x01 && elementType <= 0x20;
};
