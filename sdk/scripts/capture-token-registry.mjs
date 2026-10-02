// Captures the on-chain evidence `test/token-registry-evidence.test.ts` checks the token registry
// against.
//
//   node scripts/capture-token-registry.mjs --recapture --rpc-config rpc.config.json \
//     [--chains <id>[,<id>…]]
//
// For every EVM row of `TOKEN_REGISTRY` (read from `src`, so no build is needed) it records, at
// one block per chain: the size of the code at the address (a Base B20 token is the one byte
// `0xef`), `symbol()` and `decimals()`. For every mint `SVM_TOKEN_REGISTRY` registers on
// mainnet-beta, under Solana's chain id (1399811149), it records the mint as the cluster finalized
// it: the program that owns it, whether it is initialized, its decimals, its metadata symbol (a
// Token-2022 mint's own TokenMetadata, else its Metaplex metadata), whether any of it is minted, and
// why a checked transfer of it would be refused (`resolveSvmToken`'s `transferRefusals`: a transfer
// hook that names a program, a paused mint, ...), each read with `getMultipleAccounts`, 300 accounts
// a request. `--chains` recaptures only those chains and keeps every other chain's evidence as it
// is. Nothing else reads the network: the test is offline and only ever reads what this writes.
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
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
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
const load = createTsLoader(SDK);
const { SVM_TOKEN_REGISTRY, TOKEN_REGISTRY } = load("src/routes/token-registry.ts");
const { resolveSvmToken } = load("src/svm/token-accounts.ts");
const { T22_TLV_START, isToken2022Mint } = load("src/svm/token-program.ts");

/** Solana's canonical chain id: its evidence is mainnet-beta's mints. */
const SOLANA = 1399811149;
const ALL = [...Object.keys(TOKEN_REGISTRY).map(Number), SOLANA];
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

/** Solana JSON-RPC: `getMultipleAccounts` for `keys`, 100 a call and three calls a request (300
 *  accounts), with a pause between requests. Each account as `{ owner, data }`, or `null` where
 *  there is none; and the lowest slot the answers were read at. */
async function solanaAccounts(keys) {
  const accounts = new Map();
  let slot = Infinity;
  for (let at = 0; at < keys.length; at += 300) {
    const chunk = keys.slice(at, at + 300);
    const batch = [];
    for (let i = 0; i < chunk.length; i += 100) {
      const params = [chunk.slice(i, i + 100), { encoding: "base64", commitment: "finalized" }];
      batch.push({ jsonrpc: "2.0", id: batch.length, method: "getMultipleAccounts", params });
    }
    let answer;
    for (let attempt = 1; answer === undefined; attempt++) {
      try {
        const response = await fetch(RPC_URLS.get(SOLANA), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (!Array.isArray(body) || body.some((entry) => entry.result === undefined)) {
          throw new Error("the endpoint does not answer the batch");
        }
        answer = body;
      } catch (err) {
        // The error is the endpoint's; it is not printed, since a URL can carry a key.
        if (attempt === 4) fail(`chain ${SOLANA}: the RPC failed four times (${err.name})`);
        await new Promise((done) => setTimeout(done, 2_000 * attempt));
      }
    }
    for (const { id, result } of answer) {
      slot = Math.min(slot, result.context.slot);
      result.value.forEach((value, i) => {
        accounts.set(
          chunk[id * 100 + i],
          value === null
            ? null
            : { owner: value.owner, data: new Uint8Array(Buffer.from(value.data[0], "base64")) },
        );
      });
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  return { accounts, slot };
}

const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
/** Token-2022's TokenMetadata extension: update authority, mint, then name, symbol, uri. */
const TOKEN_METADATA = 19;
const u32 = (data, at) => new DataView(data.buffer, data.byteOffset).getUint32(at, true);
/** A Borsh string at `at`: its text, without the NUL padding Metaplex writes, and where it ends. */
function borshString(data, at) {
  const length = u32(data, at);
  const text = new TextDecoder().decode(data.subarray(at + 4, at + 4 + length));
  return [text.replace(/\0+$/, ""), at + 4 + length];
}

/** The symbol in a Token-2022 mint's own TokenMetadata, or `undefined` where it has none. */
function ownMetadataSymbol(data) {
  if (!isToken2022Mint(data)) return undefined;
  for (let at = T22_TLV_START; at + 4 <= data.length;) {
    const type = data[at] | (data[at + 1] << 8);
    const length = data[at + 2] | (data[at + 3] << 8);
    if (type === 0) break;
    if (type === TOKEN_METADATA) {
      const [, afterName] = borshString(data, at + 4 + 64);
      return borshString(data, afterName)[0];
    }
    at += 4 + length;
  }
  return undefined;
}

/** Every mainnet-beta mint, as the evidence records it, at the slot it was read. */
async function captureSolana(rows) {
  const { accounts, slot } = await solanaAccounts(rows.map((row) => row.mint));
  // A mint with no metadata of its own has Metaplex's, at its PDA.
  const metaplex = new Map();
  for (const row of rows) {
    const account = accounts.get(row.mint);
    if (account === null || ownMetadataSymbol(account.data) !== undefined) continue;
    const [pda] = await getProgramDerivedAddress({
      programAddress: address(METAPLEX),
      seeds: [
        "metadata",
        getAddressEncoder().encode(address(METAPLEX)),
        getAddressEncoder().encode(address(row.mint)),
      ],
    });
    metaplex.set(row.mint, pda);
  }
  const { accounts: metadata } = await solanaAccounts([...metaplex.values()]);
  const tokens = {};
  for (const row of rows) {
    const account = accounts.get(row.mint);
    if (account === null) {
      tokens[row.mint] = { program: null };
      continue;
    }
    let symbol = ownMetadataSymbol(account.data);
    if (symbol === undefined) {
      const found = metadata.get(metaplex.get(row.mint));
      // Metaplex metadata: a key byte, the update authority and the mint, then name and symbol.
      symbol =
        found?.owner === METAPLEX
          ? borshString(found.data, borshString(found.data, 65)[1])[0]
          : null;
    }
    let refusals = null;
    try {
      const resolved = await resolveSvmToken(async () => account, address(row.mint));
      refusals = [...resolved.transferRefusals];
    } catch {
      // Not an initialized mint of either program: `initialized` and `program` say which.
    }
    const supply = new DataView(account.data.buffer, account.data.byteOffset).getBigUint64(
      36,
      true,
    );
    tokens[row.mint] = {
      program: account.owner,
      initialized: account.data[45] === 1,
      decimals: account.data[44],
      symbol,
      minted: supply > 0n,
      refusals,
    };
  }
  return { slot, tokens };
}

let previous = { chains: {} };
try {
  previous = JSON.parse(readFileSync(FIXTURE, "utf-8"));
} catch {
  // No evidence yet: every chain is captured.
}
const chains = { ...previous.chains };
for (const chainId of CHAINS) {
  if (chainId === SOLANA) {
    const rows = SVM_TOKEN_REGISTRY["mainnet-beta"];
    chains[chainId] = await captureSolana(rows);
    console.log(
      `capture-token-registry: chain ${chainId}, slot ${chains[chainId].slot}: ${rows.length} mints`,
    );
    continue;
  }
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
  const { block, slot, tokens } = chains[id];
  // An EVM chain's evidence is at a block, Solana's at a slot.
  const at = slot === undefined ? `"block": ${block}` : `"slot": ${slot}`;
  lines.push(`    "${id}": {`, `      ${at},`, '      "tokens": {');
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
