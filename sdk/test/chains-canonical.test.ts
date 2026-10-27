/**
 * CONTRACT for the canonical chain registry (../src/chains/canonical.ts).
 *
 * Pins that the registry is additive to `chains` (never shadowing it), and
 * that it actually reconciles every `chainName` spelling used across the
 * protocol registry — the concrete motivating use case.
 */
import {
  chains,
  getChain,
  getAllChainIds,
  nativeCoinSymbol,
  nativeErc20,
  nativeToErc20Amount,
} from "../src/chains/index.js";
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
import { listProtocols } from "../src/protocols/index.js";

describe("canonical chain registry: structural invariants", () => {
  it("has exactly 46 entries", () => {
    expect(canonicalChains.length).toBe(46);
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
          throw new Error(
            `alias collision: normalized key '${k}' claimed by both '${owner}' and '${c.slug}'`,
          );
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
    expect(ids.length).toBe(37); // guards a vacuously-true loop; also pins the known EVM-only count
    for (const id of ids) {
      const canonical = chainById(id);
      expect(canonical).toBeDefined();
      expect(canonical!.kind).toBe("evm");
      expect(canonical!.name).toBe(chains[id].name);
    }
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
    // + (1329, "Sei"), from circle-gateway; + (57073, "Ink"), from uniswap-v4; + Arc Testnet, Base
    // Sepolia and Ethereum Sepolia, from cctp, circle-gateway, uniswap-v2, uniswap-v3, uniswap-v4
    // and aave-v3.
    expect(pairs.size).toBe(27);
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
    expect(svmChains().map((chain) => chain.slug)).toEqual([
      "solana",
      "solana-devnet",
      "solana-testnet",
    ]);
    expect(evmChains().length).toBe(43);
  });

  it("registers Solana's testnet under a key of its own, alias 'testnet' its alone", () => {
    expect(chainById(1399811151)?.slug).toBe("solana-testnet");
    expect(chainByAlias("testnet")?.slug).toBe("solana-testnet");
    expect(chainByAlias("Solana Testnet")?.id).toBe(1399811151);
    expect(
      canonicalChains.filter((chain) =>
        [chain.slug, chain.name, ...chain.aliases].some(
          (name) => normalizeChainKey(name) === "testnet",
        ),
      ),
    ).toHaveLength(1);
  });

  it("is absent from the EVM-only `chains` export (additivity, reverse direction)", () => {
    for (const id of [1399811149, 1399811150, 1399811151]) {
      expect(getChain(id)).toBeUndefined();
      expect(Object.keys(chains).map(Number)).not.toContain(id);
    }
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
    expect(ids.length).toBe(37);
    expect(ids.sort((a, b) => a - b)).toEqual(
      Object.keys(chains)
        .map(Number)
        .sort((a, b) => a - b),
    );
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

describe("Arc: the native coin is USDC, which is also an ERC-20", () => {
  // Measured on rpc.mainnet.arc.io at block 23287436 (PR #11): eth_getBalance and balanceOf of one
  // account. The ERC-20 reads floor(native / 1e12).
  const NATIVE_WEI = 19396491158961599350n;
  const BALANCE_OF = 19396491n;

  it("records the 6-decimal ERC-20 over the 18-decimal native balance", () => {
    expect(getChain(5042)?.nativeCurrency).toEqual({
      name: "USDC",
      symbol: "USDC",
      decimals: 18,
      erc20: { address: "0x3600000000000000000000000000000000000000", decimals: 6 },
    });
    expect(nativeErc20(5042)).toEqual({
      address: "0x3600000000000000000000000000000000000000",
      decimals: 6,
    });
  });

  it("is the only chain, with its testnet, whose native coin is an ERC-20", () => {
    expect(getAllChainIds().filter((id) => nativeErc20(id) !== undefined)).toEqual([5042, 5042002]);
    expect(nativeErc20(1)).toBeUndefined();
    expect(nativeErc20(999_999)).toBeUndefined();
  });

  it("converts native wei to token units the way balanceOf reads them", () => {
    expect(nativeToErc20Amount(5042, NATIVE_WEI)).toBe(BALANCE_OF);
    // Dust below 1e12 wei is invisible through the ERC-20.
    expect(nativeToErc20Amount(5042, 999_999_999_999n)).toBe(0n);
    expect(nativeToErc20Amount(5042, 10n ** 12n)).toBe(1n);
    expect(() => nativeToErc20Amount(1, 1n)).toThrow(/not an ERC-20/);
    expect(() => nativeToErc20Amount(5042, -1n)).toThrow(/negative/);
  });
});

describe("testnets: each marked a testnet", () => {
  it("registers Base Sepolia, Arc Testnet and Ethereum Sepolia, and every other chain as a mainnet", () => {
    expect(
      Object.values(chains)
        .filter((chain) => chain.testnet)
        .map((chain) => [chain.id, chain.name]),
    ).toEqual([
      [84532, "Base Sepolia"],
      [5042002, "Arc Testnet"],
      [11155111, "Ethereum Sepolia"],
    ]);
    expect(requireChain("arc-testnet")).toMatchObject({ id: 5042002, kind: "evm" });
    expect(requireChain("base-sepolia")).toMatchObject({ id: 84532, kind: "evm" });
    expect(requireChain("sepolia")).toMatchObject({ id: 11155111, kind: "evm" });
    expect(requireChain("Arc Testnet").slug).toBe("arc-testnet");
    expect(requireChain("Ethereum Sepolia").slug).toBe("sepolia");
    expect(requireChain(84532n).slug).toBe("base-sepolia");
  });

  it("gives Arc Testnet Arc's native model: USDC, 18 decimals over a 6-decimal ERC-20, and the fee floor", () => {
    expect(getChain(5042002)?.nativeCurrency).toEqual(getChain(5042)?.nativeCurrency);
    expect(getChain(5042002)?.minBaseFeePerGas).toBe(20_000_000_000n);
    expect(nativeToErc20Amount(5042002, 10n ** 12n)).toBe(1n);
  });

  it("gives Base Sepolia and Ethereum Sepolia Ether, as their mainnets", () => {
    expect(getChain(84532)?.nativeCurrency).toEqual(getChain(8453)?.nativeCurrency);
    expect(getChain(11155111)?.nativeCurrency).toEqual(getChain(1)?.nativeCurrency);
    expect(getChain(84532)?.minBaseFeePerGas).toBeUndefined();
  });
});

describe("canonical chain registry: every chain's native coin", () => {
  it("names one for every chain, and `chains`' own where it records the chain", () => {
    for (const chain of canonicalChains) {
      const symbol = nativeCoinSymbol(chain);
      expect([chain.slug, symbol]).toEqual([chain.slug, expect.stringMatching(/^[A-Za-z]+$/)]);
      if (chains[chain.id] !== undefined) {
        expect(symbol).toBe(chains[chain.id]!.nativeCurrency.symbol);
      }
    }
    expect(nativeCoinSymbol(requireChain("solana"))).toBe("SOL");
    expect(nativeCoinSymbol(requireChain("monad"))).toBe("MON");
    expect(nativeCoinSymbol(requireChain("base"))).toBe("ETH");
  });
});
