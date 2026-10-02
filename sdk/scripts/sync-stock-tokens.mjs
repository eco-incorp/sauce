#!/usr/bin/env node
// Copies the tokenized stocks the registry carries from each issuer's own published list into
// `src/routes/stock-tokens.generated.ts`: Backed's API (xStocks and bTokens), Ondo's token
// registry page, Coinbase's tokenized-stocks API, Backpack's asset list and PreStocks' product page
// (`STOCK_ISSUERS` in `src/routes/stock-tokens.ts` names each). Nothing here reads a chain: the
// issuer's list says which token is at which address, and `capture-token-registry.mjs` then reads
// each one on chain for the evidence fixture, which `test/token-registry-evidence.test.ts` holds
// every row to. A row this adds fails that test until the evidence is recaptured.
//
// WHAT IS COPIED, per issuer, for Ethereum (1) and Base (8453), the release's EVM chains:
//   - Backed: every asset its list deploys on either chain, and the bTokens below, which its list
//     leaves out and only `/<symbol>` serves. Only the equity ones: its bond and bill bTokens are
//     not stocks.
//   - Ondo: every Ethereum address on the registry page of a token of type Stock or ETF that
//     Ondo's app lists (ONDO_LIVE): the page also carries tokens not launched yet. Its portfolio
//     tokens and USDon are not stocks.
//   - Coinbase: every token the API lists. Each is a B20 token on Base.
//   - Mt Pelerin: its own shares' token, MPS, on Ethereum, at the address its shareholder page
//     gives (MT_PELERIN). The page is prose, not a list, so the address is written here and the
//     sync only proves the page still gives it.
// And for Solana's mainnet-beta, where every one is a Token-2022 mint:
//   - Backed: every asset its Solana list deploys. Its two Solana bTokens are not in that list, and
//     not copied: bGME has no supply there, and bTSLA a single token.
//   - Ondo: the Solana mint on the registry page of every token copied for Ethereum.
//   - Backpack Securities: every "<ticker>.US" asset with a Solana mint that Backpack takes deposits
//     of. The list also carries mints it has not opened, with deposits off and nothing minted; the
//     evidence holds every copied one to a supply above zero.
//   - PreStocks: every product on its product page, with the mint the page gives.
// Decimals are each list's: Coinbase's and Backpack's APIs give them; Backed and Ondo publish none,
// and all of their tokens have 18 on an EVM chain, Backed's 8 and Ondo's 9 on Solana, which the
// evidence holds; nor does PreStocks, whose mints have 9; MPS has none (0), as Mt Pelerin's page
// says.
//
// Review the diff before committing it: a changed address is a token the issuer moved.
//
// Run: `pnpm --filter './sdk' sync-stock-tokens`, then `capture-token-registry`.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress as isMint } from "@solana/kit";
import { getAddress } from "viem";

import { createTsLoader } from "./lib/load-ts.mjs";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(SDK, "src/routes/stock-tokens.generated.ts");
const { STOCK_ISSUERS, stockSymbol } = createTsLoader(SDK)("src/routes/stock-tokens.ts");

/** The Solana cluster the mints are copied for: the canonical `solana` chain. */
const SOLANA = "mainnet-beta";
/** Backed's network names, for the chains copied. */
const BACKED_NETWORKS = { Ethereum: 1, Base: 8453, Solana: SOLANA };
/** The EVM ones, where its bTokens are copied too. */
const BTOKEN_NETWORKS = ["Ethereum", "Base"];
/** Ondo's app's asset list: the tokens it trades, which a token not launched yet is not in. */
const ONDO_LIVE = "https://app.ondo.finance/api/v2/assets";
/** Mt Pelerin's own shares on Ethereum, as its shareholder page gives them. */
const MT_PELERIN = {
  symbol: "MPS",
  address: "0x96c645d3d3706f793ef52c19bbace441900ed47d",
  name: "Mt Pelerin Shares",
  ticker: "MPS",
};
/** The equity bTokens: a share, or an equity index fund (bCSPX). */
const BTOKENS = ["bCOIN", "bCSPX", "bGME", "bGOOGL", "bMSFT", "bMSTR", "bNIU", "bNVDA", "bTSLA"];

function fail(message) {
  console.error(`sync-stock-tokens: ${message}`);
  process.exit(1);
}

async function get(url, as = "json") {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return as === "json" ? await response.json() : await response.text();
    } catch (error) {
      if (attempt === 4) fail(`${url}: ${error.message}`);
      await new Promise((done) => setTimeout(done, 2_000 * attempt));
    }
  }
}

/** chain id (or Solana's cluster) -> issuer -> rows, each `[symbol, address, name, ticker]`. */
const lists = new Map();
function add(chainId, issuer, symbol, address, name, ticker) {
  if (chainId === SOLANA) {
    if (typeof address !== "string" || !isMint(address)) {
      fail(`${issuer} lists ${symbol} on Solana at ${address}, not a base58 address`);
    }
  } else if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    fail(`${issuer} lists ${symbol} on chain ${chainId} at ${address}, not an EVM address`);
  }
  const byIssuer = lists.get(chainId) ?? lists.set(chainId, new Map()).get(chainId);
  const rows = byIssuer.get(issuer) ?? byIssuer.set(issuer, []).get(issuer);
  const at = chainId === SOLANA ? address : getAddress(address);
  rows.push([stockSymbol(symbol), at, name.trim(), ticker.trim()]);
}

// Backed: the list per network, 100 a page, then each bToken by its symbol. An asset on both
// networks is in both lists, so each is kept once per network: `${symbol}@${network}`.
const backed = new Map();
const backedAsset = (asset, networks) => {
  for (const deployment of asset.deployments ?? []) {
    if (!networks.includes(deployment.network)) continue;
    backed.set(`${asset.symbol}@${deployment.network}`, { asset, deployment });
  }
};
for (const network of Object.keys(BACKED_NETWORKS)) {
  for (let page = 0; ; page++) {
    const url = `${STOCK_ISSUERS.backed.source}?network=${network}&pageSize=100&page=${page}`;
    const { nodes, page: at } = await get(url);
    for (const asset of nodes) {
      if (!(asset.deployments ?? []).some((d) => d.network === network)) {
        fail(`${url} lists ${asset.symbol} with no ${network} deployment`);
      }
      backedAsset(asset, [network]);
    }
    if (!at?.hasNextPage) break;
  }
}
for (const symbol of BTOKENS) {
  const asset = await get(`${STOCK_ISSUERS.backed.source}/${symbol}`);
  if (asset.symbol !== symbol) fail(`${symbol}: Backed's API answered with ${asset.symbol}`);
  backedAsset(asset, BTOKEN_NETWORKS);
}
for (const { asset, deployment } of backed.values()) {
  const chainId = BACKED_NETWORKS[deployment.network];
  add(chainId, "backed", asset.symbol, deployment.address, asset.name, asset.underlyingSymbol);
}

// Ondo: the registry page's own table, `export const tokenRows = [...]` in its Markdown source.
{
  const page = await get(`${STOCK_ISSUERS.ondo.source}.md`, "text");
  const start = page.indexOf("export const tokenRows = [");
  const end = page.indexOf("];", start);
  if (start < 0 || end < 0) fail(`${STOCK_ISSUERS.ondo.source}.md has no tokenRows table`);
  const rows = [...page.slice(start, end).matchAll(/\{([^{}]*)\}/g)].map(([, body]) =>
    Object.fromEntries(
      [...body.matchAll(/(\w+):\s*"((?:[^"\\]|\\.)*)"/g)].map(([, key, value]) => [key, value]),
    ),
  );
  if (rows.length === 0) fail(`${STOCK_ISSUERS.ondo.source}.md: tokenRows parsed to nothing`);
  const live = new Set((await get(ONDO_LIVE)).assets.map((asset) => asset.symbol));
  for (const row of rows) {
    if ((row.type === "Stock" || row.type === "ETF") && row.ethAddr && live.has(row.symbol)) {
      add(1, "ondo", row.symbol, row.ethAddr, row.name, row.ticker);
      if (row.solAddr) add(SOLANA, "ondo", row.symbol, row.solAddr, row.name, row.ticker);
    }
  }
}

// Coinbase: one list, every token on Base.
const coinbaseDecimals = new Set();
{
  const { tokens } = await get(STOCK_ISSUERS.coinbase.source);
  for (const token of tokens) {
    if (!token.symbol.endsWith("c")) fail(`Coinbase lists ${token.symbol}, which is not <ticker>c`);
    coinbaseDecimals.add(token.decimals);
    add(
      8453,
      "coinbase",
      token.symbol,
      token.contract_address,
      token.name,
      token.symbol.slice(0, -1),
    );
  }
}
if (coinbaseDecimals.size !== 1) fail(`Coinbase's tokens have decimals ${[...coinbaseDecimals]}`);

// Backpack Securities: each "<ticker>.US" asset's Solana mint, where deposits are open.
const backpackDecimals = new Set();
{
  const assets = await get(STOCK_ISSUERS.backpack.source);
  for (const asset of assets) {
    if (!asset.symbol.endsWith(".US")) continue;
    for (const token of asset.tokens ?? []) {
      if (token.blockchain !== "Solana" || !token.contractAddress || !token.depositEnabled)
        continue;
      backpackDecimals.add(token.nativeDecimals);
      const ticker = asset.symbol.slice(0, -".US".length);
      add(SOLANA, "backpack", asset.symbol, token.contractAddress, asset.displayName, ticker);
    }
  }
}
if (backpackDecimals.size !== 1) fail(`Backpack's tokens have decimals ${[...backpackDecimals]}`);

// PreStocks: the products its page carries, each `{"symbol":…,"name":…,…,"splMint":…}` in the
// page's own data (escaped, as the page embeds it). Every mint the page gives must be one of them.
{
  const page = await get(STOCK_ISSUERS.prestocks.source, "text");
  const q = String.raw`\\"`;
  const product = new RegExp(
    `\\{${q}symbol${q}:${q}([A-Z0-9]+)${q},${q}name${q}:${q}([^"\\\\]+)${q}[^{}]*?` +
      `${q}splMint${q}:${q}([1-9A-HJ-NP-Za-km-z]{32,44})${q}`,
    "g",
  );
  const products = [...page.matchAll(product)];
  const mints = new Set(page.match(/(?<=splMint\\":\\")[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? []);
  if (products.length === 0) fail(`${STOCK_ISSUERS.prestocks.source} lists no product`);
  if (new Set(products.map(([, , , mint]) => mint)).size !== mints.size) {
    fail(`${STOCK_ISSUERS.prestocks.source} gives a mint this script cannot read a product for`);
  }
  for (const [, symbol, name, mint] of products) {
    // A product appears on the page more than once; it is copied once.
    if (
      lists
        .get(SOLANA)
        ?.get("prestocks")
        ?.some(([, at]) => at === mint)
    )
      continue;
    add(SOLANA, "prestocks", symbol, mint, name, symbol);
  }
}

// Mt Pelerin: the one token its shareholder page gives, which the page must still give.
{
  const page = await get(STOCK_ISSUERS.mtpelerin.source, "text");
  if (!page.toLowerCase().includes(MT_PELERIN.address)) {
    fail(`${STOCK_ISSUERS.mtpelerin.source} no longer gives ${MT_PELERIN.address} for MPS`);
  }
  const { symbol, address, name, ticker } = MT_PELERIN;
  add(1, "mtpelerin", symbol, address, name, ticker);
}

const DECIMALS = {
  backed: 18,
  ondo: 18,
  coinbase: [...coinbaseDecimals][0],
  mtpelerin: 0,
  [SOLANA]: { backed: 8, ondo: 9, backpack: [...backpackDecimals][0], prestocks: 9 },
};
const ORDER = { 1: ["backed", "ondo", "mtpelerin"], 8453: ["coinbase", "backed"] };
const SVM_ORDER = { [SOLANA]: ["backed", "ondo", "backpack", "prestocks"] };
const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

let total = 0;
/** One chain's (or cluster's) lists, as the generated table's entries for `key`. */
function render(key, issuers, decimals) {
  let text = `  ${JSON.stringify(key)}: [\n`;
  for (const issuer of issuers) {
    const rows = lists.get(key)?.get(issuer);
    if (rows === undefined) continue;
    const seen = new Set();
    for (const [symbol] of rows) {
      if (seen.has(symbol)) fail(`${issuer} lists ${symbol} twice on ${key}`);
      seen.add(symbol);
    }
    total += rows.length;
    text += `    {\n      issuer: "${issuer}",\n      decimals: ${decimals[issuer]},\n      tokens: [\n`;
    for (const row of rows.sort(byCode)) {
      text += `        [${row.map((cell) => JSON.stringify(cell)).join(", ")}],\n`;
    }
    text += `      ],\n    },\n`;
  }
  return `${text}  ],\n`;
}
const body = Object.entries(ORDER)
  .map(([chainId, issuers]) => render(Number(chainId), issuers, DECIMALS))
  .join("")
  // An EVM chain's key is its id, unquoted.
  .replace(/^ {2}"(\d+)":/gm, "  $1:");
const svmBody = Object.entries(SVM_ORDER)
  .map(([cluster, issuers]) => render(cluster, issuers, DECIMALS[cluster]))
  .join("");

writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/sync-stock-tokens.mjs from each issuer's own published list
// (STOCK_ISSUERS in ./stock-tokens.ts). Each row is \`[symbol, address, name, ticker]\`.
// test/token-registry-evidence.test.ts holds every one to the chain.
import type { StockList } from "./stock-tokens.js";
import type { SvmTokenCluster } from "./token-registry.js";

/** Keyed by canonical EVM chain id, like \`TOKEN_REGISTRY\`. */
export const STOCK_TOKENS: Readonly<Record<number, readonly StockList[]>> = {
${body}};

/** Keyed by Solana cluster, like \`SVM_TOKEN_REGISTRY\`: each address is a Token-2022 mint's. */
export const SVM_STOCK_TOKENS: Readonly<Partial<Record<SvmTokenCluster, readonly StockList[]>>> = {
${svmBody}};
`,
);
console.log(`sync-stock-tokens: ${total} tokens -> ${OUT}`);
