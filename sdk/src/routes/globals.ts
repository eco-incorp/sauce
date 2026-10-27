/**
 * OPT-IN installation of the chain accessors (plus the `chain` front door and
 * the universal `Token` interface) onto `globalThis`, or onto any other
 * target object.
 *
 * NOTHING HERE RUNS UNLESS A HOST CALLS IT. The SDK's TypeScript surface is
 * imports only -- `import { Base, Solana } from "@eco-incorp/sauce"` (see
 * `./chain-exports.generated.ts`). Globals are a SauceScript concept: names
 * resolved at COMPILE time inside a route body, scoped to the destination
 * chain (`USDC`, `Uniswap` -- `./source-globals.generated.ts`), which install
 * no JavaScript values at all. This module is the escape hatch for a host
 * that deliberately wants the bare-name spelling at RUN time, and it is the
 * only thing in the SDK that touches `globalThis`.
 *
 * It installs values, not types: there is no ambient `declare global` block
 * to match any more, so a host that calls this declares the names itself.
 *
 * Registry-derived by construction: it enumerates `composedChainGlobals()`
 * (itself generated from `../chains/canonical.js`), so adding a chain to
 * `CANONICAL_CHAINS` adds an installable name with no code change here.
 *
 * Never clobbers a name already present on the target -- see
 * `installRouteGlobals` below.
 */
import { chain } from "./accessors.js";
import { composedChainGlobals } from "./composed.js";
// The universal token interface, installable as a bare name: `Token.transfer(...)`. A
// single, non-chain entry -- see InstallRouteGlobalsOptions.includeToken below.
import { Token } from "../token/api.js";

export interface RouteGlobalsReport {
  /** Names this call actually defined. */
  readonly installed: readonly string[];
  /** Names already present on the target -- left untouched, never clobbered. */
  readonly skipped: readonly string[];
}

export interface InstallRouteGlobalsOptions {
  /** Defaults to `globalThis`. */
  readonly target?: object;
  /** Whether to also install the `chain(ref)` front door. Defaults to `true`. */
  readonly includeChain?: boolean;
  /** Whether to also install the universal `Token` global. Defaults to `true`. */
  readonly includeToken?: boolean;
}

/** Names this module itself has defined so far, across calls -- lets
 * `installRouteGlobals` treat a re-install as idempotent (not self-skipping
 * its own prior work) and lets `uninstallRouteGlobals` know exactly what to
 * remove without guessing at what a consumer already had. */
const owned = new Set<string>();

const EMPTY_REPORT: RouteGlobalsReport = { installed: [], skipped: [] };
let lastReport: RouteGlobalsReport = EMPTY_REPORT;

/**
 * Installs every chain accessor (PascalCase-keyed, e.g. `Base`, `Solana`)
 * plus, by default, `chain` and `Token` onto `target` (default `globalThis`).
 *
 * Never overwrites a name already present: uses the `in` operator (not an
 * `undefined` check), so an inherited or getter-only property on the target
 * still counts as "taken" and is skipped, not clobbered. Every installed
 * property is `enumerable: false` (so ~40 names don't show up in
 * `Object.keys(globalThis)`/`for...in`) and `configurable: true` (so
 * `uninstallRouteGlobals` can genuinely remove it).
 *
 * The chain values are the SAME objects the named exports hand out
 * (`Base === globalThis.Base` after this call) -- composition is memoised in
 * `./composed.js`.
 */
export function installRouteGlobals(opts: InstallRouteGlobalsOptions = {}): RouteGlobalsReport {
  const target = (opts.target ?? globalThis) as Record<string, unknown>;
  const entries: [string, unknown][] = Object.entries(composedChainGlobals());
  if (opts.includeChain !== false) entries.push(["chain", chain]);
  if (opts.includeToken !== false) entries.push(["Token", Token]);

  const installed: string[] = [];
  const skipped: string[] = [];
  for (const [name, value] of entries) {
    if (name in target && !owned.has(name)) {
      skipped.push(name);
      continue;
    }
    Object.defineProperty(target, name, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    owned.add(name);
    installed.push(name);
  }
  lastReport = { installed, skipped };
  return lastReport;
}

/** Removes every name this module has installed (across all calls) from
 * `target` (default `globalThis`) and clears the internal bookkeeping, so a
 * later `installRouteGlobals()` reinstalls cleanly rather than skipping. */
export function uninstallRouteGlobals(target: object = globalThis): void {
  const rec = target as Record<string, unknown>;
  for (const name of owned) {
    delete rec[name];
  }
  owned.clear();
  lastReport = EMPTY_REPORT;
}

/**
 * The most recent `installRouteGlobals()` result -- EMPTY until a host calls
 * it, because importing the SDK installs nothing. A live view rather than a
 * frozen snapshot, so it can never claim an install that has since been
 * undone; `uninstallRouteGlobals()` resets it.
 */
export const routeGlobals: RouteGlobalsReport = {
  get installed(): readonly string[] {
    return lastReport.installed;
  },
  get skipped(): readonly string[] {
    return lastReport.skipped;
  },
};
