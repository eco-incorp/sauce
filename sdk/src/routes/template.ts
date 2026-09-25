/**
 * Byte TEMPLATING — a precompiled payload with runtime-computed values spliced into it.
 *
 * This is the mechanism that makes an intent whose amounts are only known DURING execution
 * expressible at all. `nest.ts` can only build a STATIC child: its `publishAndFund` is fully
 * pre-encoded off-chain, which is impossible for an amount nobody has measured yet (the output of a
 * swap that runs in the same fulfillment, say). The fix is not to encode the child on-chain — a
 * Sauce program has no ABI encoder for an arbitrary struct — but to encode it off-chain ONCE with
 * placeholders, cut the result at the placeholder boundaries, and have the program re-CONCATENATE
 * literal byte runs around values it computes:
 *
 * ```
 * const d0_s0 = hex`…`;                                   // everything before the first slot
 * const d0_data = d0_s0.concat(d0_out.toBytesBe(32)).concat(d0_s1)…;
 * evm.call(portal, 0n, d0_data);
 * ```
 *
 * This is the same shape as `../eco-routes/contracts/chain/IntentTemplate.sol`
 * (`struct Template { bytes[] segments; Item[] items; }`, `render()` concatenating segments around
 * rendered items) — READ AS A REFERENCE DESIGN, not depended on. Nothing here calls that contract or
 * any other: the concatenation happens inside the Sauce program itself, so there is no chainer in
 * the path and nothing new to deploy. `segments.length === slots.length + 1` is the same invariant
 * its `validateShape` asserts, for the same reason.
 *
 * WHY THIS WORKS AT ALL — the splice must not move anything after it. ABI encoding is what makes
 * that true: every value is a 32-byte word at a static offset, and a dynamic `bytes`/array carries
 * its own length and offset words which an AMOUNT never appears in. So writing a different 32-byte
 * word over an amount changes no offset, no length, and no other field. (Borsh is the same for a
 * FIXED-width integer field — a `u64` amount is 8 bytes wherever it sits — which is why `width`/
 * `littleEndian` exist here rather than 32-byte-big-endian being hardcoded; see `nest-dynamic.ts`
 * for the SVM-destination child that needs them.) The one encoding this CANNOT template is the
 * compiler's own `compact-v1` argument payload, whose scalars are minimally encoded so both the
 * width and the length prefix move with the value — see `../compact-arguments.ts`'s `scalarWidth`
 * option, which exists precisely to give that format a fixed-offset form too.
 *
 * Pure: no compiler import, no chain knowledge, no `Intent` knowledge — matching `nest.ts`'s
 * posture. `nest-dynamic.ts` is the layer that knows what a child intent is.
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";

/** Fixed-point denominator for every `scale` here, matching `IntentChainer.WAD`. Decimal rather
 *  than binary so every power-of-ten decimals conversion (6 -> 18 is `1e30`, 18 -> 6 is `1e6`) is
 *  exact in both directions. */
export const WAD = 10n ** 18n;

const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Which of the two derived amounts a slot renders. `"amountIn"` is the raw runtime MEASUREMENT;
 * `"amountOut"` is that measurement after the order's own scale (`ceil(amountIn * scale / WAD)`).
 * A slot may then apply a FURTHER per-slot `scale` on top of either — exactly
 * `IntentTemplate.AmountConfig`'s `source`/`scale` pair, and for the same reason: an intent
 * generally owes a different number on the destination than the number it was funded with.
 */
export type AmountSource = "amountIn" | "amountOut";

/** One computed value, rendered between `segments[i]` and `segments[i + 1]`. */
export interface TemplateSlot {
  readonly source: AmountSource;
  /** WAD-denominated further transform: `value = ceil(source * scale / WAD)`. `WAD` is identity. */
  readonly scale: bigint;
  /** Byte width of the rendered value, 1..32 — `.toBytesBe(width)`/`.toBytesLe(width)`'s argument. */
  readonly width: number;
  /** Borsh and other little-endian fixed-width encodings; `false` (big-endian) for ABI. */
  readonly littleEndian: boolean;
}

/** `segments.length === slots.length + 1`, always — slot `i` sits between segment `i` and `i + 1`. */
export interface ByteTemplate {
  readonly segments: readonly Hex[];
  readonly slots: readonly TemplateSlot[];
}

/**
 * A placeholder to CUT a precompiled payload at: the sentinel `value` a caller wrote into the
 * structure before encoding it, plus how the real value that replaces it is derived and encoded.
 *
 * The sentinel is matched as BYTES (`value` encoded at `width`/`littleEndian`), not as a number, so
 * it is found wherever the encoder happened to put it — a reward amount, a route token amount, or a
 * word buried inside an inner `call.data` this module never parses.
 */
export interface PlaceholderSpec {
  /** The sentinel written into the structure before encoding. Must fit `width` bytes. */
  readonly value: bigint;
  readonly source: AmountSource;
  /** Default `WAD` (identity). */
  readonly scale?: bigint;
  /** Default 32 — one ABI word. */
  readonly width?: number;
  /** Default `false` — big-endian, as ABI requires. */
  readonly littleEndian?: boolean;
  /**
   * EXACT number of occurrences expected in the payload. Omitted, any count >= 1 is accepted (zero
   * always throws). Pin it whenever the count is known: a sentinel that silently matched one word
   * too few leaves a placeholder amount in a real intent, and one word too many overwrites a field
   * the caller never meant to template.
   */
  readonly occurrences?: number;
}

function assertWidth(width: number, label: string): void {
  if (!Number.isInteger(width) || width < 1 || width > 32) {
    throw new Error(`${label}: width must be an integer in 1..32, got ${width}`);
  }
}

/** `value` as exactly `width` bytes, zero-padded, in the requested endianness. Throws rather than
 *  truncating — a truncated amount is a plausible-looking wrong number. */
export function encodeFixedWidth(value: bigint, width: number, littleEndian: boolean): Uint8Array {
  assertWidth(width, "encodeFixedWidth");
  if (value < 0n) {
    throw new Error(`encodeFixedWidth: negative value ${value} has no fixed-width encoding here`);
  }
  if (value >= 1n << BigInt(8 * width)) {
    throw new Error(`encodeFixedWidth: ${value} does not fit ${width} byte(s)`);
  }
  const bytes = new Uint8Array(width);
  let rest = value;
  for (let i = 0; i < width; i++) {
    bytes[littleEndian ? i : width - 1 - i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

/** `ceil(value * scale / WAD)` — the exact integer `IntentChainer._calculateAmountOut` computes
 *  with `Math.mulDiv(..., Rounding.Ceil)`. Rounds toward the party owed the number. */
export function scaleAmount(value: bigint, scale: bigint): bigint {
  if (scale <= 0n) {
    throw new Error(
      `scaleAmount: scale must be positive (a zero scale obliges nothing), got ${scale}`,
    );
  }
  if (value < 0n) throw new Error(`scaleAmount: negative value ${value}`);
  if (scale === WAD) return value;
  return (value * scale + (WAD - 1n)) / WAD;
}

/**
 * The largest `base` for which the SauceScript form of `scaleAmount` — `(base * scale + WAD - 1) /
 * WAD` — cannot wrap. The engine's arithmetic is 256-bit modular (EVM `MUL`), so unlike the
 * Solidity reference this has no 512-bit intermediate to hide behind: `IntentChainer` uses
 * `Math.mulDiv` specifically to avoid the boundary its own NatSpec calls out in the hand-rolled
 * form. A Sauce program cannot do 512-bit math cheaply, so the bound is checked at RUNTIME instead
 * (`emitTemplate` emits the guard), which is exact and costs one comparison.
 */
export function maxScalableBase(scale: bigint): bigint {
  if (scale <= 0n) throw new Error(`maxScalableBase: scale must be positive, got ${scale}`);
  if (scale === WAD) return MAX_UINT256;
  return (MAX_UINT256 - (WAD - 1n)) / scale;
}

function slotOf(spec: PlaceholderSpec): TemplateSlot {
  const scale = spec.scale ?? WAD;
  if (scale <= 0n) {
    throw new Error(`splitByPlaceholders: placeholder scale must be positive, got ${scale}`);
  }
  return {
    source: spec.source,
    scale,
    width: spec.width ?? 32,
    littleEndian: spec.littleEndian ?? false,
  };
}

interface Match {
  readonly start: number;
  readonly end: number;
  readonly specIndex: number;
}

function findAll(haystack: Uint8Array, needle: Uint8Array): number[] {
  const hits: number[] = [];
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

/**
 * Cuts `payload` at every occurrence of every placeholder, producing the literal segments the
 * program concatenates and the slot descriptors that say what goes between them.
 *
 * Fails closed on every way a sentinel search can be wrong: a placeholder that matched NOTHING (the
 * caller encoded a different value than they declared, or the encoder normalized it away), a
 * declared `occurrences` that disagrees with what was found, two placeholders sharing the same
 * on-wire bytes (which of them owns a hit is then undecidable), and two hits that OVERLAP (a
 * shorter sentinel landing inside a longer one). None of these is recoverable by guessing, and each
 * one silently produces a valid-looking intent carrying a wrong number.
 */
export function splitByPlaceholders(
  payload: Hex,
  placeholders: readonly PlaceholderSpec[],
): ByteTemplate {
  if (placeholders.length === 0) {
    throw new Error("splitByPlaceholders: no placeholders — a template with no slot is just bytes");
  }
  const bytes = hexToBytes(payload);
  const needles = placeholders.map((spec, i) => {
    const slot = slotOf(spec);
    try {
      return encodeFixedWidth(spec.value, slot.width, slot.littleEndian);
    } catch (cause) {
      throw new Error(
        `splitByPlaceholders: placeholder[${i}] (${spec.source}) value ${spec.value} does not fit its ` +
          `declared ${slot.width}-byte width`,
        { cause },
      );
    }
  });

  // Two placeholders with identical wire bytes make every hit ambiguous -- reject rather than
  // assign hits by declaration order, which would be an arbitrary and silent choice.
  const seen = new Map<string, number>();
  needles.forEach((needle, i) => {
    const key = bytesToHex(needle);
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new Error(
        `splitByPlaceholders: placeholder[${i}] and placeholder[${previous}] encode to the same bytes ` +
          `(${key}) — give each placeholder a distinct sentinel value.`,
      );
    }
    seen.set(key, i);
  });

  const matches: Match[] = [];
  needles.forEach((needle, specIndex) => {
    const hits = findAll(bytes, needle);
    const expected = placeholders[specIndex]!.occurrences;
    if (hits.length === 0) {
      throw new Error(
        `splitByPlaceholders: placeholder[${specIndex}] (${placeholders[specIndex]!.source}, sentinel ` +
          `${placeholders[specIndex]!.value}) does not occur in the ${bytes.length}-byte payload — the ` +
          `structure was encoded without it, or with a different value.`,
      );
    }
    if (expected !== undefined && hits.length !== expected) {
      throw new Error(
        `splitByPlaceholders: placeholder[${specIndex}] (${placeholders[specIndex]!.source}) occurs ` +
          `${hits.length} time(s), but occurrences: ${expected} was declared — a miscount templates the ` +
          `wrong field (too many) or leaves a sentinel in a real intent (too few).`,
      );
    }
    for (const start of hits) matches.push({ start, end: start + needle.length, specIndex });
  });

  matches.sort((a, b) => a.start - b.start);
  for (let i = 1; i < matches.length; i++) {
    if (matches[i]!.start < matches[i - 1]!.end) {
      throw new Error(
        `splitByPlaceholders: placeholder hits overlap at byte ${matches[i]!.start} ` +
          `(placeholder[${matches[i - 1]!.specIndex}] and placeholder[${matches[i]!.specIndex}]) — one ` +
          `sentinel's bytes appear inside another's.`,
      );
    }
  }

  const segments: Hex[] = [];
  const slots: TemplateSlot[] = [];
  let cursor = 0;
  for (const match of matches) {
    segments.push(bytesToHex(bytes.slice(cursor, match.start)));
    slots.push(slotOf(placeholders[match.specIndex]!));
    cursor = match.end;
  }
  segments.push(bytesToHex(bytes.slice(cursor)));

  return { segments, slots };
}

/**
 * The OFF-CHAIN twin of what the emitted program concatenates at runtime — the same role
 * `IntentTemplate.render` plays on-chain, and the only way to check the codegen without an engine:
 * given a measurement, this produces the exact bytes the program would, so a test can compare them
 * against an independently built concrete intent.
 */
export function renderTemplate(template: ByteTemplate, amountIn: bigint, amountOut: bigint): Hex {
  assertShape(template, "renderTemplate");
  const parts: Uint8Array[] = [hexToBytes(template.segments[0]!)];
  template.slots.forEach((slot, i) => {
    const base = slot.source === "amountIn" ? amountIn : amountOut;
    if (base > maxScalableBase(slot.scale)) {
      throw new Error(
        `renderTemplate: slot[${i}] base ${base} exceeds ${maxScalableBase(slot.scale)}, the largest ` +
          `value the program's own 256-bit \`(base * scale + WAD - 1) / WAD\` can compute without wrapping.`,
      );
    }
    const value = scaleAmount(base, slot.scale);
    try {
      parts.push(encodeFixedWidth(value, slot.width, slot.littleEndian));
    } catch (cause) {
      throw new Error(
        `renderTemplate: slot[${i}] value ${value} does not fit its ${slot.width}-byte width`,
        { cause },
      );
    }
    parts.push(hexToBytes(template.segments[i + 1]!));
  });

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return bytesToHex(out);
}

function assertShape(template: ByteTemplate, helper: string): void {
  if (template.segments.length !== template.slots.length + 1) {
    throw new Error(
      `${helper}: malformed template — ${template.segments.length} segment(s) for ` +
        `${template.slots.length} slot(s); segments must be exactly slots + 1.`,
    );
  }
}

export interface TemplateEmitOptions {
  /** Namespaces every local this template declares, so several templates merge into ONE program
   *  scope without colliding (same discipline as `nest.ts`'s `n<index>_` prefixes). */
  readonly prefix: string;
  /** The SauceScript local already holding the raw runtime measurement. */
  readonly amountInVar: string;
  /** The SauceScript local already holding `ceil(amountIn * orderScale / WAD)`. */
  readonly amountOutVar: string;
}

export interface TemplateEmitResult {
  readonly statements: readonly string[];
  /** The local the statements leave the rendered payload in. */
  readonly dataVar: string;
  /** The local holding each slot's rendered value, index-parallel to `template.slots`. Exposed so a
   *  caller can reuse a value it also needs OUTSIDE the payload — `nest-dynamic.ts`'s `approve` and
   *  its `evm.call` value both name the same amount the reward tuple carries, and re-deriving it
   *  into a second local would be a second chance to disagree with the bytes actually sent. */
  readonly slotVars: readonly string[];
}

function literal(value: bigint): string {
  return `${value.toString()}n`;
}

/**
 * Emits the SauceScript that renders this template at runtime, leaving the result in one local.
 *
 * Three kinds of statement come out, in this order:
 *
 *  1. one `const` per DISTINCT non-identity `(source, scale)` pair, each preceded by the overflow
 *     guard `maxScalableBase` describes — the engine's `*` wraps, so an unguarded scale silently
 *     renders a tiny number for a huge measurement;
 *  2. one fit guard per distinct `(value, width)` where `width < 32`, mirroring
 *     `IntentTemplate.AmountDoesNotFit`: `.toBytesBe(8)` of a value over `2^64` would otherwise
 *     truncate into a plausible wrong amount;
 *  3. one `const` per NON-EMPTY segment, then the single concat chain.
 *
 * Each segment is bound to its own `const` before `.concat` is called on it: a method call directly
 * on a `hex` literal is outside the compiler's M1 subset (the same reason
 * `deposit/templates.ts#calldataLines` and `nest.ts`'s native leg bind theirs). An EMPTY segment
 * contributes nothing to the concatenation and is skipped entirely rather than bound and appended —
 * except at index 0, which is the chain's base and must exist even when empty.
 */
export function emitTemplate(
  template: ByteTemplate,
  options: TemplateEmitOptions,
): TemplateEmitResult {
  assertShape(template, "emitTemplate");
  const { prefix, amountInVar, amountOutVar } = options;
  const statements: string[] = [];

  // 1. Derived locals, one per distinct (source, scale). The identity scale needs no local at all —
  // the base var IS the value — which also keeps the overwhelmingly common case free of arithmetic.
  const derived = new Map<string, string>();
  const varFor = (slot: TemplateSlot): string => {
    const baseVar = slot.source === "amountIn" ? amountInVar : amountOutVar;
    if (slot.scale === WAD) return baseVar;
    const key = `${slot.source}:${slot.scale}`;
    const existing = derived.get(key);
    if (existing !== undefined) return existing;
    const name = `${prefix}v${derived.size}`;
    statements.push(
      `if (${baseVar} > ${literal(maxScalableBase(slot.scale))}) { throw 'sauce: dynamic amount overflows scale'; }`,
      `const ${name} = (${baseVar} * ${literal(slot.scale)} + ${literal(WAD - 1n)}) / ${literal(WAD)};`,
    );
    derived.set(key, name);
    return name;
  };
  const slotVars = template.slots.map(varFor);

  // 2. Width guards, one per distinct (local, width) narrower than a full word.
  const guarded = new Set<string>();
  template.slots.forEach((slot, i) => {
    if (slot.width >= 32) return;
    const key = `${slotVars[i]!}:${slot.width}`;
    if (guarded.has(key)) return;
    guarded.add(key);
    statements.push(
      `if (${slotVars[i]!} > ${literal((1n << BigInt(8 * slot.width)) - 1n)}) { throw 'sauce: dynamic amount does not fit'; }`,
    );
  });

  // 3. Segment consts and the concat chain.
  const segmentVar = (i: number): string => `${prefix}s${i}`;
  const used = new Set<number>([0]);
  template.slots.forEach((_, i) => {
    if (hexToBytes(template.segments[i + 1]!).length > 0) used.add(i + 1);
  });
  for (const i of [...used].sort((a, b) => a - b)) {
    statements.push(`const ${segmentVar(i)} = hex\`${template.segments[i]!.slice(2)}\`;`);
  }

  let expr = segmentVar(0);
  template.slots.forEach((slot, i) => {
    const encoder = slot.littleEndian ? "toBytesLe" : "toBytesBe";
    expr += `.concat(${slotVars[i]!}.${encoder}(${slot.width}))`;
    if (used.has(i + 1)) expr += `.concat(${segmentVar(i + 1)})`;
  });

  const dataVar = `${prefix}data`;
  statements.push(`const ${dataVar} = ${expr};`);

  return { statements, dataVar, slotVars };
}
