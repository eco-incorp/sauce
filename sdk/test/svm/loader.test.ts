/**
 * coalescingOwnedAccountLoader — batching, chunk PARALLELISM, and error isolation; and
 * accountDataLoader, its data-only view.
 *
 * The parallelism test is the regression lock for the prod perf bug: `flush`
 * used to await each chunk sequentially (`for (…) { await loadMany(chunk) }`),
 * so N chunks = N serial RPC round-trips. It now fires every chunk at once via
 * Promise.all. The "both chunks in flight before either resolves" assertion
 * FAILS on the old sequential code and PASSES on the fix.
 *
 * The concurrency tests lock the OTHER end of the same knob: fan-out is
 * bounded by maxConcurrentChunks, so a large batch cannot open one request per
 * chunk (10,000 of them at k = 1,000,000).
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  accountDataLoader,
  coalescingOwnedAccountLoader,
  type BatchAccountLoader,
  type LoadedAccount,
} from "../../src/svm/loader.js";

// Distinct valid base58 addresses, indexed 0..n-1.
const POOL = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  "So11111111111111111111111111111111111111112",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
].map((s) => address(s));

const OWNER = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const acct = (byte: number): LoadedAccount => ({ data: new Uint8Array([byte]), owner: OWNER });

/** `count` unique deterministic addresses (a 24-bit counter in the first three bytes). */
function distinctAddresses(count: number): Address[] {
  return Array.from({ length: count }, (_, i) => {
    const bytes = new Uint8Array(32);
    bytes[0] = i & 0xff;
    bytes[1] = (i >> 8) & 0xff;
    bytes[2] = (i >> 16) & 0xff;

    return getAddressDecoder().decode(bytes);
  });
}

/** A transport that resolves a macrotask later, tracking concurrent calls. */
function inFlightTracker(): {
  loadMany: BatchAccountLoader;
  max: () => number;
  calls: () => number;
} {
  let inFlight = 0;
  let max = 0;
  let calls = 0;
  const loadMany: BatchAccountLoader = async (addrs) => {
    inFlight += 1;
    calls += 1;
    max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, 0));
    inFlight -= 1;

    return addrs.map(() => acct(4));
  };

  return { loadMany, max: () => max, calls: () => calls };
}

describe("coalescingOwnedAccountLoader", () => {
  it("coalesces same-tick loads into ONE sweep (deduped)", async () => {
    const calls: Address[][] = [];
    const loadMany: BatchAccountLoader = async (addrs) => {
      calls.push([...addrs]);
      return addrs.map(() => acct(1));
    };
    const load = coalescingOwnedAccountLoader(loadMany);

    // Three loads in the same tick, one a duplicate.
    const [a, b, c] = await Promise.all([load(POOL[0]!), load(POOL[1]!), load(POOL[0]!)]);

    expect(calls.length).toBe(1); // one round-trip
    expect(calls[0]!.length).toBe(2); // deduped: POOL[0], POOL[1]
    // Each load gets the account's data, and its owner rides along.
    for (const account of [a, b, c]) expect(account).toEqual(acct(1));
  });

  it("fires every chunk in PARALLEL, not one after another", async () => {
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
    const load = coalescingOwnedAccountLoader(loadMany, { chunkSize: 2 });
    const pending = Promise.all(POOL.map((p) => load(p)));

    // Let the flush microtask schedule all chunk round-trips.
    await new Promise((r) => setTimeout(r, 0));
    expect(maxInFlight).toBe(3); // all 3 chunks in flight at once — sequential code would be 1

    gates.forEach((release) => release());
    const results = await pending;
    expect(results.length).toBe(6);
    expect(results.every((r) => r?.data[0] === 2 && r.owner === OWNER)).toBe(true);
  });

  it("caps in-flight chunks at maxConcurrentChunks (default 16) over a 5,000-address batch", async () => {
    const { loadMany, max, calls } = inFlightTracker();
    const load = coalescingOwnedAccountLoader(loadMany); // default chunkSize 100 => 50 chunks
    const addresses = distinctAddresses(5_000);

    const results = await Promise.all(addresses.map((a) => load(a)));

    expect(calls()).toBe(50); // every chunk still swept
    expect(max()).toBe(16);
    expect(results.length).toBe(5_000);
    expect(results.every((r) => r?.data[0] === 4 && r.owner === OWNER)).toBe(true);
  });

  it("serializes chunks at maxConcurrentChunks 1 (the escape hatch)", async () => {
    const { loadMany, max, calls } = inFlightTracker();
    const load = coalescingOwnedAccountLoader(loadMany, { chunkSize: 1, maxConcurrentChunks: 1 });

    const results = await Promise.all(POOL.map((p) => load(p)));

    expect(calls()).toBe(6);
    expect(max()).toBe(1);
    expect(results.every((r) => r?.data[0] === 4 && r.owner === OWNER)).toBe(true);
  });

  it("rejects a non-positive maxConcurrentChunks", () => {
    const loadMany: BatchAccountLoader = async (addrs) => addrs.map(() => acct(5));

    expect(() => coalescingOwnedAccountLoader(loadMany, { maxConcurrentChunks: 0 })).toThrow(
      "maxConcurrentChunks must be a positive integer, got 0",
    );
  });

  it("isolates a chunk failure to its own waiters", async () => {
    const loadMany: BatchAccountLoader = async (addrs) => {
      if (addrs.includes(POOL[0]!)) throw new Error("chunk boom");
      return addrs.map(() => acct(3));
    };
    // chunkSize 1 => each address its own chunk; only POOL[0]'s chunk throws.
    const load = coalescingOwnedAccountLoader(loadMany, { chunkSize: 1 });

    const settled = await Promise.allSettled([load(POOL[0]!), load(POOL[1]!)]);
    expect(settled[0]!.status).toBe("rejected"); // failed chunk
    expect(settled[1]).toEqual({ status: "fulfilled", value: acct(3) }); // sibling chunk unaffected
  });
});

describe("accountDataLoader", () => {
  it("returns an account's data, and null for a missing account", async () => {
    const present = acct(7);
    const load = accountDataLoader(async (at) => (at === POOL[0] ? present : null));

    expect(await load(POOL[0]!)).toBe(present.data);
    expect(await load(POOL[1]!)).toBeNull();
  });
});
