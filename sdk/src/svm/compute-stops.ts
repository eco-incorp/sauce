/**
 * A Solana swap at a price, held within its share of the cook's compute units.
 *
 * A concentrated-liquidity pool's swap costs its program compute units for every initialized tick it
 * crosses, and a pool walked far enough runs the transaction out of them: the whole cook fails, every
 * pool's trade with it. The deployed engine cannot read the units left, so the cook's builder works
 * out each pool's walk as the cook is built, from the pool's tick arrays: how far its limit takes it,
 * what that costs (`SVM_SWAP_COSTS`) and what it buys. The pool whose walk buys the most per unit goes
 * first, each as far as its limit takes it within what the cook has left; a pool the units no longer
 * reach is held to where they end, and one they do not reach at all is skipped. A pool held or
 * skipped is compiled to `@sauce/router`'s Stopped form of its swap, its `stop` a tighter `priceLimit`
 * worked out here with the router's own arithmetic, so that its swap stops a tick inside the first
 * initialized tick its share does not pay to cross (1 to skip); every other pool's swap is the plain
 * one.
 *
 * Each stop is fixed as the cook is built, and a price that moves before it lands can leave a swap
 * more ticks to cross than were priced. Every pool that trades is charged `SVM_HEADROOM_TICKS` more
 * crossings for that, and a held pool's stop carries where its price was then: its Stopped form skips
 * the pool where the price has since moved further than that from its stop. A held pool so crosses
 * at most that many more initialized ticks than were priced. A pool that walks its whole way runs the
 * plain swap, unchecked: a price that moves further than the headroom can still cost it more.
 *
 * The walk is the router's own: the pool's limit for `priceLimit` and its fee, and no further than its
 * window, the last tick its slot's tick arrays let it reach (`router.svm.js`, "The window a swap at a
 * price walks"). On Raydium's code and Crema the window ends where the furthest of those arrays
 * begins; a walk its limit takes past there goes on to that array's last initialized tick that way,
 * its deep tick, which its stop carries, and its swap is compiled to the Stopped form for it, held or
 * not (`router.svm.js`, "Held to a stop", reads the tick there and checks it). Nothing here reads a
 * cluster: the caller hands it the accounts.
 */
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { svmClusterOf, svmTokenRows } from "../routes/token-registry.js";
import { SVM_CLMM_LAYOUT, svmPriceLimitVenues } from "./pool-slot.js";
import { svmMainnetProgram } from "./venue-table.js";
import { MAX_TICK, MIN_TICK, raydiumSqrtPriceAtTick } from "./venues/raydium-clmm/tick-math.js";
import type { OwnedAccountLoader } from "./venues/types.js";

/** The concentrated-liquidity layouts a stop is worked out for. */
export type SvmStopLayout = "raydium" | "whirlpool" | "defituna" | "crema";

/**
 * What a venue's program charges one swap at a price, in compute units: `base` for the swap itself
 * and `tick` for each initialized tick it crosses (a tick it walks past uninitialized costs next to
 * nothing). Both are the venue program's own units as the engine calls it, under CPI, as its log
 * line reports them (`Program <id> consumed N`): the invoke itself and the accounts it serializes are
 * the caller's, in `SVM_SWAP_FIXED`, so a caller pricing the venue under its own CPI adds its own.
 * `base` is at or above every walk of none measured and `tick` at or above the steepest step between
 * two measured walks, on the venues' own programs as mainnet runs them; the router suite holds both
 * to those programs (`test/std/router/svm.e2e.test.ts`, "the cost table holds to its program"), so a
 * program upgrade that moves them fails it. A whirlpool with an adaptive fee, which pays per step of
 * its volatility too, is not priced here: the router skips it at a price. The table holds mainnet's
 * programs, by their ids: a program another cluster deploys at the same id is priced as mainnet's,
 * and one at an id of its own, unmeasured, at the dearest.
 */
export interface SvmSwapCost {
  readonly base: number;
  readonly tick: number;
}

export const SVM_SWAP_COSTS: Readonly<Record<string, SvmSwapCost>> = {
  [svmMainnetProgram("raydium-clmm")]: { base: 39_000, tick: 9_200 },
  [svmMainnetProgram("pancakeswap-clmm")]: { base: 56_000, tick: 15_800 },
  [svmMainnetProgram("byreal")]: { base: 60_000, tick: 15_900 },
  [svmMainnetProgram("stabble-clmm")]: { base: 80_000, tick: 15_900 },
  [svmMainnetProgram("orca-whirlpool")]: { base: 30_500, tick: 7_300 },
  [svmMainnetProgram("cropper")]: { base: 40_500, tick: 14_400 },
  [svmMainnetProgram("defituna")]: { base: 35_000, tick: 13_500 },
  [svmMainnetProgram("crema")]: { base: 76_500, tick: 15_500 },
};

/** A program the table does not hold is priced at the table's dearest: never at nothing. */
const DEAREST: SvmSwapCost = {
  base: Math.max(...Object.values(SVM_SWAP_COSTS).map((cost) => cost.base)),
  tick: Math.max(...Object.values(SVM_SWAP_COSTS).map((cost) => cost.tick)),
};

/** What `program`'s swap costs: its row of `SVM_SWAP_COSTS`, else the table's dearest. */
export const svmSwapCost = (program: string): SvmSwapCost => SVM_SWAP_COSTS[program] ?? DEAREST;

/** The units a Solana cook may spend: the compute-unit limit its transaction asks for. */
export const SVM_COOK_UNITS = 1_400_000;

/**
 * What the cook spends besides the venues' programs, as `sauce tx` estimates it with no simulation:
 * the Kitchen, the engine and the program's own work, `SVM_COOK_FIXED`; each swap at a price that
 * trades, the router reading its pool and arrays, the balances around it and the venue's invoke,
 * `SVM_SWAP_FIXED`; each whose pool it reads and leaves (past its limit, an adaptive fee),
 * `SVM_SWAP_IDLE`; and each with no pool at its key, `SVM_SWAP_SKIPPED`. Measured on the distributed
 * swap's program, a little above; `sauce simulate` and `sauce run` measure each cook's own.
 */
export const SVM_COOK_FIXED = 200_000;
export const SVM_SWAP_FIXED = 255_000;
export const SVM_SWAP_IDLE = 120_000;
export const SVM_SWAP_SKIPPED = 20_000;

/**
 * The initialized ticks each pool that trades is charged past its walk, for a price that moves
 * between the cook's building and its landing: tick-spacing positions, each holding at most one
 * initialized tick. A held pool's Stopped form skips the pool where its price has moved further than
 * that from where its walk was priced, so a held pool crosses at most this many more initialized
 * ticks than were priced, while the ticks in its way stay as they were read: a position opened inside
 * the walk in the meantime adds a crossing nothing charged.
 */
export const SVM_HEADROOM_TICKS = 3;

/** A pool a swap at a price walks, as the cook's builder reads it. */
export interface SvmStopPool {
  /** The swap's stop's derivation: what the result is keyed by. */
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
  /**
   * How many times the swap runs, in a loop that writes its count out; once when absent. Each run
   * is charged its swap's own units (`base`), and the walk once: every run walks the same way to the
   * same limit, from where the one before left the price.
   */
  readonly runs?: number;
}

/** How far a pool's swap would walk, unheld, and what that costs and buys. */
export interface SvmWalk {
  /** Its liquidity at its price. */
  readonly liquidity: bigint;
  readonly tick: number;
  readonly spacing: number;
  /** Its window's last safe tick, as the router reads it. */
  readonly window: number;
  /**
   * On Raydium's code and Crema, where the walk goes on past `window` into the furthest tick array
   * its slot gives that way: that array's last initialized tick that way, which its stop carries
   * (`SvmComputeStop.deepTick`). Absent where the walk ends inside its window.
   */
  readonly deep?: number;
  /** The tick its walk ends in: its limit's, or a tick inside its window (or `deep`). */
  readonly limitTick: number;
  /** The initialized ticks it crosses getting there, in walk order. */
  readonly crossed: readonly number[];
  /** Its venue's program's units for the whole walk, before the headroom. */
  readonly units: number;
  /** What the whole walk buys, in the bought token's base units, before the fee. */
  readonly output: bigint;
  /** None: no swap (no room in its window, no liquidity, past its limit already, skipped). */
  readonly none?: true;
}

/** A pool's stop, as the cook's builder worked it out. */
export interface SvmComputeStop {
  readonly name: string;
  /**
   * The swap's `stop`, as the Stopped form takes it: 0 none (the plain swap); `svmSkipStop`'s where
   * it is `skipped`; else a tighter `priceLimit` (`limit`) in its low 192 bits, 0 for none; in bits
   * 192 to 223 the start bound (`from`): the tick, as the router reads ticks, its price may lie no
   * further from the stop than when it was priced, give or take `SVM_HEADROOM_TICKS` positions, 0
   * for none; and in bits 224 to 255 `deepTick`, as the router reads ticks, 0 for none.
   */
  readonly stop: bigint;
  /**
   * Where its walk goes on into the furthest tick array its slot gives (`SvmWalk.deep`), to a tick
   * inside this one: on its own, a stop that holds the pool nowhere short of its limit.
   */
  readonly deepTick?: number;
  /** Where the units leave the pool too few for its swap at all: its stop skips it. */
  readonly skipped?: boolean;
  /** The tighter `priceLimit`, holding the swap a tick inside `stopTick`. */
  readonly limit?: bigint;
  /** The start bound, a tick. */
  readonly from?: number;
  /** Where the units held the pool: the initialized tick it stops a tick short of. */
  readonly stopTick?: number;
  /** The walk to its limit: the initialized ticks it crosses, and its units with the headroom. */
  readonly ticksToLimit: number;
  readonly estimatedUnits: number;
  /** The units the pool was given; equal to `estimatedUnits` where it walks its whole way. */
  readonly share: number;
  /** Where the order put it, the most output per unit first, from 0. */
  readonly rank: number;
}

const i32 = (data: Uint8Array, at: number): number =>
  new DataView(data.buffer, data.byteOffset + at, 4).getInt32(0, true);

const le = (data: Uint8Array, at: number, width: number): bigint => {
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[at + i] ?? 0);
  return value;
};

/** A signed 128-bit integer, little-endian. */
const i128 = (data: Uint8Array, at: number): bigint => {
  const value = le(data, at, 16);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
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
const DYNAMIC_TICK_ARRAY = "11d8f68ee1c7da38";
const FUSION_TICK_ARRAY = "5501c702bc61658b";

/** An initialized tick, and the liquidity crossing it adds walking up. */
export interface SvmTick {
  readonly tick: number;
  readonly net: bigint;
}

/** An array's first tick, its span in ticks, and its initialized ticks. */
export interface SvmTickArray {
  readonly start: number;
  readonly span: number;
  readonly ticks: readonly SvmTick[];
}

/**
 * Ticks in Orca's and DefiTuna's tagged layout, from `at`: each a byte, 1 for an initialized tick
 * followed by its 112 bytes (its liquidity net first), else that byte alone.
 */
function tagged(data: Uint8Array, at: number, start: number, spacing: number): SvmTick[] {
  const ticks: SvmTick[] = [];
  for (let offset = 0; offset < 88 && at < data.length; offset++) {
    if (data[at] === 1) {
      ticks.push({ tick: start + offset * spacing, net: i128(data, at + 1) });
      at += 113;
    } else at += 1;
  }
  return ticks;
}

/** One tick array of `layout`, read: its start, span and initialized ticks; undefined for none. */
export function svmTickArray(
  layout: SvmStopLayout,
  data: Uint8Array | undefined,
  spacing: number,
): SvmTickArray | undefined {
  if (data === undefined || data.length < 8) return undefined;
  const kind = hex8(data);
  const ticks: SvmTick[] = [];
  if (layout === "raydium") {
    if (kind !== RAYDIUM_FIXED && kind !== RAYDIUM_DYNAMIC) return undefined;
    const start = i32(data, 40);
    // A tick's state: its index, its net liquidity, its gross (0: not initialized).
    for (let offset = 0; offset < 60; offset++) {
      let at = 44 + offset * 168;
      if (kind === RAYDIUM_DYNAMIC) {
        const place = data[48 + offset] ?? 0;
        if (place === 0) continue;
        at = 216 + (place - 1) * 168;
      }
      if (le(data, at + 20, 16) !== 0n)
        ticks.push({ tick: start + offset * spacing, net: i128(data, at + 4) });
    }
    return { start, span: 60 * spacing, ticks };
  }
  if (layout === "crema") {
    if (kind !== TICK_ARRAY) return undefined;
    const span = 64 * spacing;
    const start = -443636 + (443636 % spacing) + Number(le(data, 8, 2)) * span;
    // A tick's state: initialized, its index, its sqrt price, its net liquidity.
    for (let offset = 0; offset < 64; offset++) {
      const at = 44 + offset * 133;
      if (data[at] === 1) ticks.push({ tick: start + offset * spacing, net: i128(data, at + 21) });
    }
    return { start, span, ticks };
  }
  if (layout === "defituna") {
    if (kind !== FUSION_TICK_ARRAY) return undefined;
    const start = i32(data, 8);
    return { start, span: 88 * spacing, ticks: tagged(data, 44, start, spacing) };
  }
  const start = i32(data, 8);
  if (kind === DYNAMIC_TICK_ARRAY) {
    // Orca's dynamic array: its start, its pool, a bitmap of its ticks, then the ticks, tagged.
    return { start, span: 88 * spacing, ticks: tagged(data, 60, start, spacing) };
  }
  if (kind === TICK_ARRAY && data.length >= 12 + 88 * 113) {
    // A tick's state: initialized, its net liquidity, its gross.
    for (let offset = 0; offset < 88; offset++) {
      const at = 12 + offset * 113;
      if (data[at] === 1) ticks.push({ tick: start + offset * spacing, net: i128(data, at + 1) });
    }
    return { start, span: 88 * spacing, ticks };
  }
  // An array of a layout not read here: every place in it taken as initialized, the most it costs.
  for (let offset = 0; offset < 88; offset++)
    ticks.push({ tick: start + offset * spacing, net: 0n });
  return { start, span: 88 * spacing, ticks };
}

const floorDiv = (a: number, b: number): number => Math.floor(a / b);

/**
 * The window's last safe tick, as the router reads it (`raydiumStop`, `cremaStop`, `whirlpoolStop`),
 * absent where the swap has no room to walk; and on Raydium's code and Crema, where the furthest
 * array the slot gives that way lies past the price, that array's last initialized tick that way
 * (`deep`), which a Stopped form's stop walks the window on to (`raydiumDeep`, `cremaDeep`).
 */
function windowStop(
  layout: SvmStopLayout,
  tick: number,
  spacing: number,
  arrays: readonly (SvmTickArray | undefined)[],
  down: boolean,
): { readonly window?: number; readonly deep?: number } {
  if (layout === "whirlpool" || layout === "defituna") {
    const span = 88 * spacing;
    const base = floorDiv(tick, span) * span;
    if (down) return { window: base - 2 * span };
    const first = tick + spacing >= base + span ? base + span : base;
    return { window: first + 2 * span + 87 * spacing };
  }
  let far: SvmTickArray | undefined;
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
  if (far === undefined) return {};
  // Past the price: where it begins, and its last initialized tick that way. Holding it: that tick
  // ahead of the price, if any.
  if (down ? far.start + far.span <= tick : far.start > tick) {
    const ticks = far.ticks.map((t) => t.tick);
    return {
      window: down ? far.start + far.span : far.start,
      ...(ticks.length === 0 ? {} : { deep: down ? Math.min(...ticks) : Math.max(...ticks) }),
    };
  }
  const ahead = far.ticks.map((t) => t.tick).filter((t) => (down ? t <= tick : t > tick));
  if (ahead.length === 0) return {};
  return { window: down ? Math.min(...ahead) : Math.max(...ahead) };
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
const Q64 = 1n << 64n;
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

/**
 * What `liquidity` buys moving the sqrt price from `from` to `to` the way the swap walks: token B
 * as it falls (`down`), A as it rises. A stretch the other way buys nothing.
 */
function bought(liquidity: bigint, from: bigint, to: bigint, down: boolean): bigint {
  if (liquidity <= 0n || (down ? to >= from : to <= from)) return 0n;
  return down ? (liquidity * (from - to)) / Q64 : (liquidity * (to - from) * Q64) / (from * to);
}

/**
 * How far `pool`'s swap walks, held by nothing but its limit and its window, its cost and output: on
 * Raydium's code and Crema, on into the furthest tick array its slot gives where its limit takes it
 * past the window (`SvmWalk.deep`), as its Stopped form walks with the deep tick its stop carries.
 */
export function svmPoolWalk(pool: SvmStopPool): SvmWalk {
  const layout = SVM_CLMM_LAYOUT[pool.layout];
  const tick = i32(pool.pool, layout.tick);
  const spacing = Number(le(pool.pool, SPACING_AT[pool.layout], 2));
  const liquidity = le(pool.pool, layout.liquidity, 16);
  const price = le(pool.pool, layout.price, 16);
  const cost = svmSwapCost(pool.program);
  const arrays = pool.arrays.map((data) => svmTickArray(pool.layout, data, spacing));
  const down = pool.paysA;
  const { window, deep } = windowStop(pool.layout, tick, spacing, arrays, down);
  const none = (): SvmWalk => ({
    liquidity,
    tick,
    spacing,
    window: window ?? tick,
    limitTick: tick,
    crossed: [],
    units: 0,
    output: 0n,
    none: true,
  });
  if (window === undefined || liquidity === 0n || spacing === 0 || skipped(pool.layout, pool.pool))
    return none();
  // The router's room: a tick inside the window's edge, the deep tick where there is one, measured
  // from the price's own tick, or none.
  const edge = deep ?? window;
  if (down ? edge + 1 >= tick : edge <= tick + 2) return none();
  let limitTick = down ? edge + 1 : edge - 2;
  let end = raydiumSqrtPriceAtTick(limitTick);
  if (pool.priceLimit !== undefined && pool.priceLimit > 0n) {
    const own = svmOwnLimit(pool.priceLimit, pool.fee, down);
    if (down ? own >= price : own <= price) return none();
    // Its own limit, where nearer: inside the price's own tick it still trades, crossing none.
    if (down ? own > end : own < end) {
      end = own;
      limitTick = svmTickAtSqrtPrice(own);
    }
  }
  // It walks on where the window alone leaves it no room, or ends short of where the walk does.
  const roomy = down ? window + 1 < tick : window > tick + 2;
  const short = raydiumSqrtPriceAtTick(down ? window + 1 : window - 2);
  const walksOn = deep !== undefined && (!roomy || (down ? end < short : end > short));
  const all = [
    ...new Map(
      arrays.flatMap((array) => (array === undefined ? [] : array.ticks.map((t) => [t.tick, t]))),
    ).values(),
  ].sort((a, b) => (down ? b.tick - a.tick : a.tick - b.tick));
  // The initialized ticks whose sqrt price the walk reaches, which is where a swap crosses one: down,
  // one at or above where it ends (the tick its own limit lies in, a hair above it, is not), up, one
  // at or below.
  const crossed = all.filter((t) => {
    if (down ? t.tick > tick : t.tick <= tick) return false;
    const at = raydiumSqrtPriceAtTick(t.tick);
    return down ? at >= end : at <= end;
  });
  // What the walk buys: each stretch between initialized ticks at the liquidity then, which each
  // crossing changes by its net (added walking up, taken walking down).
  let output = 0n;
  let at = price;
  let active = liquidity;
  for (const t of crossed) {
    const next = raydiumSqrtPriceAtTick(t.tick);
    output += bought(active, at, next, down);
    at = next;
    active = down ? active - t.net : active + t.net;
  }
  output += bought(active, at, end, down);

  return {
    liquidity,
    tick,
    spacing,
    window,
    ...(walksOn ? { deep } : {}),
    limitTick,
    crossed: crossed.map((t) => t.tick),
    units: cost.base + cost.tick * crossed.length,
    output,
  };
}

/**
 * The units charged for a swap crossing `n` initialized ticks of `pool`'s, with the headroom: its
 * own units for each time it runs, and the crossings once.
 */
function charged(pool: SvmStopPool, n: number): number {
  const cost = svmSwapCost(pool.program);
  return cost.base * (pool.runs ?? 1) + cost.tick * (n + SVM_HEADROOM_TICKS);
}

/**
 * The `priceLimit` that holds `pool`'s swap a tick inside `tick`, the first initialized tick it is
 * not to cross: the loosest whose own limit, by the router's arithmetic (`svmOwnLimit`), keeps the
 * price short of it, found by halving, since the own limit moves with `priceLimit` one way only.
 * Undefined where none does, a tick past what the router's arithmetic reaches.
 */
export function svmStopLimit(tick: number, fee: bigint, paysA: boolean): bigint | undefined {
  // Paying the lower-key token the price falls: it is to stay at or above the sqrt price a tick
  // above `tick`. Paying the other it rises, and is to stay at or below the one a tick below.
  const bound = raydiumSqrtPriceAtTick(paysA ? tick + 1 : tick - 1);
  const keeps = (limit: bigint): boolean => {
    const own = svmOwnLimit(limit, fee, paysA);
    return paysA ? own >= bound : own <= bound;
  };
  // The own limit falls as priceLimit rises paying the lower-key token, and rises with it otherwise:
  // the loosest priceLimit that keeps is the greatest one.
  let low = 2n;
  let high = 1n << 190n;
  if (!keeps(low)) return undefined;
  while (high - low > 1n) {
    const mid = (low + high) / 2n;
    if (keeps(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/** A tick as the router reads it: its i32 with the sign bit flipped. */
const biased = (tick: number): bigint => BigInt(tick) + (1n << 31n);

/** The stop's bits that walk a window on to `deep` (`SvmWalk.deep`), none for none. */
const deepBits = (deep: number | undefined): bigint =>
  deep === undefined ? 0n : biased(deep) << 224n;

/**
 * The stop that skips a pool, whatever its price: a start bound past every tick the walk's way (the
 * least an i32 tick reads as paying the lower-key token, as the price falls, the greatest the other
 * way), which every pool's price has moved past, and no limit.
 */
export function svmSkipStop(paysA: boolean): bigint {
  return (paysA ? 1n : (1n << 32n) - 1n) << 192n;
}

/**
 * Each pool's stop for a cook whose venues' programs may spend `budget` units between them. The pool
 * whose walk buys the most per unit of compute goes first, each walking as far as its limit takes
 * it within what is left; a pool the rest no longer covers is held a tick inside the first
 * initialized tick it cannot pay to cross, and one that cannot pay for the swap itself is skipped.
 * Every pool that trades is charged `SVM_HEADROOM_TICKS` crossings past its walk. A walk that goes
 * on into the furthest tick array its slot gives (`SvmWalk.deep`) carries its deep tick, held or
 * not, wherever it trades past its window.
 */
export function svmComputeStops(pools: readonly SvmStopPool[], budget: number): SvmComputeStop[] {
  const walks = pools.map((pool, index) => ({ pool, walk: svmPoolWalk(pool), index }));
  // The most output per unit first: a's output over its units against b's, cross-multiplied.
  const per = ({ pool, walk }: (typeof walks)[number]): [bigint, bigint] =>
    walk.none === true ? [0n, 1n] : [walk.output, BigInt(charged(pool, walk.crossed.length))];
  const order = [...walks].sort((a, b) => {
    const [outA, unitsA] = per(a);
    const [outB, unitsB] = per(b);
    const left = outA * unitsB;
    const right = outB * unitsA;
    return left === right ? a.index - b.index : left > right ? -1 : 1;
  });
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
      // Its whole way: no stop, the plain swap, but for a walk on into its furthest tick array.
      stops.set(pool.name, {
        ...of,
        stop: deepBits(walk.deep),
        ...(walk.deep === undefined ? {} : { deepTick: walk.deep }),
        share: whole,
      });
      return;
    }
    // The most crossings what is left pays for: held a tick inside the next.
    let n = walk.crossed.length - 1;
    while (n >= 0 && charged(pool, n) > left) n--;
    const stopTick = n < 0 ? undefined : walk.crossed[n]!;
    const limit = stopTick === undefined ? undefined : svmStopLimit(stopTick, pool.fee, pool.paysA);
    if (stopTick === undefined || limit === undefined) {
      stops.set(pool.name, { ...of, stop: svmSkipStop(pool.paysA), skipped: true, share: 0 });
      return;
    }
    const share = charged(pool, n);
    left -= share;
    // Where its price may lie when it runs: no further from the stop than now, give or take the
    // headroom's positions.
    const room = SVM_HEADROOM_TICKS * walk.spacing;
    const from = pool.paysA ? walk.tick + room : walk.tick - room;
    // Held past its window, in the furthest tick array: there it walks on.
    const deep =
      walk.deep !== undefined && (pool.paysA ? stopTick < walk.window : stopTick >= walk.window)
        ? walk.deep
        : undefined;
    stops.set(pool.name, {
      ...of,
      stop: limit | (biased(from) << 192n) | deepBits(deep),
      ...(deep === undefined ? {} : { deepTick: deep }),
      limit,
      from,
      stopTick,
      share,
    });
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

/** The stops of a cook: each swap's, by its stop's derivation (`name`), in the program's order. */
export interface SvmProgramStops {
  readonly stops: readonly SvmPoolStop[];
  /**
   * The swaps whose stop binds (held, skipped, or walked on into its furthest tick array): what to
   * compile to the Stopped form.
   */
  readonly binding: readonly string[];
  /** The units the venues' programs were given between them. */
  readonly budget: number;
  /** The cook's own units, besides the venues': the cost table's, or a simulation's. */
  readonly fixed: { readonly units: number; readonly measured: boolean };
  /** The units of `SVM_HEADROOM_TICKS` more crossings at every pool that trades. */
  readonly headroom: number;
  /**
   * A swap whose runs no stop can be worked out for, where there is one: how the program names its
   * pool, and its loop's count where the loop writes one out (null where it does not). Either that
   * count is a value, or it is more than the cook's own units pay for, so the program leaves the loop
   * sooner; both ways the swap runs a number of times known only as the cook runs, what it leaves
   * the others cannot be worked out, and no swap is held. `stops` is then empty.
   */
  readonly unbounded?: { readonly label: string; readonly runs: number | null };
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

/**
 * The stops of `program`'s swaps at a price, read through `load` from the accounts the cook resolved
 * (`accounts`, by `main`'s parameter), with main's `Uint256` arguments by name (`integers`), for a
 * limit a swap takes from one. `fixed` is the cook's own units where a simulation measured them;
 * `scale` shrinks what the venues are given, for a cook that ran out of units anyway. A swap in a
 * loop is charged for each time the loop runs it (`stoppableRuns`); where a loop does not write its
 * count out, or writes one that swap's runs alone cannot pay for, none is held (`unbounded`).
 * Undefined for a program with no stops.
 */
export async function svmProgramStops(
  program: Pick<CompiledSauceProgram, "stoppable" | "stoppableRuns" | "derivedAccounts">,
  chain: CanonicalChain,
  accounts: Readonly<Record<string, string>>,
  integers: Readonly<Record<string, bigint>>,
  load: OwnedAccountLoader,
  fixed?: number,
  scale = 1,
): Promise<SvmProgramStops | undefined> {
  // Each swap that runs, with how many times: once outside a loop, never in a loop that never does.
  const runsOf = (derive: string): number | null =>
    program.stoppableRuns !== undefined && Object.hasOwn(program.stoppableRuns, derive)
      ? program.stoppableRuns[derive]!
      : 1;
  const values = (program.stoppable ?? [])
    .map((derive) => ({ name: derive, derive, runs: runsOf(derive) }))
    .filter((value) => value.runs !== 0);
  if (values.length === 0) return undefined;
  const derived = Object.entries(program.derivedAccounts ?? {});
  /** The account the cook gives the part `name` of the slot of `pool` paying `token`. */
  const part = (pool: string, token: string, name: string): string | undefined => {
    const at = derived.find(([, derive]) => derive === `slot:${pool}:${token}.${name}`)?.[0];
    return at === undefined ? undefined : accounts[at];
  };
  /** No stop for any swap, for `value`'s runs. */
  const unbounded = (value: (typeof values)[number]): SvmProgramStops => {
    const [, pool, token] = value.derive.split(":") as [string, string, string];
    return {
      stops: [],
      binding: [],
      budget: 0,
      fixed: { units: fixed ?? 0, measured: fixed !== undefined },
      headroom: 0,
      unbounded: {
        label: labelOf(pool, (part(pool, token, "pool") ?? "") as Address),
        runs: value.runs,
      },
    };
  };
  const uncounted = values.find((value) => value.runs === null);
  if (uncounted !== undefined) return unbounded(uncounted);
  const rows = svmTokenRows(chain);
  const cluster = svmClusterOf(chain);
  const venues = cluster === undefined ? [] : svmPriceLimitVenues(cluster);
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
    }
  >();
  for (const value of values) {
    // `stop:<pool>:<token>:<limit>`, a second swap of the same three numbered after a `#`.
    const [, pool, token, written = ""] = value.derive.split(":") as [
      string,
      string,
      string,
      string?,
    ];
    const limit = written.replace(/#\d+$/, "");
    const program = part(pool, token, "program");
    const address = part(pool, token, "pool") as Address | undefined;
    const venue = venues.find((one) => one.program === program);
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
    const fee = feeOf(layout, account, await data(part(pool, token, "config")));
    const arrays = await Promise.all(
      ["ticks0", "ticks1", "ticks2"].map((name) => data(part(pool, token, name))),
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
      ...(value.runs === 1 ? {} : { runs: value.runs! }),
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
    });
  }
  // What the cook spends on a swap each time it runs, besides its venue's program, by the cost table:
  // one that trades more than one whose pool the router reads and leaves, and that more than a key
  // with no pool.
  const each = (value: (typeof values)[number]): number => {
    const pool = pools.find((one) => one.name === value.name);
    return pool === undefined
      ? SVM_SWAP_SKIPPED
      : svmPoolWalk(pool).none === true
        ? SVM_SWAP_IDLE
        : SVM_SWAP_FIXED;
  };
  // A loop's count that the cook cannot pay for, that swap's runs alone: the program leaves the loop
  // sooner (a `break`, a `return`), at a point known only as it runs.
  const unpaid = values.find(
    (value) => value.runs! > 1 && SVM_COOK_FIXED + each(value) * value.runs! > SVM_COOK_UNITS,
  );
  if (unpaid !== undefined) return unbounded(unpaid);
  // The cook's own units: as a simulation measured them, else the cost table's, each swap's as many
  // times as it runs.
  const units =
    fixed ?? values.reduce((sum, value) => sum + each(value) * value.runs!, SVM_COOK_FIXED);
  const budget = Math.max(0, Math.floor((SVM_COOK_UNITS - units) * scale));
  const computed = new Map(svmComputeStops(pools, budget).map((stop) => [stop.name, stop]));
  const stops: SvmPoolStop[] = [];
  for (const value of values) {
    const stop = computed.get(value.name);
    const pool = seen.get(value.name);
    if (stop === undefined || pool === undefined) continue;
    const { decimals, ...shown } = pool;
    stops.push({
      ...stop,
      ...shown,
      ...(stop.limit === undefined
        ? {}
        : {
            stopPrice: significant(
              stop.limit * 10n ** BigInt(decimals[1]),
              E18 * 10n ** BigInt(decimals[0]),
            ),
          }),
    });
  }

  return {
    stops,
    binding: stops.filter((stop) => stop.stop !== 0n).map((stop) => stop.name),
    budget,
    fixed: { units, measured: fixed !== undefined },
    headroom: pools
      .filter((pool) => (computed.get(pool.name)?.share ?? 0) > 0)
      .reduce((sum, pool) => sum + svmSwapCost(pool.program).tick * SVM_HEADROOM_TICKS, 0),
  };
}

/**
 * The values a program compiled with `stops.binding` takes after its own arguments, one for each of
 * its `derivedValues`: each held swap's stop.
 */
export function svmStopValues(
  stops: SvmProgramStops | undefined,
  program: Pick<CompiledSauceProgram, "derivedValues">,
): bigint[] {
  const of = new Map((stops?.stops ?? []).map((stop) => [stop.name, stop.stop]));
  return (program.derivedValues ?? []).map((value) => of.get(value.derive) ?? 0n);
}
