/**
 * Shared bigint helpers for venue adapters. All venue math is bigint with
 * floors/ceils exactly as the historical venue investigation states; division floors natively.
 *
 * Original venue investigation (historical):
 * https://github.com/eco-incorp/sauce/blob/d3686430ee308994f95309a8c9b2d5930d71cf5d/docs/svm-venues.md
 */

/** Ceiling division: smallest q with q * b >= a. Non-negative dividends only. */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (a < 0n) throw new Error(`ceilDiv dividend must be non-negative, got ${a}`);
  if (b <= 0n) throw new Error(`ceilDiv divisor must be positive, got ${b}`);
  return (a + b - 1n) / b;
}

/**
 * Little-endian unsigned field read — the TS mirror of the compiler's
 * accountUint(ref, offset, width). All seven venues are pure-LE; BE never
 * occurs. width is in bytes, 1..=32 (SPL token amount = readUintLE(data, 64, 8)).
 */
export function readUintLE(data: Uint8Array, offset: number, width: number): bigint {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`readUintLE offset must be a non-negative integer, got ${offset}`);
  }
  if (!Number.isInteger(width) || width < 1 || width > 32) {
    throw new Error(`readUintLE width must be an integer in 1..=32, got ${width}`);
  }
  if (offset + width > data.length) {
    throw new Error(
      `readUintLE reads [${offset}, ${offset + width}) beyond ${data.length}-byte data`,
    );
  }
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) {
    value = (value << 8n) | BigInt(data[offset + i]);
  }
  return value;
}
