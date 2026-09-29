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
//   - which of the relevant selectors the deployed code dispatches, after resolving proxies
//     (EIP-1167 clones, EIP-1967 implementation and beacon slots, the legacy zeppelinos, EIP-1822
//     and Synthetix slots, `implementation()`-style getters) and selector routers (EIP-2535
//     `facetAddress`, 0x's `getFunctionImplementation`, Paraswap's `getImplementation`, Pendle's
//     `selectorToFacet`, Fluid's `getSigsImplementation`);
//   - the verified ABI fragments, from Sourcify, then Blockscout, then a keyless Etherscan-compatible
//     API, of every function the registry declares under that name (every overload, so a wrong one
//     is visible).
// "Relevant selectors" are the registry's own, every verified overload of the same name, and the
// target's `probes`: signatures to ask a selector router about when the registry's are wrong.
//
// RPC endpoints come only from the file `--rpc-config` names: a JSON object mapping each chain id to
// its URL, `{ "<chainId>": "<url>" }`. There is no default and no public fallback, and nothing is
// read from the environment. Keep yours at `sdk/rpc.config.json`, which is gitignored; copy
// `sdk/rpc.config.example.json` to start. Before anything is fetched, the script fails listing every
// chain id the selected deployments need that the file does not give. No URL is ever written to the
// fixture.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { keccak256, toFunctionSelector } from "viem";

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
/** chainId -> URL, exactly as the developer's config gives them. */
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
    if (typeof value !== "string" || !/^https?:\/\//.test(value)) continue;
    urls.set(Number(key), value);
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

function rpcUrl(chainId) {
  const url = RPC_URLS.get(chainId);
  // main() checks every chain up front, so this is only reachable through a bug there.
  if (url === undefined) throw new Error(`no RPC configured for chain ${chainId}`);
  return url;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(chainId, method, params) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(rpcUrl(chainId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json();
      if (body.error) {
        // A revert is an answer, not a transport failure.
        if (method === "eth_call") return null;
        throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
      }
      return body.result;
    } catch (err) {
      if (attempt >= 4) {
        throw new Error(`chain ${chainId} ${method} failed: ${err.message}`, { cause: err });
      }
      await sleep(1000 * 2 ** attempt);
    }
  }
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

/** JSON body, `null` for "not here" (404 / not verified). Throws when the API could not answer. */
async function getJson(url) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    try {
      await throttle(host);
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      if (attempt >= 5) throw new Error(`${host}: ${err.message}`, { cause: err });
      await sleep(2000 * 2 ** attempt);
    }
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
    // "Nothing here" is not cached: an unverified contract may be verified by the next recapture.
    if (value !== null) writeFileSync(path, JSON.stringify({ key, value }));
    return value;
  });
}

const getCode = (chainId, address) =>
  diskMemo(`code:${chainId}:${address.toLowerCase()}`, () =>
    rpc(chainId, "eth_getCode", [address, "latest"]),
  );
const getSlot = (chainId, address, slot) =>
  memo(`slot:${chainId}:${address}:${slot}`, () =>
    rpc(chainId, "eth_getStorageAt", [address, slot, "latest"]),
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

/** The opcodes `code` executes (PUSH immediates skipped). */
function opcodes(code) {
  const hex = code.slice(2);
  const ops = new Set();
  for (let i = 0; i < hex.length; i += 2) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    ops.add(op);
    if (op >= 0x60 && op <= 0x7f) i += 2 * (op - 0x5f);
  }
  return ops;
}

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

/** True when `code` dispatches `selector`: a PUSHn immediate or (EraVM, dense tables) a raw match. */
function dispatches(code, selector, chainId) {
  const sel = selector.slice(2).toLowerCase();
  const hex = code.slice(2).toLowerCase();
  if (!ERAVM.has(chainId)) {
    const value = parseInt(sel, 16);
    for (let i = 0; i < hex.length; i += 2) {
      const op = parseInt(hex.slice(i, i + 2), 16);
      if (op >= 0x60 && op <= 0x7f) {
        const n = op - 0x5f;
        if (n <= 4) {
          const imm = hex.slice(i + 2, i + 2 + 2 * n);
          if (imm.length === 2 * n && parseInt(imm, 16) === value) return true;
        }
        i += 2 * n;
      }
    }
  }
  // Byte-aligned raw match: EraVM constants, Vyper's data-section selector tables.
  for (let at = hex.indexOf(sel); at !== -1; at = hex.indexOf(sel, at + 1)) {
    if (at % 2 === 0) return true;
  }
  return false;
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

/** `verifiedAbi`, with a lookup that could not be answered recorded on the instance, not thrown. */
async function lookupAbi(chainId, address, result) {
  try {
    return await verifiedAbi(chainId, address);
  } catch (err) {
    (result.abiErrors ??= []).push(`${address}: ${err.message}`);
    return null;
  }
}

async function captureInstance(slug, abiExport, registryFns, target) {
  const { chainId, address } = target;
  const names = new Set(registryFns.map((f) => f.name));
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

  // Verified ABIs of every layer; the implementation's usually carries the functions.
  const verified = {};
  const abiSources = [];
  for (const layer of layers) {
    if (!layer.code) continue;
    const v = await lookupAbi(chainId, layer.address, result);
    if (!v) continue;
    abiSources.push({ address: layer.address, source: v.source, contract: v.contract });
    for (const item of v.abi) {
      if (item.type !== "function" || !names.has(item.name)) continue;
      const frag = fragment(item);
      verified[frag.selector] ??= { ...frag, from: layer.address };
    }
  }

  // Every selector worth an answer: the registry's, the target's probes, and verified overloads.
  const candidates = new Set(registryFns.map((f) => toFunctionSelector(signature(f))));
  for (const probe of target.probes ?? []) candidates.add(toFunctionSelector(probe));
  for (const sel of Object.keys(verified)) candidates.add(sel);
  const absorb = async (facet) => {
    const v = await lookupAbi(chainId, facet, result);
    if (!v) return;
    if (!abiSources.some((s) => s.address === facet)) {
      abiSources.push({ address: facet, source: v.source, contract: v.contract });
    }
    for (const item of v.abi) {
      if (item.type !== "function" || !names.has(item.name)) continue;
      const frag = fragment(item);
      verified[frag.selector] ??= { ...frag, from: facet };
      candidates.add(frag.selector);
    }
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
  for (const host of hosts) {
    const lookups = await routerLookups(chainId, host);
    // An EIP-2535 loupe lists every facet: read each one's verified ABI for the relevant names.
    if (lookups.some(([lookup]) => lookup === "facetAddress(bytes4)")) {
      const list = await call(chainId, host, FACET_ADDRESSES);
      for (const facet of decodeAddressArray(list)) await absorb(facet);
    }
    for (const [lookup, lsel] of lookups) {
      for (const sel of [...candidates]) {
        if (routed[sel]) continue;
        const word = await call(chainId, host, `${lsel}${sel.slice(2)}${"0".repeat(56)}`);
        const facet = typeof word === "string" ? wordToAddress(word.slice(0, 66)) : null;
        if (!isAddress(facet)) continue;
        routed[sel] = { via: lookup, facet };
        await absorb(facet);
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
  result.abiSources = abiSources;
  result.verified = Object.values(verified).sort((a, b) => a.signature.localeCompare(b.signature));
  return result;
}

async function main() {
  const only = new Set(cli.positionals);
  const previous = existsSync(EVIDENCE_PATH)
    ? expand(JSON.parse(readFileSync(EVIDENCE_PATH, "utf-8")))
    : { instances: [] };
  // A target can name a protocol another branch adds: without its build output there is nothing to
  // capture, and its evidence is carried over untouched until the protocol lands.
  const present = (slug) => existsSync(join(SDK, "dist", "protocols", slug, "abis.js"));
  const keep = previous.instances.filter(
    (i) =>
      (only.size > 0 && !only.has(i.protocol)) ||
      !present(i.protocol) ||
      (CHAINS_ONLY !== null && !CHAINS_ONLY.has(i.chainId)),
  );
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
      for (const inst of instances) if (spec.probes) inst.probes = spec.probes;
      if (instances.length === 0 && !spec.unverifiable) {
        throw new Error(`${slug}.${abiExport}: target names no instance`);
      }
      for (const inst of instances) {
        if (CHAINS_ONLY !== null && !CHAINS_ONLY.has(inst.chainId)) continue;
        jobs.push({ slug, abiExport, registryFns, inst });
      }
    }
  }
  // Every RPC the run needs, checked before the first request: a chain found missing mid-run would
  // leave its instances recorded as errors in the fixture.
  const missing = [...new Set(jobs.map((job) => job.inst.chainId))]
    .filter((chainId) => !RPC_URLS.has(chainId))
    .sort((a, b) => a - b);
  if (missing.length > 0) {
    fail(
      `--rpc-config ${RPC_CONFIG_PATH} gives no RPC URL for chain id${missing.length > 1 ? "s" : ""} ` +
        `${missing.join(", ")}, which the selected deployments need. Add a "<chainId>": "<url>" ` +
        "entry for each, or narrow the run with --chains or protocol slugs.",
    );
  }
  console.log(`capturing ${jobs.length} instances`);
  const captured = await pool(jobs, 6, async (job, i) => {
    const r = await captureInstance(job.slug, job.abiExport, job.registryFns, job.inst);
    const missing = Object.values(r.selectors ?? {}).filter((v) => v === null).length;
    console.log(
      `[${i + 1}/${jobs.length}] ${job.slug}.${job.abiExport} ${job.inst.chainId}:${job.inst.address}` +
        (r.error ? ` ERROR ${r.error}` : ` verified=${r.verified.length} absent=${missing}`),
    );
    return r;
  });
  const instances = [...keep, ...captured].sort(
    (a, b) =>
      a.protocol.localeCompare(b.protocol) ||
      a.abi.localeCompare(b.abi) ||
      a.chainId - b.chainId ||
      a.address.localeCompare(b.address),
  );
  writeFileSync(EVIDENCE_PATH, serialize(instances));
  console.log(`wrote ${instances.length} instances to ${EVIDENCE_PATH}`);
}

/** The fixture shares each distinct verified fragment across the deployments that declare it. */
function fragmentId(fragment) {
  return `${fragment.selector}-${keccak256(new TextEncoder().encode(JSON.stringify(fragment))).slice(2, 10)}`;
}

/** The stored fixture, with each instance's fragment ids resolved back to fragments. */
function expand(stored) {
  const fragments = stored.fragments ?? {};
  return {
    instances: stored.instances.map((i) => ({
      ...i,
      verified: (i.verified ?? []).map((id) => fragments[id]),
    })),
  };
}

/** One fragment and one instance per line, so a recapture diffs by deployment. */
function serialize(instances) {
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
    `"note": ${JSON.stringify("Generated by sdk/scripts/capture-registry-abi.mjs (RECAPTURE_REGISTRY_ABI=1). Do not edit by hand.")},`,
    `"capturedAt": ${JSON.stringify(new Date().toISOString().slice(0, 10))},`,
    '"fragments": {',
    ...ids.map(
      (id, n) =>
        `${JSON.stringify(id)}: ${JSON.stringify(fragments[id])}${n < ids.length - 1 ? "," : ""}`,
    ),
    "},",
    '"instances": [',
    ...rows.map((row, n) => `${JSON.stringify(row)}${n < rows.length - 1 ? "," : ""}`),
    "]",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

await main();
