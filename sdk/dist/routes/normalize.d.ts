/**
 * Pure coercion helpers — NO ABI/Borsh encoding here (that's E3.2). This file
 * only normalizes caller-friendly inputs (`RouteInput`/`RewardInput`) into the
 * strict runtime shapes (`Route`/`Reward`) declared in `types.ts`.
 */
import type { AddressInput, Reward, RewardInput, Route, RouteInput, UniversalAddress } from "./types.js";
/**
 * Coerces an address into the eco-routes 32-byte `UniversalAddress` format:
 * a 20-byte EVM address is left-padded to 32 bytes; an already-32-byte value
 * passes through unchanged. Anything else throws.
 */
export declare function toUniversalAddress(input: AddressInput): UniversalAddress;
/** Accepts `bigint | number | string`; rejects negative or non-integer values. */
export declare function toBigInt(value: bigint | number | string): bigint;
export declare function normalizeRoute(input: RouteInput): Route;
export declare function normalizeReward(input: RewardInput): Reward;
/**
 * The empty route synthesized for a TERMINAL `.<DestChain>()` close: `salt`
 * and `portal` stay zero (finalization's job — E3.2/E3.3), `deadline`
 * inherits the leg's own reward deadline so the shape isn't structurally
 * expired on arrival, and `tokens`/`calls` are empty. A valid SHAPE, not a
 * submittable intent.
 */
export declare function emptyRoute(deadline: bigint): Route;
//# sourceMappingURL=normalize.d.ts.map