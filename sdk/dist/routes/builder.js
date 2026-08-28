import { canonicalChains, requireChain } from "../chains/canonical.js";
/** Builds the immutable `ChainStage` standing on `chain`, having accumulated `legs` so far. */
function makeChainStage(chain, legs, assemble) {
    return {
        chain,
        route(reward) {
            return makePendingLeg(chain, legs, reward, assemble);
        },
        build() {
            return legs.slice();
        },
        [Symbol.iterator]() {
            return legs.slice()[Symbol.iterator]();
        },
    };
}
/** Builds the immutable `PendingLeg` open from `source`, awaiting a destination. */
function makePendingLeg(source, legs, reward, assemble) {
    function closeTo(ref, route) {
        const destination = requireChain(ref);
        const intent = assemble(source, destination, route, reward);
        const nextLegs = [...legs, intent];
        if (route === undefined) {
            return nextLegs;
        }
        return makeChainStage(destination, nextLegs, assemble);
    }
    const pending = {
        to: closeTo,
    };
    for (const c of canonicalChains) {
        const key = pascalOfSlug(c.slug);
        pending[key] = (route) => (route === undefined ? closeTo(c) : closeTo(c, route));
    }
    return pending;
}
/**
 * Builds the top-level `ChainOrigin` for `chain` -- what a generated
 * accessor (`chainAccessors.Base`) or `chain(ref)` returns.
 */
export function makeChainOrigin(chain, assemble) {
    return {
        chain,
        route(reward) {
            return makePendingLeg(chain, [], reward, assemble);
        },
    };
}
/**
 * Generates the top-level chain accessors from `../chains/canonical.js`,
 * parameterized by `assemble` -- the v3-swappable seam. Adding a chain to
 * `CANONICAL_CHAINS` adds an accessor here with zero code changes; a
 * duplicate PascalCase key (two slugs colliding after casing) throws at
 * module-eval time rather than silently overwriting one accessor with
 * another.
 */
export function createChainAccessors(assemble) {
    const out = {};
    for (const c of canonicalChains) {
        const key = pascalOfSlug(c.slug);
        if (key in out) {
            throw new Error(`duplicate chain accessor '${key}' (from slug '${c.slug}')`);
        }
        out[key] = makeChainOrigin(c, assemble);
    }
    return out;
}
// --- shared slug/pascal helpers (also used by accessors.ts) ---
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
//# sourceMappingURL=builder.js.map