// SAUCE SETTLE PROGRAM WIRE FORMAT v1 — the byte-level constants a partner needs to implement
// the check in ANY language (Go/Solidity/Python), independent of this package. See decode.ts's
// module docstring for the full grammar; this file carries only the numeric constants and the
// minimal-length push primitive both decode.ts and report.ts build on.

/** Wire-format constants for the sweep-program v12 wire shape. All values measured against
 *  the retired in-repo TypeScript compiler's actual emission —
 *  none of these are arbitrary choices. */
export const SETTLE_WIRE = {
  /** The compiler's TUPLE-build opcode. Not a legal PUSH width (`0x94 > 0x20`), which is exactly
   *  what lets a linear scan know where the leading token-push run ends. */
  TUPLE_OP: 0x94,
  /** Smallest legal PUSH opcode — a 1-byte value. */
  PUSH_MIN: 0x01,
  /** Largest legal PUSH opcode — a 32-byte (uint256) value. */
  PUSH_MAX: 0x20,
  /** The TUPLE arity byte is a single raw byte (not itself a push), so it tops out at 255. */
  MAX_ARITY: 255,
  /** An address is 20 bytes; token and recipient pushes must not exceed this width even though
   *  the PUSH opcode alone would allow up to 32 (see OVERSIZE_ADDRESS in decode.ts). */
  ADDRESS_BYTES: 20,
} as const;

/** Result of scanning one PUSH at a given offset. `ok:false` carries enough detail for a caller
 *  to render a precise failure without re-scanning. */
export type PushScanResult =
  | { ok: true; value: bigint; offset: number; width: number; next: number }
  | { ok: false; code: "TRUNCATED_PUSH" | "NON_MINIMAL_PUSH" | "OVERSIZE_ADDRESS"; offset: number; message: string };

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

/**
 * Scan ONE minimal-length integer PUSH at `pos` — §2 of the wire spec.
 *
 * A push is `L || data[L]` where `0x01 <= L <= 0x20`; the opcode byte IS the width. The encoder
 * is minimal-length: `L` is the smallest width holding the value, with the single exception that
 * `value === 0` encodes as `L=1, data=0x00` (never a bare zero-width opcode — there is no such
 * thing on this wire).
 *
 * `maxWidthBytes` additionally caps `L` (pass `SETTLE_WIRE.ADDRESS_BYTES` for token/recipient
 * slots, `SETTLE_WIRE.PUSH_MAX` — i.e. no extra cap beyond the opcode's own range — for `minOut`).
 * This is the STRICT/canonical scanner: it enforces minimality and the width cap unconditionally,
 * which is the behavior a partner-facing decoder must have (see decode.ts's module docstring,
 * §6 of the wire spec, for why: today's in-repo decoder in the recipes package predates this
 * package and does NOT make these checks — this scanner is the corrected replacement).
 *
 * Returns `ok:false` rather than throwing so callers can build a full checks report even when a
 * scan fails partway through.
 */
export function scanMinimalPush(bytes: Uint8Array, pos: number, maxWidthBytes: number = SETTLE_WIRE.PUSH_MAX): PushScanResult {
  const op = bytes[pos];
  if (op === undefined || op < SETTLE_WIRE.PUSH_MIN || op > SETTLE_WIRE.PUSH_MAX) {
    return {
      ok: false,
      code: "TRUNCATED_PUSH",
      offset: pos,
      message: `expected a PUSH opcode (0x01..0x20) at byte ${pos}, got ${op === undefined ? "end of buffer" : "0x" + op.toString(16)}`,
    };
  }
  const width = op;
  if (pos + 1 + width > bytes.length) {
    return {
      ok: false,
      code: "TRUNCATED_PUSH",
      offset: pos,
      message: `PUSH at byte ${pos} declares width ${width} but only ${bytes.length - pos - 1} byte(s) remain`,
    };
  }
  const data = bytes.subarray(pos + 1, pos + 1 + width);
  if (width > 1 && data[0] === 0x00) {
    return {
      ok: false,
      code: "NON_MINIMAL_PUSH",
      offset: pos,
      message: `PUSH at byte ${pos} has a leading zero byte (width ${width}) — not minimal-length; a canonical encoder never emits this`,
    };
  }
  if (width > maxWidthBytes) {
    return {
      ok: false,
      code: "OVERSIZE_ADDRESS",
      offset: pos,
      message: `PUSH at byte ${pos} is ${width} bytes wide, exceeding the ${maxWidthBytes}-byte cap for this slot`,
    };
  }
  return { ok: true, value: bytesToBigInt(data), offset: pos, width, next: pos + 1 + width };
}

/** Encode one value as a minimal-length PUSH — the exact inverse of `scanMinimalPush`. Throws if
 *  `value` needs more than `maxWidthBytes` bytes (never silently truncates). */
export function encodeMinimalPush(value: bigint, maxWidthBytes: number = SETTLE_WIRE.PUSH_MAX): Uint8Array {
  if (value < 0n) throw new RangeError(`encodeMinimalPush: value ${value} is negative`);
  let hex = value.toString(16);
  if (hex.length % 2 === 1) hex = "0" + hex;
  let bytes = hexToBytesLocal(hex);
  if (bytes.length === 0) bytes = new Uint8Array([0x00]); // value === 0 → L=1, data=0x00
  if (bytes.length > maxWidthBytes) {
    throw new RangeError(`encodeMinimalPush: value ${value} needs ${bytes.length} bytes, exceeding the ${maxWidthBytes}-byte cap`);
  }
  if (bytes.length > SETTLE_WIRE.PUSH_MAX) {
    throw new RangeError(`encodeMinimalPush: value ${value} needs ${bytes.length} bytes, exceeding the wire's 32-byte PUSH maximum`);
  }
  const out = new Uint8Array(1 + bytes.length);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

function hexToBytesLocal(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
