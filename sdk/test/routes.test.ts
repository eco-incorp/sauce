/**
 * eco-routes chain-global surface — CONTRACT tests. Pure data assertions, no
 * compiler/forge/network involved beyond the trivial one-op SauceScript
 * programs compiled below.
 */
import { canonicalChains } from "../src/chains/canonical.js";
import { chain, chainAccessors, pascalOfSlug } from "../src/routes/index.js";

describe("routes: a chain accessor is a namespace", () => {
  it("its own keys are exactly ['chain','hop'], and it is not callable", () => {
    expect(typeof chainAccessors.Base).toBe("object");
    expect(Object.keys(chainAccessors.Base).sort()).toEqual(["chain", "hop"]);
    expect(typeof chainAccessors.Base.hop).toBe("function");
  });

  it("chain('eth')/chain(8453)/chain('BNB Chain') resolve", () => {
    expect(chain("eth").chain.slug).toBe("ethereum");
    expect(chain(8453).chain.slug).toBe("base");
    expect(chain("BNB Chain").chain.slug).toBe("bsc");
  });

  it("chain('bogus') throws Unknown chain", () => {
    expect(() => chain("bogus")).toThrow(/Unknown chain 'bogus'/);
  });
});

describe("routes: accessor generation is registry-derived", () => {
  it("the key set matches a fresh pascal derivation from canonicalChains, no literal list", () => {
    const expectedKeys = canonicalChains.map((c) => pascalOfSlug(c.slug)).sort();
    const actualKeys = Object.keys(chainAccessors).sort();
    expect(actualKeys).toEqual(expectedKeys);
    expect(new Set(expectedKeys).size).toBe(expectedKeys.length); // duplicate-free
    expect(Object.keys(chainAccessors)).toHaveLength(canonicalChains.length);
  });

  it("each global's .chain is the matching registry record", () => {
    for (const c of canonicalChains) {
      const key = pascalOfSlug(c.slug);
      expect((chainAccessors as Record<string, { chain: unknown }>)[key]!.chain).toEqual(c);
    }
  });
});
