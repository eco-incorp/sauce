/**
 * Every EVM row of the token registry, checked against the chain: code at its address, a
 * `symbol()` that is the row's symbol (a stock's with "." as "_", `stockSymbol`) and a
 * `decimals()` that is the row's decimals.
 *
 * OFFLINE. The evidence is `fixtures/token-registry/evidence.json`, captured by
 * `scripts/capture-token-registry.mjs` at one block per chain, only when asked to (see CLAUDE.md).
 * A row added without recapturing fails here, naming the chain to recapture, and so does evidence
 * for a token no row has any more.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STOCK_ISSUERS, stockSymbol } from "../src/routes/stock-tokens.js";
import { STOCK_TOKENS } from "../src/routes/stock-tokens.generated.js";
import { TOKEN_REGISTRY } from "../src/routes/token-registry.js";

interface Evidence {
  /** Bytes of code at the address; a Base B20 token's account holds the single byte `0xef`. */
  readonly code: number | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
}

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "token-registry",
  "evidence.json",
);
const TEXT = readFileSync(FIXTURE, "utf-8");
const EVIDENCE = JSON.parse(TEXT) as {
  readonly chains: Readonly<
    Record<string, { readonly block: number; readonly tokens: Readonly<Record<string, Evidence>> }>
  >;
};

const rows = Object.entries(TOKEN_REGISTRY).flatMap(([chainId, list]) =>
  list.map((row) => ({ chainId, row })),
);

describe("token registry evidence", () => {
  it("covers every chain the registry has rows on, each at a block", () => {
    for (const chainId of Object.keys(TOKEN_REGISTRY)) {
      expect(EVIDENCE.chains[chainId]?.block).toBeGreaterThan(0);
    }
  });

  it.each(rows.map(({ chainId, row }) => [`${chainId}:${row.symbol}`, chainId, row] as const))(
    "%s is the token the chain has there",
    (_label, chainId, row) => {
      const evidence = EVIDENCE.chains[chainId]?.tokens[row.address];
      if (evidence === undefined) {
        throw new Error(
          `no evidence for ${row.symbol} (${row.address}) on chain ${chainId}: recapture with ` +
            `node scripts/capture-token-registry.mjs --recapture --rpc-config <path> --chains ${chainId}`,
        );
      }
      expect(evidence.code).toBeGreaterThan(0);
      expect(evidence.decimals).toBe(row.decimals);
      expect(row.stock === undefined ? evidence.symbol : stockSymbol(evidence.symbol ?? "")).toBe(
        row.symbol,
      );
    },
  );

  it("holds no evidence for a token no row has", () => {
    for (const [chainId, { tokens }] of Object.entries(EVIDENCE.chains)) {
      const addresses = new Set((TOKEN_REGISTRY[Number(chainId)] ?? []).map((row) => row.address));
      expect(Object.keys(tokens).filter((address) => !addresses.has(address as never))).toEqual([]);
    }
  });

  it("holds no endpoint", () => {
    expect(TEXT).not.toMatch(/https?:|wss?:/);
  });
});

describe("stock tokens", () => {
  it("give each row its issuer's list as the source", () => {
    for (const list of Object.values(TOKEN_REGISTRY)) {
      for (const row of list) {
        if (row.stock !== undefined)
          expect(row.source).toBe(STOCK_ISSUERS[row.stock.issuer].source);
      }
    }
  });

  it("are Coinbase's B20 precompiles on Base: one byte of code, which no local EVM runs", () => {
    const coinbase = STOCK_TOKENS[8453]!.find((list) => list.issuer === "coinbase")!;
    expect(coinbase.tokens.length).toBeGreaterThan(0);
    for (const [, address] of coinbase.tokens) {
      expect(EVIDENCE.chains["8453"]!.tokens[address]!.code).toBe(1);
    }
  });

  it("name SpaceX on Ethereum and Base, the demo's token", () => {
    const named = (chainId: number) =>
      TOKEN_REGISTRY[chainId]!.filter((row) => row.stock?.ticker === "SPCX").map((r) => r.symbol);

    expect(named(1)).toEqual(["SPCXx", "SPCXon"]);
    expect(named(8453)).toEqual(["SPCXc"]);
  });
});
