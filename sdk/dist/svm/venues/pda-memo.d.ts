import type { Address } from '@solana/kit';
export interface PdaMemoStats {
    hits: number;
    misses: number;
}
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
/**
 * TEST SEAM: shrink the LRU cap so eviction is reachable in a unit test
 * without inserting 100k entries. `__resetPdaMemoForTest` restores the default.
 */
export declare function __setMaxEntriesForTest(n: number): void;
/** TEST SEAM: drop the memo, zero the counters, and restore the default cap. */
export declare function __resetPdaMemoForTest(): void;
//# sourceMappingURL=pda-memo.d.ts.map