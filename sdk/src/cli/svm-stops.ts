/**
 * The `sauce` command's side of a Solana swap at a price's stop (`svm/compute-stops.ts`): the values
 * the venue namespaces added to `main` (`program.derivedValues`, `stop:<pool>:<token>:<limit>`),
 * worked out from the pools the cook's slots name as the cook is built, and how a command shows
 * them. `sauce tx` takes them from the cost table; `sauce simulate` and `sauce run` check them in a
 * simulation, and tighten them where the cook still runs out of compute units.
 */
import { SVM_SWAP_COSTS, type SvmProgramStops as SvmStops } from "../svm/compute-stops.js";

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
        `${stop.label} is skipped: the pools ahead of it leave too few compute units for its swap ` +
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
