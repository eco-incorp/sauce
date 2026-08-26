/**
 * coalescingAccountLoader — batching, chunk PARALLELISM, and error isolation.
 *
 * The parallelism test is the regression lock for the prod perf bug: `flush`
 * used to await each chunk sequentially (`for (…) { await loadMany(chunk) }`),
 * so N chunks = N serial RPC round-trips. It now fires every chunk at once via
 * Promise.all. The "both chunks in flight before either resolves" assertion
 * FAILS on the old sequential code and PASSES on the fix.
 */
import { address } from '@solana/kit';
import type { Address } from '@solana/kit';
import { coalescingAccountLoader, type BatchAccountLoader, type LoadedAccount } from '../../src/svm/loader.js';

// Distinct valid base58 addresses, indexed 0..n-1.
const POOL = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
  'So11111111111111111111111111111111111111112',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
].map((s) => address(s));

const OWNER = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const acct = (byte: number): LoadedAccount => ({ data: new Uint8Array([byte]), owner: OWNER });

describe('coalescingAccountLoader', () => {
  it('coalesces same-tick loads into ONE sweep (deduped)', async () => {
    const calls: Address[][] = [];
    const loadMany: BatchAccountLoader = async (addrs) => {
      calls.push([...addrs]);
      return addrs.map(() => acct(1));
    };
    const load = coalescingAccountLoader(loadMany);

    // Three loads in the same tick, one a duplicate.
    const [a, b, c] = await Promise.all([load(POOL[0]!), load(POOL[1]!), load(POOL[0]!)]);

    expect(calls.length).toBe(1); // one round-trip
    expect(calls[0]!.length).toBe(2); // deduped: POOL[0], POOL[1]
    expect([a, b, c].every((r) => r !== null)).toBe(true);
  });

  it('fires every chunk in PARALLEL, not one after another', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Array<() => void> = [];
    const loadMany: BatchAccountLoader = (addrs) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<(LoadedAccount | null)[]>((resolve) => {
        // Resolve only when explicitly released, so we can observe how many
        // chunks are concurrently awaiting before any completes.
        gates.push(() => {
          inFlight -= 1;
          resolve(addrs.map(() => acct(2)));
        });
      });
    };
    // chunkSize 2 over 6 addresses => 3 chunks.
    const load = coalescingAccountLoader(loadMany, { chunkSize: 2 });
    const pending = Promise.all(POOL.map((p) => load(p)));

    // Let the flush microtask schedule all chunk round-trips.
    await new Promise((r) => setTimeout(r, 0));
    expect(maxInFlight).toBe(3); // all 3 chunks in flight at once — sequential code would be 1

    gates.forEach((release) => release());
    const results = await pending;
    expect(results.length).toBe(6);
    expect(results.every((r) => r !== null)).toBe(true);
  });

  it('isolates a chunk failure to its own waiters', async () => {
    const loadMany: BatchAccountLoader = async (addrs) => {
      if (addrs.includes(POOL[0]!)) throw new Error('chunk boom');
      return addrs.map(() => acct(3));
    };
    // chunkSize 1 => each address its own chunk; only POOL[0]'s chunk throws.
    const load = coalescingAccountLoader(loadMany, { chunkSize: 1 });

    const settled = await Promise.allSettled([load(POOL[0]!), load(POOL[1]!)]);
    expect(settled[0]!.status).toBe('rejected'); // failed chunk
    expect(settled[1]!.status).toBe('fulfilled'); // sibling chunk unaffected
  });
});
