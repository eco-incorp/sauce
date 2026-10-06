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
 * SCOPE — derivation memoized, addresses ONLY, for EVERY program-derived
 * address the SDK computes: the venues' tick-array/bin-array/per-tick, ATA and
 * known-bump authority PDAs, the Kitchen's PDAs, the ATA prepend, the lookup
 * table `createAltWithAddresses` creates and the Portal's PDAs. Nothing outside
 * this module derives one (test/svm/no-raw-pda-derive.test.ts fails a raw
 * derivation anywhere else in `src`). The memo key is derived INTERNALLY from
 * `(programAddress, seeds)` — never supplied by the caller — so two families
 * that happen to share an identical seed SHAPE (e.g. pancakeswap-clmm/
 * stabble-clmm/byreal reuse raydium-clmm's `['tick_array', pool, startTick
 * BE i32]` shape; cropper/defituna reuse orca-whirlpool's ASCII-encoded
 * shape) under DISTINCT program ids can never collide: the program id is
 * part of the key by construction, not by caller discipline.
 */
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  isOffCurveAddress,
} from "@solana/kit";
import type { Address, ProgramDerivedAddress, ReadonlyUint8Array } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { sha256 } from "../../bytes.js";

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
export const DEFAULT_PDA_MEMO_MAX_ENTRIES = 100_000;
let maxEntries = DEFAULT_PDA_MEMO_MAX_ENTRIES;

const memo = new Map<string, Address>();
/** `[address, bump]` tuples for callers that need the bump too (the Kitchen PDAs). Same key. */
const bumpMemo = new Map<string, ProgramDerivedAddress>();
/**
 * {@link memoizedCreateProgramAddress}'s results. Its own map: there the bump is one of the seeds
 * and nothing is searched, so the same key means a different derivation than in the two maps above.
 */
const createMemo = new Map<string, CreatedProgramAddress>();
const MEMOS: readonly Map<string, unknown>[] = [memo, bumpMemo, createMemo];
let hits = 0;
let misses = 0;

/** A cached value, counted as a hit and moved to the end of `map` (most recently used), or undefined. */
function recall<T>(map: Map<string, T>, key: string): T | undefined {
  const cached = map.get(key);
  if (cached === undefined) return undefined;
  hits += 1;
  // Refresh recency: delete + re-set moves this key to the END of the Map's iteration order, so
  // eviction below always removes the entry that has gone longest without a hit.
  map.delete(key);
  map.set(key, cached);
  return cached;
}

/** Stores a freshly derived value, evicting `map`'s least-recently-used entry at the cap. */
function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

function toHex(bytes: ReadonlyUint8Array): string {
  let out = "";
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
function memoKey(programAddress: Address, seeds: readonly ReadonlyUint8Array[]): string {
  let key = programAddress as string;
  for (const seed of seeds) {
    key += "|";
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
  const cached = recall(memo, key);
  if (cached !== undefined) return cached;
  misses += 1;
  const [derived] = await getProgramDerivedAddress({
    programAddress,
    seeds: seeds as Uint8Array[],
  });
  remember(memo, key, derived);
  return derived;
}

/** Seeds for {@link memoizedFindAssociatedTokenPda} — the same shape `@solana-program/token`'s `findAssociatedTokenPda` takes (`tokenProgram` is part of the ATA seeds, so it is required just as it is there). */
export interface AssociatedTokenSeeds {
  owner: Address;
  mint: Address;
  tokenProgram: Address;
}

/**
 * {@link memoizedGetProgramDerivedAddress} for callers that also need the bump (the Kitchen PDA
 * helpers return it). The bump is a pure function of the same `(programAddress, seeds)` key as the
 * address, so the full `[address, bump]` tuple is cached under that key; same LRU cap and counters.
 */
export async function memoizedGetProgramDerivedAddressWithBump(
  programAddress: Address,
  seeds: readonly ReadonlyUint8Array[],
): Promise<ProgramDerivedAddress> {
  const key = memoKey(programAddress, seeds);
  const cached = recall(bumpMemo, key);
  if (cached !== undefined) return cached;
  misses += 1;
  const derived = await getProgramDerivedAddress({
    programAddress,
    seeds: seeds as ReadonlyUint8Array[],
  });
  remember(bumpMemo, key, derived);
  return derived;
}

/** What {@link memoizedCreateProgramAddress} returns: the address, and whether it is off the curve. */
export interface CreatedProgramAddress {
  address: Address;
  /** False when the address is a point on ed25519, which the runtime's `create_program_address` refuses. */
  offCurve: boolean;
}

/**
 * Memoized `create_program_address` for a KNOWN bump: `sha256(seeds || programAddress ||
 * "ProgramDerivedAddress")`, with the bump the caller read off an account passed as the last seed
 * and nothing searched (a stored bump need not be the canonical one, so a find would be wrong).
 * Synchronous, like the hashing it replaces. Same key scheme, LRU cap and counters as the finds,
 * in a map of its own.
 *
 * The on-curve check is computed once per key and RETURNED rather than thrown, because its callers
 * differ and each keeps its own behaviour: some refuse an on-curve result with their own error, and
 * some take the address as is because the pool already exists on chain with that bump.
 */
export function memoizedCreateProgramAddress(
  programAddress: Address,
  seeds: readonly ReadonlyUint8Array[],
): CreatedProgramAddress {
  const key = memoKey(programAddress, seeds);
  const cached = recall(createMemo, key);
  if (cached !== undefined) return cached;
  misses += 1;
  const address = getAddressDecoder().decode(
    sha256(
      ...(seeds as readonly Uint8Array[]),
      getAddressEncoder().encode(programAddress) as Uint8Array,
      "ProgramDerivedAddress",
    ),
  );
  const created = { address, offCurve: isOffCurveAddress(address) };
  remember(createMemo, key, created);
  return created;
}

/**
 * Memoized associated-token-account address — the drop-in, memoized twin of
 * `@solana-program/token`'s `findAssociatedTokenPda`. BYTE-IDENTICAL to it: the
 * same Associated-Token program id and the same `[owner, tokenProgram, mint]`
 * seed order (`findAssociatedTokenPda`'s own definition), so it resolves to the
 * exact same address — but through {@link memoizedGetProgramDerivedAddress}, so
 * a repeated warm derive of the same ATA is a memo hit instead of a fresh
 * SHA-256 bump-walk + ed25519 on-curve check. `findAssociatedTokenPda` is a
 * distinct code path from the raw `getProgramDerivedAddress` calls this module's
 * venues also route, so it needs its own memoized entry point to stop bypassing
 * the memo. Returns the address only — the bump `findAssociatedTokenPda` also
 * returns is unused at every venue call site this replaces (all destructure
 * `const [ata] = …`).
 */
export async function memoizedFindAssociatedTokenPda(
  seeds: AssociatedTokenSeeds,
): Promise<Address> {
  const encoder = getAddressEncoder();
  return memoizedGetProgramDerivedAddress(ASSOCIATED_TOKEN_PROGRAM_ADDRESS, [
    encoder.encode(seeds.owner) as Uint8Array,
    encoder.encode(seeds.tokenProgram) as Uint8Array,
    encoder.encode(seeds.mint) as Uint8Array,
  ]);
}

/** TEST/OBSERVABILITY SEAM: cumulative hit/miss counts since process start or the last reset. */
export function __pdaMemoStats(): PdaMemoStats {
  return { hits, misses };
}

/** TEST SEAM: current entry count, for asserting LRU eviction. */
export function __pdaMemoSize(): number {
  return memo.size;
}

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
export function configurePdaMemo(config: PdaMemoConfig): void {
  const next = config.maxEntries;
  if (!Number.isInteger(next) || next < 1) {
    throw new Error(`configurePdaMemo: maxEntries must be a positive integer, got ${String(next)}`);
  }
  maxEntries = next;
  // Honor a lowered cap immediately rather than waiting for the next miss to
  // drain one entry at a time. Map iteration is least-recently-used-first.
  for (const map of MEMOS) {
    while (map.size > maxEntries) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }
}

/** The memo's current maximum-entry cap (default {@link DEFAULT_PDA_MEMO_MAX_ENTRIES}). */
export function getPdaMemoMaxEntries(): number {
  return maxEntries;
}

/** TEST SEAM: drop the memo, zero the counters, and restore the default cap. */
export function __resetPdaMemoForTest(): void {
  for (const map of MEMOS) map.clear();
  hits = 0;
  misses = 0;
  maxEntries = DEFAULT_PDA_MEMO_MAX_ENTRIES;
}
