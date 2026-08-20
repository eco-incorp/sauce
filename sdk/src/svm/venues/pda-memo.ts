/**
 * Process-lifetime memo of Solana Program Derived Address DERIVATION ONLY —
 * (programAddress, seeds) -> address. NEVER a cache of account STATE.
 *
 * WHY THIS IS SAFE: a PDA is a mathematical constant of its (programAddress,
 * seeds) tuple — `getProgramDerivedAddress` (@solana/kit / @solana/addresses)
 * is a PURE function: same inputs always produce the same address + bump,
 * forever, for a given program. Caching that computation carries zero
 * staleness risk because there is no "live" version of a derivation to go
 * stale against. Every consumer of a memoized address still re-reads the
 * ACCOUNT's live bytes (liquidity, sqrtPrice, tick-array bytes, the
 * initialized flag, …) via its own `AccountLoader` on every call — this
 * module never touches account data and is never itself a state read. A
 * window-dependent seed (a tick-array/bin-array start index) is derived from
 * the pool's LIVE spot on every call, so when the spot moves and the window
 * shifts, the seed — and therefore the memo key — changes: a shifted window
 * always produces a fresh miss and the correct new address, never a stale hit.
 *
 * VALUE — CPU/throughput, not single-quote latency. `getProgramDerivedAddress`
 * is CPU-bound: it walks bump seeds 255→0 hashing SHA-256 over the seed bytes
 * and does a synchronous on-curve check (a bigint mulmod ladder,
 * `pow_2_252_3` in `@solana/addresses`) on the MAIN, SINGLE event-loop
 * thread. Under N concurrent warm quotes those checks fully serialize —
 * memoizing frees main-thread CPU proportional to N and raises the QPS a pod
 * sustains before the event loop saturates; it does not shorten one isolated
 * quote's own wall-clock time (which is network-bound on RPC round-trips).
 *
 * SCOPE — derivation memoized, addresses ONLY, across every CLMM/DLMM family
 * that routes its tick-array/bin-array/per-tick PDA derivation through
 * {@link memoizedGetProgramDerivedAddress} below (raydium-clmm, orca-whirlpool,
 * pancakeswap-clmm, stabble-clmm, cropper, byreal, defituna, crema, invariant,
 * meteora-dlmm, saros-dlmm). The memo key is derived INTERNALLY from
 * `(programAddress, seeds)` — never supplied by the caller — so two families
 * that happen to share an identical seed SHAPE (e.g. pancakeswap-clmm/
 * stabble-clmm/byreal reuse raydium-clmm's `['tick_array', pool, startTick
 * BE i32]` shape; cropper/defituna reuse orca-whirlpool's ASCII-encoded
 * shape) under DISTINCT program ids can never collide: the program id is
 * part of the key by construction, not by caller discipline.
 */
import { getProgramDerivedAddress } from '@solana/kit';
import type { Address } from '@solana/kit';

export interface PdaMemoStats {
  hits: number;
  misses: number;
}

/**
 * Belt-and-suspenders cap on the memo's size — the real steady-state
 * population is a small, bounded set of distinct (program, pool, window)
 * tick-array/bin-array keys plus one oracle/bitmap/tick-array-map key per
 * pool (tens of entries per actively-traded pool, across all eleven
 * families), so this ceiling is never expected to bind in practice.
 */
const DEFAULT_MAX_ENTRIES = 100_000;
let maxEntries = DEFAULT_MAX_ENTRIES;

const memo = new Map<string, Address>();
let hits = 0;
let misses = 0;

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX_TABLE[bytes[i]];
  return out;
}

/**
 * Derive the memo key from the EXACT tuple being derived: the program address
 * plus every seed, each seed hex-encoded and joined with a `|` separator.
 * Every seed is a `Uint8Array` (the type below enforces it — no `string`
 * overload), so the key is provably 1:1 with `(programAddress, seeds)`: hex
 * never emits `|`, so the separator unambiguously delimits seed boundaries
 * (`[[0x01],[0x02]]` → `01|02` can never equal `[[0x01,0x02]]` → `0102`), and
 * there is no string/byte domain to alias (`"ab"` vs `[0xab]` cannot both
 * occur). No caller ever supplies or influences the key, so no venue can
 * accidentally alias another venue's cached address.
 */
function memoKey(programAddress: Address, seeds: readonly Uint8Array[]): string {
  let key = programAddress as string;
  for (const seed of seeds) {
    key += '|';
    key += toHex(seed);
  }
  return key;
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
export async function memoizedGetProgramDerivedAddress(
  programAddress: Address,
  seeds: readonly Uint8Array[],
): Promise<Address> {
  const key = memoKey(programAddress, seeds);
  const cached = memo.get(key);
  if (cached !== undefined) {
    hits += 1;
    // Refresh recency: delete + re-set moves this key to the END of the
    // Map's iteration order, so eviction below always removes the entry that
    // has gone longest without a hit.
    memo.delete(key);
    memo.set(key, cached);
    return cached;
  }
  misses += 1;
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds: seeds as Uint8Array[] });
  if (memo.size >= maxEntries) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, derived);
  return derived;
}

/** TEST/OBSERVABILITY SEAM: cumulative hit/miss counts since process start or the last reset. */
export function __pdaMemoStats(): PdaMemoStats {
  return { hits, misses };
}

/** TEST SEAM: current entry count, for asserting LRU eviction. */
export function __pdaMemoSize(): number {
  return memo.size;
}

/**
 * TEST SEAM: shrink the LRU cap so eviction is reachable in a unit test
 * without inserting 100k entries. `__resetPdaMemoForTest` restores the default.
 */
export function __setMaxEntriesForTest(n: number): void {
  maxEntries = n;
}

/** TEST SEAM: drop the memo, zero the counters, and restore the default cap. */
export function __resetPdaMemoForTest(): void {
  memo.clear();
  hits = 0;
  misses = 0;
  maxEntries = DEFAULT_MAX_ENTRIES;
}
