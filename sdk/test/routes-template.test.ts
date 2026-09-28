/**
 * routes/template.ts — the byte-templating primitive under `via: "dynamic"` nesting.
 *
 * Pure: no compiler, no network. Two things are established here.
 *
 * FIRST, that `renderTemplate` computes what `IntentTemplate.render`/`_amount` computes
 * (`../eco-routes/contracts/chain/IntentTemplate.sol`). `referenceRender` below is an INDEPENDENT
 * transcription of that Solidity — the segment/item concatenation loop, `Math.mulDiv(…, Ceil)`, the
 * `AmountDoesNotFit` width check and the byte loop with its `littleEndian` index flip — written from
 * the contract rather than from `template.ts`, and the contract is never called. Two implementations
 * of the same spec agreeing is the only cross-check available without an engine; it is not proof
 * that either matches a deployed contract.
 *
 * SECOND, that every way a sentinel search can be wrong throws. Each of those is a silent wrong
 * NUMBER in a real intent if it does not — which is why they are enumerated rather than sampled.
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";

import {
  emitTemplate,
  encodeFixedWidth,
  maxScalableBase,
  renderTemplate,
  scaleAmount,
  splitByPlaceholders,
  WAD,
  type ByteTemplate,
  type PlaceholderSpec,
} from "../src/routes/template.js";

const IN = BigInt(`0x5acef00d${"00".repeat(27)}01`);
const OUT = BigInt(`0x5acef00d${"00".repeat(27)}02`);

const word = (value: bigint): string => value.toString(16).padStart(64, "0");

// ---------------------------------------------------------------------------
// An independent transcription of IntentTemplate.sol, for the cross-check.
// ---------------------------------------------------------------------------

interface ReferenceItem {
  readonly source: "amountIn" | "amountOut";
  readonly scale: bigint;
  readonly width: number;
  readonly littleEndian: boolean;
}

/** `Math.mulDiv(amount, scale, WAD, Rounding.Ceil)` — one exact integer, no intermediate width
 *  changes it, so plain bigint arithmetic reproduces it. */
function mulDivCeil(amount: bigint, scale: bigint, denominator: bigint): bigint {
  const product = amount * scale;
  return product % denominator === 0n ? product / denominator : product / denominator + 1n;
}

/** `IntentTemplate._amount` — scale, then the `AmountDoesNotFit` check, then the byte loop. */
function referenceAmount(item: ReferenceItem, amountIn: bigint, amountOut: bigint): Uint8Array {
  if (item.scale === 0n) throw new Error("InvalidAmountScale");
  if (item.width === 0 || item.width > 32) throw new Error("InvalidAmountWidth");
  const base = item.source === "amountIn" ? amountIn : amountOut;
  const amount = mulDivCeil(base, item.scale, 10n ** 18n);
  if (item.width < 32 && amount >> BigInt(item.width * 8) !== 0n)
    throw new Error("AmountDoesNotFit");
  const result = new Uint8Array(item.width);
  for (let i = 0; i < item.width; i++) {
    result[item.littleEndian ? i : item.width - 1 - i] = Number((amount >> BigInt(8 * i)) & 0xffn);
  }
  return result;
}

/** `IntentTemplate._render` — `result = segments[0]`, then `bytes.concat(result, value,
 *  segments[i + 1])` per item. */
function referenceRender(
  segments: readonly Hex[],
  items: readonly ReferenceItem[],
  amountIn: bigint,
  amountOut: bigint,
): Hex {
  if (segments.length !== items.length + 1) throw new Error("SegmentCountMismatch");
  let result = [...hexToBytes(segments[0]!)];
  items.forEach((item, i) => {
    result = [
      ...result,
      ...referenceAmount(item, amountIn, amountOut),
      ...hexToBytes(segments[i + 1]!),
    ];
  });
  return bytesToHex(Uint8Array.from(result));
}

// ---------------------------------------------------------------------------

describe("splitByPlaceholders: cutting a payload at its sentinels", () => {
  it("cuts one payload into segments + slots, in payload order regardless of declaration order", () => {
    // `OUT` first in the payload, `IN` second -- declared the other way round on purpose.
    const payload = `0xdeadbeef${word(OUT)}cafe${word(IN)}` as Hex;
    const template = splitByPlaceholders(payload, [
      { value: IN, source: "amountIn" },
      { value: OUT, source: "amountOut" },
    ]);

    expect(template.segments).toEqual(["0xdeadbeef", "0xcafe", "0x"]);
    expect(template.slots.map((s) => s.source)).toEqual(["amountOut", "amountIn"]);
    expect(template.slots.every((s) => s.scale === WAD && s.width === 32 && !s.littleEndian)).toBe(
      true,
    );
  });

  it("finds EVERY occurrence of one sentinel, so a repeated amount is templated everywhere", () => {
    const payload = `0x00${word(IN)}11${word(IN)}22` as Hex;
    const template = splitByPlaceholders(payload, [
      { value: IN, source: "amountIn", occurrences: 2 },
    ]);

    expect(template.segments).toEqual(["0x00", "0x11", "0x22"]);
    expect(template.slots).toHaveLength(2);
  });

  it.each([
    [
      "a sentinel that does not occur",
      `0xdeadbeef${word(IN)}` as Hex,
      [{ value: OUT, source: "amountOut" }] as PlaceholderSpec[],
      /does not occur in the/,
    ],
    [
      "a declared occurrence count that disagrees with what was found",
      `0x${word(IN)}${word(IN)}` as Hex,
      [{ value: IN, source: "amountIn", occurrences: 1 }] as PlaceholderSpec[],
      /occurs 2 time\(s\), but occurrences: 1 was declared/,
    ],
    [
      "two sentinels encoding to the same bytes",
      `0x${word(IN)}` as Hex,
      [
        { value: IN, source: "amountIn" },
        { value: IN, source: "amountOut" },
      ] as PlaceholderSpec[],
      /encode to the same bytes/,
    ],
    [
      "a sentinel too wide for its declared width",
      `0x${word(IN)}` as Hex,
      [{ value: IN, source: "amountIn", width: 8 }] as PlaceholderSpec[],
      /does not fit its declared 8-byte width/,
    ],
    [
      "no placeholders at all",
      "0xdeadbeef" as Hex,
      [] as PlaceholderSpec[],
      /a template with no slot is just bytes/,
    ],
  ])("throws on %s", (_name, payload, placeholders, message) => {
    expect(() => splitByPlaceholders(payload, placeholders)).toThrow(message);
  });

  it("throws when a narrow sentinel's bytes land INSIDE a wide one's", () => {
    // The 8-byte `0x00000000_0000beef` sits inside the 32-byte word's trailing bytes.
    const wide = BigInt(`0x${"00".repeat(24)}000000000000beef`);
    const narrow = 0xbeefn;
    expect(() =>
      splitByPlaceholders(`0x${word(wide)}` as Hex, [
        { value: wide, source: "amountIn" },
        { value: narrow, source: "amountOut", width: 8 },
      ]),
    ).toThrow(/placeholder hits overlap at byte/);
  });
});

describe("renderTemplate agrees with an independent transcription of IntentTemplate.sol", () => {
  const items: ReferenceItem[] = [
    { source: "amountIn", scale: WAD, width: 32, littleEndian: false },
    { source: "amountOut", scale: WAD, width: 32, littleEndian: false },
    { source: "amountOut", scale: 10n ** 30n, width: 32, littleEndian: false }, // 6 -> 18 decimals
    { source: "amountIn", scale: 500000000000000000n, width: 8, littleEndian: true }, // half, u64 LE
  ];
  const template: ByteTemplate = {
    segments: ["0xa9059cbb", "0x1122", "0x", "0x33", "0xff"],
    slots: items,
  };

  it.each([
    [0n, 0n],
    [1n, 1n],
    [1_000_000n, 990_000n],
    [3n, 7n], // exercises the ceil on a non-exact quotient
    [2n ** 63n - 1n, 2n ** 63n - 1n],
  ])("renders identically for amountIn=%s amountOut=%s", (amountIn, amountOut) => {
    expect(renderTemplate(template, amountIn, amountOut)).toEqual(
      referenceRender(template.segments, items, amountIn, amountOut),
    );
  });

  it("rejects a value too wide for its slot, as IntentTemplate.AmountDoesNotFit does", () => {
    const narrow: ByteTemplate = {
      segments: ["0x", "0x"],
      slots: [{ source: "amountIn", scale: WAD, width: 8, littleEndian: false }],
    };
    expect(() => renderTemplate(narrow, 2n ** 64n, 0n)).toThrow(/does not fit its 8-byte width/);
    expect(() => referenceAmount(narrow.slots[0]!, 2n ** 64n, 0n)).toThrow("AmountDoesNotFit");
  });

  it("rejects a base the program's own 256-bit multiply could not compute", () => {
    const scaled: ByteTemplate = {
      segments: ["0x", "0x"],
      slots: [{ source: "amountIn", scale: 10n ** 30n, width: 32, littleEndian: false }],
    };
    const max = maxScalableBase(10n ** 30n);
    expect(() => renderTemplate(scaled, max + 1n, 0n)).toThrow(/without wrapping/);
    expect(() => renderTemplate(scaled, max, 0n)).not.toThrow();
  });

  it("malformed shapes throw rather than rendering a short payload", () => {
    expect(() => renderTemplate({ segments: ["0x"], slots: [] }, 0n, 0n)).not.toThrow();
    expect(() =>
      renderTemplate(
        {
          segments: ["0x"],
          slots: [{ source: "amountIn", scale: WAD, width: 32, littleEndian: false }],
        },
        1n,
        1n,
      ),
    ).toThrow(/segments must be exactly slots \+ 1/);
  });
});

describe("scaleAmount / maxScalableBase", () => {
  it("is the identity at WAD and ceil-rounds elsewhere", () => {
    expect(scaleAmount(12345n, WAD)).toBe(12345n);
    expect(scaleAmount(3n, WAD / 2n)).toBe(2n); // ceil(1.5)
    expect(scaleAmount(0n, WAD * 7n)).toBe(0n);
  });

  it("guarantees a non-zero obligation for any non-zero input, the reason ceil was chosen", () => {
    // IntentChainer._calculateAmountOut's NatSpec: "with amountIn >= 1 and scale >= 1 the quotient
    // is strictly positive, so no order can oblige a solver to deliver nothing".
    expect(scaleAmount(1n, 1n)).toBe(1n);
  });

  it("rejects a zero or negative scale", () => {
    expect(() => scaleAmount(1n, 0n)).toThrow(/scale must be positive/);
    expect(() => maxScalableBase(0n)).toThrow(/scale must be positive/);
  });

  it("maxScalableBase is exactly the largest base that does not wrap", () => {
    const scale = 10n ** 30n;
    const max = maxScalableBase(scale);
    expect(max * scale + (WAD - 1n)).toBeLessThanOrEqual(2n ** 256n - 1n);
    expect((max + 1n) * scale + (WAD - 1n)).toBeGreaterThan(2n ** 256n - 1n);
  });
});

describe("encodeFixedWidth", () => {
  it("zero-pads to the declared width in both endiannesses", () => {
    expect(bytesToHex(encodeFixedWidth(0x1234n, 4, false))).toBe("0x00001234");
    expect(bytesToHex(encodeFixedWidth(0x1234n, 4, true))).toBe("0x34120000");
  });

  it("throws rather than truncating — a truncated amount is a plausible wrong number", () => {
    expect(() => encodeFixedWidth(0x1_0000n, 2, false)).toThrow(/does not fit 2 byte/);
    expect(() => encodeFixedWidth(-1n, 32, false)).toThrow(/negative value/);
    expect(() => encodeFixedWidth(1n, 33, false)).toThrow(/width must be an integer in 1\.\.32/);
  });
});

describe("emitTemplate: the SauceScript it produces", () => {
  const template: ByteTemplate = {
    segments: ["0xaabb", "0x", "0xcc"],
    slots: [
      { source: "amountIn", scale: WAD, width: 32, littleEndian: false },
      { source: "amountOut", scale: WAD, width: 8, littleEndian: true },
    ],
  };

  it("binds every non-empty segment to its own const and chains one concat expression", () => {
    const { statements, dataVar, slotVars } = emitTemplate(template, {
      prefix: "d0_",
      amountInVar: "d0_in",
      amountOutVar: "d0_out",
    });

    expect(dataVar).toBe("d0_data");
    // The identity scale needs no local at all -- the base var IS the value.
    expect(slotVars).toEqual(["d0_in", "d0_out"]);
    expect(statements).toEqual([
      // The u64 slot is narrower than a word, so it gets IntentTemplate's AmountDoesNotFit guard.
      "if (d0_out > 18446744073709551615n) { throw 'sauce: dynamic amount does not fit'; }",
      "const d0_s0 = hex`aabb`;",
      "const d0_s2 = hex`cc`;", // s1 is empty and is skipped entirely, never bound
      "const d0_data = d0_s0.concat(d0_in.toBytesBe(32)).concat(d0_out.toBytesLe(8)).concat(d0_s2);",
    ]);
  });

  it("derives one local per distinct non-identity (source, scale), guarded against wrapping", () => {
    const scaled: ByteTemplate = {
      segments: ["0x00", "0x11", "0x22"],
      slots: [
        { source: "amountIn", scale: 2n * WAD, width: 32, littleEndian: false },
        { source: "amountIn", scale: 2n * WAD, width: 32, littleEndian: false },
      ],
    };
    const { statements, slotVars } = emitTemplate(scaled, {
      prefix: "d1_",
      amountInVar: "d1_in",
      amountOutVar: "d1_in",
    });

    // ONE local, reused -- the second slot must not re-derive (and so cannot disagree).
    expect(slotVars).toEqual(["d1_v0", "d1_v0"]);
    expect(statements[0]).toBe(
      `if (d1_in > ${maxScalableBase(2n * WAD)}n) { throw 'sauce: dynamic amount overflows scale'; }`,
    );
    expect(statements[1]).toBe(
      "const d1_v0 = (d1_in * 2000000000000000000n + 999999999999999999n) / 1000000000000000000n;",
    );
  });

  it("namespaces every local by its prefix, so two templates merge into one scope", () => {
    const a = emitTemplate(template, { prefix: "d0_", amountInVar: "a", amountOutVar: "b" });
    const b = emitTemplate(template, { prefix: "d1_", amountInVar: "c", amountOutVar: "d" });
    const names = [...a.statements, ...b.statements]
      .map((s) => /^const (\w+)/.exec(s)?.[1])
      .filter((n): n is string => n !== undefined);

    expect(new Set(names).size).toBe(names.length);
  });
});
