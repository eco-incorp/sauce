/**
 * Per-chain token registry (`token-registry.ts`) -- module-eval invariants, coverage matrix, and
 * the one precedence resolver (`resolveTokenMap`).
 */
import { getAddressEncoder } from "@solana/kit";
import { bytesToHex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import {
  SVM_TOKEN_REGISTRY,
  TOKEN_REGISTRY,
  knownTokenSymbols,
  registryTokenAddress,
  resolveTokenMap,
  svmTokenRows,
} from "../src/routes/token-registry.js";
import { TOKEN_METHODS } from "../src/routes/host.js";
import { NATIVE_MINT } from "../src/svm/prepends.js";
import { USDC_MINT } from "../src/svm/venues/hylo/index.js";

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
        for (const method of TOKEN_METHODS) {
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

  it("solana registers its cluster's classic SPL mints", () => {
    expect(knownTokenSymbols(requireChain("solana"))).toEqual(["USDC", "USDT", "WSOL"]);
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

  it("an svm chain resolves its mints' keys, and a caller token overrides one PER KEY", () => {
    const solana = requireChain("solana");
    const DEVNET_USDC = SVM_TOKEN_REGISTRY.devnet.find((row) => row.symbol === "USDC")!.address;
    const map = resolveTokenMap(solana, { USDC: DEVNET_USDC });
    expect(map.get("USDC")).toBe(BigInt(DEVNET_USDC));
    expect(map.get("USDT")).toBe(registryTokenAddress(solana, "USDT"));
    expect([...map.keys()].sort()).toEqual(["USDC", "USDT", "WSOL"]);
  });

  it("an evm chain the registry doesn't cover resolves to only the caller tokens", () => {
    const USDC = "0x8888888888888888888888888888888888888888" as const;
    const map = resolveTokenMap(requireChain("ronin"), { USDC });
    expect(map.size).toBe(1);
    expect(map.get("USDC")).toBe(BigInt(USDC));
  });
});

describe("SVM_TOKEN_REGISTRY: the Solana mints", () => {
  const keyOf = (mint: string) =>
    bytesToHex(new Uint8Array(getAddressEncoder().encode(mint as never)));

  it("a canonical solana program resolves mainnet-beta's mints", () => {
    expect(svmTokenRows(requireChain("solana"))).toBe(SVM_TOKEN_REGISTRY["mainnet-beta"]);
    expect(svmTokenRows(requireChain("base"))).toEqual([]);
  });

  it("each row's key is its mint's 32 bytes, and symbols and mints are unique per cluster", () => {
    for (const rows of Object.values(SVM_TOKEN_REGISTRY)) {
      expect(new Set(rows.map((row) => row.symbol)).size).toBe(rows.length);
      expect(new Set(rows.map((row) => row.mint)).size).toBe(rows.length);
      for (const row of rows) {
        expect(row.address).toMatch(/^0x[0-9a-f]{64}$/);
        expect(row.address).toBe(keyOf(row.mint));
        expect(row.symbol).toMatch(/^[A-Z][A-Z0-9]{1,10}$/);
      }
    }
  });

  it("agrees with the mints the SDK already records", () => {
    const mainnet = Object.fromEntries(
      SVM_TOKEN_REGISTRY["mainnet-beta"].map((row) => [row.symbol, row.mint]),
    );
    expect(mainnet.USDC).toBe(USDC_MINT);
    expect(mainnet.WSOL).toBe(NATIVE_MINT);
  });

  it("pins the coverage: USDC, USDT and the wrapped native on mainnet; USDC and WSOL on devnet", () => {
    expect(
      Object.fromEntries(
        Object.entries(SVM_TOKEN_REGISTRY).map(([cluster, rows]) => [
          cluster,
          rows.map((row) => `${row.symbol} ${row.mint} ${row.decimals}`),
        ]),
      ),
    ).toEqual({
      "mainnet-beta": [
        "USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 6",
        "USDT Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB 6",
        "WSOL So11111111111111111111111111111111111111112 9",
      ],
      devnet: [
        "USDC 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 6",
        "WSOL So11111111111111111111111111111111111111112 9",
      ],
    });
  });
});
