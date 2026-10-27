/**
 * M Swap and Sanctum Infinity have no per-pair account, so each mints a synthetic discovery key per
 * directed pair and remembers the pair behind it. That memory is module-global, so it must stay
 * bounded however many keys a long-lived integrator mints, and a pair `fetchPoolConfig` refuses
 * must not stay behind.
 *
 * FAILING-FIRST: before the fix each venue's map grew by one entry per pair, forever, and kept a
 * refused pair's entry.
 */
import { address, getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { fetchMSwapPoolConfig, mswapPoolKey } from "../../../src/svm/venues/mswap/index.js";
import {
  __resetSanctumInfinityKeysForTest,
  sanctumInfinity,
  sanctumInfinityLookupPair,
  sanctumInfinityPoolKey,
} from "../../../src/svm/venues/sanctum-infinity/index.js";
import { MAX_PAIR_KEYS, pairKeyRegistry } from "../../../src/svm/venues/pair-keys.js";
import { TOKEN_2022_PROGRAM_ID, type OwnedAccountLoader } from "../../../src/svm/index.js";
import { makeT22Mint } from "../fixtures/token-2022/synth.js";

const MANY = 10_000;
const OUT = address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

/** A distinct mint per index. */
function mintAt(index: number): Address {
  const bytes = new Uint8Array(32);
  new DataView(bytes.buffer).setUint32(0, index + 1);
  bytes[31] = 7;
  return getAddressDecoder().decode(bytes);
}

const nothing: OwnedAccountLoader = async () => null;

/** A fetch still in flight, refused when the test says. (`Promise.withResolvers` is past this
 *  project's `lib`.) */
function deferredRefusal(): { refusal: Promise<never>; refuse: (error: Error) => void } {
  let refuse!: (error: Error) => void;
  const refusal = new Promise<never>((_, reject) => (refuse = reject));
  return { refusal, refuse };
}

describe("pairKeyRegistry", () => {
  it("holds at most its capacity, evicting the least recently used key", async () => {
    const registry = pairKeyRegistry("test", 3);
    const keys = [0, 1, 2].map((i) => registry.key(mintAt(i), OUT));
    registry.lookup(keys[0]); // key 0 is now the most recently used
    const fourth = registry.key(mintAt(3), OUT);
    expect(registry.lookup(keys[1])).toBeUndefined(); // the least recently used went
    for (const kept of [keys[0], keys[2], fourth]) expect(registry.lookup(kept)).toBeDefined();
    // A resolve counts as use, and a successful one keeps the key.
    await registry.resolve(keys[2], async () => "ok");
    expect(registry.lookup(keys[2])).toBeDefined();
  });

  it("re-minting a key is idempotent and does not grow the registry", () => {
    const registry = pairKeyRegistry("test", 2);
    const key = registry.key(mintAt(0), OUT);
    for (let i = 0; i < 10; i++) expect(registry.key(mintAt(0), OUT)).toBe(key);
    const other = registry.key(mintAt(1), OUT);
    expect(registry.lookup(key)).toBeDefined();
    expect(registry.lookup(other)).toBeDefined();
  });

  it("defaults to MAX_PAIR_KEYS, below the many keys the venue tests mint", () => {
    expect(MAX_PAIR_KEYS).toBeLessThan(MANY);
  });

  it("a refusal still forgets the pair it refused", async () => {
    const registry = pairKeyRegistry("test", 3);
    const key = registry.key(mintAt(0), OUT);
    await expect(
      registry.resolve(key, async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(registry.lookup(key)).toBeUndefined();
  });

  it("a stale refusal does not erase the pair minted again meanwhile", async () => {
    const registry = pairKeyRegistry("test", 3);
    const key = registry.key(mintAt(0), OUT);
    const { refusal, refuse } = deferredRefusal();
    const pending = registry.resolve(key, () => refusal);
    expect(registry.key(mintAt(0), OUT)).toBe(key); // minted again while the first is in flight
    refuse(new Error("stale"));
    await expect(pending).rejects.toThrow("stale");
    expect(registry.lookup(key)).toEqual({ inMint: mintAt(0), outMint: OUT });
  });

  it("a stale refusal does not erase a pair evicted and minted again", async () => {
    const registry = pairKeyRegistry("test", 1);
    const key = registry.key(mintAt(0), OUT);
    const { refusal, refuse } = deferredRefusal();
    const pending = registry.resolve(key, () => refusal);
    registry.key(mintAt(1), OUT); // capacity 1: evicts the first
    expect(registry.lookup(key)).toBeUndefined();
    registry.key(mintAt(0), OUT); // and it comes back
    refuse(new Error("stale"));
    await expect(pending).rejects.toThrow("stale");
    expect(registry.lookup(key)).toEqual({ inMint: mintAt(0), outMint: OUT });
  });
});

describe("mswap discovery keys", () => {
  it("forgets a pair fetchPoolConfig refused", async () => {
    const pool = mswapPoolKey(mintAt(1), OUT);
    // No SwapGlobal: the pair is refused.
    await expect(fetchMSwapPoolConfig(nothing, pool)).rejects.toThrow(/SwapGlobal/);
    await expect(fetchMSwapPoolConfig(nothing, pool)).rejects.toThrow(/unknown discovery key/);
  });

  it("does not grow without bound: the oldest of many keys is evicted, the newest kept", async () => {
    const first = mswapPoolKey(mintAt(0), OUT);
    let last = first;
    for (let i = 1; i <= MANY; i++) last = mswapPoolKey(mintAt(i), OUT);
    await expect(fetchMSwapPoolConfig(nothing, first)).rejects.toThrow(/unknown discovery key/);
    await expect(fetchMSwapPoolConfig(nothing, last)).rejects.toThrow(/SwapGlobal/);
  });
});

describe("sanctum-infinity discovery keys", () => {
  beforeEach(() => __resetSanctumInfinityKeysForTest());

  it("forgets a pair fetchPoolConfig refused", async () => {
    const inMint = mintAt(1);
    const key = sanctumInfinityPoolKey(inMint, OUT);
    expect(sanctumInfinityLookupPair(key)).toEqual({ inMint, outMint: OUT });
    const t22: OwnedAccountLoader = async (at) =>
      at === inMint ? { data: makeT22Mint(), owner: TOKEN_2022_PROGRAM_ID } : null;
    await expect(sanctumInfinity.fetchPoolConfig(t22, key)).rejects.toThrow(/Token-2022/);
    expect(sanctumInfinityLookupPair(key)).toBeUndefined();
  });

  it("does not grow without bound: the oldest of many keys is evicted, the newest kept", () => {
    const first = sanctumInfinityPoolKey(mintAt(0), OUT);
    let last = first;
    for (let i = 1; i <= MANY; i++) last = sanctumInfinityPoolKey(mintAt(i), OUT);
    expect(sanctumInfinityLookupPair(first)).toBeUndefined();
    expect(sanctumInfinityLookupPair(last)).toEqual({ inMint: mintAt(MANY), outMint: OUT });
  });
});
