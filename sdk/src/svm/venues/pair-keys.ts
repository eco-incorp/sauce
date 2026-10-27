/**
 * Synthetic per-directed-pair discovery keys, for the venues with no per-pair on-chain account
 * (Sanctum Infinity, M Swap). `fetchPoolConfig(load, pool)` takes an `Address`, and such a venue
 * has none to give, so the discovery wrapper mints a DETERMINISTIC, PURELY LOCAL key per
 * (inMint, outMint) — sha256 of the pair, so it round-trips through the `Address` brand as a plain
 * 32-byte value and is NEVER read on-chain — and the venue remembers the pair behind it.
 *
 * Thirty-two bytes cannot carry two mints, so the key cannot describe itself and the pair is
 * remembered. That memory is bounded: at most {@link MAX_PAIR_KEYS} keys, the least recently
 * minted or fetched evicted first, and a pair `fetchPoolConfig` refuses is forgotten. A key that
 * is unknown (never minted, evicted, or refused) throws, which `resolveSvmPoolSpec` swallows into a
 * harmless drop, exactly like a wrong-owner spoof on any other family; minting it again is
 * idempotent.
 */
import { address, getBase58Decoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { sha256 } from "../../bytes.js";

/** The keys one venue remembers at most. */
export const MAX_PAIR_KEYS = 4096;

export interface DirectedPair {
  inMint: Address;
  outMint: Address;
}

export interface PairKeyRegistry {
  /** Mint (or re-mint, idempotently) the key for a directed pair. */
  key(inMint: Address, outMint: Address): Address;
  /** The pair behind a key, or undefined when it is not remembered. */
  lookup(key: Address): DirectedPair | undefined;
  /**
   * Run `fetch` on the key's pair, forgetting the key when it throws: a refused pair leaves no
   * entry. Throws `<slug>: unknown discovery key` for a key not remembered.
   */
  resolve<T>(key: Address, fetch: (pair: DirectedPair) => Promise<T>): Promise<T>;
  /** Forget every key. */
  clear(): void;
}

const b58 = getBase58Decoder();

/** One venue's bounded registry; `slug` names the venue in its errors. */
export function pairKeyRegistry(slug: string, capacity: number = MAX_PAIR_KEYS): PairKeyRegistry {
  // Map iteration order is insertion order: re-inserting on use keeps the oldest first.
  const pairs = new Map<string, DirectedPair>();
  const lookup = (key: Address): DirectedPair | undefined => {
    const pair = pairs.get(key);
    if (pair !== undefined) {
      pairs.delete(key);
      pairs.set(key, pair);
    }
    return pair;
  };
  return {
    key(inMint, outMint) {
      const key = address(b58.decode(sha256(`${inMint}\0${outMint}`)));
      pairs.delete(key);
      pairs.set(key, { inMint, outMint });
      if (pairs.size > capacity) pairs.delete(pairs.keys().next().value!);
      return key;
    },
    lookup,
    async resolve(key, fetch) {
      const pair = lookup(key);
      if (pair === undefined) {
        throw new Error(`${slug}: unknown discovery key ${key} (not minted, or no longer held)`);
      }
      try {
        return await fetch(pair);
      } catch (error) {
        // Forget the pair this resolve refused, and only that: a key minted again (or evicted and
        // minted again) while the fetch was in flight holds a fresh entry a stale refusal must keep.
        if (pairs.get(key) === pair) pairs.delete(key);
        throw error;
      }
    },
    clear() {
      pairs.clear();
    },
  };
}
