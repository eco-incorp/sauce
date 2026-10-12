/**
 * `routerSvmDataTemplate` against the swaps eco-incorp/sauce-recipes builds
 * (`std/router/fixtures/recipes-swap-templates.json`): for every template, both directions and both
 * builders, the prefix, suffix and divisor written from the template's own fields (its limit and
 * floor, its direction, the market's lot sizes read off the fixture's account) are the template's,
 * byte for byte. The engine suite (`std/router/svm-at-limit.e2e.test.ts`) proves `<venue>Data` sends
 * those same bytes; this proves the TypeScript writes them too, and refuses a field past its slot.
 */
import { readFileSync } from "node:fs";

import { routerSvmDataTemplate } from "../../src/svm/router-data.js";
import type { RouterSvmDataOptions } from "../../src/svm/router-data.js";
import type { RouterSvmVenue } from "../../src/svm/router-accounts.js";
import { BYTES, le, pool } from "./venue-fixture.js";

interface Template {
  pool: string;
  venue: string;
  direction: string;
  builder: string;
  prefix: string;
  suffix: string;
  divisor?: string;
  accounts: unknown[];
}
const TEMPLATES = (
  JSON.parse(
    readFileSync(
      new URL("../std/router/fixtures/recipes-swap-templates.json", import.meta.url),
      "utf8",
    ),
  ) as { templates: Template[] }
).templates;

const FIRST = new Set(["0to1", "aToB", "baseIn", "xToY"]);
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const leHex = (text: string, offset: number, width: number): bigint =>
  le(Buffer.from(text, "hex"), offset, width);

/** The fields a template's bytes carry past its amount, and the market's lot sizes. */
const optionsOf = (t: Template): RouterSvmDataOptions => {
  const aToB = FIRST.has(t.direction);
  const s = t.suffix;
  const market = BYTES.get(pool(t.pool).pool)!;
  switch (t.venue) {
    case "phoenix":
      return { aToB, lot: le(market, aToB ? 112 : 192, 8) };
    case "invariant":
      return { aToB, limit: leHex(s, 1, 16) };
    case "manifest":
      return { aToB, minOut: leHex(s, 0, 8) };
    case "openbook-v2":
      return {
        aToB,
        quoteLot: le(market, 448, 8),
        baseLot: le(market, 456, 8),
        orders: BigInt(`0x${s.slice(-2)}`),
      };
    default:
      return {
        aToB,
        minOut: leHex(s, 0, 8),
        limit: leHex(s, 8, 16),
        ...(t.venue === "orca-whirlpool" ? { v2: t.accounts.length !== 11 } : {}),
      };
  }
};

describe("routerSvmDataTemplate: the recipes' own bytes", () => {
  it.each(TEMPLATES.map((t) => [`${t.pool} ${t.direction} ${t.builder}`, t] as const))(
    "%s",
    (_, t) => {
      const written = routerSvmDataTemplate(t.venue as RouterSvmVenue, optionsOf(t));
      expect({
        prefix: hex(written.prefix),
        suffix: hex(written.suffix),
        divisor: written.divisor,
      }).toEqual({ prefix: t.prefix, suffix: t.suffix, divisor: BigInt(t.divisor ?? "1") });
    },
  );
});

describe("routerSvmDataTemplate: fields past their slot, refused when the program is written", () => {
  it("a sqrt price limit past 128 bits, which cut to its field would be no limit", () => {
    for (const venue of [
      "raydium-clmm",
      "orca-whirlpool",
      "cropper",
      "defituna",
      "crema",
      "invariant",
    ] as const)
      expect(() => routerSvmDataTemplate(venue, { aToB: true, limit: 1n << 128n })).toThrow(
        `${venue}: limit ${1n << 128n} is past its 128 bits`,
      );
    expect(
      hex(routerSvmDataTemplate("raydium-clmm", { aToB: true, limit: (1n << 128n) - 1n }).suffix),
    ).toBe(`${"00".repeat(8)}${"ff".repeat(16)}01`);
  });

  it("a floor past 64 bits, a Phoenix price past 64, an OpenBook price past 63 or orders past 255", () => {
    expect(() => routerSvmDataTemplate("defituna", { aToB: false, minOut: 1n << 64n })).toThrow(
      "defituna: minOut 18446744073709551616 is past its 64 bits",
    );
    expect(() => routerSvmDataTemplate("manifest", { aToB: true, minOut: -1n })).toThrow(
      "manifest: minOut -1 is past its 64 bits",
    );
    expect(() =>
      routerSvmDataTemplate("phoenix", { aToB: true, lot: 1n, ticks: 1n << 64n }),
    ).toThrow("phoenix: ticks 18446744073709551616 is past its 64 bits");
    const book = { aToB: true, baseLot: 1n, quoteLot: 1n };
    expect(() => routerSvmDataTemplate("openbook-v2", { ...book, priceLots: 1n << 63n })).toThrow(
      "openbook-v2: priceLots 9223372036854775808 is past its 63 bits",
    );
    expect(() => routerSvmDataTemplate("openbook-v2", { ...book, orders: 256n })).toThrow(
      "openbook-v2: orders 256 is past its byte",
    );
  });

  it("a field the venue's instruction does not carry, and a book without its lot sizes", () => {
    expect(() => routerSvmDataTemplate("invariant", { aToB: true, minOut: 1n })).toThrow(
      "invariant's swap takes no minOut",
    );
    expect(() => routerSvmDataTemplate("manifest", { aToB: true, limit: 1n })).toThrow(
      "manifest's swap takes no limit",
    );
    expect(() => routerSvmDataTemplate("cropper", { aToB: true, v2: true })).toThrow(
      "cropper's swap takes no v2",
    );
    expect(() => routerSvmDataTemplate("phoenix", { aToB: true })).toThrow(
      "phoenix's swap takes a lot size",
    );
    expect(() => routerSvmDataTemplate("openbook-v2", { aToB: true, baseLot: 1n })).toThrow(
      "openbook-v2's swap takes the market's base and quote lot sizes",
    );
  });

  it("Orca's swap_v2 and a Phoenix or OpenBook order at a price", () => {
    expect(
      hex(routerSvmDataTemplate("orca-whirlpool", { aToB: false, v2: true, minOut: 5n }).suffix),
    ).toBe(`0500000000000000${"00".repeat(16)}010000`);
    expect(hex(routerSvmDataTemplate("phoenix", { aToB: false, lot: 1n, ticks: 7n }).prefix)).toBe(
      `000200010700000000000000${"00".repeat(8)}`,
    );
    const order = routerSvmDataTemplate("openbook-v2", {
      aToB: true,
      baseLot: 10n,
      quoteLot: 1n,
      priceLots: 9n,
      orders: 4n,
    });
    expect([hex(order.prefix), hex(order.suffix), order.divisor]).toEqual([
      "032c47031ac7cb55010900000000000000",
      "ffffffffffffff7f0104",
      10n,
    ]);
  });
});
