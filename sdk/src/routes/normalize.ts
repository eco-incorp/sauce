/**
 * Pure coercion helpers: a caller-friendly address or integer into the strict runtime value.
 */
import { toExactBigInt } from "../numeric.js";
import type { AddressInput, UniversalAddress } from "./types.js";

const HEX_RE = /^0x[0-9a-fA-F]*$/;

/**
 * Coerces an address into the 32-byte `UniversalAddress` format:
 * a 20-byte EVM address is left-padded to 32 bytes; an already-32-byte value
 * passes through unchanged. Anything else throws.
 */
export function toUniversalAddress(input: AddressInput): UniversalAddress {
  if (typeof input !== "string" || !HEX_RE.test(input)) {
    throw new Error(`Invalid address: expected 0x-hex, got ${String(input)}`);
  }
  const body = input.slice(2);
  if (body.length % 2 !== 0) {
    throw new Error(`Invalid address: odd hex length '${input}'`);
  }
  const byteLength = body.length / 2;
  if (byteLength === 32) {
    return input.toLowerCase() as UniversalAddress;
  }
  if (byteLength === 20) {
    return ("0x" + "00".repeat(12) + body).toLowerCase() as UniversalAddress;
  }
  throw new Error(`Invalid address: expected 20 or 32 bytes, got ${byteLength} bytes ('${input}')`);
}

/**
 * Accepts `bigint | number | string`; rejects negative or non-integer values.
 *
 * A `number` goes through {@link toExactBigInt}, so it must also be a SAFE integer. Pass a large
 * value as a `bigint` (`10n ** 18n`) or as a PLAIN DECIMAL string (`'1000000000000000000'`) —
 * exponent notation like `'1e21'` is rejected too, being no more an integer string than `1e21` as
 * a `number` is a safe one.
 */
export function toBigInt(value: bigint | number | string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`Expected a non-negative bigint, got ${value}`);
    return value;
  }
  if (typeof value === "number") {
    const exact = toExactBigInt(value);
    if (exact < 0n) throw new Error(`Expected a non-negative integer number, got ${value}`);
    return exact;
  }
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`Expected an integer string, got '${value}'`);
    }
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error(`Expected a non-negative value, got '${value}'`);
    return parsed;
  }
  throw new Error(`Expected bigint | number | string, got ${typeof value}`);
}
