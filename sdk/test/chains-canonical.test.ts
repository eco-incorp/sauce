/**
 * CONTRACT for the canonical chain registry (../src/chains/canonical.ts).
 *
 * Pins that the registry is additive to `chains` (never shadowing it),
 * decoupled from v12 liveness (identity != deployability), and that it
 * actually reconciles every `chainName` spelling used across the protocol
 * registry — the concrete motivating use case.
 */
import { chains, getChain, getAllChainIds } from "../src/chains/index.js";
import {
  canonicalChains,
  chainById,
  chainBySlug,
  chainByAlias,
  resolveChain,
  requireChain,
  isEvm,
  isSvm,
  evmChains,
  svmChains,
  normalizeChainKey,
} from "../src/chains/canonical.js";
import { V12_EVM_CHAINS, v12LiveChainIds, v12ChainSlug } from "../src/deployments/index.js";
import { listProtocols } from "../src/protocols/index.js";

describe("canonical chain registry: structural invariants", () => {
  it("has exactly 39 entries", () => {
    expect(canonicalChains.length).toBe(39);
  });

  it("has unique ids and unique slugs", () => {
    const ids = canonicalChains.map((c) => c.id);
    const slugs = canonicalChains.map((c) => c.slug);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every slug matches the kebab-case shape", () => {
    for (const c of canonicalChains) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every kind is 'evm' or 'svm'", () => {
    for (const c of canonicalChains) {
      expect(["evm", "svm"]).toContain(c.kind);
    }
  });

  it("has a globally unique normalized key set (slug + name + aliases)", () => {
    const seen = new Map<string, string>();
    for (const c of canonicalChains) {
      const keys = [c.slug, c.name, ...c.aliases].map(normalizeChainKey);
      for (const k of keys) {
        const owner = seen.get(k);
        if (owner !== undefined && owner !== c.slug) {
          throw new Error(`alias collision: normalized key '${k}' claimed by both '${owner}' and '${c.slug}'`);
        }
        seen.set(k, c.slug);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("canonical chain registry: superset of `chains` (additivity)", () => {
  it("covers every id in `chains`, byte-identical name, kind evm", () => {
    const ids = Object.keys(chains).map(Number);
    expect(ids.length).toBe(33); // guards a vacuously-true loop; also pins the known EVM-only count
    for (const id of ids) {
      const canonical = chainById(id);
      expect(canonical).toBeDefined();
      expect(canonical!.kind).toBe("evm");
      expect(canonical!.name).toBe(chains[id].name);
    }
  });
});

describe("canonical chain registry: v12 deploy-record consistency", () => {
  it("matches V12_EVM_CHAINS slugs for all 12 chains, ronin included", () => {
    const raw = V12_EVM_CHAINS as Record<number, { name: string }>;
    const ids = Object.keys(raw).map(Number);
    expect(ids.length).toBe(12);
    for (const id of ids) {
      expect(chainById(id)!.slug).toBe(raw[id].name);
    }
  });

  it("agrees with v12ChainSlug for every live chain", () => {
    const live = v12LiveChainIds();
    expect(live.length).toBeGreaterThan(0);
    for (const id of live) {
      expect(v12ChainSlug(id)).toBe(chainById(id)!.slug);
    }
  });

  it("registers ronin (identity) even though its v12 deploy failed (liveness)", () => {
    expect(chainById(2020)).toBeDefined();
    expect(chainById(2020)!.slug).toBe("ronin");
    expect(v12ChainSlug(2020)).toBeUndefined();
  });
});

describe("canonical chain registry: protocol chainName reconciliation", () => {
  it("resolves every distinct (chainId, chainName) pair used across the protocol registry", () => {
    const pairs = new Map<string, number>();
    let visited = 0;
    for (const protocol of listProtocols()) {
      for (const deployment of protocol.chains) {
        visited++;
        const resolved = chainByAlias(deployment.chainName);
        expect(resolved).toBeDefined();
        expect(resolved!.id).toBe(deployment.chainId);
        pairs.set(`${deployment.chainId}:${deployment.chainName}`, deployment.chainId);
      }
    }
    expect(visited).toBeGreaterThan(0); // guards a vacuously-true loop
    expect(pairs.size).toBe(20);
  });
});

describe("canonical chain registry: Solana / SVM", () => {
  it("registers Solana mainnet with the eco-routes id", () => {
    const sol = chainById(1399811149);
    expect(sol).toBeDefined();
    expect(sol!.slug).toBe("solana");
    expect(sol!.kind).toBe("svm");
  });

  it("resolves aliases 'mainnet-beta' and 'SOL'", () => {
    expect(chainByAlias("mainnet-beta")?.id).toBe(1399811149);
    expect(chainByAlias("SOL")?.id).toBe(1399811149);
  });

  it("isSvm/isEvm classify Solana correctly", () => {
    expect(isSvm(1399811149)).toBe(true);
    expect(isEvm(1399811149)).toBe(false);
  });

  it("evmChains/svmChains partition correctly", () => {
    expect(svmChains().length).toBe(1);
    expect(evmChains().length).toBe(38);
  });

  it("is absent from the EVM-only `chains` export (additivity, reverse direction)", () => {
    expect(getChain(1399811149)).toBeUndefined();
    expect(Object.keys(chains).map(Number)).not.toContain(1399811149);
  });
});

describe("canonical chain registry: lookup semantics", () => {
  it("chainByAlias is case/punctuation insensitive", () => {
    for (const s of ["BSC", "bsc", "BNB Chain", "bnb chain", "bnb-chain"]) {
      expect(chainByAlias(s)?.id).toBe(56);
    }
    for (const s of ["Arbitrum", "Arbitrum One", "arbitrum-one"]) {
      expect(chainByAlias(s)?.id).toBe(42161);
    }
    for (const s of ["zkSync", "zkSync Era"]) {
      expect(chainByAlias(s)?.id).toBe(324);
    }
    for (const s of ["Avalanche", "Avalanche C-Chain"]) {
      expect(chainByAlias(s)?.id).toBe(43114);
    }
  });

  it("chainBySlug is exact-match only", () => {
    expect(chainBySlug("BNB Chain")).toBeUndefined();
    expect(chainBySlug("bsc")?.id).toBe(56);
  });

  it("resolveChain treats number/string/CanonicalChain uniformly", () => {
    const byId = resolveChain(8453);
    const bySlugRef = resolveChain("base");
    expect(byId).toBeDefined();
    expect(bySlugRef).toBe(byId);
    expect(resolveChain(byId!)).toBe(byId);
  });

  it("resolveChain returns undefined and requireChain throws for an unknown ref", () => {
    expect(resolveChain("nope")).toBeUndefined();
    expect(() => requireChain("nope")).toThrow(/Unknown chain 'nope'/);
    expect(() => requireChain("nope")).toThrow(/ethereum/);
  });

  it("isEvm/isSvm are false (not throwing) for an unresolvable ref", () => {
    expect(isEvm("nope")).toBe(false);
    expect(isSvm("nope")).toBe(false);
  });
});

describe("canonical chain registry: non-regression of existing exports", () => {
  it("getAllChainIds is unaffected and matches `chains` keys", () => {
    const ids = getAllChainIds();
    expect(ids.length).toBe(33);
    expect(ids.sort((a, b) => a - b)).toEqual(Object.keys(chains).map(Number).sort((a, b) => a - b));
  });

  it("getChain still returns the same data for a known chain", () => {
    expect(getChain(8453)!.name).toBe("Base");
  });
});

describe("canonical chain registry: bigint chain-ref resolution (regression)", () => {
  // eco-routes chain ids are native bigint. Before the fix, resolveChain fell
  // through to `return ref` for a bigint, so an svm id silently resolved to
  // undefined-kind and downstream encoders defaulted to EVM. These pin that a
  // bigint resolves identically to its numeric id.
  it("resolves an EVM bigint id to its evm record", () => {
    expect(resolveChain(8453n)?.slug).toBe("base");
    expect(isEvm(8453n)).toBe(true);
    expect(isSvm(8453n)).toBe(false);
  });

  it("resolves the Solana bigint id to its SVM record (not a silent evm default)", () => {
    const solana = chainBySlug("solana");
    expect(solana).toBeDefined();
    expect(resolveChain(BigInt(solana!.id))?.slug).toBe("solana");
    expect(isSvm(BigInt(solana!.id))).toBe(true);
    expect(isEvm(BigInt(solana!.id))).toBe(false);
  });

  it("agrees with the numeric-id resolution for every canonical chain", () => {
    for (const c of canonicalChains) {
      expect(resolveChain(BigInt(c.id))).toBe(chainById(c.id));
    }
  });

  it("returns undefined for a negative or out-of-safe-range bigint (never throws here)", () => {
    expect(resolveChain(-1n)).toBeUndefined();
    expect(resolveChain(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBeUndefined();
  });
});
