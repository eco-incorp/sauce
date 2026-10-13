// Captures tokenized-stock mints as Solana mainnet-beta finalized them, into
// `test/svm/fixtures/token-2022/stock-mints.json`: the images the Token-2022 suites plant at each
// mint's registry address, unchanged but for its mint authority.
//
//   node scripts/capture-stock-mints.mjs --recapture --rpc-config rpc.config.json <symbol>…
//
// Each symbol is a stock `SVM_TOKEN_REGISTRY` registers on mainnet-beta (read from `src`, so no
// build is needed). The mints are read in one `getMultipleAccounts`, finalized, and each is written
// with its issuer, address, owning program, size, decimals, the extensions it carries, the slot it
// was read at and its data. A mint already in the file and not named is kept as it is.
//
// RPC endpoints come only from the file `--rpc-config` names, a JSON object of chain id to URL (the
// file `capture-registry-abi.mjs` reads); Solana's is under 1399811149. There is no default and no
// public fallback, nothing is read from the environment, and no URL is ever printed or written.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createTsLoader } from "./lib/load-ts.mjs";

const USAGE =
  "usage: node scripts/capture-stock-mints.mjs --recapture --rpc-config <path> <symbol>…";
const SOLANA = "1399811149";

function fail(message) {
  console.error(`capture-stock-mints: ${message}`);
  process.exit(1);
}

let cli;
try {
  cli = parseArgs({
    options: { recapture: { type: "boolean", default: false }, "rpc-config": { type: "string" } },
    allowPositionals: true,
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
if (!cli.values.recapture) fail(`refusing to touch the network without --recapture\n${USAGE}`);
if (cli.values["rpc-config"] === undefined) fail(`pass --rpc-config <path>\n${USAGE}`);
if (cli.positionals.length === 0) fail(`name at least one stock symbol\n${USAGE}`);

let config;
try {
  config = JSON.parse(readFileSync(cli.values["rpc-config"], "utf8"));
} catch (err) {
  fail(`cannot read --rpc-config: ${err.message}`);
}
const url = config?.[SOLANA];
if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
  fail(`--rpc-config gives no URL for Solana (${SOLANA})`);
}

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(SDK, "test", "svm", "fixtures", "token-2022", "stock-mints.json");
const load = createTsLoader(SDK);
const { SVM_TOKEN_REGISTRY } = load("src/routes/token-registry.ts");
const { STOCK_ISSUERS } = load("src/routes/stock-tokens.ts");

const rows = cli.positionals.map((symbol) => {
  const row = SVM_TOKEN_REGISTRY["mainnet-beta"].find((one) => one.symbol === symbol);
  if (row?.stock === undefined) fail(`${symbol} is not a stock mainnet-beta registers`);
  return row;
});

// Token-2022's extension types, by number, as the file names them.
const EXTENSIONS = {
  1: "transferFeeConfig",
  3: "mintCloseAuthority",
  4: "confidentialTransferMint",
  6: "defaultAccountState",
  9: "nonTransferable",
  10: "interestBearingConfig",
  12: "permanentDelegate",
  14: "transferHook",
  16: "confidentialTransferFeeConfig",
  18: "metadataPointer",
  19: "tokenMetadata",
  20: "groupPointer",
  21: "tokenGroup",
  22: "groupMemberPointer",
  23: "tokenGroupMember",
  25: "scaledUiAmountConfig",
  26: "pausableConfig",
};

function extensionsOf(data) {
  const names = [];
  // A mint with extensions: 82 bytes, padding to 165, the type byte, then (type, length, value).
  for (let at = 166; at + 4 <= data.length;) {
    const type = data[at] | (data[at + 1] << 8);
    const length = data[at + 2] | (data[at + 3] << 8);
    if (type === 0) break;
    names.push(EXTENSIONS[type] ?? `extension${type}`);
    at += 4 + length;
  }
  return names;
}

let answer;
for (let attempt = 1; answer === undefined; attempt++) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [rows.map((row) => row.mint), { encoding: "base64", commitment: "finalized" }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.result === undefined) throw new Error("no result");
    answer = body.result;
  } catch (err) {
    // The error is the endpoint's; it is not printed, since a URL can carry a key.
    if (attempt === 4) fail(`the RPC failed four times (${err.name})`);
    await new Promise((done) => setTimeout(done, 2_000 * attempt));
  }
}

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
rows.forEach((row, index) => {
  const value = answer.value[index];
  if (value === null) fail(`${row.symbol}: the mint ${row.mint} has no account`);
  const data = new Uint8Array(Buffer.from(value.data[0], "base64"));
  if (value.owner !== row.tokenProgram) {
    fail(`${row.symbol}: owned by ${value.owner}, not the registry's ${row.tokenProgram}`);
  }
  fixture.mints[row.symbol] = {
    issuer: STOCK_ISSUERS[row.stock.issuer].name,
    mint: row.mint,
    owner: value.owner,
    space: data.length,
    decimals: data[44],
    extensions: extensionsOf(data),
    slot: answer.context.slot,
    dataBase64: value.data[0],
  };
  console.log(
    `${row.symbol}: ${data.length} bytes at slot ${answer.context.slot}, ` +
      `${fixture.mints[row.symbol].extensions.join(", ")}`,
  );
});
writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
