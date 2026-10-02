/**
 * Every EVM row of the token registry, checked against the chain: code at its address, a
 * `symbol()` that is the row's symbol (a stock's with "." as "_", `stockSymbol`) and a
 * `decimals()` that is the row's decimals. And every Solana mint the registry has on mainnet-beta:
 * owned by the row's token program, initialized, with the row's decimals, its metadata symbol the
 * row's, and nothing that would make a checked transfer of it refused.
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
import { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } from "../src/routes/token-registry.js";
import { TOKEN_2022_PROGRAM_ID } from "../src/svm/token-program.js";

interface Evidence {
  /** Bytes of code at the address; a Base B20 token's account holds the single byte `0xef`. */
  readonly code: number | null;
  readonly symbol: string | null;
  readonly decimals: number | null;
}

/** A Solana mint as the cluster had it. */
interface MintEvidence {
  /** The program that owns the account, `null` where there is no account. */
  readonly program: string | null;
  readonly initialized?: boolean;
  readonly decimals?: number;
  /** The mint's own TokenMetadata symbol, else its Metaplex metadata's. */
  readonly symbol?: string | null;
  /** Whether any of it is minted: its supply is above zero. */
  readonly minted?: boolean;
  /** Why a checked transfer of it is refused (`resolveSvmToken`), `null` where it is no mint. */
  readonly refusals?: readonly string[] | null;
}

/** Solana's canonical chain id, under which the evidence holds mainnet-beta's mints. */
const SOLANA = "1399811149";
/** A row whose symbol is not its mint's metadata symbol, as the row says: the wrapped native's
 *  metadata names the coin it wraps. */
const METADATA_SYMBOL: Readonly<Record<string, string>> = { WSOL: "SOL" };

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
const MINTS = (
  EVIDENCE.chains[SOLANA] as unknown as
    { readonly slot: number; readonly tokens: Readonly<Record<string, MintEvidence>> } | undefined
)?.tokens;
const MAINNET = SVM_TOKEN_REGISTRY["mainnet-beta"];

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
      const addresses = new Set<string>(
        chainId === SOLANA
          ? MAINNET.map((row) => row.mint)
          : (TOKEN_REGISTRY[Number(chainId)] ?? []).map((row) => row.address),
      );
      expect(Object.keys(tokens).filter((address) => !addresses.has(address))).toEqual([]);
    }
  });

  it("covers Solana's mainnet-beta mints at a slot", () => {
    expect((EVIDENCE.chains[SOLANA] as unknown as { slot: number }).slot).toBeGreaterThan(0);
  });

  it.each(MAINNET.map((row) => [`solana:${row.symbol}`, row] as const))(
    "%s is the mint the cluster has there, and a checked transfer moves it",
    (_label, row) => {
      const evidence = MINTS?.[row.mint];
      if (evidence === undefined) {
        throw new Error(
          `no evidence for ${row.symbol} (${row.mint}) on Solana: recapture with ` +
            `node scripts/capture-token-registry.mjs --recapture --rpc-config <path> --chains ${SOLANA}`,
        );
      }
      expect(evidence.program).toBe(row.tokenProgram);
      expect(evidence.initialized).toBe(true);
      expect(evidence.decimals).toBe(row.decimals);
      // The metadata names the mint as the row does: a stock's with "." as "_", Backpack's by the
      // bare ticker it lists as "<ticker>.US", the wrapped native's by the coin it wraps.
      const metadata = evidence.symbol ?? "";
      if (row.stock?.issuer === "backpack") expect(metadata).toBe(row.stock.ticker);
      else if (row.stock !== undefined) expect(stockSymbol(metadata)).toBe(row.symbol);
      else expect(metadata).toBe(METADATA_SYMBOL[row.symbol] ?? row.symbol);
      // No transfer hook that names a program, no pause, no account that starts frozen.
      expect(evidence.refusals).toEqual([]);
      // Backpack lists mints it has not opened: each copied one has been minted.
      if (row.stock?.issuer === "backpack") expect(evidence.minted).toBe(true);
    },
  );

  it("holds no endpoint", () => {
    expect(TEXT).not.toMatch(/https?:|wss?:/);
  });
});

describe("stock tokens", () => {
  it("give each row its issuer's list as the source", () => {
    for (const list of [...Object.values(TOKEN_REGISTRY), MAINNET]) {
      for (const row of list) {
        if (row.stock !== undefined)
          expect(row.source).toBe(STOCK_ISSUERS[row.stock.issuer].source);
      }
    }
  });

  it("are Token-2022 mints on Solana, from Backed, Ondo, Backpack and PreStocks", () => {
    const stocks = MAINNET.filter((row) => row.stock !== undefined);
    expect(stocks.length).toBeGreaterThan(0);
    for (const row of stocks) expect(row.tokenProgram).toBe(TOKEN_2022_PROGRAM_ID);
    expect([...new Set(stocks.map((row) => row.stock!.issuer))]).toEqual([
      "backed",
      "ondo",
      "backpack",
      "prestocks",
    ]);
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

  it("name SpaceX on Solana: by its ticker, and PreStocks' by the company's name", () => {
    const named = MAINNET.filter((row) => row.stock?.ticker === "SPCX").map((row) => row.symbol);

    expect(named).toEqual(["SPCXx", "SPCXon", "SPCX_US"]);
    expect(MAINNET.find((row) => row.symbol === "SPACEX")?.stock).toEqual({
      issuer: "prestocks",
      name: "SpaceX",
      ticker: "SPACEX",
    });
  });
});
