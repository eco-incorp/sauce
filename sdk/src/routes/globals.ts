/**
 * Installs the eco-routes chain accessors (and the `chain` front door) as
 * DEFAULT GLOBALS, so a consumer writes `Base(() => USDC.transfer(to, amt)).reward(reward)`
 * with zero import. Registry-derived by construction: it enumerates
 * `chainAccessors` (itself generated from `../chains/canonical.js` by
 * `createChainGlobals`), so adding a chain to `CANONICAL_CHAINS` adds a
 * global with no code change here.
 *
 * Imported for its side effect from `../index.js` -- see the comment there
 * for why that import must stay a BARE one (it is what carries the ambient
 * `declare global` block in `./globals.generated.js` into a consumer's type
 * graph, not just the runtime install).
 *
 * Reversible, in order of how much it undoes:
 *  1. `globalThis.__ECO_ROUTES_NO_GLOBALS__ = true` before importing the SDK
 *     skips the runtime install entirely (ambient types still resolve --
 *     see the module doc on `index.ts` for why that's a type-only nuisance,
 *     not a wrong program).
 *  2. `uninstallRouteGlobals()` removes whatever this module installed.
 *  3. `installRouteGlobals({ includeChain: false })` / `{ target }` re-runs
 *     with a narrower scope.
 *  4. Deleting the two lines in `../index.js` removes both the runtime
 *     install AND the ambient types together (see that file).
 *
 * Never clobbers a name already present on the target -- see
 * `installRouteGlobals` below.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { chain, chainAccessors } from "./accessors.js";
// Load-bearing for TYPES, not runtime: this bare side-effect import is what
// tsc preserves into dist/routes/globals.d.ts, which is how the ambient
// `declare global` block reaches a consumer of the built package. Do not
// "clean up" this import -- see globals.generated.ts and this file's own
// header comment above.
import "./globals.generated.js";
// E2.3: composes each chain global with its native contract accessor tree
// (`Base.Uniswap.UniversalRouter.method(...)`) alongside the existing
// eco-routes DSL (`Base.route(...)`) -- see chainContractsFor below.
import { chainContracts } from "../descriptors/accessors.js";
// The SVM twin of the above: composes the svm venue accessor tree
// (`Solana.RaydiumCpSwap.swap(...)`) onto an `svm`-kind chain global only --
// see composeChainGlobal's `origin.chain.kind === "svm"` branch below.
import { venues as svmVenueAccessors } from "../svm/accessors.js";
// The universal token interface as a DEFAULT GLOBAL: `Token.transfer(...)` with no import. A
// single, non-chain global -- see InstallRouteGlobalsOptions.includeToken below.
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

/**
 * Installs every chain accessor (PascalCase-keyed, e.g. `Base`, `Solana`)
 * plus, by default, `chain` onto `target` (default `globalThis`).
 *
 * Never overwrites a name already present: uses the `in` operator (not an
 * `undefined` check), so an inherited or getter-only property on the target
 * still counts as "taken" and is skipped, not clobbered. Every installed
 * property is `enumerable: false` (so ~40 names don't show up in
 * `Object.keys(globalThis)`/`for...in`) and `configurable: true` (so
 * `uninstallRouteGlobals` can genuinely remove it).
 */
/** Function intrinsics a contract/venue namespace key must never collide with once composed onto a
 *  CALLABLE global -- unlike the plain-object global this replaced, landing on one of these would
 *  corrupt the callable itself, not merely shadow an inert property. */
const FUNCTION_INTRINSIC_DENYLIST: ReadonlySet<string> = new Set([
  "length",
  "name",
  "prototype",
  "arguments",
  "caller",
  "bind",
  "call",
  "apply",
  "toString",
  "constructor",
]);

/**
 * Composes one chain global: a FRESH callable forwarding to `origin.route`
 * (so it stays CALLABLE — a plain object would silently drop that), plus
 * `chain`/`route` and the lazy contract-namespace tree (`Uniswap`,
 * `UniswapV4`, ...) and, for an `svm`-kind chain only, the svm venue
 * accessor tree (`RaydiumCpSwap`, `MeteoraDammV2`, ...) — copied via
 * `Object.getOwnPropertyDescriptors` (NOT spread) so every namespace's
 * memoising GETTERS stay lazy — spread would invoke every one of them
 * eagerly at install time. `origin` itself is never mutated: this returns a
 * fresh function object. Throws on a name collision (e.g. a future protocol
 * or venue slug literally named "route", "chain", or a function intrinsic
 * like "call"/"bind"), mirroring `createChainGlobals`'s own duplicate-key
 * throw. The `kind === "svm"` gate is registry-derived (from
 * `../chains/canonical.js`'s own `CanonicalChain.kind`), not a hardcoded
 * chain name -- a second SVM chain added to `CANONICAL_CHAINS` gets the
 * venue namespaces automatically, and every EVM chain provably cannot.
 */
function composeChainGlobal(
  name: string,
  origin: Record<string, unknown> & { chain: CanonicalChain; route: unknown },
): object {
  const contracts = chainContracts(origin.chain) as unknown as Record<string, unknown>;
  const sources: PropertyDescriptorMap[] = [Object.getOwnPropertyDescriptors(contracts)];
  if (origin.chain.kind === "svm") {
    const svmVenues = svmVenueAccessors() as unknown as Record<string, unknown>;
    sources.push(Object.getOwnPropertyDescriptors(svmVenues));
  }

  const fn = ((...args: unknown[]) =>
    (origin.route as (...a: unknown[]) => unknown)(...args)) as unknown as Record<string, unknown>;
  const merged: PropertyDescriptorMap = {
    chain: { value: origin.chain, enumerable: true, configurable: false, writable: false },
    route: { value: origin.route, enumerable: true, configurable: false, writable: false },
  };
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (key in merged || FUNCTION_INTRINSIC_DENYLIST.has(key)) {
        throw new Error(
          `routes/globals: contract namespace '${key}' collides with the eco-routes accessor on '${name}'`,
        );
      }
    }
    Object.assign(merged, source);
  }
  Object.defineProperties(fn, merged);
  return fn;
}

export function installRouteGlobals(opts: InstallRouteGlobalsOptions = {}): RouteGlobalsReport {
  const target = (opts.target ?? globalThis) as Record<string, unknown>;
  const entries: [string, unknown][] = Object.entries(chainAccessors).map(([name, origin]) => [
    name,
    composeChainGlobal(
      name,
      origin as unknown as Record<string, unknown> & { chain: CanonicalChain; route: unknown },
    ),
  ]);
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
  return { installed, skipped };
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
}

/**
 * Install-on-import result -- this IS the default-globals behavior. A host
 * that must not have `globalThis` mutated can opt out before the SDK is
 * ever imported: `globalThis.__ECO_ROUTES_NO_GLOBALS__ = true`.
 */
export const routeGlobals: RouteGlobalsReport = (globalThis as Record<string, unknown>)
  .__ECO_ROUTES_NO_GLOBALS__
  ? { installed: [], skipped: [] }
  : installRouteGlobals();
