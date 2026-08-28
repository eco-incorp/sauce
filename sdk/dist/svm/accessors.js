import { pascalOfSlug } from '../routes/builder.js';
import { listVenues, venueAdapter } from './venues/registry.js';
function buildVenueAccessor(adapter) {
    return {
        slug: adapter.slug,
        kind: adapter.kind,
        programId: adapter.programId,
        adapter,
        poolConfig: (load, pool) => adapter.fetchPoolConfig(load, pool),
        quoteAccounts: (cfg) => adapter.quoteAccounts(cfg),
        quoteSource: (cfg, i, amountIn) => adapter.emitQuote(cfg, i, amountIn),
        swap: (cfg, user, amountIn) => adapter.buildSwap(cfg, user, amountIn),
        referenceQuote: (cfg, state, amountIn, now) => adapter.referenceQuote(cfg, state, amountIn, now),
    };
}
/**
 * Import-based front door: `venue('raydium-cp-swap').swap(...)` — the
 * analogue of `descriptors/accessors.ts`'s `on(chainRef)`, for
 * `__ECO_ROUTES_NO_GLOBALS__` hosts and the TS2451 own-`const Solana` caveat.
 */
export function venue(slug) {
    return buildVenueAccessor(venueAdapter(slug));
}
/**
 * The lazy, memoising tree the `Solana` global composes (see
 * ../routes/globals.ts). Builds zero adapter wrappers until a namespace is
 * actually touched; two reads of the same namespace off one `venues()` call
 * return the identical object.
 */
export function venues() {
    const out = {};
    for (const slug of listVenues()) {
        const key = pascalOfSlug(slug);
        if (key in out) {
            throw new Error(`svm/accessors: duplicate venue namespace '${key}' (from slug '${slug}')`);
        }
        let memo;
        Object.defineProperty(out, key, {
            enumerable: true,
            configurable: true,
            get() {
                if (memo === undefined)
                    memo = buildVenueAccessor(venueAdapter(slug));
                return memo;
            },
        });
    }
    return out;
}
//# sourceMappingURL=accessors.js.map