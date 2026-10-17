/**
 * A Solana swap at a price, held within its share of the cook's compute units.
 *
 * A concentrated-liquidity pool's swap costs its program compute units for every initialized tick it
 * crosses, and a pool walked far enough runs the transaction out of them: the whole cook fails, every
 * pool's trade with it. The deployed engine cannot read the units left, so the cook's builder works
 * out each pool's walk as the cook is built, from the pool's tick arrays: how far its limit takes it,
 * and what that costs (`SVM_SWAP_COSTS`). The deepest pools walk first, each as far as its limit takes
 * it within what the cook has left; a pool the units no longer reach is held to where they end, and
 * one they do not reach at all is skipped. Each pool's swap takes the result as its `stop`
 * (`@sauce/router`'s): 0 none, 1 skip the pool, else a tick (its i32 with the sign bit flipped) the
 * swap holds a tick inside of — the first initialized tick a pool held short cannot pay to cross, or,
 * for a pool that walks its whole way on Raydium's code or Crema, the last initialized tick of the
 * furthest tick array its slot gives, past where the router's own window ends, which the router
 * checks with one read. A pool so held loses fill, never the cook.
 *
 * The walk is the router's own: the pool's limit for `priceLimit` and its fee, and no further than its
 * window, the last tick its slot's tick arrays let it reach (`router.svm.js`, "The window a swap at a
 * price walks"). Nothing here reads a cluster: the caller hands it the accounts.
 */
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { svmTokenRows } from "../routes/token-registry.js";
import { SVM_CLMM_LAYOUT, SVM_PRICE_LIMIT_VENUES } from "./pool-slot.js";
import {
  BYREAL_PROGRAM_ID,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "./venues/index.js";
import { MAX_TICK, MIN_TICK, raydiumSqrtPriceAtTick } from "./venues/raydium-clmm/tick-math.js";
import type { OwnedAccountLoader } from "./venues/types.js";

/** The concentrated-liquidity layouts a stop is worked out for. */
export type SvmStopLayout = "raydium" | "whirlpool" | "defituna" | "crema";

/**
 * What a venue's program charges one swap at a price, in compute units: `base` for the swap itself
 * and `tick` for each initialized tick it crosses (a tick it walks past uninitialized costs next to
 * nothing). Measured on the venues' own programs, as mainnet runs them, at or a little above every
 * walk measured, and held to them by `test/svm/compute-costs.e2e.test.ts`: a program upgrade that
 * moves them fails it.
 */
export interface SvmSwapCost {
  readonly base: number;
  readonly tick: number;
}

export const SVM_SWAP_COSTS: Readonly<Record<string, SvmSwapCost>> = {
  [RAYDIUM_CLMM_PROGRAM_ID]: { base: 39_000, tick: 9_200 },
  [PANCAKESWAP_CLMM_PROGRAM_ID]: { base: 56_000, tick: 15_500 },
  [BYREAL_PROGRAM_ID]: { base: 60_000, tick: 15_800 },
  [STABBLE_CLMM_PROGRAM_ID]: { base: 80_000, tick: 15_800 },
  [ORCA_WHIRLPOOL_PROGRAM_ID]: { base: 30_500, tick: 7_200 },
  [CROPPER_PROGRAM_ID]: { base: 40_500, tick: 15_000 },
  [DEFITUNA_PROGRAM_ID]: { base: 35_000, tick: 13_100 },
  [CREMA_PROGRAM_ID]: { base: 76_500, tick: 15_400 },
};

/** The units a Solana cook may spend: the compute-unit limit its transaction asks for. */
export const SVM_COOK_UNITS = 1_400_000;

/**
 * What the cook spends besides the venues' programs, as `sauce tx` estimates it with no simulation:
 * the Kitchen, the engine and the program's own work, `SVM_COOK_FIXED`; each swap at a price that
 * trades, the router reading its pool and arrays and the balances around it, `SVM_SWAP_FIXED`; each
 * whose pool it reads and leaves (past its limit, an adaptive fee), `SVM_SWAP_IDLE`; and each with
 * no pool at its key, `SVM_SWAP_SKIPPED`. Measured on the distributed swap's program, a little
 * above; `sauce simulate` and `sauce run` measure each cook's own.
 */
export const SVM_COOK_FIXED = 200_000;
export const SVM_SWAP_FIXED = 255_000;
export const SVM_SWAP_IDLE = 120_000;
export const SVM_SWAP_SKIPPED = 20_000;

/**
 * The share of each pool's estimate kept back, for prices that move between the cook's building and
 * its landing and for the cost table's own error: each walk is charged `1 + SVM_COMPUTE_HEADROOM`
 * times its estimate.
 */
export const SVM_COMPUTE_HEADROOM = 0.15;

/** A pool a swap at a price walks, as the cook's builder reads it. */
export interface SvmStopPool {
  /** The swap's stop, `main`'s parameter: what the result is keyed by. */
  readonly name: string;
  readonly program: Address;
  readonly layout: SvmStopLayout;
  /** The pool's account. */
  readonly pool: Uint8Array;
  /** Its fee, in millionths of the input: a Raydium-layout pool's config's, else the pool's. */
  readonly fee: bigint;
  /** The slot's three tick arrays, in walk order; undefined for the System program in a place. */
  readonly arrays: readonly (Uint8Array | undefined)[];
  /** Paying the lower-key token, the price falls. */
  readonly paysA: boolean;
  /** The swap's `priceLimit`, where the cook knows it: none is walked to the window's edge. */
  readonly priceLimit?: bigint;
}

/** How far a pool's swap would walk, unheld, and what that costs. */
export interface SvmWalk {
  /** Its liquidity at its price: what the deepest-first order sorts by. */
  readonly liquidity: bigint;
  readonly tick: number;
  readonly spacing: number;
  /** Its window's last safe tick, read as the router reads it with the swap's `stop`. */
  readonly window: number;
  /** Its slot's tick arrays, read. */
  readonly arrays: readonly (Array_ | undefined)[];
  /** Whether it walks past where the router's own window ends, which only the stop takes it. */
  readonly deep?: true;
  /** The tick its walk ends at: its limit's, or a tick inside its window. */
  readonly limitTick: number;
  /** The initialized ticks it crosses getting there, in walk order. */
  readonly crossed: readonly number[];
  /** Its venue's program's units for the whole walk, before the headroom. */
  readonly units: number;
  /** None: no swap (no tick array ahead of the price, no liquidity, past its limit already). */
  readonly none?: true;
}

/** A pool's stop, as the cook's builder worked it out. */
export interface SvmComputeStop {
  readonly name: string;
  /** The swap's `stop`: 0 none, 1 skip, else a tick, biased, it holds the swap a tick inside of. */
  readonly stop: bigint;
  /** Where the units held the pool: the initialized tick it stops a tick short of. */
  readonly stopTick?: number;
  /** The walk to its limit: the initialized ticks it crosses, and its units with the headroom. */
  readonly ticksToLimit: number;
  readonly estimatedUnits: number;
  /** The units the pool was given; equal to `estimatedUnits` where it walks its whole way. */
  readonly share: number;
  /** Where the order put it, deepest first, from 0. */
  readonly rank: number;
}

const i32 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0, true);

const le = (data: Uint8Array, at: number, width: number): bigint => {
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[at + i] ?? 0);
  return value;
};

const hex8 = (data: Uint8Array): string =>
  [...data.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Where each layout keeps its tick spacing. */
const SPACING_AT: Readonly<Record<SvmStopLayout, number>> = {
  raydium: 235,
  whirlpool: 41,
  defituna: 139,
  crema: 168,
};

const RAYDIUM_FIXED = "c09b55cd31f9812a";
const RAYDIUM_DYNAMIC = "6a8b98247599b838";
const TICK_ARRAY = "4561bdbe6e0742bb";
const FUSION_TICK_ARRAY = "5501c702bc61658b";

/** An array's first tick, its span in ticks, and its initialized ticks; undefined for none. */
interface Array_ {
  readonly start: number;
  readonly span: number;
  readonly ticks: readonly number[];
}

/** The slot place (6 to 8) of the array of `arrays` holding `tick`, in walk order from ticks0. */
const placeOf = (arrays: readonly (Array_ | undefined)[], tick: number): number | undefined => {
  const at = arrays.findIndex(
    (array) => array !== undefined && tick >= array.start && tick < array.start + array.span,
  );
  return at < 0 ? undefined : 6 + at;
};

/** One tick array of `layout`, read: its start, span and initialized ticks; undefined for none. */
function readArray(
  layout: SvmStopLayout,
  data: Uint8Array | undefined,
  spacing: number,
): Array_ | undefined {
  if (data === undefined || data.length < 8) return undefined;
  const kind = hex8(data);
  const ticks: number[] = [];
  if (layout === "raydium") {
    if (kind !== RAYDIUM_FIXED && kind !== RAYDIUM_DYNAMIC) return undefined;
    const start = i32(data, 40);
    for (let offset = 0; offset < 60; offset++) {
      let at = 64 + offset * 168;
      if (kind === RAYDIUM_DYNAMIC) {
        const place = data[48 + offset] ?? 0;
        at = place === 0 ? 0 : 216 + (place - 1) * 168 + 20;
      }
      if (at !== 0 && le(data, at, 16) !== 0n) ticks.push(start + offset * spacing);
    }
    return { start, span: 60 * spacing, ticks };
  }
  if (layout === "crema") {
    if (kind !== TICK_ARRAY) return undefined;
    const span = 64 * spacing;
    const start = -443636 + (443636 % spacing) + Number(le(data, 8, 2)) * span;
    for (let offset = 0; offset < 64; offset++) {
      if (data[44 + offset * 133] === 1) ticks.push(start + offset * spacing);
    }
    return { start, span, ticks };
  }
  if (layout === "defituna") {
    if (kind !== FUSION_TICK_ARRAY) return undefined;
    const start = i32(data, 8);
    let at = 44;
    for (let offset = 0; offset < 88 && at < data.length; offset++) {
      if (data[at] === 1) {
        ticks.push(start + offset * spacing);
        at += 113;
      } else at += 1;
    }
    return { start, span: 88 * spacing, ticks };
  }
  const start = i32(data, 8);
  if (kind === TICK_ARRAY && data.length >= 12 + 88 * 113) {
    for (let offset = 0; offset < 88; offset++) {
      if (data[12 + offset * 113] === 1) ticks.push(start + offset * spacing);
    }
  } else {
    // An array of a layout not read here: every place in it taken as initialized, the most it costs.
    for (let offset = 0; offset < 88; offset++) ticks.push(start + offset * spacing);
  }
  return { start, span: 88 * spacing, ticks };
}

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * The window's last safe tick, as the router reads it (`raydiumStop`, `cremaStop`, `whirlpoolStop`):
 * undefined where the swap has no array to walk.
 */
function windowStop(
  layout: SvmStopLayout,
  tick: number,
  spacing: number,
  arrays: readonly (Array_ | undefined)[],
  down: boolean,
): { readonly deep: number; readonly near: number } | undefined {
  if (layout === "whirlpool" || layout === "defituna") {
    const span = 88 * spacing;
    const base = floorDiv(tick, span) * span;
    const first = tick + spacing >= base + span ? base + span : base;
    const edge = down ? base - 2 * span : first + 2 * span + 87 * spacing;
    return { deep: edge, near: edge };
  }
  let far: Array_ | undefined;
  if (layout === "crema") {
    far = [...arrays].reverse().find((array) => array !== undefined);
  } else {
    for (const array of arrays) {
      if (array === undefined) continue;
      const ahead = down ? array.start <= tick : array.start + array.span > tick;
      if (
        ahead &&
        (far === undefined || (down ? array.start < far.start : array.start > far.start))
      )
        far = array;
    }
  }
  if (far === undefined) return undefined;
  const holds = down ? far.start + far.span > tick : far.start <= tick;
  // The router's own window: where the furthest array begins, or, holding the price, its last
  // initialized tick that way; taken on into a furthest array past the price by the swap's stop.
  const edge = down ? far.start + far.span : far.start;
  const past = far.ticks.filter((t) => !holds || (down ? t <= tick : t > tick));
  const last = past.length === 0 ? undefined : down ? Math.min(...past) : Math.max(...past);
  if (holds) return last === undefined ? undefined : { deep: last, near: last };
  return { deep: last ?? edge, near: edge };
}

/** The tick whose sqrt price is the greatest at or below `sqrt`. */
export function svmTickAtSqrtPrice(sqrt: bigint): number {
  let low = MIN_TICK;
  let high = MAX_TICK;
  if (sqrt <= raydiumSqrtPriceAtTick(low)) return low;
  if (sqrt >= raydiumSqrtPriceAtTick(high)) return high;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (raydiumSqrtPriceAtTick(mid) <= sqrt) low = mid;
    else high = mid;
  }
  return low;
}

const isqrt = (n: bigint): bigint => {
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
};

const E18 = 10n ** 18n;
const Q128 = 1n << 128n;

/** The router's own limit for `priceLimit` at a pool of `fee`: its sqrt price (`clmmOrder`). */
export function svmOwnLimit(priceLimit: bigint, fee: bigint, paysA: boolean): bigint {
  const limit = paysA ? isqrt((Q128 * E18) / priceLimit) : isqrt((priceLimit * Q128) / E18);
  const root = isqrt((1_000_000n - fee) * 10n ** 30n);
  return paysA ? (limit * E18) / root : (limit * root) / E18;
}

/**
 * Whether the router skips `pool` before calling its venue (`swapRaydium`, `swapWhirlpool`,
 * `swapCrema`): swaps switched off or a fee that is more than one rate on Raydium's code, an adaptive
 * fee on a whirlpool, a paused Crema pool.
 */
function skipped(layout: SvmStopLayout, pool: Uint8Array): boolean {
  if (layout === "raydium")
    return ((pool[389] ?? 0) & 16) !== 0 || le(pool, 393, 4) !== 0n || le(pool, 1096, 16) !== 0n;
  if (layout === "whirlpool") return le(pool, 41, 2) !== le(pool, 43, 2);
  if (layout === "crema") return (pool[747] ?? 0) !== 0;
  return false;
}

/** How far `pool`'s swap walks, held by nothing but its limit and its window, and its cost. */
export function svmPoolWalk(pool: SvmStopPool): SvmWalk {
  const layout = SVM_CLMM_LAYOUT[pool.layout];
  const tick = i32(pool.pool, layout.tick);
  const spacing = Number(le(pool.pool, SPACING_AT[pool.layout], 2));
  const liquidity = le(pool.pool, layout.liquidity, 16);
  const price = le(pool.pool, layout.price, 16);
  const cost = SVM_SWAP_COSTS[pool.program] ?? { base: 0, tick: 0 };
  const arrays = pool.arrays.map((data) => readArray(pool.layout, data, spacing));
  const down = pool.paysA;
  const windows = windowStop(pool.layout, tick, spacing, arrays, down);
  const window = windows?.deep;
  const none = (): SvmWalk => ({
    liquidity,
    tick,
    spacing,
    window: window ?? tick,
    arrays,
    limitTick: tick,
    crossed: [],
    units: 0,
    none: true,
  });
  if (window === undefined || liquidity === 0n || spacing === 0 || skipped(pool.layout, pool.pool))
    return none();
  // A tick inside the window: down, the price ends above `window + 1`; up, below `window − 1`.
  let limitTick = down ? window + 1 : window - 2;
  if (pool.priceLimit !== undefined && pool.priceLimit > 0n) {
    const own = svmOwnLimit(pool.priceLimit, pool.fee, down);
    if (down ? own >= price : own <= price) return none();
    const ownTick = svmTickAtSqrtPrice(own);
    limitTick = down ? Math.max(limitTick, ownTick) : Math.min(limitTick, ownTick);
  }
  if (down ? limitTick > tick : limitTick <= tick) return none();
  const near = down ? windows!.near + 1 : windows!.near - 2;
  const deep = down ? limitTick < near : limitTick > near;
  const all = [
    ...new Set(arrays.flatMap((array) => (array === undefined ? [] : array.ticks))),
  ].sort((a, b) => (down ? b - a : a - b));
  const crossed = all.filter((t) =>
    down ? t <= tick && t >= limitTick : t > tick && t <= limitTick,
  );

  return {
    liquidity,
    tick,
    spacing,
    window,
    arrays,
    ...(deep ? { deep } : {}),
    limitTick,
    crossed,
    units: cost.base + cost.tick * crossed.length,
  };
}

/** The units of a swap crossing `n` initialized ticks of `pool`'s, with the headroom. */
function charged(pool: SvmStopPool, n: number): number {
  const cost = SVM_SWAP_COSTS[pool.program] ?? { base: 0, tick: 0 };
  return Math.ceil((cost.base + cost.tick * n) * (1 + SVM_COMPUTE_HEADROOM));
}

/**
 * A swap's stop at `tick`, as the router reads it: the tick's i32 with the sign bit flipped, and on
 * Raydium's code the slot place of the array it lies in from bit 40, where the router reads it.
 */
const stopAt = (pool: SvmStopPool, walk: SvmWalk, tick: number): bigint => {
  const place = pool.layout === "raydium" ? placeOf(walk.arrays, tick) : undefined;
  return BigInt(tick) + (1n << 31n) + (place === undefined ? 0n : BigInt(place) << 40n);
};

/**
 * Each pool's stop for a cook whose venues' programs may spend `budget` units between them: the
 * deepest pool (most liquidity at its price) first, each walking as far as its limit takes it within
 * what is left, a pool the rest no longer covers held a tick inside the first initialized tick it
 * cannot pay to cross, and one that cannot pay for the swap itself skipped.
 */
export function svmComputeStops(pools: readonly SvmStopPool[], budget: number): SvmComputeStop[] {
  const order = pools
    .map((pool, index) => ({ pool, walk: svmPoolWalk(pool), index }))
    .sort((a, b) =>
      a.walk.liquidity === b.walk.liquidity
        ? a.index - b.index
        : a.walk.liquidity > b.walk.liquidity
          ? -1
          : 1,
    );
  let left = budget;
  const stops = new Map<string, SvmComputeStop>();
  order.forEach(({ pool, walk }, rank) => {
    const whole = walk.none === true ? 0 : charged(pool, walk.crossed.length);
    const of = { name: pool.name, ticksToLimit: walk.crossed.length, estimatedUnits: whole, rank };
    if (walk.none === true) {
      stops.set(pool.name, { ...of, stop: 0n, share: 0 });
      return;
    }
    if (whole <= left) {
      left -= whole;
      // Its whole way: no stop, but where that is past the router's own window (on Raydium's code
      // and Crema, into the furthest array, which that window stops at the start of).
      stops.set(pool.name, {
        ...of,
        stop: walk.deep === true ? stopAt(pool, walk, walk.window) : 0n,
        share: whole,
      });
      return;
    }
    // The most crossings what is left pays for: held a tick inside the next.
    let n = walk.crossed.length - 1;
    while (n >= 0 && charged(pool, n) > left) n--;
    if (n < 0) {
      stops.set(pool.name, { ...of, stop: 1n, share: 0 });
      return;
    }
    const share = charged(pool, n);
    left -= share;
    const stopTick = walk.crossed[n]!;
    stops.set(pool.name, { ...of, stop: stopAt(pool, walk, stopTick), stopTick, share });
  });

  return pools.map((pool) => stops.get(pool.name)!);
}

// ---------------------------------------------------------------------------------------------
// A program's stops, read from the accounts its cook names
// ---------------------------------------------------------------------------------------------

/** `numerator / denominator` to six significant digits, for a person: 151.234, 0.00661225. */
function significant(numerator: bigint, denominator: bigint): string {
  if (numerator === 0n) return "0";
  let places = 0;
  while (places < 60 && (numerator * 10n ** BigInt(places)) / denominator < 100_000n) places++;
  const unit = 10n ** BigInt(places);
  const rounded = (2n * numerator * unit + denominator) / (2n * denominator);
  const fraction = (rounded % unit).toString().padStart(places, "0").replace(/0+$/, "");

  return fraction === "" ? (rounded / unit).toString() : `${rounded / unit}.${fraction}`;
}

/** A pool's stop, with what a person reads of it. */
export interface SvmPoolStop extends SvmComputeStop {
  readonly pool: Address;
  /** How the program names the pool: `Raydium.CLMM.pool(USDC, SPCX_US, 2500)`. */
  readonly label: string;
  readonly venue: string;
  readonly pay: string;
  readonly buy: string;
  /** Where the units held it: the price of its last unit there, fee included, in whole tokens. */
  readonly stopPrice?: string;
}

/** The stops of a cook: the values `main` takes, in its order, and each pool's. */
export interface SvmProgramStops {
  readonly values: readonly bigint[];
  readonly stops: readonly SvmPoolStop[];
  /** The units the venues' programs were given between them. */
  readonly budget: number;
  /** The cook's own units, besides the venues': the cost table's, or a simulation's. */
  readonly fixed: { readonly units: number; readonly measured: boolean };
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const sameKey = (data: Uint8Array, at: number, key: Address): boolean => {
  const bytes = getAddressEncoder().encode(key);
  return bytes.every((byte, i) => data[at + i] === byte);
};

/** How output names a pool by its derivation: `Raydium.CLMM(USDC,SPCX_US,2500)` as written. */
function labelOf(pool: string, address: Address): string {
  const keyed = /^([A-Za-z]+\.[A-Za-z]+)\((.*)\)$/.exec(pool);
  if (keyed !== null) return `${keyed[1]}.pool(${keyed[2]!.split(",").join(", ")})`;
  if (pool.startsWith("@")) return `pool ${address} (main's argument ${pool.slice(1)})`;
  return `pool ${address}`;
}

/** A layout's fee, in millionths: Raydium's code keeps it in its config, the others in the pool. */
const feeOf = (layout: SvmStopLayout, pool: Uint8Array, config: Uint8Array | undefined): bigint =>
  layout === "raydium"
    ? le(config ?? new Uint8Array(), 47, 4)
    : layout === "whirlpool"
      ? le(pool, 45, 2)
      : layout === "defituna"
        ? le(pool, 143, 2)
        : le(pool, 172, 2);

/** The price of a pool's last unit at `tick`, fee included, in whole tokens of the pair. */
function takerPrice(
  tick: number,
  paysA: boolean,
  fee: bigint,
  [payDecimals, buyDecimals]: readonly [number, number],
): string {
  const sqrt = raydiumSqrtPriceAtTick(tick);
  const kept = 1_000_000n - fee;
  const price = paysA
    ? (Q128 * E18 * 1_000_000n) / (sqrt * sqrt * kept)
    : (sqrt * sqrt * E18 * 1_000_000n) / (Q128 * kept);

  return significant(price * 10n ** BigInt(buyDecimals), E18 * 10n ** BigInt(payDecimals));
}

/**
 * The stops of `program`'s swaps at a price, read through `load` from the accounts the cook resolved
 * (`accounts`, by `main`'s parameter), with main's `Uint256` arguments by name (`integers`), for a
 * limit a swap takes from one. `fixed` is the cook's own units where a simulation measured them;
 * `scale` shrinks what the venues are given, for a cook that ran out of units anyway. Undefined for
 * a program with no stops.
 */
export async function svmProgramStops(
  program: Pick<CompiledSauceProgram, "derivedValues" | "derivedAccounts">,
  chain: CanonicalChain,
  accounts: Readonly<Record<string, string>>,
  integers: Readonly<Record<string, bigint>>,
  load: OwnedAccountLoader,
  fixed?: number,
  scale = 1,
): Promise<SvmProgramStops | undefined> {
  const values = program.derivedValues ?? [];
  if (values.length === 0) return undefined;
  const derived = Object.entries(program.derivedAccounts ?? {});
  const rows = svmTokenRows(chain);
  const symbolOf = (mint: Address): string => rows.find((row) => row.mint === mint)?.symbol ?? mint;
  const data = async (key: string | undefined): Promise<Uint8Array | undefined> =>
    key === undefined || key === SYSTEM_PROGRAM
      ? undefined
      : ((await load(key as Address))?.data ?? undefined);
  const pools: SvmStopPool[] = [];
  const seen = new Map<
    string,
    Pick<SvmPoolStop, "pool" | "label" | "venue" | "pay" | "buy"> & {
      readonly decimals: readonly [number, number];
      readonly paysA: boolean;
      readonly fee: bigint;
    }
  >();
  for (const value of values) {
    const [, pool, token, limit = ""] = value.derive.split(":") as [
      string,
      string,
      string,
      string?,
    ];
    const part = (name: string): string | undefined => {
      const at = derived.find(([, derive]) => derive === `slot:${pool}:${token}.${name}`)?.[0];
      return at === undefined ? undefined : accounts[at];
    };
    const program = part("program");
    const address = part("pool") as Address | undefined;
    const venue = SVM_PRICE_LIMIT_VENUES.find((one) => one.program === program);
    const account = await data(address);
    if (venue === undefined || address === undefined || account === undefined) continue;
    const layout = venue.layout as SvmStopLayout;
    const at = SVM_CLMM_LAYOUT[layout];
    const payName = derived.find(([, derive]) => derive === `mint:${token}`)?.[0];
    const payMint = (payName === undefined ? undefined : accounts[payName]) as Address | undefined;
    if (payMint === undefined) continue;
    const paysA = sameKey(account, at.mintA, payMint);
    if (!paysA && !sameKey(account, at.mintB, payMint)) continue;
    const buyMint = getAddressDecoder().decode(
      account.subarray(paysA ? at.mintB : at.mintA, (paysA ? at.mintB : at.mintA) + 32),
    );
    const fee = feeOf(layout, account, await data(part("config")));
    const arrays = await Promise.all(
      ["ticks0", "ticks1", "ticks2"].map((name) => data(part(name))),
    );
    const priceLimit = limit.startsWith("@")
      ? integers[limit.slice(1)]
      : limit === ""
        ? undefined
        : BigInt(limit);
    pools.push({
      name: value.name,
      program: program as Address,
      layout,
      pool: account,
      fee,
      arrays,
      paysA,
      ...(priceLimit === undefined ? {} : { priceLimit }),
    });
    seen.set(value.name, {
      pool: address,
      label: labelOf(pool, address),
      venue: venue.name,
      pay: symbolOf(payMint),
      buy: symbolOf(buyMint),
      decimals: [
        Number((await data(payMint))?.[44] ?? 0),
        Number((await data(buyMint))?.[44] ?? 0),
      ],
      paysA,
      fee,
    });
  }
  // The cook's own units: as a simulation measured them, else the cost table's, a swap that trades
  // costing more than one whose pool the router reads and leaves, and that more than a key with no
  // pool.
  const trading = pools.filter((pool) => svmPoolWalk(pool).none !== true).length;
  const units =
    fixed ??
    SVM_COOK_FIXED +
      SVM_SWAP_FIXED * trading +
      SVM_SWAP_IDLE * (pools.length - trading) +
      SVM_SWAP_SKIPPED * (values.length - pools.length);
  const budget = Math.max(0, Math.floor((SVM_COOK_UNITS - units) * scale));
  const computed = new Map(svmComputeStops(pools, budget).map((stop) => [stop.name, stop]));
  const stops: SvmPoolStop[] = [];
  for (const value of values) {
    const stop = computed.get(value.name);
    const pool = seen.get(value.name);
    if (stop === undefined || pool === undefined) continue;
    const { decimals, paysA, fee, ...shown } = pool;
    stops.push({
      ...stop,
      ...shown,
      ...(stop.stopTick === undefined
        ? {}
        : { stopPrice: takerPrice(stop.stopTick, paysA, fee, decimals) }),
    });
  }

  return {
    values: values.map((value) => computed.get(value.name)?.stop ?? 0n),
    stops,
    budget,
    fixed: { units, measured: fixed !== undefined },
  };
}
