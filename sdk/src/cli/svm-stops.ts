/**
 * The `sauce` command's side of a Solana swap at a price's stop (`svm/compute-stops.ts`): the values
 * the venue namespaces added to `main` (`program.derivedValues`, `stop:<pool>:<token>:<limit>`),
 * worked out from the pools the cook's slots name as the cook is built, and how a command shows
 * them. `sauce tx` takes them from the cost table; `sauce simulate` and `sauce run` check them in a
 * simulation, and tighten them where the cook still runs out of compute units.
 */
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import type { CompiledSauceProgram } from "../routes/sauce-route.js";
import { svmTokenRows } from "../routes/token-registry.js";
import {
  SVM_COOK_FIXED,
  SVM_COOK_UNITS,
  SVM_SWAP_COSTS,
  SVM_SWAP_FIXED,
  SVM_SWAP_IDLE,
  SVM_SWAP_SKIPPED,
  svmComputeStops,
  svmPoolWalk,
  type SvmComputeStop,
  type SvmStopLayout,
  type SvmStopPool,
} from "../svm/compute-stops.js";
import { SVM_CLMM_LAYOUT, SVM_PRICE_LIMIT_VENUES } from "../svm/pool-slot.js";
import { raydiumSqrtPriceAtTick } from "../svm/venues/raydium-clmm/tick-math.js";
import type { OwnedAccountLoader } from "../svm/venues/types.js";
import { significant } from "./pools.js";

/** A pool's stop, with what a person reads of it. */
export interface SvmStopShown extends SvmComputeStop {
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
export interface SvmStops {
  readonly values: readonly bigint[];
  readonly stops: readonly SvmStopShown[];
  /** The units the venues' programs were given between them. */
  readonly budget: number;
  /** The cook's own units, besides the venues': the cost table's, or a simulation's. */
  readonly fixed: { readonly units: number; readonly measured: boolean };
}

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const E18 = 10n ** 18n;
const Q128 = 1n << 128n;

const le = (data: Uint8Array, at: number, width: number): bigint => {
  let value = 0n;
  for (let i = width - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[at + i] ?? 0);
  return value;
};

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
export async function svmStopsOf(
  program: Pick<CompiledSauceProgram, "derivedValues" | "derivedAccounts">,
  chain: CanonicalChain,
  accounts: Readonly<Record<string, string>>,
  integers: Readonly<Record<string, bigint>>,
  load: OwnedAccountLoader,
  fixed?: number,
  scale = 1,
): Promise<SvmStops | undefined> {
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
    Pick<SvmStopShown, "pool" | "label" | "venue" | "pay" | "buy"> & {
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
  const stops: SvmStopShown[] = [];
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

/**
 * The units a simulated cook spent besides its venues' programs, from its total and its log: what
 * the stops are worked out against once a simulation has measured it.
 */
export function svmCookFixedUnits(total: bigint | number, logs: readonly string[]): number {
  let venues = 0;
  for (const line of logs) {
    const match = /^Program (\S+) consumed (\d+) of \d+ compute units$/.exec(line);
    if (match !== null && Object.hasOwn(SVM_SWAP_COSTS, match[1]!)) venues += Number(match[2]);
  }

  return Math.max(0, Number(total) - venues);
}

/** Whether a simulated cook ran out of compute units. */
export const svmRanOutOfUnits = (logs: readonly string[]): boolean =>
  logs.some((line) =>
    /exceeded CUs meter|exceeded maximum compute|ComputationalBudgetExceeded/.test(line),
  );

const grouped = (units: number): string => units.toLocaleString("en-US");

/** A line for each pool a stop holds or skips: what a person reads. */
export function svmStopLines(stops: SvmStops): string[] {
  return stops.stops.flatMap((stop) => {
    if (stop.stop === 1n) {
      return [
        `${stop.label} is skipped: the deeper pools leave too few compute units for its swap ` +
          `(about ${grouped(stop.estimatedUnits)} to its limit, ${stop.ticksToLimit} initialized ` +
          "ticks)",
      ];
    }
    if (stop.stopTick === undefined) return [];
    return [
      `${stop.label} stops at ${stop.stopPrice} ${stop.pay} per ${stop.buy}, short of its limit: ` +
        `reaching it would cross ${stop.ticksToLimit} initialized ticks, about ` +
        `${grouped(stop.estimatedUnits)} compute units, past its share of ${grouped(stop.share)}`,
    ];
  });
}

/** The stops as `--json` and the MCP server give them. */
export function svmStopsJson(stops: SvmStops): Record<string, unknown> {
  return {
    computeStops: stops.stops.map((stop) => ({
      pool: stop.pool,
      label: stop.label,
      venue: stop.venue,
      stop: stop.stop.toString(),
      held: stop.stopTick !== undefined,
      skipped: stop.stop === 1n,
      ...(stop.stopTick === undefined ? {} : { stopTick: stop.stopTick }),
      ...(stop.stopPrice === undefined ? {} : { stopPrice: stop.stopPrice }),
      ticksToLimit: stop.ticksToLimit,
      estimatedUnits: stop.estimatedUnits,
      share: stop.share,
      rank: stop.rank,
    })),
    computeBudget: {
      venues: stops.budget,
      cook: stops.fixed.units,
      measured: stops.fixed.measured,
    },
  };
}
