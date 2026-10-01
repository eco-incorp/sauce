/**
 * Tokenized stocks, by chain: Backed's xStocks and Ondo Global Markets' tokens on Ethereum,
 * Coinbase's tokenized stocks on Base, and Backed's older bTokens on both. `token-registry.ts`
 * merges their rows (`stock-tokens.generated.ts`) into `TOKEN_REGISTRY`, so a program names each
 * one by its symbol with no import, as it names `USDC`: `SPCXc.balanceOf(ctx.self())`.
 *
 * PROVENANCE. Each list is copied from its issuer's own published list (`STOCK_ISSUERS`), never
 * from an aggregator, by `scripts/sync-stock-tokens.mjs`, and every row is then held to the chain:
 * code at the address, `symbol()` equal to the issuer's symbol and `decimals()` to the list's.
 * `scripts/capture-token-registry.mjs` reads those once into
 * `test/fixtures/token-registry/evidence.json`, and `test/token-registry-evidence.test.ts` checks
 * every registry row against it offline.
 *
 * SYMBOLS are the issuer's ticker, which is the token's own `symbol()` ("TSLAx", "TSLAon",
 * "TSLAc", "bTSLA"), except that a "." becomes "_" (`stockSymbol`): xStocks of non-US listings
 * carry an exchange suffix ("BRK.Bx", "ABI.BEx"), and a symbol has to be an identifier to be a
 * name in a program. Unlike the registry's other rows they are not all uppercase, so the CLI
 * matches a symbol without regard to case, and the registry keeps each chain's symbols unique that
 * way.
 *
 * WHAT A POT CAN DO WITH THEM. Any contract can hold, receive and send every token here: no issuer
 * gates a holder by allowlist or KYC, which applies only to minting and redeeming with the issuer.
 * Each can pause transfers and refuse a sanctioned or blocked address: Backed by a Chainalysis
 * sanctions list, Ondo by its compliance contract, Coinbase by a B20 policy. That is read from
 * each kind's verified implementation (Coinbase's from the B20 specification), and was checked by
 * `eth_call` transfers from a holder to an arbitrary contract. Two kinds behave unlike a plain
 * ERC-20:
 *
 * - Backed's tokens REBASE. `balanceOf` is shares times a multiplier the issuer moves for
 *   corporate actions, which a fee can also lower over time, so a balance changes with no
 *   transfer. It is constant within a transaction, so a program's balance difference across a
 *   swap holds; a transfer of `x` can credit 1 unit less than `x`, which a venue that checks what
 *   it was paid can refuse when the xStock is the token paid in.
 * - Coinbase's are B20 tokens: precompiles of the Base node, whose account holds the single byte
 *   `0xef` and no bytecode. They run on Base, but not in a local EVM such as anvil, so a program
 *   that moves one can be simulated against a Base node and not against a fork of it. Their
 *   multiplier is the redemption ratio, not a rebase: balances do not change.
 *
 * LEFT OUT, each for a reason: every Solana stock mint (xStocks, Ondo, Backpack, PreStocks,
 * Superstate) is a Token-2022 mint, which the SVM token arm does not take (`SVM_TOKEN_ENTRIES`);
 * Superstate's Opening Bell shares on Ethereum can be held only by an allowlisted address; Dinari
 * lists its dShares nowhere by address; Backed's bond and bill bTokens and Ondo's portfolio tokens
 * and USDon are not stocks.
 */

/** An issuer whose list `stock-tokens.generated.ts` copies. */
export type StockIssuer = "backed" | "ondo" | "coinbase";

/** Each issuer's name and the published list its rows are copied from. */
export const STOCK_ISSUERS: Readonly<
  Record<StockIssuer, { readonly name: string; readonly source: string }>
> = {
  // Backed's public API, documented at docs.xstocks.fi. Its list holds the xStocks; each asset,
  // the bTokens among them, is also at `/<symbol>`.
  backed: { name: "Backed", source: "https://api.xstocks.fi/api/v2/public/assets" },
  // Ondo's token registry page: every Ondo Global Markets token with its addresses.
  ondo: { name: "Ondo Global Markets", source: "https://docs.ondo.finance/partner-docs/tokens" },
  // Coinbase's tokenized-stocks API, documented with the B20 standard at
  // docs.base.org/specifications/b20/tokenized-stocks-on-base.
  coinbase: { name: "Coinbase", source: "https://api.coinbase.com/v1/tokenized-stocks" },
};

/** `[symbol, address, name, ticker]`: the registry symbol, the EIP-55 address, the token's name
 *  and its underlying's ticker, both as the issuer lists them (Coinbase lists no ticker: its
 *  symbol is the ticker and a trailing "c"). The address is a plain string because 1,800 template
 *  literal types in one table are more than the compiler will check (TS2590); the registry checks
 *  each one instead. */
export type StockEntry = readonly [symbol: string, address: string, name: string, ticker: string];

/** One issuer's tokens on one chain, with the decimals they all have. */
export interface StockList {
  readonly issuer: StockIssuer;
  readonly decimals: number;
  readonly tokens: readonly StockEntry[];
}

/** The registry symbol for an issuer's symbol: the same, with a "." as "_". */
export function stockSymbol(symbol: string): string {
  return symbol.split(".").join("_");
}
