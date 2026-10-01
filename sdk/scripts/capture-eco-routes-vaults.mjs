// Captures the on-chain evidence `test/eco-routes-vault.test.ts` holds the SDK's offline vault
// prediction (`routes/vault.ts#ecoRoutesVaultConfig`) to.
//
//   node scripts/capture-eco-routes-vaults.mjs --recapture --rpc-config rpc.config.json
//
// Run after `pnpm build` (it reads the registry and the encoders from `dist/`). For every EVM chain
// and every Portal the eco-routes registry carries there (each environment), it asks the deployed
// Portal for `intentVaultAddress` of one fixed probe intent, and records the answer beside whether
// the Portal's code embeds `ECO_ROUTES_VAULT_PROXY_CREATION_CODE`. A Portal that does not answer, or
// a chain the config gives no URL for, is written to `uncaptured` with the reason, for a reviewer to
// see; the test fails on an uncovered Portal it is not told about.
//
// RPC endpoints come only from the file `--rpc-config` names: a JSON object mapping each chain id to
// its URL, `{ "<chainId>": "<url>" }`, the same file `capture-registry-abi.mjs` takes. There is no
// default and no public fallback, and nothing is read from the environment. No URL is ever written to
// the fixture, and a failed request's message is reported without it.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getAddress, keccak256 } from "viem";

const USAGE = "usage: node scripts/capture-eco-routes-vaults.mjs --recapture --rpc-config <path>";

function fail(message) {
  console.error(`capture-eco-routes-vaults: ${message}`);
  process.exit(1);
}

let cli;
try {
  cli = parseArgs({
    options: {
      recapture: { type: "boolean", default: false },
      "rpc-config": { type: "string" },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`);
}
if (!cli.values.recapture) fail(`refusing to touch the network without --recapture\n${USAGE}`);
if (cli.values["rpc-config"] === undefined) fail(`pass --rpc-config <path>\n${USAGE}`);

const RPC_CONFIG_PATH = cli.values["rpc-config"];
const RPC_URLS = (() => {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(RPC_CONFIG_PATH, "utf-8"));
  } catch (err) {
    fail(`cannot read --rpc-config ${RPC_CONFIG_PATH}: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`--rpc-config ${RPC_CONFIG_PATH} must be a JSON object of chain id -> RPC URL`);
  }
  const urls = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^[1-9][0-9]*$/.test(key)) fail(`--rpc-config: "${key}" is not a chain id`);
    // A value still holding the example's `<…>` placeholder is not configured.
    if (typeof value === "string" && /^https?:\/\//.test(value)) urls.set(Number(key), value);
  }
  return urls;
})();

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(SDK, "test", "fixtures", "eco-routes-vaults.json");
const dist = (path) => import(join(SDK, "dist", path));

const { ECO_ROUTES_ADDRESSES } = await dist("protocols/eco-routes/addresses.generated.js");
const { resolveChain } = await dist("chains/canonical.js");
const { hashIntent } = await dist("routes/encode.js");
const { normalizeReward, normalizeRoute } = await dist("routes/normalize.js");
const { intentVaultAddressCall } = await dist("routes/portal.js");
const { ECO_ROUTES_VAULT_PROXY_CREATION_CODE } = await dist("routes/vault.js");

/**
 * The one intent every Portal is asked about. Its fields mean nothing; they only have to be fixed,
 * so the test can rebuild it and hash it the same way. `intentHash` does not include the source
 * chain, so the same probe has one vault per Portal address, whichever chain it is asked on.
 */
const PROBE = {
  destination: "10",
  route: {
    salt: `0x${"5a".repeat(32)}`,
    deadline: "2000000000",
    portal: "0x000000000000000000000000000000000000dEaD",
    nativeAmount: "0",
    tokens: [],
    calls: [],
  },
  reward: {
    deadline: "2000000000",
    creator: "0x000000000000000000000000000000000000dEaD",
    prover: "0x000000000000000000000000000000000000bEEF",
    nativeAmount: "1",
    tokens: [{ token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "7" }],
  },
};

const probeOn = (chainId) => ({
  destination: BigInt(PROBE.destination),
  sourceChainId: BigInt(chainId),
  route: normalizeRoute({
    ...PROBE.route,
    deadline: BigInt(PROBE.route.deadline),
    nativeAmount: BigInt(PROBE.route.nativeAmount),
  }),
  reward: normalizeReward({
    ...PROBE.reward,
    deadline: BigInt(PROBE.reward.deadline),
    nativeAmount: BigInt(PROBE.reward.nativeAmount),
    tokens: PROBE.reward.tokens.map((t) => ({ token: t.token, amount: BigInt(t.amount) })),
  }),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(chainId, method, params) {
  const url = RPC_URLS.get(chainId);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 200)}`);
      return body.result;
    } catch (err) {
      // The message of a failed fetch can carry the URL, and with it a provider key.
      const reason = String(err?.message ?? err)
        .split(url)
        .join("<rpc>");
      // No `cause`: it is the error whose message carries the URL.
      // eslint-disable-next-line preserve-caught-error
      if (attempt >= 3) throw new Error(`chain ${chainId} ${method} failed: ${reason}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

const vaults = [];
const uncaptured = {};
for (const [id, environments] of Object.entries(ECO_ROUTES_ADDRESSES.v3.chains)) {
  const chainId = Number(id);
  if (resolveChain(chainId)?.kind !== "evm") continue;
  for (const [environment, roles] of Object.entries(environments)) {
    const portal = roles.Portal;
    if (portal === undefined) continue;
    const key = `${chainId}:${getAddress(portal)}`;
    if (!RPC_URLS.has(chainId)) {
      uncaptured[key] = `no RPC URL for chain ${chainId} in the config this was captured with`;
      continue;
    }
    try {
      const call = intentVaultAddressCall(probeOn(chainId), { portal });
      const answer = await rpc(chainId, "eth_call", [{ to: call.to, data: call.data }, "latest"]);
      const code = await rpc(chainId, "eth_getCode", [portal, "latest"]);
      vaults.push({
        chainId,
        environment,
        portal: getAddress(portal),
        vault: getAddress(call.decode(answer)),
        codeKeccak256: keccak256(code),
        embedsProxyCreationCode: code
          .toLowerCase()
          .includes(ECO_ROUTES_VAULT_PROXY_CREATION_CODE.slice(2).toLowerCase()),
      });
      console.log(`${key} (${environment}): ${vaults.at(-1).vault}`);
    } catch (err) {
      uncaptured[key] = err.message;
      console.log(`${key} (${environment}): not captured — ${err.message}`);
    }
  }
}

const fixture = {
  note:
    "What each deployed eco-routes Portal's own intentVaultAddress returned for `probe`, written by " +
    "scripts/capture-eco-routes-vaults.mjs and read by test/eco-routes-vault.test.ts. Do not edit by hand.",
  capturedAt: new Date().toISOString().slice(0, 10),
  probe: PROBE,
  intentHash: hashIntent(probeOn(1)).intentHash,
  vaults,
  uncaptured,
};
writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`wrote ${vaults.length} vault(s), ${Object.keys(uncaptured).length} uncaptured`);
