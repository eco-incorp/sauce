// Captures the on-chain evidence `test/token-registry-evidence.test.ts` checks the token registry
// against.
//
//   node scripts/capture-token-registry.mjs --recapture --rpc-config rpc.config.json \
//     [--chains <id>[,<id>…]]
//
// For every EVM row of `TOKEN_REGISTRY` (read from `src`, so no build is needed) it records, at
// one block per chain: the size of the code at the address (a Base B20 token is the one byte
// `0xef`), `symbol()` and `decimals()`. `--chains` recaptures only those chains and keeps every
// other chain's evidence as it is. Nothing else reads the network: the test is offline and only
// ever reads what this writes.
//
// RPC endpoints come only from the file `--rpc-config` names: a JSON object mapping each chain id to
// its URL, `{ "<chainId>": "<url>" }`, the file `capture-registry-abi.mjs` reads. There is no
// default and no public fallback, and nothing is read from the environment. Before anything is
// fetched, the script fails listing every chain id the registry needs that the file does not give.
// No URL is ever written to the fixture or printed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decodeAbiParameters, hexToString } from "viem";

import { createTsLoader } from "./lib/load-ts.mjs";

const USAGE =
  "usage: node scripts/capture-token-registry.mjs --recapture --rpc-config <path> " +
  "[--chains <id>[,<id>…]]";

function fail(message) {
  console.error(`capture-token-registry: ${message}`);
  process.exit(1);
}

let cli;
try {
  cli = parseArgs({
    options: {
      recapture: { type: "boolean", default: false },
      "rpc-config": { type: "string" },
      chains: { type: "string" },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
if (!cli.values.recapture) fail(`refusing to touch the network without --recapture\n${USAGE}`);
if (cli.values["rpc-config"] === undefined) {
  fail(
    "pass --rpc-config <path>, a JSON object of chain id -> RPC URL (copy " +
      `rpc.config.example.json to the gitignored rpc.config.json)\n${USAGE}`,
  );
}

function readRpcConfig(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(`cannot read --rpc-config ${path}: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`--rpc-config ${path} must be a JSON object of chain id -> RPC URL`);
  }
  const urls = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[1-9][0-9]*$/.test(key)) fail(`--rpc-config ${path}: "${key}" is not a chain id`);
    // A value still holding the example's `<…>` placeholder is not configured.
    if (typeof value !== "string" || !/^https?:\/\//.test(value)) continue;
    urls.set(Number(key), value);
  }
  return urls;
}

const RPC_URLS = readRpcConfig(cli.values["rpc-config"]);
const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(SDK, "test", "fixtures", "token-registry", "evidence.json");
const { TOKEN_REGISTRY } = createTsLoader(SDK)("src/routes/token-registry.ts");

const ALL = Object.keys(TOKEN_REGISTRY).map(Number);
const CHAINS =
  cli.values.chains === undefined
    ? ALL
    : cli.values.chains.split(",").map((part) => {
        const id = Number(part.trim());
        if (!ALL.includes(id))
          fail(`--chains: ${part.trim()} is not a chain the registry has rows on`);
        return id;
      });
const missing = CHAINS.filter((id) => !RPC_URLS.has(id));
if (missing.length > 0) fail(`--rpc-config gives no URL for chain(s) ${missing.join(", ")}`);

/** JSON-RPC requests to `chainId`, 100 to a batch; each result, or `null` where one errored. */
async function rpc(chainId, requests) {
  const results = [];
  for (let at = 0; at < requests.length; at += 100) {
    const batch = requests
      .slice(at, at + 100)
      .map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }));
    let answer;
    for (let attempt = 1; answer === undefined; attempt++) {
      try {
        const response = await fetch(RPC_URLS.get(chainId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!Array.isArray(body)) throw new Error("the endpoint does not answer a JSON-RPC batch");
        answer = body;
      } catch (err) {
        // The error is the endpoint's; it is not printed, since a URL can carry a key.
        if (attempt === 4) fail(`chain ${chainId}: the RPC failed four times (${err.name})`);
        await new Promise((done) => setTimeout(done, 2_000 * attempt));
      }
    }
    const byId = new Map(answer.map((entry) => [entry.id, entry]));
    for (let id = 0; id < batch.length; id++) results.push(byId.get(id)?.result ?? null);
  }
  return results;
}

/** An ERC-20 `symbol()`: an ABI string, or the bytes32 some older tokens return. */
function symbolOf(hex) {
  if (typeof hex !== "string" || hex === "0x") return null;
  try {
    return decodeAbiParameters([{ type: "string" }], hex)[0];
  } catch {
    return hex.length === 66 ? hexToString(hex, { size: 32 }).replace(/\0+$/, "") : null;
  }
}

const decimalsOf = (hex) =>
  typeof hex === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(hex) ? Number(BigInt(hex)) : null;

let previous = { chains: {} };
try {
  previous = JSON.parse(readFileSync(FIXTURE, "utf-8"));
} catch {
  // No evidence yet: every chain is captured.
}
const chains = { ...previous.chains };
for (const chainId of CHAINS) {
  const [head] = await rpc(chainId, [["eth_blockNumber", []]]);
  if (typeof head !== "string") fail(`chain ${chainId}: no block number`);
  const block = Number(BigInt(head));
  const rows = TOKEN_REGISTRY[chainId];
  const at = `0x${block.toString(16)}`;
  const answers = await rpc(
    chainId,
    rows.flatMap((row) => [
      ["eth_getCode", [row.address, at]],
      ["eth_call", [{ to: row.address, data: "0x95d89b41" }, at]],
      ["eth_call", [{ to: row.address, data: "0x313ce567" }, at]],
    ]),
  );
  const tokens = {};
  rows.forEach((row, index) => {
    const [code, symbol, decimals] = answers.slice(3 * index, 3 * index + 3);
    tokens[row.address] = {
      code: typeof code === "string" ? (code.length - 2) / 2 : null,
      symbol: symbolOf(symbol),
      decimals: decimalsOf(decimals),
    };
  });
  chains[chainId] = { block, tokens };
  console.log(`capture-token-registry: chain ${chainId}, block ${block}: ${rows.length} tokens`);
}

// One token a line, so a recapture diffs by token.
const lines = ["{", '  "chains": {'];
const ids = Object.keys(chains).sort((a, b) => Number(a) - Number(b));
ids.forEach((id, i) => {
  const { block, tokens } = chains[id];
  lines.push(`    "${id}": {`, `      "block": ${block},`, '      "tokens": {');
  const entries = Object.entries(tokens);
  entries.forEach(([address, evidence], j) => {
    const comma = j === entries.length - 1 ? "" : ",";
    lines.push(`        ${JSON.stringify(address)}: ${JSON.stringify(evidence)}${comma}`);
  });
  lines.push("      }", `    }${i === ids.length - 1 ? "" : ","}`);
});
lines.push("  }", "}", "");
mkdirSync(dirname(FIXTURE), { recursive: true });
writeFileSync(FIXTURE, lines.join("\n"));
