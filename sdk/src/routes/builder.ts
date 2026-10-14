/**
 * Chain-global surface machinery: every canonical chain export is a namespace carrying `.chain`
 * (its registry record). Calling one, or its `.route`, opened an intent; opening an intent is coming
 * soon (`coming-soon.ts`), so each refuses with that.
 *
 * `ChainRef`/`CanonicalChain` come straight from `../chains/canonical.js` (which additionally
 * accepts `bigint`), re-exported below so the public name survives at this import path.
 */
import type { CanonicalChain, ChainRef, ChainSlug } from "../chains/canonical.js";
import { canonicalChains } from "../chains/canonical.js";
import { chainCallComingSoon } from "./coming-soon.js";

export type { ChainRef };

/**
 * `PascalOf<"bnb-chain">` = `"BnbChain"`. Matches the runtime `pascal()`
 * derivation in `accessors.ts` by construction (both reduce to
 * `Capitalize<S>` composed across `-`-separated segments) -- re-exported from
 * `accessors.ts` so callers only need one import site.
 */
export type PascalOf<S extends string> = S extends `${infer H}-${infer T}`
  ? `${Capitalize<H>}${PascalOf<T>}`
  : Capitalize<S>;

/** Calling a chain export, or its `.route`: what opened an intent. */
export interface ChainRoute {
  /**
   * @deprecated Opening an intent is coming soon, written
   *   `<Chain>.hop({ send, receive, refundee }).then(() => { … })`. Throws
   *   `IntentsComingSoonError`.
   */
  (...args: unknown[]): never;
}

/** A chain export: `.chain`. Calling it, or `.route`, throws `IntentsComingSoonError`. */
export interface ChainGlobal extends ChainRoute {
  /** The registry record this export was generated from (or resolved via `chain(ref)`). */
  readonly chain: CanonicalChain;
  /**
   * @deprecated Opening an intent is coming soon, written
   *   `<Chain>.hop({ send, receive, refundee }).then(() => { … })`. Throws
   *   `IntentsComingSoonError`.
   */
  readonly route: ChainRoute;
}

/** One generated `ChainGlobal` per canonical chain slug, PascalCase-keyed. */
export type ChainGlobals = {
  readonly [S in ChainSlug as PascalOf<S>]: ChainGlobal;
};

/** Function intrinsics a namespace/contract-accessor key must never collide with -- see
 *  `globals.ts#composeChainGlobal`'s own, wider denylist for the composed (installed) global. */
const FUNCTION_INTRINSICS: ReadonlySet<string> = new Set([
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
 * Builds the `ChainGlobal` for `chain` -- what a generated export (`Base`) or `chain(ref)` returns:
 * `chain`, enumerable, so `Object.keys(chainAccessors.Base)` is exactly `["chain"]`, and an ARROW
 * function (no own `prototype`) whose call, like its non-enumerable `route`, refuses.
 */
export function makeChainGlobal(chain: CanonicalChain): ChainGlobal {
  const name = pascalOfSlug(chain.slug);
  const route: ChainRoute = () => chainCallComingSoon(name, "route");
  const call = (() => chainCallComingSoon(name)) as unknown as ChainGlobal;

  return Object.defineProperties(call, {
    chain: { value: chain, enumerable: true, configurable: false, writable: false },
    route: { value: route, enumerable: false, configurable: false, writable: false },
  });
}

/**
 * Generates the top-level chain globals from `../chains/canonical.js` --
 * adding a chain to `CANONICAL_CHAINS` adds a global here with zero code
 * changes; a duplicate PascalCase key (two slugs colliding after casing)
 * throws at module-eval time rather than silently overwriting one with
 * another.
 */
export function createChainGlobals(): ChainGlobals {
  const out: Record<string, ChainGlobal> = {};
  for (const c of canonicalChains) {
    const key = pascalOfSlug(c.slug);
    if (key in out) {
      throw new Error(`duplicate chain global '${key}' (from slug '${c.slug}')`);
    }
    out[key] = makeChainGlobal(c);
  }
  return out as ChainGlobals;
}

// --- shared slug/pascal helpers (also used by accessors.ts, descriptors/accessors.ts, svm/accessors.ts) ---

/**
 * `PascalOf`'s runtime mirror: split on `-`, upper-case each segment's first
 * character, join. Agrees with the type-level `PascalOf` by construction
 * (both reduce to `Capitalize<S>` per `-`-separated segment) as long as a
 * slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` -- pinned by
 * `chains-canonical.test.ts`.
 */
export function pascalOfSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

// Re-exported so a caller checking for a hard denylist elsewhere (globals.ts)
// can extend, rather than re-derive, this list.
export { FUNCTION_INTRINSICS };
