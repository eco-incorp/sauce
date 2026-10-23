/**
 * routes/normalize.ts — `toBigInt` numeric-input contract.
 *
 * `amount`/`value` inputs are `bigint | number | string`, so `toBigInt` is the single gate every
 * public entry point funnels through. Past 2^53-1 a `number` has already been rounded by the
 * JSON/JS parser, so it is rejected rather than converted — these assertions pin exactly where the
 * accepted range ends and which of the three input forms carry a large value exactly.
 */
import { toBigInt } from "../src/routes/normalize.js";

describe("toBigInt: number", () => {
  it("accepts Number.MAX_SAFE_INTEGER exactly", () => {
    expect(toBigInt(Number.MAX_SAFE_INTEGER)).toBe(9007199254740991n);
  });

  it("accepts small integers and zero", () => {
    expect(toBigInt(0)).toBe(0n);
    expect(toBigInt(42)).toBe(42n);
  });

  it("rejects the first unsafe integer above MAX_SAFE_INTEGER", () => {
    expect(() => toBigInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "Expected a safe integer number, got 9007199254740992 — pass a bigint or a plain decimal string",
    );
  });

  it("rejects 1e18 — the wei-amount footgun", () => {
    expect(() => toBigInt(1e18)).toThrow(
      "Expected a safe integer number, got 1000000000000000000 — pass a bigint or a plain decimal string",
    );
  });

  it("rejects 1e21", () => {
    expect(() => toBigInt(1e21)).toThrow("Expected a safe integer number, got 1e+21");
  });

  it("still rejects non-integers, NaN and Infinity with the integer message", () => {
    expect(() => toBigInt(1.5)).toThrow("Expected an integer number, got 1.5");
    expect(() => toBigInt(NaN)).toThrow("Expected an integer number, got NaN");
    expect(() => toBigInt(Infinity)).toThrow("Expected an integer number, got Infinity");
  });

  it("still rejects a negative integer with the non-negative message", () => {
    expect(() => toBigInt(-1)).toThrow("Expected a non-negative integer number, got -1");
  });
});

describe("toBigInt: string", () => {
  it("carries a plain decimal past 2^53-1 exactly", () => {
    expect(toBigInt("999999999999999999")).toBe(999999999999999999n);
  });

  it("rejects exponent notation", () => {
    expect(() => toBigInt("1e21")).toThrow("Expected an integer string, got '1e21'");
  });

  it("rejects a negative decimal", () => {
    expect(() => toBigInt("-1")).toThrow("Expected a non-negative value, got '-1'");
  });
});

describe("toBigInt: bigint", () => {
  it("passes a large value through exactly", () => {
    expect(toBigInt(999999999999999999n)).toBe(999999999999999999n);
    expect(toBigInt(10n ** 18n)).toBe(1000000000000000000n);
  });

  it("rejects a negative", () => {
    expect(() => toBigInt(-1n)).toThrow("Expected a non-negative bigint, got -1");
  });
});
