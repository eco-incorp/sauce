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
/** Names this module itself has defined so far, across calls -- lets
 * `installRouteGlobals` treat a re-install as idempotent (not self-skipping
 * its own prior work) and lets `uninstallRouteGlobals` know exactly what to
 * remove without guessing at what a consumer already had. */
const owned = new Set();
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
const FUNCTION_INTRINSIC_DENYLIST = new Set([
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
function composeChainGlobal(name, origin) {
    const contracts = chainContracts(origin.chain);
    const sources = [Object.getOwnPropertyDescriptors(contracts)];
    if (origin.chain.kind === "svm") {
        const svmVenues = svmVenueAccessors();
        sources.push(Object.getOwnPropertyDescriptors(svmVenues));
    }
    const fn = ((...args) => origin.route(...args));
    const merged = {
        chain: { value: origin.chain, enumerable: true, configurable: false, writable: false },
        route: { value: origin.route, enumerable: true, configurable: false, writable: false },
    };
    for (const source of sources) {
        for (const key of Object.keys(source)) {
            if (key in merged || FUNCTION_INTRINSIC_DENYLIST.has(key)) {
                throw new Error(`routes/globals: contract namespace '${key}' collides with the eco-routes accessor on '${name}'`);
            }
        }
        Object.assign(merged, source);
    }
    Object.defineProperties(fn, merged);
    return fn;
}
export function installRouteGlobals(opts = {}) {
    const target = (opts.target ?? globalThis);
    const entries = Object.entries(chainAccessors).map(([name, origin]) => [
        name,
        composeChainGlobal(name, origin),
    ]);
    if (opts.includeChain !== false)
        entries.push(["chain", chain]);
    if (opts.includeToken !== false)
        entries.push(["Token", Token]);
    const installed = [];
    const skipped = [];
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
export function uninstallRouteGlobals(target = globalThis) {
    const rec = target;
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
export const routeGlobals = globalThis
    .__ECO_ROUTES_NO_GLOBALS__
    ? { installed: [], skipped: [] }
    : installRouteGlobals();
//# sourceMappingURL=globals.js.map