/**
 * What `@sauce/router`'s Crema functions are held to on a pool that keeps its pair higher key first
 * (`svm.e2e.test.ts`: mainnet's USDT/USDC pool 7MPnn7…, `svm/venue-fixture.ts`), worked out here from
 * the pool's own account and from first principles, never from the router's arithmetic or from the
 * instruction it sends.
 *
 * A Crema pool keeps its token A at 40 and its token B at 72 in the order it was created in, so
 * token A can be the higher key. Its price, at 190, is a Q64.64 square root of token B per token A,
 * so paying token A the price falls. A swap's `priceLimit` is the most one unit bought may cost, the
 * pool's fee included, as payToken base units per buyToken base unit times 1e18.
 */
import { getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";

import { BYTES, isqrt, le, Q128, SYSTEM } from "../../svm/venue-fixture.js";
import type { Pool } from "../../svm/venue-fixture.js";

const E24 = 10n ** 24n;
const MILLION = 1_000_000n;

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** A pool as its own account holds it. */
export const cremaFrame = (data: Uint8Array) => ({
  tokenA: getAddressCodec().decode(data.subarray(40, 72)),
  tokenB: getAddressCodec().decode(data.subarray(72, 104)),
  spacing: Number(le(data, 168, 2)),
  /** In millionths, taken from the input. */
  fee: le(data, 172, 2),
  liquidity: le(data, 174, 16),
  sqrt: le(data, 190, 16),
  tick: new DataView(data.buffer, data.byteOffset).getInt32(206, true),
});

/**
 * What the next unit bought costs at the sqrt price `s`, the fee on top, as `priceLimit`'s units
 * (payToken base units per buyToken base unit, times 1e18), rounded up. Paying token A, whose price
 * falls: 2^128 · 1e24 / (s² · (1e6 − f)). Paying token B: s² · 1e24 / (2^128 · (1e6 − f)).
 */
export const marginalCost = (s: bigint, fee: bigint, paysA: boolean): bigint =>
  paysA
    ? ceilDiv(Q128 * E24, s * s * (MILLION - fee))
    : ceilDiv(s * s * E24, Q128 * (MILLION - fee));

/**
 * The sqrt price a swap may reach, and no further, without the next unit costing more than
 * `priceLimit`: paying token A the lowest, paying token B the highest, exactly.
 */
export const sqrtAtCost = (priceLimit: bigint, fee: bigint, paysA: boolean): bigint => {
  const kept = MILLION - fee;
  const within = (s: bigint): boolean => marginalCost(s, fee, paysA) <= priceLimit;
  let s = paysA
    ? isqrt(ceilDiv(Q128 * E24, priceLimit * kept))
    : isqrt((priceLimit * Q128 * kept) / E24);
  if (paysA) {
    while (!within(s)) s += 1n;
    while (within(s - 1n)) s -= 1n;
  } else {
    while (!within(s)) s -= 1n;
    while (within(s + 1n)) s += 1n;
  }
  return s;
};

/** The array indices a tick-array map marks: one bit each, from its ninth byte. */
export const markedIndices = (map: Uint8Array): number[] => {
  const out: number[] = [];
  for (let index = 0; index < (map.length - 8) * 8; index++)
    if (((map[8 + (index >> 3)]! >> (index & 7)) & 1) === 1) out.push(index);
  return out;
};

/**
 * A tick array's initialized ticks. Its index, at 8, counts arrays of 64 × spacing ticks from the
 * pool's least tick, −443636 rounded to the spacing; a tick is 133 bytes from 44, initialized when
 * its first byte is 1.
 */
export const initializedTicks = (array: Uint8Array, spacing: number): number[] => {
  const start = -443636 + (443636 % spacing) + Number(le(array, 8, 2)) * 64 * spacing;
  const out: number[] = [];
  for (let offset = 0; offset < 64; offset++)
    if (array[44 + offset * 133] === 1) out.push(start + offset * spacing);
  return out;
};

/**
 * The tick arrays a swap's slot holds on `window`, the arrays the pool's venue module names for its
 * direction in walk order (a fixture pool's `payA` or `payB`, which pad with arrays that exist but
 * that the pool's map does not mark): those its map marks, up to the first it does not, then the
 * System program. Crema refuses an array its map does not mark.
 */
export const markedTicks = (p: Pool, window: readonly Address[]): [Address, Address, Address] => {
  const marked = new Set(markedIndices(BYTES.get(p.extra)!));
  const kept: Address[] = [];
  for (const at of window) {
    const array = BYTES.get(at);
    if (array === undefined || !marked.has(Number(le(array, 8, 2)))) break;
    kept.push(at);
  }
  return [kept[0] ?? SYSTEM, kept[1] ?? SYSTEM, kept[2] ?? SYSTEM];
};
