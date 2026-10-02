/**
 * Tokenized stocks, by chain: Backed's xStocks, Ondo Global Markets' tokens and Mt Pelerin's own
 * shares (MPS) on Ethereum, Coinbase's tokenized stocks on Base, Backed's older bTokens on both, and
 * on Solana the xStocks, Ondo's tokens, Backpack Securities' and PreStocks'. `token-registry.ts`
 * merges their rows (`stock-tokens.generated.ts`) into `TOKEN_REGISTRY` and, on Solana, into
 * `SVM_TOKEN_REGISTRY`, so a program names each one by its symbol with no import, as it names
 * `USDC`: `SPCXc.balanceOf(ctx.self())` on Base, `balanceOf(TSLAx, account)` on Solana.
 *
 * PROVENANCE. Each list is copied from its issuer's own published list (`STOCK_ISSUERS`), never
 * from an aggregator, by `scripts/sync-stock-tokens.mjs`, and every row is then held to the chain:
 * on an EVM chain, code at the address, `symbol()` equal to the issuer's symbol and `decimals()` to
 * the list's; on Solana, a mint owned by the row's token program, initialized, with the list's
 * decimals, the issuer's symbol in its own metadata and no transfer hook program.
 * `scripts/capture-token-registry.mjs` reads those once into
 * `test/fixtures/token-registry/evidence.json`, and `test/token-registry-evidence.test.ts` checks
 * every registry row against it offline.
 *
 * SYMBOLS are the issuer's ticker, which is the token's own `symbol()` ("TSLAx", "TSLAon",
 * "TSLAc", "bTSLA"), except that a "." becomes "_" (`stockSymbol`): xStocks of non-US listings
 * carry an exchange suffix ("BRK.Bx", "ABI.BEx"), and a symbol has to be an identifier to be a
 * name in a program. Backpack Securities lists its tokens as "<ticker>.US" ("NVDA_US") while the
 * mint's own symbol is the bare ticker, which is the row's ticker; PreStocks' symbol is the
 * company's name ("SPACEX"). Unlike the registry's other rows they are not all uppercase, so the
 * CLI matches a symbol without regard to case, and the registry keeps each chain's symbols unique
 * that way.
 *
 * WHAT A POT CAN DO WITH THEM. Any contract can hold, receive and send every token here: no issuer
 * gates a holder by allowlist or KYC, which applies only to minting and redeeming with the issuer.
 * Each can pause transfers and refuse a sanctioned or blocked address: Backed by a Chainalysis
 * sanctions list, Ondo by its compliance contract, Coinbase by a B20 policy, Mt Pelerin by the
 * freeze and lock rules its token checks (its holding company's locked shares). That is read from
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
 * ON SOLANA every stock mint is a Token-2022 mint, moved by `@sauce/token`'s checked writes
 * (`transferChecked`, `approveChecked`), and each carries the same extensions: its own metadata, a
 * Pausable switch (unpaused), new accounts initialized rather than frozen, confidential transfers
 * (opt-in per account), a transfer hook with NO program, which is no hook, and, but for Ondo's, a
 * permanent delegate, the issuer's authority to move or burn any balance. Amounts are raw: the
 * issuer's multiplier (ScaledUiAmount) is what a wallet multiplies them by for display, and it moves
 * for corporate actions, so a raw unit is not always one share. PreStocks' mints also charge a
 * transfer fee, withheld from what the recipient gets.
 *
 * LEFT OUT, each for a reason: Superstate's Opening Bell shares, on Ethereum and Solana, can be
 * held only by an allowlisted address; on Solana, a mint whose transfer hook names a program, which
 * `@sauce/token` refuses (none of the issuers' mints has one), Backpack's mints it has not opened
 * yet (no deposits, and no supply), and Backed's two Solana bTokens, which its Solana list leaves
 * out (bGME has no supply, bTSLA a single token); Dinari lists its dShares nowhere by address;
 * Aktionariat publishes no list of its companies' tokens and keeps them mostly on Optimism; MSX
 * lists its tokens only through its app, for contracts with no verified source; Backed's bond and
 * bill bTokens and Ondo's portfolio tokens and USDon are not stocks.
 */

/** An issuer whose list `stock-tokens.generated.ts` copies. */
export type StockIssuer = "backed" | "ondo" | "coinbase" | "mtpelerin" | "backpack" | "prestocks";

/** Each issuer's name and the published list its rows are copied from. */
export const STOCK_ISSUERS: Readonly<
  Record<StockIssuer, { readonly name: string; readonly source: string }>
> = {
  // Backed's public API, documented at docs.xstocks.fi. Its list, per network (`?network=Solana`),
  // holds the xStocks; each asset, the bTokens among them, is also at `/<symbol>`.
  backed: { name: "Backed", source: "https://api.xstocks.fi/api/v2/public/assets" },
  // Ondo's token registry page: every Ondo Global Markets token with its addresses, Solana's mint
  // among them.
  ondo: { name: "Ondo Global Markets", source: "https://docs.ondo.finance/partner-docs/tokens" },
  // Coinbase's tokenized-stocks API, documented with the B20 standard at
  // docs.base.org/specifications/b20/tokenized-stocks-on-base.
  coinbase: { name: "Coinbase", source: "https://api.coinbase.com/v1/tokenized-stocks" },
  // Mt Pelerin's shareholder page, which gives the address of its own shares' token, MPS.
  mtpelerin: { name: "Mt Pelerin", source: "https://www.mtpelerin.com/shareholders" },
  // Backpack Exchange's asset list: each "<ticker>.US" asset is a Backpack Securities token, with
  // its Solana mint.
  backpack: { name: "Backpack Securities", source: "https://api.backpack.exchange/api/v1/assets" },
  // PreStocks' product page: each company's token, with its Solana mint.
  prestocks: { name: "PreStocks", source: "https://prestocks.com/products" },
};

/** `[symbol, address, name, ticker]`: the registry symbol, the address (EIP-55 on an EVM chain, the
 *  mint's base58 on Solana), the token's name and its underlying's ticker, both as the issuer lists
 *  them. Coinbase lists no ticker: its symbol is the ticker and a trailing "c". Backpack's is its
 *  symbol less ".US". PreStocks' companies are private, with no ticker: its symbol stands for one.
 *  The address is a plain string because 1,800 template literal types in one table are more than
 *  the compiler will check (TS2590); the registry checks each one instead. */
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
