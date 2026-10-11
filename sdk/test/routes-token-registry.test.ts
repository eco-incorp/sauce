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
import { TOKEN_METHODS } from "../src/routes/chain-module.js";
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
        // A stock's is its issuer's ticker as an identifier, in the issuer's case ("bTSLA").
        expect(row.symbol).toMatch(
          row.stock === undefined ? /^[A-Z][A-Z0-9]{1,10}$/ : /^[A-Za-z][A-Za-z0-9_]{1,15}$/,
        );
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
        // Unique without regard to case, which is how the CLI looks a symbol up.
        expect(symbols.has(row.symbol.toUpperCase())).toBe(false);
        symbols.add(row.symbol.toUpperCase());
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
  /** The chain's symbols, less its stock tokens, which `token-registry-evidence.test.ts` holds. */
  const tokensOf = (slug: string) =>
    knownTokenSymbols(requireChain(slug)).filter(
      (symbol) =>
        TOKEN_REGISTRY[requireChain(slug).id]!.find((row) => row.symbol === symbol)!.stock ===
        undefined,
    );

  it("matches the exact chain -> sorted-symbols table this cut lands", () => {
    const matrix: Record<string, readonly string[]> = {
      ethereum: tokensOf("ethereum"),
      optimism: tokensOf("optimism"),
      arbitrum: tokensOf("arbitrum"),
      polygon: tokensOf("polygon"),
      base: tokensOf("base"),
    };
    expect(matrix).toEqual({
      ethereum: ["USDC", "USDT", "WETH"],
      optimism: ["USDC", "USDT", "USDT0", "WETH"],
      arbitrum: ["USDC", "USDT0", "WETH"],
      polygon: ["USDC", "USDT0", "WETH", "WPOL"],
      base: ["USDC", "WETH"],
    });
  });

  it("registers stock tokens on ethereum and base only, each chain from its issuers' lists", () => {
    const issuers = Object.fromEntries(
      Object.entries(TOKEN_REGISTRY)
        .map(([id, rows]) => [
          requireChain(Number(id)).slug,
          [...new Set(rows.flatMap((row) => (row.stock === undefined ? [] : [row.stock.issuer])))],
        ])
        .filter(([, list]) => list.length > 0),
    );
    expect(issuers).toEqual({
      ethereum: ["backed", "ondo", "mtpelerin"],
      base: ["coinbase", "backed"],
    });
    expect(registryTokenAddress(requireChain("base"), "SPCXc")).toBe(
      BigInt("0xb2000000000000000000007b9fcbd005511aCBd5"),
    );
  });

  it("a chain with no rows returns an empty symbol list, not an error", () => {
    expect(knownTokenSymbols(requireChain("ronin"))).toEqual([]);
  });

  it("solana registers its cluster's mints, legacy SPL Token and Token-2022 alike", () => {
    // Less its stock mints, which `token-registry-evidence.test.ts` holds.
    const stocks = new Set(
      SVM_TOKEN_REGISTRY["mainnet-beta"].filter((row) => row.stock).map((row) => row.symbol),
    );
    expect(
      knownTokenSymbols(requireChain("solana")).filter((symbol) => !stocks.has(symbol)),
    ).toEqual(["PYUSD", "USDC", "USDT", "WSOL"]);
  });

  it("registers stock mints on solana's mainnet-beta only, from its issuers' lists", () => {
    const issuers = Object.fromEntries(
      Object.entries(SVM_TOKEN_REGISTRY).map(([cluster, rows]) => [
        cluster,
        [...new Set(rows.flatMap((row) => (row.stock === undefined ? [] : [row.stock.issuer])))],
      ]),
    );
    expect(issuers).toEqual({
      "mainnet-beta": ["backed", "ondo", "backpack", "prestocks"],
      devnet: [],
    });
    expect(registryTokenAddress(requireChain("solana"), "TSLAx")).toBe(
      BigInt("0x07e83582411fea1482f0994b80aa512a97c94f25df283bec5a67a381fc862b4a"),
    );
  });

  it("arbitrum and polygon deliberately do NOT register USDT (bridged/renamed symbol() mismatch)", () => {
    expect(registryTokenAddress(requireChain("arbitrum"), "USDT")).toBeUndefined();
    expect(registryTokenAddress(requireChain("polygon"), "USDT")).toBeUndefined();
  });

  it("registers Tether's USDT0 as USDT0 on each canonical chain Tether's list names it on", () => {
    // docs.usdt0.to/technical-documentation/deployments, each chain's "Token" contract.
    const usdt0 = Object.fromEntries(
      Object.entries(TOKEN_REGISTRY).flatMap(([id, rows]) =>
        rows
          .filter((row) => row.symbol === "USDT0")
          .map((row) => [requireChain(Number(id)).slug, row.address]),
      ),
    );
    expect(usdt0).toEqual({
      optimism: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071",
      unichain: "0x9151434b16b9763660705744891fA906F660EcC5",
      polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      monad: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
      sei: "0x9151434b16b9763660705744891fA906F660EcC5",
      mantle: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
      plasma: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
      arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      ink: "0x0200C29006150606B650577BBE7B6248F58470c1",
      berachain: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    });
    // Optimism's USDT is the bridged token, a different contract from its USDT0.
    expect(registryTokenAddress(requireChain("optimism"), "USDT")).not.toBe(
      registryTokenAddress(requireChain("optimism"), "USDT0"),
    );
    // On Ethereum USDT0 is an adapter that locks USDT itself: the token there is USDT.
    expect(registryTokenAddress(requireChain("ethereum"), "USDT0")).toBeUndefined();
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
    expect([...map.keys()].sort()).toEqual(knownTokenSymbols(solana));
    expect(map.size).toBe(SVM_TOKEN_REGISTRY["mainnet-beta"].length);
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
      // Unique without regard to case, which is how the CLI looks a symbol up.
      expect(new Set(rows.map((row) => row.symbol.toUpperCase())).size).toBe(rows.length);
      expect(new Set(rows.map((row) => row.mint)).size).toBe(rows.length);
      for (const row of rows) {
        expect(row.address).toMatch(/^0x[0-9a-f]{64}$/);
        expect(row.address).toBe(keyOf(row.mint));
        // A stock's is its issuer's ticker as an identifier, in the issuer's case ("NVDA_US").
        expect(row.symbol).toMatch(
          row.stock === undefined ? /^[A-Z][A-Z0-9]{1,10}$/ : /^[A-Za-z][A-Za-z0-9_]{1,15}$/,
        );
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

  it("pins the coverage and each mint's token program: PYUSD on Token-2022, the rest legacy", () => {
    expect(
      Object.fromEntries(
        // Less the stock mints, which `token-registry-evidence.test.ts` holds.
        Object.entries(SVM_TOKEN_REGISTRY).map(([cluster, rows]) => [
          cluster,
          rows
            .filter((row) => row.stock === undefined)
            .map((row) => `${row.symbol} ${row.mint} ${row.decimals} ${row.tokenProgram}`),
        ]),
      ),
    ).toEqual({
      "mainnet-beta": [
        "PYUSD 2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo 6 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        "USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 6 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "USDT Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB 6 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "WSOL So11111111111111111111111111111111111111112 9 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      ],
      devnet: [
        "USDC 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 6 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "WSOL So11111111111111111111111111111111111111112 9 TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      ],
    });
  });
});
