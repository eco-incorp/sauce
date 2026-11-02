// Captures the on-chain evidence `test/registry-abi.test.ts` checks the protocol registry against.
//
//   node scripts/capture-registry-abi.mjs --recapture --rpc-config rpc.config.json \
//     [--chains <id>[,<id>…]] [--no-cache] [slug ...]
//
// Run after `pnpm build` (it reads the registry from `dist/`). With slugs, only those protocols are
// recaptured and the rest of the fixture is kept. `--chains` narrows that to those chains'
// deployments, keeping every other chain's captured evidence as it is. `--no-cache` ignores the
// response cache. Nothing else reads the network: the test is offline and only ever reads what this
// writes.
//
// For every contract instance in `test/fixtures/registry-abi/targets.json` it records:
//   - which selectors the deployed code dispatches, after resolving proxies (EIP-1167 clones,
//     EIP-1967 implementation and beacon slots, the legacy zeppelinos, EIP-1822 and Synthetix slots,
//     `implementation()`-style getters) and selector routers (EIP-2535 `facets`/`facetAddress`, 0x's
//     `getFunctionImplementation`, Paraswap's `getImplementation`, Pendle's `selectorToFacet`,
//     Fluid's `getSigsImplementation`);
//   - its FULL verified ABI, from Sourcify, then Blockscout, then a keyless Etherscan-compatible
//     API: every function, event and custom error of the implementation layer(s) and of every facet
//     a selector router reaches. Of a proxy layer that delegates to another (a wrapper), only what
//     the registry already declares by name: a proxy's admin functions are not the contract's.
// The candidate selectors are the same for every instance of one ABI export: the union of every
// instance's verified functions, the registry's own, the target's `probes` (signatures to ask a
// selector router about when the registry's are wrong), and the functions of the export's reference
// interfaces (`reference/index.json`: a public interface for a contract with no verified source).
// Dispatch is recorded for EVERY candidate on EVERY instance, because the registry's ABI is that
// union and a program compiled for a chain may call only what that chain's deployment dispatches
// (`gen-registry-abis.mjs` and `gen-source-globals.mjs` derive both from what this writes).
//
// Events and errors are the same union: for each, where the deployed code carries it (an event's
// topic is a PUSH32 before its LOG, a custom error's selector a PUSH4, or a left-aligned PUSH32,
// before its REVERT), or null; and one real log of each event a target lists under `logs`, from the
// newest blocks of the first deployment that emitted one, which the test decodes with the
// registry's own declaration.
//
// RPC endpoints come only from the file `--rpc-config` names: a JSON object mapping each chain id to
// its URL, or to a list of URLs a failed request moves along (`{ "<chainId>": "<url>" }`,
// `{ "<chainId>": ["<url>", "<url>"] }`). There is no default and no public fallback, and nothing is
// read from the environment. Keep yours at `sdk/rpc.config.json`, which is gitignored; copy
// `sdk/rpc.config.example.json` to start. Before anything is fetched, the script fails listing every
// chain id the selected deployments need that the file does not give. No URL is ever written to the
// fixture.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decodeAbiParameters, keccak256, toEventSelector, toFunctionSelector } from "viem";

const USAGE =
  "usage: node scripts/capture-registry-abi.mjs --recapture --rpc-config <path> " +
  "[--chains <id>[,<id>…]] [--no-cache] [slug ...]";

function fail(message) {
  console.error(`capture-registry-abi: ${message}`);
  process.exit(1);
}

let cli;
try {
  cli = parseArgs({
    allowPositionals: true,
    options: {
      recapture: { type: "boolean", default: false },
      "rpc-config": { type: "string" },
      chains: { type: "string" },
      "no-cache": { type: "boolean", default: false },
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
const RPC_CONFIG_PATH = cli.values["rpc-config"];
/** chainId -> the URLs, in order, exactly as the developer's config gives them. */
const RPC_URLS = readRpcConfig(RPC_CONFIG_PATH);
const CHAINS_ONLY =
  cli.values.chains === undefined ? null : new Set(parseChainIds(cli.values.chains));
const NO_CACHE = cli.values["no-cache"];

function parseChainIds(list) {
  const ids = list.split(",").map((part) => part.trim());
  const bad = ids.filter((id) => !/^[1-9][0-9]*$/.test(id));
  if (bad.length > 0) fail(`--chains takes decimal chain ids, got: ${bad.join(", ")}`);
  return ids.map(Number);
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
    const list = (Array.isArray(value) ? value : [value]).filter(
      (url) => typeof url === "string" && /^https?:\/\//.test(url),
    );
    if (list.length > 0) urls.set(Number(key), list);
  }
  return urls;
}

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(SDK, "test", "fixtures", "registry-abi");
const TARGETS = JSON.parse(readFileSync(join(FIXTURE_DIR, "targets.json"), "utf-8"));
const EVIDENCE_PATH = join(FIXTURE_DIR, "evidence.json");
const CACHE_DIR = join(SDK, "node_modules", ".cache", "registry-abi");
mkdirSync(CACHE_DIR, { recursive: true });

/** Blockscout v2 hosts, by chain. */
const BLOCKSCOUT = {
  1: "eth.blockscout.com",
  10: "optimism.blockscout.com",
  100: "gnosis.blockscout.com",
  130: "unichain.blockscout.com",
  137: "polygon.blockscout.com",
  324: "zksync.blockscout.com",
  8453: "base.blockscout.com",
  34443: "explorer.mode.network",
  42161: "arbitrum.blockscout.com",
  42220: "celo.blockscout.com",
  57073: "explorer.inkonchain.com",
  // Redirects to scrollscan.com, which serves the same Blockscout v2 API.
  534352: "scroll.blockscout.com",
  7777777: "explorer.zora.energy",
};

/** Keyless Etherscan-compatible APIs: Routescan's, and zkSync Era's own explorer. */
const routescan = (chainId) =>
  `https://api.routescan.io/v2/network/mainnet/evm/${chainId}/etherscan/api`;
const ETHERSCAN_COMPATIBLE = {
  ...Object.fromEntries(
    [1, 10, 56, 146, 8453, 34443, 42161, 43114, 59144, 81457].map((c) => [
      c,
      ["routescan", routescan(c)],
    ]),
  ),
  324: ["zksync-explorer", "https://block-explorer-api.mainnet.zksync.io/api"],
};

/** zkSync Era runs EraVM bytecode: no PUSH4 dispatcher to parse, so selectors are found by scan. */
const ERAVM = new Set([324]);

/** The URL attempt `attempt` of a request to `chainId` goes to: the config's list, in turn. */
function rpcUrl(chainId, attempt) {
  const urls = RPC_URLS.get(chainId);
  // main() checks every chain up front, so this is only reachable through a bug there.
  if (urls === undefined) throw new Error(`no RPC configured for chain ${chainId}`);
  return urls[attempt % urls.length];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One request to `url`, retried there alone: the answer is that endpoint's, or it throws. */
async function rpcAt(chainId, url, method, params, attempts) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json();
      if (body.error) {
        // A revert is an answer, not a transport failure.
        if (method === "eth_call" && isRevert(body.error)) return null;
        throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
      }
      return body.result;
    } catch (err) {
      if (attempt >= attempts - 1) {
        throw new Error(`chain ${chainId} ${method} failed: ${err.message}`, { cause: err });
      }
      await sleep(1000 * 2 ** Math.min(attempt, 4));
    }
  }
}

/** One request, retried along the config's URLs in turn. */
async function rpc(chainId, method, params) {
  const urls = RPC_URLS.get(chainId);
  const attempts = Math.max(5, 2 * urls.length + 1);
  for (let attempt = 0; ; attempt++) {
    try {
      return await rpcAt(chainId, rpcUrl(chainId, attempt), method, params, 1);
    } catch (err) {
      if (attempt >= attempts - 1) throw err;
      await sleep(1000 * 2 ** Math.min(attempt, 4));
    }
  }
}

/**
 * Whether a JSON-RPC error is the call's own revert, as nodes report one (code 3, or -32000/-32015
 * with an execution message), rather than a node refusing or failing the request.
 */
function isRevert(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (error?.code === 3) return true;
  return /revert|execution|invalid opcode|out of gas|stack underflow|bad instruction/.test(message);
}

/** Minimum spacing between requests to one host, so a free API's rate limit is not tripped. */
const SPACING_MS = {
  "sourcify.dev": 350,
  "api.routescan.io": 250,
  "block-explorer-api.mainnet.zksync.io": 250,
};
const nextSlot = new Map();
async function throttle(host) {
  const spacing = SPACING_MS[host] ?? 100;
  const at = Math.max(Date.now(), nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + spacing);
  if (at > Date.now()) await sleep(at - Date.now());
}

/**
 * JSON body, `null` for "not here" (404 / not verified). Throws when the API could not answer: a
 * rate limit or a server error after retries, and at once a refusal (401/403: a key wall or a
 * challenge page, which no retry passes), so a refused lookup is never recorded as "unverified".
 */
async function getJson(url) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      await throttle(host);
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 5) throw new Error(`${host}: ${err.message}`, { cause: err });
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error(`${host}: HTTP ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  }
}

const cached = new Map();
function memo(key, fn) {
  if (!cached.has(key)) {
    const promise = fn();
    cached.set(key, promise);
    // A failure is not an answer: forget it, so a later lookup asks again.
    promise.catch(() => cached.delete(key));
  }
  return cached.get(key);
}

function diskMemo(key, fn) {
  return memo(key, async () => {
    const path = join(CACHE_DIR, `${keccak256(new TextEncoder().encode(key)).slice(2, 18)}.json`);
    if (existsSync(path) && !NO_CACHE) {
      return JSON.parse(readFileSync(path, "utf-8")).value;
    }
    const value = await fn();
    // "Nothing here" is not cached: an unverified contract may be verified by the next recapture,
    // and an address with no code may have code by then.
    if (value !== null && value !== "0x") writeFileSync(path, JSON.stringify({ key, value }));
    return value;
  });
}

/**
 * An answer of nothing (no code, a zero word) is asked of each endpoint the config lists, each
 * request pinned to its endpoint, and the first that has something wins: a node that lags or drops
 * state answers empty, and an empty implementation slot would silently leave a proxy's
 * implementation out of its layers. Nothing is believed only when two endpoints that answered agree
 * (or when the config gives one endpoint, which nothing can corroborate); an endpoint that could
 * not answer is no vote, so one endpoint is never counted twice.
 */
async function consensus(chainId, method, params, empty) {
  const urls = RPC_URLS.get(chainId);
  let emptyAnswer;
  let emptyVotes = 0;
  const failures = [];
  for (const url of urls) {
    let answer;
    try {
      answer = await rpcAt(chainId, url, method, params, 3);
    } catch (err) {
      failures.push(err.message);
      continue;
    }
    if (!empty(answer)) return answer;
    emptyAnswer = answer;
    if (++emptyVotes >= Math.min(2, urls.length)) return emptyAnswer;
  }
  throw new Error(
    `chain ${chainId} ${method}: ${emptyVotes} endpoint(s) answered nothing and no other could ` +
      `confirm it (${failures.join("; ")})`,
  );
}
const getCode = (chainId, address) =>
  diskMemo(`code:${chainId}:${address.toLowerCase()}`, () =>
    consensus(chainId, "eth_getCode", [address, "latest"], (code) => !code || code === "0x"),
  );
const getSlot = (chainId, address, slot) =>
  memo(`slot:${chainId}:${address}:${slot}`, () =>
    consensus(
      chainId,
      "eth_getStorageAt",
      [address, slot, "latest"],
      (word) => typeof word !== "string" || !/[1-9a-f]/i.test(word.slice(2)),
    ),
  );
const call = (chainId, to, data) =>
  memo(`call:${chainId}:${to}:${data}`, () => rpc(chainId, "eth_call", [{ to, data }, "latest"]));

const ZERO = "0x0000000000000000000000000000000000000000";
const SLOTS = {
  eip1967: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  eip1967Beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  zeppelinos: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  eip1822: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
  // keccak256(abi.encode("io.synthetix.core-contracts.Proxy")): Synthetix v3 router proxies.
  synthetix: "0x5a648c35a2f5512218b4683cf10e03f5b7c9dc7346e1bf77d304ae97f60f592b",
};
/** Getters that name a proxy's implementation, tried on proxy-shaped code no slot resolved. */
const IMPL_GETTERS = {
  "implementation()": "0x5c60da1b",
  "comptrollerImplementation()": "0xbb82aa5e",
  "masterCopy()": "0xa619486e",
  "getImplementation()": "0xaaf10f42",
};
/** Selector routers: `lookup(bytes4) -> address`, asked of the instance (or its embedded diamond). */
const ROUTERS = {
  "facetAddress(bytes4)": "0xcdffacc6",
  "getFunctionImplementation(bytes4)": "0x972fdd26",
  "selectorToFacet(bytes4)": "0xae7473ac",
  "getImplementation(bytes4)": "0xdc9cc645",
  "getSigsImplementation(bytes4)": "0xa5fcc8bc",
};

/** `facetAddresses()`, the EIP-2535 loupe's facet list. */
const FACET_ADDRESSES = "0x52ef6b2c";
function decodeAddressArray(data) {
  if (!data || data.length < 130) return [];
  const hex = data.slice(2);
  const offset = parseInt(hex.slice(0, 64), 16) * 2;
  const length = parseInt(hex.slice(offset, offset + 64), 16);
  if (!Number.isSafeInteger(length) || length > 256) return [];
  const out = [];
  for (let i = 0; i < length; i++) {
    const word = hex.slice(offset + 64 + i * 64, offset + 128 + i * 64);
    out.push(`0x${word.slice(24)}`.toLowerCase());
  }
  return out.filter(isAddress);
}

const wordToAddress = (word) =>
  word && word.length === 66 && /^0x0{24}/.test(word) ? `0x${word.slice(-40)}`.toLowerCase() : null;
const isAddress = (a) => a !== null && a !== ZERO && /^0x[0-9a-f]{40}$/.test(a);

/** Small code that DELEGATECALLs: a proxy, whatever its storage layout. */
function proxyShaped(chainId, code) {
  if (ERAVM.has(chainId)) return (code.length - 2) / 2 < 16_384;
  return (code.length - 2) / 2 < 6_144 && opcodes(code).has(0xf4);
}

async function hasCode(chainId, address) {
  const code = await getCode(chainId, address);
  return Boolean(code && code !== "0x");
}

/** The proxy layers under `address`, outermost first. */
async function resolveLayers(chainId, address, seen = new Set()) {
  address = address.toLowerCase();
  if (seen.has(address) || seen.size > 6) return [];
  seen.add(address);
  const code = await getCode(chainId, address);
  if (!code || code === "0x") return [{ address, kind: "empty" }];
  const layers = [{ address, code }];
  const clone = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i.exec(code);
  const targets = [];
  if (clone) targets.push(["eip1167", `0x${clone[1].toLowerCase()}`]);
  for (const [kind, slot] of Object.entries(SLOTS)) {
    const target = wordToAddress(await getSlot(chainId, address, slot));
    if (!isAddress(target) || !(await hasCode(chainId, target))) continue;
    if (kind === "eip1967Beacon") {
      const impl = wordToAddress(await call(chainId, target, IMPL_GETTERS["implementation()"]));
      if (isAddress(impl)) targets.push(["beacon", impl]);
    } else targets.push([kind, target]);
  }
  if (targets.length === 0 && proxyShaped(chainId, code)) {
    for (const [getter, sel] of Object.entries(IMPL_GETTERS)) {
      const impl = wordToAddress(await call(chainId, address, sel));
      if (isAddress(impl) && impl !== address && (await hasCode(chainId, impl))) {
        targets.push([getter, impl]);
        break;
      }
    }
    // Gnosis Safe proxies keep the singleton in slot 0.
    if (targets.length === 0) {
      const impl = wordToAddress(await getSlot(chainId, address, "0x0"));
      if (isAddress(impl) && (await hasCode(chainId, impl)) && code.includes("a619486e")) {
        targets.push(["slot0", impl]);
      }
    }
  }
  for (const [kind, target] of targets) {
    const inner = await resolveLayers(chainId, target, seen);
    if (inner.length > 0) inner[0].kind = kind;
    layers.push(...inner);
  }
  // A layer that delegated to another is a wrapper: its own functions are its admin's.
  layers[0].wrapper = layers.length > 1;
  return layers;
}

/**
 * The selector-routing lookups the instance answers. A lookup counts only when it names no facet for
 * a selector nothing implements (0xffffffff): a catch-all fallback that echoes an address does not.
 */
async function routerLookups(chainId, address) {
  const found = [];
  for (const [lookup, lsel] of Object.entries(ROUTERS)) {
    const probe = await call(chainId, address, `${lsel}ffffffff${"0".repeat(56)}`);
    // The first word is the facet; some diamonds (Venus) also return the selector's position.
    if (typeof probe !== "string" || probe.length < 66) continue;
    if (wordToAddress(probe.slice(0, 66)) !== ZERO) continue;
    found.push([lookup, lsel]);
  }
  return found;
}

/**
 * The addresses a thin proxy hard-codes: PUSH20 constants, and PUSH32 words holding an address (how
 * Solidity inlines an `immutable address`).
 */
function embeddedAddresses(code) {
  const hex = code.slice(2);
  const out = new Set();
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    let imm = null;
    if (op === 0x73) imm = `0x${hex.slice(i + 2, i + 42)}`;
    if (op === 0x7f && /^0{24}/.test(hex.slice(i + 2, i + 26)))
      imm = `0x${hex.slice(i + 26, i + 66)}`;
    if (imm !== null) {
      imm = imm.toLowerCase();
      if (isAddress(imm) && !/^0x0{8}/.test(imm) && !/^0xf{8}/.test(imm)) out.add(imm);
    }
    if (op >= 0x60 && op <= 0x7f) i += 2 * (op - 0x5f);
  }
  return [...out];
}

/**
 * The Solidity libraries `codes` link, by address: each embedded address whose code is a deployed
 * library's, which opens with the call guard solc writes into every library (PUSH20 its own
 * address, ADDRESS, EQ). A library runs in its caller's context through DELEGATECALL, so what it
 * emits or reverts with is its caller's (Aave's Pool emits `Supply` from SupplyLogic). A library
 * links others in turn. None on EraVM, whose code is not EVM bytecode.
 */
async function linkedLibraries(chainId, codes) {
  const found = new Map();
  if (ERAVM.has(chainId)) return found;
  const tried = new Set();
  for (let frontier = codes.filter(Boolean); frontier.length > 0;) {
    const next = [];
    for (const code of frontier) {
      for (const address of embeddedAddresses(code)) {
        if (tried.has(address)) continue;
        tried.add(address);
        const library = await getCode(chainId, address).catch(() => null);
        if (!library?.toLowerCase().startsWith(`0x73${address.slice(2)}3014`)) continue;
        found.set(address, library);
        next.push(library);
      }
    }
    frontier = next;
  }
  return found;
}

/** True when `code` dispatches `selector`: a PUSH1..PUSH4 immediate of its value or (EraVM, dense
 *  tables) a raw match. */
function dispatches(code, selector, chainId) {
  const sel = selector.slice(2).toLowerCase();
  if (!ERAVM.has(chainId)) {
    // A dispatcher compares the selector as a number: a leading zero byte may be left out.
    const found = immediates(code);
    const value = sel.replace(/^(00)+/, "");
    for (let n = Math.max(1, value.length / 2); n <= 4; n++) {
      if (found.has(value.padStart(2 * n, "0"))) return true;
    }
  }
  // Byte-aligned raw match: EraVM constants, Vyper's data-section selector tables.
  const hex = lowerHex(code);
  for (let at = hex.indexOf(sel); at !== -1; at = hex.indexOf(sel, at + 1)) {
    if (at % 2 === 0) return true;
  }
  return false;
}

/** `code` without `0x`, lowercase, memoized per code. */
const lowerHexOf = new Map();
function lowerHex(code) {
  let hex = lowerHexOf.get(code);
  if (hex === undefined) {
    hex = code.slice(2).toLowerCase();
    lowerHexOf.set(code, hex);
  }
  return hex;
}

/** Every PUSHn immediate `code` executes, lowercase hex without `0x`, memoized per code. */
const immediatesOf = new Map();
function immediates(code) {
  let found = immediatesOf.get(code);
  if (found !== undefined) return found;
  found = new Set();
  const hex = lowerHex(code);
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      const imm = hex.slice(i + 2, i + 2 + 2 * n);
      if (imm.length === 2 * n) found.add(imm);
      i += 2 * n;
    }
  }
  immediatesOf.set(code, found);
  return found;
}

/** True when the lowercase hex `hex` holds `needle` at a byte boundary. */
function holdsAligned(hex, needle) {
  for (let at = hex.indexOf(needle); at !== -1; at = hex.indexOf(needle, at + 1)) {
    if (at % 2 === 0) return true;
  }
  return false;
}

/**
 * True when `code` carries an event's 32-byte topic: the PUSH32 its LOG takes, or the same word in
 * the code's data, which solc's constant optimizer CODECOPYs a constant from where that is cheaper
 * (Compound's cTokens carry `Transfer` so); raw on EraVM.
 */
function emits(code, topic, chainId) {
  const t = topic.slice(2).toLowerCase();
  if (ERAVM.has(chainId)) return code.toLowerCase().includes(t);
  return holdsAligned(lowerHex(code), t);
}

/** Every opcode `code` executes (PUSH immediates skipped), memoized per code. */
const opcodesOf = new Map();
function opcodes(code) {
  let found = opcodesOf.get(code);
  if (found !== undefined) return found;
  found = new Set();
  const hex = lowerHex(code);
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    found.add(op);
    if (op >= 0x60 && op <= 0x7f) i += 2 * (op - 0x5f);
  }
  opcodesOf.set(code, found);
  return found;
}

/**
 * True when `code` can emit an anonymous event whose `topics` parameters are indexed: it executes
 * LOG<topics>. An anonymous event has no topic0 to find in the code, so the shape of the LOG that
 * would emit it is the evidence there is (EraVM code has no such opcode to read).
 */
function emitsAnonymous(code, topics, chainId) {
  if (ERAVM.has(chainId)) return false;
  return opcodes(code).has(0xa0 + topics);
}

/** topic0 of each anonymous event seen, -> how many of its parameters are indexed. */
const ANONYMOUS = new Map();
function noteAnonymous(frag) {
  if (frag.type === "event" && frag.anonymous === true) {
    ANONYMOUS.set(frag.topic0, frag.inputs.filter((p) => p.indexed).length);
  }
}

/**
 * True when `code` carries a custom error's selector: a PUSH4 shifted into place, or the selector
 * already left-aligned in a word, which is how solc's optimizer usually spells it, pushed or copied
 * from the code's data like an event's topic (raw on EraVM).
 */
function reverts(code, selector, chainId) {
  const s = selector.slice(2).toLowerCase();
  if (ERAVM.has(chainId)) return code.toLowerCase().includes(s);
  return immediates(code).has(s) || holdsAligned(lowerHex(code), s + "0".repeat(56));
}

const SOURCIFY = "https://sourcify.dev/server/v2/contract";

/**
 * The verified ABI of `address`, or null when no source has one: Sourcify, then Blockscout, then
 * Routescan. A source that cannot answer is skipped; if none found the ABI and one of them could not
 * answer, the lookup throws rather than record an "unverified" that is really an outage.
 */
function verifiedAbi(chainId, address) {
  return diskMemo(`abi:${chainId}:${address}`, async () => {
    const failures = [];
    const attempt = async (fn) => {
      try {
        return await fn();
      } catch (err) {
        failures.push(err.message);
        return null;
      }
    };
    const sourcify = await attempt(() =>
      getJson(`${SOURCIFY}/${chainId}/${address}?fields=abi,compilation`),
    );
    if (sourcify?.abi) {
      return {
        source: `sourcify:${sourcify.match ?? sourcify.runtimeMatch ?? "match"}`,
        contract: sourcify.compilation?.name ?? null,
        abi: sourcify.abi,
      };
    }
    const host = BLOCKSCOUT[chainId];
    if (host) {
      const bs = await attempt(() => getJson(`https://${host}/api/v2/smart-contracts/${address}`));
      if (bs?.abi && (bs.is_verified || bs.is_fully_verified || bs.is_partially_verified)) {
        return { source: "blockscout", contract: bs.name ?? null, abi: bs.abi };
      }
    }
    const compatible = ETHERSCAN_COMPATIBLE[chainId];
    if (compatible) {
      const [name, base] = compatible;
      const es = await attempt(() =>
        getJson(`${base}?module=contract&action=getsourcecode&address=${address}`),
      );
      const hit = es?.status === "1" ? es.result?.[0] : undefined;
      if (hit && hit.ABI && hit.ABI.startsWith("[")) {
        return { source: name, contract: hit.ContractName || null, abi: JSON.parse(hit.ABI) };
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
    return null;
  });
}

function canonicalType(p) {
  if (!p.type.startsWith("tuple")) return p.type;
  return `(${(p.components ?? []).map(canonicalType).join(",")})${p.type.slice(5)}`;
}
const signature = (f) => `${f.name}(${(f.inputs ?? []).map(canonicalType).join(",")})`;

/** A fragment reduced to what the test compares: types, names, outputs, mutability. */
function fragment(f) {
  const strip = (p) => ({
    name: p.name ?? "",
    type: p.type,
    ...(p.components ? { components: p.components.map(strip) } : {}),
  });
  const mutability =
    f.stateMutability ?? (f.constant ? "view" : f.payable ? "payable" : "nonpayable");
  return {
    signature: signature(f),
    selector: toFunctionSelector(signature(f)),
    inputs: (f.inputs ?? []).map(strip),
    outputs: (f.outputs ?? []).map(strip),
    stateMutability: mutability,
  };
}

/**
 * An event or a custom error, reduced the same way, with its `type` (a function fragment has none,
 * which keeps every function fragment id the fixture already holds). An event keeps each top-level
 * parameter's `indexed` flag: it decides which parameters a log carries as topics. An anonymous
 * event says so (`anonymous: true`, only then, so no other event's fragment id moves): its log
 * carries no topic0, so its topics are its indexed parameters alone. Its `topic0` is still the
 * signature's hash, which names it like any other event's.
 */
function eventOrErrorFragment(item) {
  const strip = (p, top) => ({
    name: p.name ?? "",
    type: p.type,
    ...(top && item.type === "event" ? { indexed: Boolean(p.indexed) } : {}),
    ...(p.components ? { components: p.components.map((c) => strip(c, false)) } : {}),
  });
  const sig = signature(item);
  return {
    type: item.type,
    signature: sig,
    ...(item.type === "event"
      ? { topic0: toEventSelector(sig) }
      : { selector: toFunctionSelector(sig) }),
    ...(item.type === "event" && item.anonymous === true ? { anonymous: true } : {}),
    inputs: (item.inputs ?? []).map((p) => strip(p, true)),
  };
}

/** The 32-byte topic or 4-byte selector a fragment is found in deployed code by. */
const markOf = (frag) => frag.topic0 ?? frag.selector;

async function registryOf(slug) {
  const abis = await import(join(SDK, "dist", "protocols", slug, "abis.js"));
  const { deployments } = await import(join(SDK, "dist", "protocols", slug, "addresses.js"));
  return { abis, deployments };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Code hash (a layer's `codeHash`) -> the deployments a live source verified a layer of that code
 * at: where the same runtime code is verified elsewhere, for `sameCodeAbi`.
 */
const VERIFIED_CODE = new Map();
function noteVerifiedCode(chainId, address, codeHash) {
  const list = VERIFIED_CODE.get(codeHash) ?? [];
  if (!list.some(([c, a]) => c === chainId && a === address)) list.push([chainId, address]);
  VERIFIED_CODE.set(codeHash, list);
}

/**
 * The verified ABI of the same runtime code elsewhere, for an address no source could answer for:
 * another captured layer with its code hash, or the same address on another configured chain. It
 * is taken only where the two codes are equal byte for byte (`sameCodeAs`), so it is that code's
 * own ABI; null when none is.
 */
function sameCodeAbi(chainId, address) {
  return memo(`same:${chainId}:${address}`, async () => {
    const code = await getCode(chainId, address).catch(() => null);
    if (!code || code === "0x") return null;
    const full = keccak256(code);
    const candidates = [
      ...(VERIFIED_CODE.get(full.slice(0, 18)) ?? []),
      ...[...RPC_URLS.keys()].map((c) => [c, address]),
    ];
    const tried = new Set([`${chainId}:${address}`]);
    for (const [c, a] of candidates) {
      if (tried.has(`${c}:${a}`)) continue;
      tried.add(`${c}:${a}`);
      const other = await getCode(c, a).catch(() => null);
      if (!other || keccak256(other) !== full) continue;
      const v = await verifiedAbi(c, a).catch(() => null);
      if (v) return { ...v, sameCodeAs: `${c}:${a}` };
    }
    return null;
  });
}

/**
 * `verifiedAbi`, with a lookup that could not be answered recorded on the instance, not thrown. One
 * that could not be answered is first resolved from the same code verified elsewhere
 * (`sameCodeAbi`).
 */
async function lookupAbi(chainId, address, result) {
  try {
    return await verifiedAbi(chainId, address);
  } catch (err) {
    const twin = await sameCodeAbi(chainId, address);
    if (twin !== null) return twin;
    (result.abiErrors ??= []).push(`${address}: ${err.message}`);
    return null;
  }
}

/** `facets()`, the EIP-2535 loupe's whole routing table: each facet with its selectors. */
const FACETS = "0x7a0ed627";
const FACETS_OUTPUT = [
  {
    type: "tuple[]",
    components: [
      { name: "facetAddress", type: "address" },
      { name: "functionSelectors", type: "bytes4[]" },
    ],
  },
];
/** The table `facets()` answered, or null when the answer does not decode as one. */
function decodeFacets(data) {
  if (typeof data !== "string" || data.length < 130) return null;
  try {
    const [facets] = decodeAbiParameters(FACETS_OUTPUT, data);
    return facets.map((f) => ({
      facet: f.facetAddress.toLowerCase(),
      selectors: f.functionSelectors.map((s) => s.toLowerCase()),
    }));
  } catch {
    return null;
  }
}

/**
 * One instance of an ABI export: its layers, its verified ABI, and where its code dispatches each
 * of `seeds` (the export's candidate selectors, see the header) and carries each of `seedMarks`
 * (topic or selector -> "event" | "error"), with its own verified ones added to both.
 */
async function captureInstance(job, target, seeds, seedMarks) {
  const { slug, abiExport, registryFns, registryMarks } = job;
  const { chainId, address } = target;
  const names = new Set(registryFns.map((f) => f.name));
  // Events and errors, by `<type> <name>`: an event and an error may share a name.
  const markNames = new Set(registryMarks.map((m) => `${m.type} ${m.name}`));
  const result = {
    protocol: slug,
    abi: abiExport,
    chainId,
    address: address.toLowerCase(),
    ...(target.role ? { role: target.role } : {}),
    ...(target.note ? { note: target.note } : {}),
  };
  let layers;
  try {
    layers = await resolveLayers(chainId, address);
    // A contract whose fallback delegates what it does not dispatch to a contract a getter names
    // (Comet's `extensionDelegate()`): that contract's code runs as this one's, so it is a layer.
    if (layers[0].kind !== "empty") {
      for (const getter of target.delegates ?? []) {
        const word = await call(chainId, result.address, toFunctionSelector(getter));
        const delegate = typeof word === "string" ? wordToAddress(word.slice(0, 66)) : null;
        if (!isAddress(delegate) || !(await hasCode(chainId, delegate))) continue;
        const inner = await resolveLayers(chainId, delegate, new Set(layers.map((l) => l.address)));
        if (inner.length > 0) inner[0].kind = getter;
        layers.push(...inner);
      }
    }
  } catch (err) {
    return { ...result, error: err.message };
  }
  result.layers = layers.map((l) => ({
    address: l.address,
    kind: l.kind ?? "direct",
    // A short code hash: enough to tell an upgraded implementation from the captured one.
    ...(l.code ? { codeHash: keccak256(l.code).slice(0, 18), bytes: (l.code.length - 2) / 2 } : {}),
  }));
  if (layers[0].kind === "empty") {
    result.error = "no code at address";
    return result;
  }

  // The verified functions, events and errors, by selector or topic: all of an implementation's or
  // a facet's, and of a wrapper's only the names the registry declares. An implementation's
  // declaration of a selector wins over a wrapper's.
  const verified = {};
  const verifiedMarks = {};
  const take = (abi, from, wrapper) => {
    for (const item of abi) {
      if (item.type === "function") {
        if (wrapper && !names.has(item.name)) continue;
        const frag = fragment(item);
        verified[frag.selector] ??= { ...frag, from };
      } else if (item.type === "event" || item.type === "error") {
        if (wrapper && !markNames.has(`${item.type} ${item.name}`)) continue;
        const frag = eventOrErrorFragment(item);
        noteAnonymous(frag);
        verifiedMarks[markOf(frag)] ??= { ...frag, from };
      }
    }
  };
  const abiSources = [];
  const layerAbis = [];
  for (const layer of layers) {
    if (!layer.code) continue;
    const v = await lookupAbi(chainId, layer.address, result);
    if (!v) continue;
    const { abi, ...source } = v;
    abiSources.push({ address: layer.address, ...source });
    layerAbis.push([layer, abi]);
    if (v.sameCodeAs === undefined) {
      noteVerifiedCode(chainId, layer.address, keccak256(layer.code).slice(0, 18));
    }
  }
  for (const [layer, abi] of layerAbis) if (!layer.wrapper) take(abi, layer.address, false);
  for (const [layer, abi] of layerAbis) if (layer.wrapper) take(abi, layer.address, true);
  // A source that verified a layer before and cannot answer now (an explorer behind a challenge
  // page), and whose code no other source has verified (`sameCodeAbi`), does not unverify it, as
  // long as nothing the previous capture's fragments came from has changed: the same layers with
  // the same code, none reached through a router (whose facets are not layers, and may have
  // moved). The deployment keeps what that capture recorded, and the source says when that was and
  // whether it is the whole ABI (`carried: { date, partial }`). A capture before the registry took
  // full ABIs kept only the functions, events and errors the registry declared, so what it carries
  // is `partial`, and so is anything carried from a partial source again; the generator lists each.
  const before = PREVIOUS.rows.get(`${slug}|${abiExport}|${chainId}|${result.address}`);
  const codeOf = (list) => JSON.stringify((list ?? []).map((l) => [l.address, l.codeHash ?? null]));
  if (
    result.abiErrors !== undefined &&
    before !== undefined &&
    codeOf(before.layers) === codeOf(result.layers) &&
    !Object.values(before.selectors ?? {}).some((v) => typeof v === "string")
  ) {
    const failed = new Set(result.abiErrors.map((e) => e.slice(0, 42)));
    const carried = (before.abiSources ?? []).filter(
      (s) =>
        failed.has(s.address) &&
        result.layers.some((l) => l.address === s.address) &&
        !abiSources.some((x) => x.address === s.address),
    );
    for (const s of carried) {
      // A date alone is how a capture before full ABIs marked what it carried.
      const was = s.carried;
      abiSources.push({
        ...s,
        carried:
          typeof was === "object" && was !== null
            ? was
            : { date: was ?? PREVIOUS.capturedAt, partial: was !== undefined },
      });
    }
    if (carried.length > 0) {
      for (const frag of before.verified ?? []) {
        if (frag.type === undefined) verified[frag.selector] ??= { ...frag, from: "carried" };
        else verifiedMarks[markOf(frag)] ??= { ...frag, from: "carried" };
      }
    }
  }

  const candidates = new Set(seeds);
  for (const f of registryFns) candidates.add(toFunctionSelector(signature(f)));
  for (const probe of target.probes ?? []) candidates.add(toFunctionSelector(probe));
  for (const sel of Object.keys(verified)) candidates.add(sel);
  /** Every facet a router named, whether or not it has a verified ABI. */
  const facets = new Set();
  const absorb = async (facet) => {
    if (facets.has(facet)) return;
    facets.add(facet);
    const v = await lookupAbi(chainId, facet, result);
    if (!v) return;
    if (!abiSources.some((s) => s.address === facet)) {
      const { abi: _abi, ...source } = v;
      abiSources.push({ address: facet, ...source });
    }
    take(v.abi, facet, false);
    for (const sel of Object.keys(verified)) candidates.add(sel);
  };
  const routed = {};
  // Routing tables live on the instance, or, for a thin proxy that asks an embedded diamond per
  // call (Premia's PoolProxy), on that diamond: ask both.
  const hosts = [result.address];
  if (layers.length === 1 && layers[0].code && proxyShaped(chainId, layers[0].code)) {
    for (const embedded of embeddedAddresses(layers[0].code)) {
      if (embedded !== result.address && (await hasCode(chainId, embedded))) hosts.push(embedded);
    }
  }
  const perSelector = [];
  /** How the instance routes selectors to facets: `facets()` for a loupe's whole table, else each
   *  per-selector lookup it answers. */
  const routing = new Set();
  for (const host of hosts) {
    const lookups = await routerLookups(chainId, host);
    let table = null;
    // An EIP-2535 loupe: its whole table where it answers `facets()`, else its facet list.
    if (lookups.some(([lookup]) => lookup === "facetAddress(bytes4)")) {
      table = decodeFacets(await call(chainId, host, FACETS));
      if (table !== null && table.length > 0) {
        routing.add("facets()");
        for (const { facet, selectors } of table) {
          if (!isAddress(facet)) continue;
          for (const sel of selectors) routed[sel] ??= { via: "facets()", facet };
          await absorb(facet);
        }
      } else {
        table = null;
        const list = await call(chainId, host, FACET_ADDRESSES);
        for (const facet of decodeAddressArray(list)) await absorb(facet);
      }
    }
    for (const [lookup, lsel] of lookups) {
      if (table !== null && lookup === "facetAddress(bytes4)") continue;
      perSelector.push([host, lookup, lsel]);
      routing.add(lookup);
    }
  }
  // A router that answers one selector at a time is asked about every candidate, and again about
  // the functions of each facet it names, until no new candidate turns up.
  const asked = new Set();
  for (let more = true; more;) {
    more = false;
    for (const [host, lookup, lsel] of perSelector) {
      for (const sel of [...candidates].sort()) {
        const key = `${host}:${lsel}:${sel}`;
        if (routed[sel] || asked.has(key)) continue;
        asked.add(key);
        const word = await call(chainId, host, `${lsel}${sel.slice(2)}${"0".repeat(56)}`);
        const facet = typeof word === "string" ? wordToAddress(word.slice(0, 66)) : null;
        if (!isAddress(facet)) continue;
        routed[sel] = { via: lookup, facet };
        const before = candidates.size;
        await absorb(facet);
        if (candidates.size > before) more = true;
      }
    }
  }
  const selectors = {};
  for (const sel of [...candidates].sort()) {
    if (routed[sel]) {
      selectors[sel] = `routed:${routed[sel].facet}`;
      continue;
    }
    // The layer (index into `layers`) whose code dispatches it, or null.
    const where = layers.findIndex((l) => l.code && dispatches(l.code, sel, chainId));
    selectors[sel] = where >= 0 ? where : null;
  }
  result.selectors = selectors;
  result.router = [...routing].sort();
  // A router asked one selector at a time names only the facets some candidate reaches: which of
  // its inventory's facets (`reference/index.json` `inventories`) this deployment reached.
  if (job.inventory !== undefined) {
    result.inventory = {
      facets: job.inventory.length,
      resolved: job.inventory
        .filter((facet) => facet.selectors.some((sel) => routed[sel] !== undefined))
        .map((facet) => facet.name),
    };
  }

  // Every event and error the export's deployments declare, and the registry's: where the code
  // that runs carries each (a layer, a facet a router named, or a library either links), or null.
  // An anonymous event is found by the shape of the LOG that emits it (`emitsAnonymous`), having no
  // topic0 to find.
  const facetCode = {};
  for (const facet of [...new Set([...facets, ...Object.values(routed).map((r) => r.facet)])]) {
    facetCode[facet] = await getCode(chainId, facet).catch(() => null);
  }
  const libraries = await linkedLibraries(chainId, [
    ...layers.map((l) => l.code),
    ...Object.values(facetCode),
  ]);
  const locate = (kind, mark) => {
    const topics = kind === "event" ? ANONYMOUS.get(mark) : undefined;
    const carries =
      kind === "error"
        ? (code) => reverts(code, mark, chainId)
        : topics !== undefined
          ? (code) => emitsAnonymous(code, topics, chainId)
          : (code) => emits(code, mark, chainId);
    const where = layers.findIndex((l) => l.code && carries(l.code));
    if (where >= 0) return where;
    const facet = Object.keys(facetCode)
      .sort()
      .find((f) => facetCode[f] && facetCode[f] !== "0x" && carries(facetCode[f]));
    if (facet !== undefined) return `routed:${facet}`;
    const library = [...libraries.keys()].sort().find((a) => carries(libraries.get(a)));
    return library === undefined ? null : `library:${library}`;
  };
  const wanted = new Map(seedMarks);
  for (const item of registryMarks) {
    const frag = eventOrErrorFragment(item);
    noteAnonymous(frag);
    wanted.set(markOf(frag), frag.type);
  }
  for (const frag of Object.values(verifiedMarks)) wanted.set(markOf(frag), frag.type);
  for (const kind of ["event", "error"]) {
    const marks = [...wanted].filter(([, type]) => type === kind).map(([mark]) => mark);
    if (marks.length === 0) continue;
    const located = {};
    for (const mark of marks.sort()) located[mark] = locate(kind, mark);
    result[kind === "event" ? "events" : "errors"] = located;
  }
  result.abiSources = abiSources;
  result.verified = [
    ...Object.values(verified).sort((a, b) => a.signature.localeCompare(b.signature)),
    ...Object.values(verifiedMarks).sort(
      (a, b) => a.type.localeCompare(b.type) || a.signature.localeCompare(b.signature),
    ),
  ];
  return result;
}

/** One JSON-RPC request with no retry on an error the node answers: a too-wide range is an answer. */
async function rpcAnswer(chainId, method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(rpcUrl(chainId, attempt), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();
      return body.error ? { error: body.error } : { result: body.result };
    } catch (err) {
      if (attempt >= 2) return { error: { message: err.message } };
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/**
 * The newest log `address` emitted under `topic0`, or null when none turns up within the search: a
 * window walked back from the head, narrowed when the node refuses its width and widened while it
 * comes back empty. A proxy emits under its own address, so `address` is the instance's.
 */
async function newestLog(chainId, address, topic0) {
  const head = await rpcAnswer(chainId, "eth_blockNumber", []);
  if (head.error) return null;
  let to = parseInt(head.result, 16);
  let span = 50_000;
  for (let requests = 0; requests < 16 && to > 0; requests++) {
    const from = Math.max(0, to - span + 1);
    const answer = await rpcAnswer(chainId, "eth_getLogs", [
      {
        address,
        topics: [topic0],
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      },
    ]);
    if (answer.error) {
      if (span <= 500) return null;
      span = Math.floor(span / 5);
      continue;
    }
    if (answer.result.length > 0) return answer.result.at(-1);
    to = from - 1;
    span = Math.min(span * 2, 2_000_000);
  }
  return null;
}

/**
 * One real log of every event a target lists under `logs`, from the first of its deployments that
 * has one. The log is stored as the node returned it, so the test decodes exactly the bytes the
 * chain holds.
 */
async function captureLogs(jobs) {
  const wanted = new Map();
  for (const job of jobs) {
    for (const sig of job.logs) {
      wanted.set(`${job.slug}\u0000${job.abiExport}\u0000${sig}`, {
        protocol: job.slug,
        abi: job.abiExport,
        event: sig,
        topic0: toEventSelector(sig),
        instances: job.instances,
      });
    }
  }
  const logs = await pool([...wanted.values()], 4, async (entry) => {
    for (const inst of entry.instances) {
      const log = await newestLog(inst.chainId, inst.address, entry.topic0);
      if (log === null) continue;
      console.log(
        `log ${entry.protocol}.${entry.abi} ${entry.event} ${inst.chainId}:${log.blockNumber}`,
      );
      return {
        protocol: entry.protocol,
        abi: entry.abi,
        event: entry.event,
        chainId: inst.chainId,
        address: log.address.toLowerCase(),
        blockNumber: parseInt(log.blockNumber, 16),
        transactionHash: log.transactionHash,
        logIndex: parseInt(log.logIndex, 16),
        topics: log.topics,
        data: log.data,
      };
    }
    console.log(`log ${entry.protocol}.${entry.abi} ${entry.event}: none found`);
    return null;
  });
  return { wanted: new Set(wanted.keys()), logs: logs.filter((log) => log !== null) };
}

const logKey = (log) => `${log.protocol}\u0000${log.abi}\u0000${log.event}`;

/**
 * The reference interfaces' functions, events and errors, by `<slug>.<AbiExport>`
 * (`reference/index.json`). Their events and errors are located on every instance like the
 * registry's, so a standard's event no example carries stays recorded as such once the registry
 * leaves it out.
 */
function readReference() {
  const dir = join(FIXTURE_DIR, "reference");
  const index = join(dir, "index.json");
  const out = new Map();
  if (!existsSync(index)) return out;
  for (const [key, files] of Object.entries(JSON.parse(readFileSync(index, "utf-8")).exports)) {
    const items = files.flatMap(({ file }) =>
      JSON.parse(readFileSync(join(dir, file), "utf-8")).filter((i) =>
        ["function", "event", "error"].includes(i.type),
      ),
    );
    out.set(key, items);
  }
  return out;
}

/**
 * Each per-selector router's inventory, by `<slug>.<AbiExport>` (`reference/index.json`
 * `inventories`): every facet its maker publishes, with the selectors of its functions. Such a
 * router names only the facets a candidate selector reaches, so its inventory's functions are all
 * candidates, and each deployment records which of the facets it reached.
 */
function readInventories() {
  const dir = join(FIXTURE_DIR, "reference");
  const index = join(dir, "index.json");
  const out = new Map();
  if (!existsSync(index)) return out;
  const inventories = JSON.parse(readFileSync(index, "utf-8")).inventories ?? {};
  for (const [key, value] of Object.entries(inventories)) {
    if (key === "note") continue;
    const { facets } = value;
    out.set(
      key,
      Object.entries(facets).map(([name, { file }]) => ({
        name,
        selectors: JSON.parse(readFileSync(join(dir, file), "utf-8"))
          .filter((i) => i.type === "function")
          .map((f) => toFunctionSelector(signature(f))),
      })),
    );
  }
  return out;
}

/** The fixture as this run found it: each deployment's row, and when it was captured. */
const PREVIOUS = { rows: new Map(), capturedAt: undefined };

async function main() {
  const only = new Set(cli.positionals);
  const stored = existsSync(EVIDENCE_PATH)
    ? JSON.parse(readFileSync(EVIDENCE_PATH, "utf-8"))
    : null;
  const previous = stored === null ? { instances: [], logs: [] } : expand(stored);
  PREVIOUS.capturedAt = stored?.capturedAt;
  for (const row of previous.instances) {
    PREVIOUS.rows.set(`${row.protocol}|${row.abi}|${row.chainId}|${row.address}`, row);
    // Where a live source verified a layer's code, for an address no source can answer for now.
    const live = (row.abiSources ?? []).filter((s) => !s.carried && !s.sameCodeAs);
    for (const layer of row.layers ?? []) {
      if (layer.codeHash && live.some((s) => s.address === layer.address)) {
        noteVerifiedCode(row.chainId, layer.address, layer.codeHash);
      }
    }
    for (const frag of row.verified ?? []) noteAnonymous(frag);
  }
  // A target can name a protocol another branch adds: without its build output there is nothing to
  // capture, and its evidence is carried over untouched until the protocol lands.
  const present = (slug) => existsSync(join(SDK, "dist", "protocols", slug, "abis.js"));
  const keep = previous.instances.filter(
    (i) =>
      (only.size > 0 && !only.has(i.protocol)) ||
      !present(i.protocol) ||
      (CHAINS_ONLY !== null && !CHAINS_ONLY.has(i.chainId)),
  );
  const reference = readReference();
  const inventories = readInventories();
  const jobs = [];
  for (const [slug, exports] of Object.entries(TARGETS.protocols)) {
    if (only.size > 0 && !only.has(slug)) continue;
    if (!present(slug)) {
      console.log(`${slug}: not in this tree's build, evidence kept as captured`);
      continue;
    }
    const { abis, deployments } = await registryOf(slug);
    for (const [abiExport, spec] of Object.entries(exports)) {
      const abi = abis[abiExport];
      if (!Array.isArray(abi)) throw new Error(`${slug}: no ABI export ${abiExport}`);
      const registryFns = abi.filter((i) => i.type === "function");
      const registryMarks = abi.filter((i) => i.type === "event" || i.type === "error");
      const instances = [];
      for (const role of spec.roles ?? []) {
        for (const d of deployments) {
          const address = d.addresses[role];
          if (address === undefined) continue;
          // A role whose deployments run different releases binds one ABI per chain set.
          if (spec.chains && !spec.chains.includes(d.chainId)) continue;
          // A Solana program id (32 bytes) runs no EVM ABI: nothing here applies to it.
          if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
          instances.push({ chainId: d.chainId, address, role });
        }
      }
      for (const inst of spec.instances ?? []) instances.push(inst);
      for (const inst of instances) {
        if (spec.probes) inst.probes = spec.probes;
        if (spec.delegates) inst.delegates = spec.delegates;
      }
      if (instances.length === 0 && !spec.unverifiable) {
        throw new Error(`${slug}.${abiExport}: target names no instance`);
      }
      const selected = instances.filter(
        (inst) => CHAINS_ONLY === null || CHAINS_ONLY.has(inst.chainId),
      );
      if (selected.length === 0) continue;
      // The candidates start from the reference interfaces and from every instance this run keeps
      // as captured, so a run narrowed to some chains still answers for the export's whole union.
      const inventory = inventories.get(`${slug}.${abiExport}`);
      const referenceItems = reference.get(`${slug}.${abiExport}`) ?? [];
      const seeds = new Set([
        ...referenceItems
          .filter((f) => f.type === "function")
          .map((f) => toFunctionSelector(signature(f))),
        ...(inventory ?? []).flatMap((facet) => facet.selectors),
      ]);
      const seedMarks = new Map();
      for (const item of referenceItems) {
        if (item.type === "function") continue;
        const frag = eventOrErrorFragment(item);
        noteAnonymous(frag);
        seedMarks.set(markOf(frag), frag.type);
      }
      for (const row of keep) {
        if (row.protocol !== slug || row.abi !== abiExport) continue;
        for (const sel of Object.keys(row.selectors ?? {})) seeds.add(sel);
        for (const mark of Object.keys(row.events ?? {})) seedMarks.set(mark, "event");
        for (const mark of Object.keys(row.errors ?? {})) seedMarks.set(mark, "error");
      }
      jobs.push({
        slug,
        abiExport,
        registryFns,
        registryMarks,
        logs: spec.logs ?? [],
        instances: selected,
        seeds,
        seedMarks,
        inventory,
      });
    }
  }
  // Every RPC the run needs, checked before the first request: a chain found missing mid-run would
  // leave its instances recorded as errors in the fixture.
  const missing = [...new Set(jobs.flatMap((job) => job.instances.map((inst) => inst.chainId)))]
    .filter((chainId) => !RPC_URLS.has(chainId))
    .sort((a, b) => a - b);
  if (missing.length > 0) {
    fail(
      `--rpc-config ${RPC_CONFIG_PATH} gives no RPC URL for chain id${missing.length > 1 ? "s" : ""} ` +
        `${missing.join(", ")}, which the selected deployments need. Add a "<chainId>": "<url>" ` +
        "entry for each, or narrow the run with --chains or protocol slugs.",
    );
  }
  const total = jobs.reduce((n, job) => n + job.instances.length, 0);
  console.log(`capturing ${total} instances of ${jobs.length} ABI exports`);
  let done = 0;
  // Each export's instances are captured with the candidates every one of them adds, again until a
  // round adds none: what one deployment's verified ABI declares is asked of all of them.
  const captured = (
    await pool(jobs, 4, async (job) => {
      let seeds = job.seeds;
      let seedMarks = job.seedMarks;
      for (let round = 1; ; round++) {
        const rows = await pool(job.instances, 3, (inst) =>
          captureInstance(job, inst, seeds, seedMarks),
        );
        const next = new Set(seeds);
        const nextMarks = new Map(seedMarks);
        for (const row of rows) {
          for (const sel of Object.keys(row.selectors ?? {})) next.add(sel);
          for (const mark of Object.keys(row.events ?? {})) nextMarks.set(mark, "event");
          for (const mark of Object.keys(row.errors ?? {})) nextMarks.set(mark, "error");
        }
        const stable = next.size === seeds.size && nextMarks.size === seedMarks.size;
        if (stable || round === 5) {
          for (const r of rows) {
            const absent = Object.values(r.selectors ?? {}).filter((v) => v === null).length;
            console.log(
              `[${++done}/${total}] ${job.slug}.${job.abiExport} ${r.chainId}:${r.address}` +
                (r.error
                  ? ` ERROR ${r.error}`
                  : ` verified=${r.verified.length} candidates=${Object.keys(r.selectors).length} absent=${absent}`) +
                (r.abiErrors ? ` abiErrors=${r.abiErrors.length}` : "") +
                (stable ? "" : " (candidates still growing after 5 rounds)"),
            );
          }
          return rows;
        }
        seeds = next;
        seedMarks = nextMarks;
      }
    })
  ).flat();
  const instances = [...keep, ...captured].sort(
    (a, b) =>
      a.protocol.localeCompare(b.protocol) ||
      a.abi.localeCompare(b.abi) ||
      a.chainId - b.chainId ||
      a.address.localeCompare(b.address),
  );
  // A log is a fact about the chain, so one this run did not find again is kept while its target
  // still lists the event; a run's new one replaces it.
  const found = await captureLogs(jobs);
  const fresh = new Set(found.logs.map(logKey));
  const ran = new Set(jobs.map((job) => `${job.slug}\u0000${job.abiExport}`));
  const logs = [
    ...previous.logs.filter((log) => {
      if (fresh.has(logKey(log))) return false;
      return !ran.has(`${log.protocol}\u0000${log.abi}`) || found.wanted.has(logKey(log));
    }),
    ...found.logs,
  ].sort(
    (a, b) =>
      a.protocol.localeCompare(b.protocol) ||
      a.abi.localeCompare(b.abi) ||
      a.event.localeCompare(b.event),
  );
  writeFileSync(EVIDENCE_PATH, serialize(instances, logs));
  console.log(`wrote ${instances.length} instances and ${logs.length} logs to ${EVIDENCE_PATH}`);
}

/** The fixture shares each distinct verified fragment across the deployments that declare it. */
function fragmentId(fragment) {
  return `${markOf(fragment)}-${keccak256(new TextEncoder().encode(JSON.stringify(fragment))).slice(2, 10)}`;
}

/** The stored fixture, with each instance's fragment ids resolved back to fragments. */
function expand(stored) {
  const fragments = stored.fragments ?? {};
  return {
    instances: stored.instances.map((i) => ({
      ...i,
      verified: (i.verified ?? []).map((id) => fragments[id]),
    })),
    logs: stored.logs ?? [],
  };
}

/** One fragment, one instance and one log per line, so a recapture diffs by deployment. */
function serialize(instances, logs) {
  const fragments = {};
  const rows = instances.map((instance) => {
    const verified = (instance.verified ?? []).map(({ from: _from, ...fragment }) => {
      const id = fragmentId(fragment);
      fragments[id] = fragment;
      return id;
    });
    return { ...instance, verified };
  });
  const ids = Object.keys(fragments).sort();
  const lines = [
    "{",
    `"note": ${JSON.stringify("Generated by sdk/scripts/capture-registry-abi.mjs --recapture. Do not edit by hand.")},`,
    `"capturedAt": ${JSON.stringify(new Date().toISOString().slice(0, 10))},`,
    '"fragments": {',
    ...ids.map(
      (id, n) =>
        `${JSON.stringify(id)}: ${JSON.stringify(fragments[id])}${n < ids.length - 1 ? "," : ""}`,
    ),
    "},",
    '"instances": [',
    ...rows.map((row, n) => `${JSON.stringify(row)}${n < rows.length - 1 ? "," : ""}`),
    "],",
    '"logs": [',
    ...logs.map((log, n) => `${JSON.stringify(log)}${n < logs.length - 1 ? "," : ""}`),
    "]",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

await main();
