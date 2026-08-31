/**
 * Chain-global surface machinery: every canonical chain global is BOTH
 * callable (`Base(sauce, opts)`) and a namespace carrying `.chain` and
 * `.route` (the same callable, `Base.route === Base`'s own behavior).
 *
 * `ChainRoute`/`ChainGlobal` are ONE interface hierarchy — `ChainGlobal
 * extends ChainRoute`, so the call signature and `.route` can never drift
 * apart (see `sdk/test/routes-globals-ambient-types.test.ts`'s type-level pin).
 *
 * `ChainRef`/`CanonicalChain` now come straight from `../chains/canonical.js`
 * (which additionally accepts `bigint`) rather than a narrower copy kept
 * here — re-exported below so the public name survives at this import path.
 */
import type { CanonicalChain, ChainRef, ChainSlug } from "../chains/canonical.js";
import type { IntentOptions, PendingSauceRoute, SauceBody } from "./intent-dsl.js";
export type { ChainRef };
/**
 * `PascalOf<"bnb-chain">` = `"BnbChain"`. Matches the runtime `pascal()`
 * derivation in `accessors.ts` by construction (both reduce to
 * `Capitalize<S>` composed across `-`-separated segments) -- re-exported from
 * `accessors.ts` so callers only need one import site.
 */
export type PascalOf<S extends string> = S extends `${infer H}-${infer T}` ? `${Capitalize<H>}${PascalOf<T>}` : Capitalize<S>;
/** The call signature: `Chain(sauce, options)` -> a pending route awaiting `.reward(...)`. */
export interface ChainRoute {
    (sauce: SauceBody, options?: IntentOptions): PendingSauceRoute;
}
/** A chain global: callable (the SAME behavior as `.route`), plus `.chain`/`.route`. */
export interface ChainGlobal extends ChainRoute {
    /** The registry record this global was generated from (or resolved via `chain(ref)`). */
    readonly chain: CanonicalChain;
    /** The SAME interface as the call signature -- `Base.route === Base` in behavior, by construction. */
    readonly route: ChainRoute;
}
/** One generated `ChainGlobal` per canonical chain slug, PascalCase-keyed. */
export type ChainGlobals = {
    readonly [S in ChainSlug as PascalOf<S>]: ChainGlobal;
};
/** Function intrinsics a namespace/contract-accessor key must never collide with -- see
 *  `globals.ts#composeChainGlobal`'s own, wider denylist for the composed (installed) global. */
declare const FUNCTION_INTRINSICS: ReadonlySet<string>;
/**
 * Builds the callable `ChainGlobal` for `chain` -- what a generated global
 * (`Base`) or `chain(ref)` returns. An ARROW function (no own `prototype` to
 * collide with) forwarding to `openRoute`, with `chain`/`route` defined onto
 * it as enumerable so `Object.keys(chainAccessors.Base)` stays exactly
 * `["chain","route"]`.
 */
export declare function makeChainGlobal(chain: CanonicalChain): ChainGlobal;
/**
 * Generates the top-level chain globals from `../chains/canonical.js` --
 * adding a chain to `CANONICAL_CHAINS` adds a global here with zero code
 * changes; a duplicate PascalCase key (two slugs colliding after casing)
 * throws at module-eval time rather than silently overwriting one with
 * another.
 */
export declare function createChainGlobals(): ChainGlobals;
/**
 * `PascalOf`'s runtime mirror: split on `-`, upper-case each segment's first
 * character, join. Agrees with the type-level `PascalOf` by construction
 * (both reduce to `Capitalize<S>` per `-`-separated segment) as long as a
 * slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` -- pinned by
 * `chains-canonical.test.ts`.
 */
export declare function pascalOfSlug(slug: string): string;
export { FUNCTION_INTRINSICS };
//# sourceMappingURL=builder.d.ts.map