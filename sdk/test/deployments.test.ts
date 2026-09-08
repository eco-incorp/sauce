/**
 * CONTRACT for the chainId → Sauce Recipes API slug resolver.
 *
 * Replaces a hand-maintained slug constant (e.g. eco-solver's former
 * SAUCE_CHAIN_SLUGS — a point-in-time `eth_getCode` probe that goes stale the
 * next time a chain is added): the slug now comes from the pinned deploy record's
 * per-chain `name`, gated on `live`. These assertions pin the two properties a
 * consumer relies on — (1) a slug is emitted IFF the stack is live on that chain,
 * and (2) it equals the vendored engine-side name — so a repin that changes a
 * slug or a chain's liveness is caught here rather than silently altering which
 * chains the resolver reports servable.
 */
import {
  v12ChainSlug,
  v12LiveChainSlugs,
  v12LiveChainIds,
  v12FailedChainIds,
  V12_EVM_CHAINS,
} from "../src/deployments/index.js";

const CHAINS = V12_EVM_CHAINS as Record<number, { name: string; live: boolean }>;

describe("v12ChainSlug", () => {
  it("returns the engine-side name for every live chain", () => {
    const live = v12LiveChainIds();
    expect(live.length).toBeGreaterThan(0); // guards a vacuously-true loop
    for (const id of live) {
      expect(v12ChainSlug(id)).toBe(CHAINS[id].name);
    }
  });

  it("returns undefined for a chain whose deploy did not land", () => {
    const failed = v12FailedChainIds();
    expect(failed.length).toBeGreaterThan(0); // ronin — guards a vacuously-true loop
    for (const id of failed) {
      expect(v12ChainSlug(id)).toBeUndefined();
    }
  });

  it("returns undefined for an unknown chain", () => {
    expect(v12ChainSlug(999999)).toBeUndefined();
  });

  it("anchors the stable, load-bearing slugs", () => {
    // ethereum/base slugs are contractually stable — the Recipes API `chain=` param.
    expect(v12ChainSlug(1)).toBe("ethereum");
    expect(v12ChainSlug(8453)).toBe("base");
    // ronin's deploy failed (Solidity >=0.8.20 / PUSH0), so it must never resolve to a slug.
    expect(v12ChainSlug(2020)).toBeUndefined();
  });
});

describe("v12LiveChainSlugs", () => {
  it("keys are exactly the live chain ids", () => {
    const keys = Object.keys(v12LiveChainSlugs())
      .map(Number)
      .sort((a, b) => a - b);
    expect(keys).toEqual(v12LiveChainIds());
  });

  it("every value is a non-empty slug matching v12ChainSlug", () => {
    const map = v12LiveChainSlugs();
    expect(Object.keys(map).length).toBeGreaterThan(0);
    for (const [id, slug] of Object.entries(map)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).toBe(v12ChainSlug(Number(id)));
    }
  });
});
