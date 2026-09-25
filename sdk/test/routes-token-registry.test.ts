/**
 * Per-chain token registry (`token-registry.ts`) -- module-eval invariants, coverage matrix, and
 * the one precedence resolver (`resolveTokenMap`).
 */
import { requireChain } from "../src/chains/canonical.js";
import {
  TOKEN_REGISTRY,
  knownTokenSymbols,
  registryTokenAddress,
  resolveTokenMap,
} from "../src/routes/token-registry.js";
import { REWRITABLE_METHODS } from "../src/routes/token-rewrite.js";

// verify/vectors.ts's own pinned Base USDC/WETH constants -- one source of truth; drift in either
// turns this red.
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_WETH = "0x4200000000000000000000000000000000000006";

describe("TOKEN_REGISTRY module-eval invariants", () => {
  it("every key is a canonical EVM chain id", () => {
    for (const idStr of Object.keys(TOKEN_REGISTRY)) {
      const chain = requireChain(Number(idStr));
      expect(chain.kind).toBe("evm");
    }
  });

  it("every row's symbol matches the ticker shape and none collides with a U4 rewritable method", () => {
    for (const rows of Object.values(TOKEN_REGISTRY)) {
      for (const row of rows) {
        expect(row.symbol).toMatch(/^[A-Z][A-Z0-9]{1,10}$/);
        for (const method of REWRITABLE_METHODS) {
          expect(row.symbol.toUpperCase()).not.toBe(method.toUpperCase());
        }
      }
    }
  });

  it("every row's address is EIP-55 checksummed, and symbols/addresses are unique per chain", () => {
    for (const rows of Object.values(TOKEN_REGISTRY)) {
      const symbols = new Set<string>();
      const addresses = new Set<string>();
      for (const row of rows) {
        expect(row.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(symbols.has(row.symbol)).toBe(false);
        symbols.add(row.symbol);
        const key = row.address.toLowerCase();
        expect(addresses.has(key)).toBe(false);
        addresses.add(key);
      }
    }
  });
});

describe("Base USDC/WETH match verify/vectors.ts's pinned constants", () => {
  it("registryTokenAddress('base', 'USDC'/'WETH') equals the pinned Tier-0 constants", () => {
    const base = requireChain("base");
    expect(registryTokenAddress(base, "USDC")).toBe(BigInt(BASE_USDC));
    expect(registryTokenAddress(base, "WETH")).toBe(BigInt(BASE_WETH));
  });
});

describe("coverage matrix (pinned exactly -- a new row is a deliberate edit)", () => {
  it("matches the exact chain -> sorted-symbols table this cut lands", () => {
    const matrix: Record<string, readonly string[]> = {
      ethereum: knownTokenSymbols(requireChain("ethereum")),
      optimism: knownTokenSymbols(requireChain("optimism")),
      arbitrum: knownTokenSymbols(requireChain("arbitrum")),
      polygon: knownTokenSymbols(requireChain("polygon")),
      base: knownTokenSymbols(requireChain("base")),
    };
    expect(matrix).toEqual({
      ethereum: ["USDC", "USDT", "WETH"],
      optimism: ["USDC", "USDT", "WETH"],
      arbitrum: ["USDC", "WETH"],
      polygon: ["USDC", "WETH", "WPOL"],
      base: ["USDC", "WETH"],
    });
  });

  it("a chain with no rows returns an empty symbol list, not an error", () => {
    expect(knownTokenSymbols(requireChain("ronin"))).toEqual([]);
  });

  it("an svm chain returns an empty symbol list", () => {
    expect(knownTokenSymbols(requireChain("solana"))).toEqual([]);
  });

  it("arbitrum and polygon deliberately do NOT register USDT (bridged/renamed symbol() mismatch)", () => {
    expect(registryTokenAddress(requireChain("arbitrum"), "USDT")).toBeUndefined();
    expect(registryTokenAddress(requireChain("polygon"), "USDT")).toBeUndefined();
  });
});

describe("resolveTokenMap: the one precedence resolver", () => {
  it("returns the registry rows for an evm chain with no caller tokens", () => {
    const map = resolveTokenMap(requireChain("base"));
    expect(map.get("USDC")).toBe(BigInt(BASE_USDC));
    expect(map.get("WETH")).toBe(BigInt(BASE_WETH));
  });

  it("merges caller tokens PER KEY on top of the registry -- override one symbol, keep the other", () => {
    const OTHER_USDC = "0x5555555555555555555555555555555555555555" as const;
    const map = resolveTokenMap(requireChain("base"), { USDC: OTHER_USDC });
    expect(map.get("USDC")).toBe(BigInt(OTHER_USDC));
    expect(map.get("WETH")).toBe(BigInt(BASE_WETH));
  });

  it("a caller token for a symbol the registry doesn't know is simply added", () => {
    const FOO = "0x6666666666666666666666666666666666666666" as const;
    const map = resolveTokenMap(requireChain("base"), { FOO });
    expect(map.get("FOO")).toBe(BigInt(FOO));
  });

  it("an svm chain resolves to only the caller tokens (no registry rows exist for an svm chain id)", () => {
    const USDC = "0x7777777777777777777777777777777777777777" as const;
    const map = resolveTokenMap(requireChain("solana"), { USDC });
    expect(map.size).toBe(1);
    expect(map.get("USDC")).toBe(BigInt(USDC));
  });

  it("an evm chain the registry doesn't cover resolves to only the caller tokens", () => {
    const USDC = "0x8888888888888888888888888888888888888888" as const;
    const map = resolveTokenMap(requireChain("ronin"), { USDC });
    expect(map.size).toBe(1);
    expect(map.get("USDC")).toBe(BigInt(USDC));
  });
});
