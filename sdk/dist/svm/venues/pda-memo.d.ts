import type { Address } from '@solana/kit';
export interface PdaMemoStats {
    hits: number;
    misses: number;
}
/**
 * Default belt-and-suspenders cap on the memo's size — the real steady-state
 * population is a small, bounded set of distinct (program, pool, window)
 * tick-array/bin-array keys plus one oracle/bitmap/tick-array-map key per
 * pool (tens of entries per actively-traded pool, across all eleven
 * families), so this ceiling is never expected to bind in practice. A
 * consumer running an unusually large pool universe can raise it via
 * {@link configurePdaMemo}.
 */
export declare const DEFAULT_PDA_MEMO_MAX_ENTRIES = 100000;
/**
 * Memoized `getProgramDerivedAddress`. The cache key is derived internally
 * from `(programAddress, seeds)` (see {@link memoKey}) — callers never
 * supply or influence it, so this is a drop-in replacement for the inline
 * `const [pda] = await getProgramDerivedAddress({ programAddress, seeds })`
 * pattern: same two logical inputs, same resolved `Address` out.
 *
 * Evicts the least-recently-used entry once the memo exceeds
 * {@link MAX_ENTRIES} (a `Map` re-inserted on every hit iterates in
 * least-recently-used-first order, so the first key is always the eviction
 * candidate).
 */
export declare function memoizedGetProgramDerivedAddress(programAddress: Address, seeds: readonly Uint8Array[]): Promise<Address>;
/** TEST/OBSERVABILITY SEAM: cumulative hit/miss counts since process start or the last reset. */
export declare function __pdaMemoStats(): PdaMemoStats;
/** TEST SEAM: current entry count, for asserting LRU eviction. */
export declare function __pdaMemoSize(): number;
/** Options for {@link configurePdaMemo}. */
export interface PdaMemoConfig {
    /**
     * Maximum number of `(programAddress, seeds) -> address` entries the memo
     * retains before evicting the least-recently-used one. Must be a positive
     * integer. Defaults to {@link DEFAULT_PDA_MEMO_MAX_ENTRIES} (100 000).
     */
    maxEntries: number;
}
/**
 * Tune the process-wide PDA-derivation memo. Call once at startup — the memo is
 * a single process-lifetime cache shared across every CLMM/DLMM venue family,
 * so this is global configuration, not per-call.
 *
 * A consumer whose pool universe is large enough to approach the default 100 000
 * ceiling (each entry is one small `(program, pool, window)`-shaped key) can
 * raise `maxEntries` to keep more derivations warm. Raising it is cheap — the
 * memo only grows as far as real derivations demand. LOWERING it below the
 * current population evicts the oldest entries eagerly to honor the new bound
 * immediately (correct addresses always re-derive on the next miss).
 *
 * @throws if `maxEntries` is not a positive integer.
 */
export declare function configurePdaMemo(config: PdaMemoConfig): void;
/** The memo's current maximum-entry cap (default {@link DEFAULT_PDA_MEMO_MAX_ENTRIES}). */
export declare function getPdaMemoMaxEntries(): number;
/** TEST SEAM: drop the memo, zero the counters, and restore the default cap. */
export declare function __resetPdaMemoForTest(): void;
//# sourceMappingURL=pda-memo.d.ts.map