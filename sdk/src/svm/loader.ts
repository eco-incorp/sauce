/**
 * Batched account loading for prepare/quote flows.
 *
 * The venue adapters consume the one-address AccountLoader (fixture tests
 * feed it directly), but a naive RPC binding costs one round-trip per
 * account — an SvmRoute prepare over k pools touches 3-8 accounts each.
 * `coalescingAccountLoader` keeps the adapter surface unchanged while
 * batching transport: every load() issued in the same microtask turn joins
 * ONE getMultipleAccounts sweep (deduped, chunked at the RPC's 100-account
 * cap), so a parallelized prepare resolves in O(dependency-depth) sweeps —
 * pool accounts first, then their vault/config satellites — regardless of
 * pool count.
 *
 * A sweep's chunks go out concurrently but no more than
 * `maxConcurrentChunks` at a time: unbounded fan-out means a batch of k
 * addresses opens ceil(k / chunkSize) simultaneous requests, which at
 * k = 1,000,000 is 10,000. The cap is PER SWEEP, so independent concurrent
 * prepares never queue behind one another and the O(dependency-depth)
 * property above is preserved.
 *
 * Owner checks are PRESERVED through batching: getMultipleAccounts returns
 * each account's owner, and the loader hands (address, owner) to the
 * `expectOwner` hook before releasing the data — a per-account rejection
 * there fails that account's load() alone, exactly like a single-account
 * loader that verifies owners. NOTE: nothing currently passes `expectOwner` —
 * `quoteSvmRoute`/`svmRoute` do not wire owner expectations, contrary to what
 * this said. The owner is now carried on the loaded account instead, which is
 * where mint classification needs it.
 */
import type { Address } from "@solana/kit";
import type { AccountLoader, OwnedAccountLoader } from "./venues/types.js";

/** getMultipleAccounts pubkey cap on public RPCs. */
const DEFAULT_CHUNK_SIZE = 100;
/** 16 x DEFAULT_CHUNK_SIZE = 1,600 accounts per wave — ~200-500 pools at 3-8 accounts each. */
const DEFAULT_MAX_CONCURRENT_CHUNKS = 16;

export interface LoadedAccount {
  data: Uint8Array;
  owner: Address;
}

/** Batch transport: addresses in, (data + owner) per account out (null = not found). */
export type BatchAccountLoader = (
  addresses: readonly Address[],
) => Promise<(LoadedAccount | null)[]>;

export interface CoalescingLoaderOptions {
  /** getMultipleAccounts cap per request (public RPC limit: 100). */
  chunkSize?: number;
  /** Chunk requests in flight at once WITHIN one sweep (default 16). */
  maxConcurrentChunks?: number;
  /** Per-account owner check — throw to reject that account's load(). */
  expectOwner?: (address: Address, owner: Address) => void;
}

interface PendingLoad {
  resolve: (account: LoadedAccount | null) => void;
  reject: (error: unknown) => void;
}

/**
 * Wraps a batch transport as a single-account AccountLoader that coalesces
 * same-turn loads into deduped, chunked sweeps.
 */
export function coalescingOwnedAccountLoader(
  loadMany: BatchAccountLoader,
  options: CoalescingLoaderOptions = {},
): OwnedAccountLoader {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(
      `coalescingAccountLoader chunkSize must be a positive integer, got ${chunkSize}`,
    );
  }
  const maxConcurrentChunks = options.maxConcurrentChunks ?? DEFAULT_MAX_CONCURRENT_CHUNKS;
  if (!Number.isInteger(maxConcurrentChunks) || maxConcurrentChunks < 1) {
    throw new Error(
      `coalescingAccountLoader maxConcurrentChunks must be a positive integer, got ${maxConcurrentChunks}`,
    );
  }
  let pending: Map<Address, PendingLoad[]> | null = null;

  // One chunk's sweep: load it, then resolve/reject every waiter for its
  // addresses. Never rejects — failures are delivered to that chunk's own
  // waiters, so one bad chunk can't sink the others under Promise.all below.
  const sweepChunk = async (
    batch: Map<Address, PendingLoad[]>,
    chunk: Address[],
  ): Promise<void> => {
    let results: (LoadedAccount | null)[];
    try {
      results = await loadMany(chunk);
      if (results.length !== chunk.length) {
        throw new Error(
          `batch loader returned ${results.length} accounts for ${chunk.length} addresses`,
        );
      }
    } catch (error) {
      for (const address of chunk) for (const waiter of batch.get(address)!) waiter.reject(error);
      return;
    }
    chunk.forEach((address, i) => {
      const result = results[i];
      for (const waiter of batch.get(address)!) {
        if (result === null) {
          waiter.resolve(null);
          continue;
        }
        try {
          options.expectOwner?.(address, result.owner);
          // Fresh copy per waiter — callers may mutate their view. The owner rides along: it is
          // what tells a legacy mint from an extensionless Token-2022 one, and dropping it here is
          // what made that classification impossible downstream.
          waiter.resolve({ data: new Uint8Array(result.data), owner: result.owner });
        } catch (error) {
          waiter.reject(error);
        }
      }
    });
  };

  const flush = async (batch: Map<Address, PendingLoad[]>): Promise<void> => {
    const addresses = [...batch.keys()];
    // Chunks are independent getMultipleAccounts round-trips (chunkSize is the
    // RPC's per-call pubkey cap) — fire them in parallel, not one after another,
    // but never more than maxConcurrentChunks at a time. Each worker drains the
    // shared cursor, so the wave refills as soon as a chunk lands.
    const chunks: Address[][] = [];
    for (let at = 0; at < addresses.length; at += chunkSize) {
      chunks.push(addresses.slice(at, at + chunkSize));
    }
    let next = 0;
    const drainChunks = async (): Promise<void> => {
      while (next < chunks.length) {
        const chunk = chunks[next++]!;
        await sweepChunk(batch, chunk);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(maxConcurrentChunks, chunks.length) }, drainChunks),
    );
  };

  return (address: Address): Promise<LoadedAccount | null> =>
    new Promise((resolve, reject) => {
      if (pending === null) {
        pending = new Map();
        const batch = pending;
        queueMicrotask(() => {
          pending = null;
          void flush(batch);
        });
      }
      const waiters = pending.get(address);
      if (waiters === undefined) pending.set(address, [{ resolve, reject }]);
      else waiters.push({ resolve, reject });
    });
}

/**
 * The data-only loader the venue adapters take, as a projection of the owner-aware one.
 *
 * Keeping both means an adapter can be moved to owner-based mint classification on its own, instead
 * of all 64 changing in one sweep.
 */
export function coalescingAccountLoader(
  loadMany: BatchAccountLoader,
  options: CoalescingLoaderOptions = {},
): AccountLoader {
  const owned = coalescingOwnedAccountLoader(loadMany, options);

  return async (address: Address): Promise<Uint8Array | null> =>
    (await owned(address))?.data ?? null;
}

/** The slice of a @solana/kit RPC this loader needs (Rpc<GetMultipleAccountsApi>). */
export interface GetMultipleAccountsRpc {
  getMultipleAccounts(
    addresses: readonly Address[],
    config: { encoding: "base64" },
  ): {
    send(): Promise<{ value: ({ data: readonly [string, string]; owner: Address } | null)[] }>;
  };
}

/** Batch transport over a @solana/kit RPC's getMultipleAccounts (base64). */
export function kitBatchAccountLoader(rpc: GetMultipleAccountsRpc): BatchAccountLoader {
  return async (addresses: readonly Address[]): Promise<(LoadedAccount | null)[]> => {
    const { value } = await rpc.getMultipleAccounts(addresses, { encoding: "base64" }).send();
    return value.map((account) =>
      account === null
        ? null
        : { data: new Uint8Array(Buffer.from(account.data[0], "base64")), owner: account.owner },
    );
  };
}
