import { canonicalChains } from "../chains/canonical.js";
import { openRoute } from "./intent-dsl.js";
/** Function intrinsics a namespace/contract-accessor key must never collide with -- see
 *  `globals.ts#composeChainGlobal`'s own, wider denylist for the composed (installed) global. */
const FUNCTION_INTRINSICS = new Set([
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
    "chain",
    "route",
]);
/**
 * Builds the callable `ChainGlobal` for `chain` -- what a generated global
 * (`Base`) or `chain(ref)` returns. An ARROW function (no own `prototype` to
 * collide with) forwarding to `openRoute`, with `chain`/`route` defined onto
 * it as enumerable so `Object.keys(chainAccessors.Base)` stays exactly
 * `["chain","route"]`.
 */
export function makeChainGlobal(chain) {
    const route = (sauce, options) => openRoute(chain, sauce, options);
    const fn = ((sauce, options) => route(sauce, options));
    Object.defineProperties(fn, {
        chain: { value: chain, enumerable: true, configurable: false, writable: false },
        route: { value: route, enumerable: true, configurable: false, writable: false },
    });
    return fn;
}
/**
 * Generates the top-level chain globals from `../chains/canonical.js` --
 * adding a chain to `CANONICAL_CHAINS` adds a global here with zero code
 * changes; a duplicate PascalCase key (two slugs colliding after casing)
 * throws at module-eval time rather than silently overwriting one with
 * another.
 */
export function createChainGlobals() {
    const out = {};
    for (const c of canonicalChains) {
        const key = pascalOfSlug(c.slug);
        if (key in out) {
            throw new Error(`duplicate chain global '${key}' (from slug '${c.slug}')`);
        }
        out[key] = makeChainGlobal(c);
    }
    return out;
}
// --- shared slug/pascal helpers (also used by accessors.ts, descriptors/accessors.ts, svm/accessors.ts) ---
/**
 * `PascalOf`'s runtime mirror: split on `-`, upper-case each segment's first
 * character, join. Agrees with the type-level `PascalOf` by construction
 * (both reduce to `Capitalize<S>` per `-`-separated segment) as long as a
 * slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` -- pinned by
 * `chains-canonical.test.ts`.
 */
export function pascalOfSlug(slug) {
    return slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}
// Re-exported so a caller checking for a hard denylist elsewhere (globals.ts)
// can extend, rather than re-derive, this list.
export { FUNCTION_INTRINSICS };
//# sourceMappingURL=builder.js.map