/**
 * The ONE `number` -> `bigint` conversion in the SDK.
 *
 * A double represents an integer exactly only up to 2^53-1. Past that it has ALREADY been rounded
 * before any of this code sees it, and the two ways of reading it disagree about WHICH wrong value
 * to produce: `BigInt(1234567890123456789)` is `1234567890123456768n` while
 * `(1234567890123456789).toString()` is `"1234567890123456800"`. So every site that turns a
 * caller's `number` into an on-chain amount comes through here and rejects it, and the sites that
 * FORMAT a value into emitted SauceScript format the `bigint` this returns — never the `number` —
 * which is what makes the two wrong values unreachable rather than merely unused.
 *
 * Total for any double: a non-integer and an unsafe integer both throw. `label` names the
 * offending field (`amountIn: expected a safe integer, got 1e+21 ...`); omit it where the caller
 * coerces a value it has no field name for. A caller with better advice for the non-integer case
 * — a shape the renderer cannot spell at all, say — checks `Number.isInteger` itself first and
 * throws its own error before calling this.
 */
export function toExactBigInt(value: number, label?: string): bigint {
  if (!Number.isInteger(value)) {
    throw new Error(
      label === undefined
        ? `Expected an integer number, got ${value}`
        : `${label}: expected an integer, got ${value}`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      label === undefined
        ? `Expected a safe integer number, got ${value} — pass a bigint or a plain decimal string`
        : `${label}: expected a safe integer, got ${value} — pass a bigint or a string instead`,
    );
  }

  return BigInt(value);
}
