#!/usr/bin/env node
// Copies the tokenized stocks the registry carries from each issuer's own published list into
// `src/routes/stock-tokens.generated.ts`: Backed's API (xStocks and bTokens), Ondo's token
// registry page, and Coinbase's tokenized-stocks API (`STOCK_ISSUERS` in `src/routes/stock-tokens.ts`
// names each). Nothing here reads a chain: the issuer's list says which token is at which address,
// and `capture-token-registry.mjs` then reads each one on chain for the evidence fixture, which
// `test/token-registry-evidence.test.ts` holds every row to. A row this adds fails that test until
// the evidence is recaptured.
//
// WHAT IS COPIED, per issuer, for Ethereum (1) and Base (8453), the release's EVM chains:
//   - Backed: every asset its list deploys on either chain, and the bTokens below, which its list
//     leaves out and only `/<symbol>` serves. Only the equity ones: its bond and bill bTokens are
//     not stocks.
//   - Ondo: every Ethereum address on the registry page of a token of type Stock or ETF that
//     Ondo's app lists (ONDO_LIVE): the page also carries tokens not launched yet. Its portfolio
//     tokens and USDon are not stocks.
//   - Coinbase: every token the API lists. Each is a B20 token on Base.
// Decimals are each list's: Coinbase's API gives them; Backed and Ondo publish none, and all of
// their tokens have 18, which the evidence holds.
//
// Review the diff before committing it: a changed address is a token the issuer moved.
//
// Run: `pnpm --filter './sdk' sync-stock-tokens`, then `capture-token-registry`.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import { createTsLoader } from "./lib/load-ts.mjs";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(SDK, "src/routes/stock-tokens.generated.ts");
const { STOCK_ISSUERS, stockSymbol } = createTsLoader(SDK)("src/routes/stock-tokens.ts");

/** Backed's network names, for the chains copied. */
const BACKED_NETWORKS = { Ethereum: 1, Base: 8453 };
/** Ondo's app's asset list: the tokens it trades, which a token not launched yet is not in. */
const ONDO_LIVE = "https://app.ondo.finance/api/v2/assets";
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

/** chain id -> issuer -> rows, each `[symbol, address, name, ticker]`. */
const lists = new Map();
function add(chainId, issuer, symbol, address, name, ticker) {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    fail(`${issuer} lists ${symbol} on chain ${chainId} at ${address}, not an EVM address`);
  }
  const byIssuer = lists.get(chainId) ?? lists.set(chainId, new Map()).get(chainId);
  const rows = byIssuer.get(issuer) ?? byIssuer.set(issuer, []).get(issuer);
  rows.push([stockSymbol(symbol), getAddress(address), name.trim(), ticker.trim()]);
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
  backedAsset(asset, Object.keys(BACKED_NETWORKS));
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

const DECIMALS = { backed: 18, ondo: 18, coinbase: [...coinbaseDecimals][0] };
const ORDER = { 1: ["backed", "ondo"], 8453: ["coinbase", "backed"] };
const byCode = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

let body = "";
let total = 0;
for (const [chainId, issuers] of Object.entries(ORDER)) {
  body += `  ${chainId}: [\n`;
  for (const issuer of issuers) {
    const rows = lists.get(Number(chainId))?.get(issuer);
    if (rows === undefined) continue;
    const seen = new Set();
    for (const [symbol] of rows) {
      if (seen.has(symbol)) fail(`${issuer} lists ${symbol} twice on chain ${chainId}`);
      seen.add(symbol);
    }
    total += rows.length;
    body += `    {\n      issuer: "${issuer}",\n      decimals: ${DECIMALS[issuer]},\n      tokens: [\n`;
    for (const row of rows.sort(byCode)) {
      body += `        [${row.map((cell) => JSON.stringify(cell)).join(", ")}],\n`;
    }
    body += `      ],\n    },\n`;
  }
  body += `  ],\n`;
}

writeFileSync(
  OUT,
  `// GENERATED FILE — do not edit by hand.
//
// Written by sdk/scripts/sync-stock-tokens.mjs from each issuer's own published list
// (STOCK_ISSUERS in ./stock-tokens.ts). Each row is \`[symbol, address, name, ticker]\`.
// test/token-registry-evidence.test.ts holds every one to the chain.
import type { StockList } from "./stock-tokens.js";

/** Keyed by canonical EVM chain id, like \`TOKEN_REGISTRY\`. */
export const STOCK_TOKENS: Readonly<Record<number, readonly StockList[]>> = {
${body}};
`,
);
console.log(`sync-stock-tokens: ${total} tokens -> ${OUT}`);
