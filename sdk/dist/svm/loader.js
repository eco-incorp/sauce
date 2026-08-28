/**
 * Wraps a batch transport as a single-account AccountLoader that coalesces
 * same-turn loads into deduped, chunked sweeps.
 */
export function coalescingAccountLoader(loadMany, options = {}) {
    const chunkSize = options.chunkSize ?? 100;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
        throw new Error(`coalescingAccountLoader chunkSize must be a positive integer, got ${chunkSize}`);
    }
    let pending = null;
    // One chunk's sweep: load it, then resolve/reject every waiter for its
    // addresses. Never rejects — failures are delivered to that chunk's own
    // waiters, so one bad chunk can't sink the others under Promise.all below.
    const sweepChunk = async (batch, chunk) => {
        let results;
        try {
            results = await loadMany(chunk);
            if (results.length !== chunk.length) {
                throw new Error(`batch loader returned ${results.length} accounts for ${chunk.length} addresses`);
            }
        }
        catch (error) {
            for (const address of chunk)
                for (const waiter of batch.get(address))
                    waiter.reject(error);
            return;
        }
        chunk.forEach((address, i) => {
            const result = results[i];
            for (const waiter of batch.get(address)) {
                if (result === null) {
                    waiter.resolve(null);
                    continue;
                }
                try {
                    options.expectOwner?.(address, result.owner);
                    // Fresh copy per waiter — callers may mutate their view.
                    waiter.resolve(new Uint8Array(result.data));
                }
                catch (error) {
                    waiter.reject(error);
                }
            }
        });
    };
    const flush = async (batch) => {
        const addresses = [...batch.keys()];
        // Chunks are independent getMultipleAccounts round-trips (chunkSize is the
        // RPC's per-call pubkey cap) — fire them in parallel, not one after another.
        const chunks = [];
        for (let at = 0; at < addresses.length; at += chunkSize) {
            chunks.push(addresses.slice(at, at + chunkSize));
        }
        await Promise.all(chunks.map((chunk) => sweepChunk(batch, chunk)));
    };
    return (address) => new Promise((resolve, reject) => {
        if (pending === null) {
            pending = new Map();
            const batch = pending;
            queueMicrotask(() => {
                pending = null;
                void flush(batch);
            });
        }
        const waiters = pending.get(address);
        if (waiters === undefined)
            pending.set(address, [{ resolve, reject }]);
        else
            waiters.push({ resolve, reject });
    });
}
/** Batch transport over a @solana/kit RPC's getMultipleAccounts (base64). */
export function kitBatchAccountLoader(rpc) {
    return async (addresses) => {
        const { value } = await rpc.getMultipleAccounts(addresses, { encoding: 'base64' }).send();
        return value.map((account) => account === null ? null : { data: new Uint8Array(Buffer.from(account.data[0], 'base64')), owner: account.owner });
    };
}
//# sourceMappingURL=loader.js.map