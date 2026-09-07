/**
 * Pure coercion helpers — NO ABI/Borsh encoding here (that's E3.2). This file
 * only normalizes caller-friendly inputs (`RouteInput`/`RewardInput`) into the
 * strict runtime shapes (`Route`/`Reward`) declared in `types.ts`.
 */
import { toExactBigInt } from "../numeric.js";
import type {
  AddressInput,
  Call,
  CallInput,
  Reward,
  RewardInput,
  Route,
  RouteInput,
  TokenAmount,
  TokenAmountInput,
  UniversalAddress,
} from "./types.js";

const ZERO_HEX32 = ("0x" + "00".repeat(32)) as UniversalAddress;

const HEX_RE = /^0x[0-9a-fA-F]*$/;

/**
 * Coerces an address into the eco-routes 32-byte `UniversalAddress` format:
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
    return (("0x" + "00".repeat(12) + body).toLowerCase()) as UniversalAddress;
  }
  throw new Error(
    `Invalid address: expected 20 or 32 bytes, got ${byteLength} bytes ('${input}')`,
  );
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

function normalizeTokenAmount(input: TokenAmountInput): TokenAmount {
  return {
    token: toUniversalAddress(input.token),
    amount: toBigInt(input.amount),
  };
}

function normalizeCall(input: CallInput): Call {
  return {
    target: toUniversalAddress(input.target),
    data: input.data,
    value: input.value === undefined ? 0n : toBigInt(input.value),
  };
}

export function normalizeRoute(input: RouteInput): Route {
  return {
    salt: input.salt ?? ZERO_HEX32,
    deadline: toBigInt(input.deadline),
    portal: toUniversalAddress(input.portal),
    nativeAmount: input.nativeAmount === undefined ? 0n : toBigInt(input.nativeAmount),
    tokens: (input.tokens ?? []).map(normalizeTokenAmount),
    calls: (input.calls ?? []).map(normalizeCall),
  };
}

export function normalizeReward(input: RewardInput): Reward {
  return {
    deadline: toBigInt(input.deadline),
    creator: toUniversalAddress(input.creator),
    prover: toUniversalAddress(input.prover),
    nativeAmount: input.nativeAmount === undefined ? 0n : toBigInt(input.nativeAmount),
    tokens: (input.tokens ?? []).map(normalizeTokenAmount),
  };
}

/**
 * The empty route synthesized for a TERMINAL `.<DestChain>()` close: `salt`
 * and `portal` stay zero (finalization's job — E3.2/E3.3), `deadline`
 * inherits the leg's own reward deadline so the shape isn't structurally
 * expired on arrival, and `tokens`/`calls` are empty. A valid SHAPE, not a
 * submittable intent.
 */
export function emptyRoute(deadline: bigint): Route {
  return {
    salt: ZERO_HEX32,
    deadline,
    portal: ZERO_HEX32,
    nativeAmount: 0n,
    tokens: [],
    calls: [],
  };
}
