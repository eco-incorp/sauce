/**
 * Chain-global surface machinery: every canonical chain export is a namespace carrying `.chain`
 * (its registry record).
 *
 * `ChainRef`/`CanonicalChain` come straight from `../chains/canonical.js` (which additionally
 * accepts `bigint`), re-exported below so the public name survives at this import path.
 */
import type { CanonicalChain, ChainRef, ChainSlug } from "../chains/canonical.js";
import { canonicalChains } from "../chains/canonical.js";
import { pascalOfSlug, type PascalOf } from "./pascal.js";

export type { ChainRef, PascalOf };
export { pascalOfSlug };

/** A chain export: `.chain`. */
export interface ChainGlobal {
  /** The registry record this export was generated from (or resolved via `chain(ref)`). */
  readonly chain: CanonicalChain;
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
]);

/**
 * Builds the `ChainGlobal` for `chain` -- what a generated export (`Base`) or `chain(ref)` returns:
 * `chain`, enumerable, so `Object.keys(chainAccessors.Base)` is exactly `["chain"]`.
 */
export function makeChainGlobal(chain: CanonicalChain): ChainGlobal {
  return Object.defineProperties({} as ChainGlobal, {
    chain: { value: chain, enumerable: true, configurable: false, writable: false },
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

// Re-exported so a caller checking for a hard denylist elsewhere (globals.ts)
// can extend, rather than re-derive, this list.
export { FUNCTION_INTRINSICS };
