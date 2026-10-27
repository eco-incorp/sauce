// Checks the `sauce` command's built-in public RPC endpoints (`src/cli/public-rpcs.ts`) live, as
// they were checked when the list was written: run it by hand before a release, or when one is
// suspected dead. It is not part of CI, which reaches no network.
//
//   node scripts/check-public-rpcs.mjs [--chains <id>,…]
//
// For each endpoint, in turn (one request at a time, so no endpoint rate-limits the check):
//   - EVM: `eth_chainId` is the chain's id; `eth_call` honors a state override of code and storage
//     (a contract that returns its slot 0, set to 42), which `sauce simulate`'s fallback needs; and
//     whether `eth_simulateV1` runs that call with `validation: false` and `traceTransfers`, as the
//     command sends it: an endpoint flagged `simulateV1` must run it (one flagged false that runs it
//     is noted, not failed: false only keeps the command from sending it there).
//   - Solana: `getGenesisHash` is the cluster's (mainnet's, devnet's, testnet's), `getSlot` answers
//     a slot, and a mint the registry has on the cluster reads (USDC; testnet's wrapped native);
//     and whether a filtered `getProgramAccounts` answers: an endpoint flagged `programAccounts`
//     must answer it.
// It prints a line per endpoint and exits 1 when any fails or its flag is wrong. The endpoints are
// read from the module itself (`lib/load-ts.mjs`), so the check needs no build, and holds no URL.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createTsLoader } from "./lib/load-ts.mjs";

const SDK = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = createTsLoader(SDK);
const { PUBLIC_RPCS, PUBLIC_RPCS_VERIFIED } = load(join(SDK, "src/cli/public-rpcs.ts"));
const { CANONICAL_CHAINS } = load(join(SDK, "src/chains/canonical.ts"));

const { values } = parseArgs({ options: { chains: { type: "string" } } });
const only = values.chains === undefined ? undefined : values.chains.split(",").map(Number);

/** Each Solana chain's cluster, by the chain id the SDK gives it: its genesis and a mint the
 *  registry has there (USDC, else the wrapped native: testnet has no USDC). */
const SOLANA_CLUSTERS = {
  1399811149: {
    genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  1399811150: {
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  1399811151: {
    genesis: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    mint: "So11111111111111111111111111111111111111112",
  },
};
/** An address with no code, given code that returns its storage slot 0, and slot 0 set to 42. */
const PROBE = "0x00000000000000000000000000000000005a0ce1";
const OVERRIDE = {
  [PROBE]: {
    code: "0x60005460005260206000f3",
    stateDiff: { [`0x${"0".repeat(64)}`]: `0x${"2a".padStart(64, "0")}` },
  },
};
const FORTY_TWO = `0x${"2a".padStart(64, "0")}`;

/** One JSON-RPC call: its result, or a throw naming the HTTP status or the RPC error. An endpoint
 *  the list gives a timeout of its own (`timeoutMs`) is given that long. */
async function rpc(url, method, params, timeoutMs = 15_000) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = JSON.parse(text);
  if (body.error !== undefined) {
    throw new Error(`${method}: ${body.error.code} ${String(body.error.message).slice(0, 80)}`);
  }

  return body.result;
}

/** What is wrong with an EVM endpoint, or `undefined`; and whether it ran eth_simulateV1. */
async function checkEvm(chainId, url) {
  const id = Number(await rpc(url, "eth_chainId", []));
  if (id !== chainId) return { problem: `serves chain ${id}` };
  const called = await rpc(url, "eth_call", [{ to: PROBE, data: "0x" }, "latest", OVERRIDE]);
  if (called !== FORTY_TWO) return { problem: `ignored a state override (answered ${called})` };
  try {
    const [block] = await rpc(url, "eth_simulateV1", [
      {
        blockStateCalls: [{ stateOverrides: OVERRIDE, calls: [{ to: PROBE, data: "0x" }] }],
        validation: false,
        traceTransfers: true,
      },
      "latest",
    ]);
    const call = block?.calls?.[0];

    return { simulateV1: call?.status === "0x1" && call?.returnData === FORTY_TWO };
  } catch {
    return { simulateV1: false };
  }
}

/** What is wrong with an endpoint of the Solana cluster `cluster`, or `undefined`. */
async function checkSolana(url, cluster, timeoutMs) {
  const ask = (method, params) => rpc(url, method, params, timeoutMs);
  const genesis = await ask("getGenesisHash", []);
  if (genesis !== cluster.genesis) return { problem: `serves the cluster of genesis ${genesis}` };
  if (typeof (await ask("getSlot", [])) !== "number") return { problem: "answered no slot" };
  const mint = await ask("getAccountInfo", [cluster.mint, { encoding: "base64" }]);
  if (mint?.value === null || mint?.value === undefined) return { problem: "read no mint" };
  // A filtered scan, as `sauce pools` sends one: Raydium CLMM's 1,544-byte pools holding the mint.
  const scan = await ask("getProgramAccounts", [
    "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    {
      encoding: "base64",
      dataSlice: { offset: 0, length: 0 },
      filters: [{ dataSize: 1544 }, { memcmp: { offset: 105, bytes: cluster.mint } }],
    },
  ]).catch(() => undefined);

  return { programAccounts: Array.isArray(scan) };
}

console.log(`public endpoints, last verified ${PUBLIC_RPCS_VERIFIED}:`);
let failures = 0;
for (const [key, list] of Object.entries(PUBLIC_RPCS)) {
  const chainId = Number(key);
  if (only !== undefined && !only.includes(chainId)) continue;
  const slug = CANONICAL_CHAINS.find((chain) => chain.id === chainId)?.slug ?? `chain ${chainId}`;
  for (const { url, simulateV1, programAccounts, timeoutMs } of list) {
    let found;
    try {
      const cluster = SOLANA_CLUSTERS[chainId];
      found =
        cluster !== undefined
          ? await checkSolana(url, cluster, timeoutMs)
          : await checkEvm(chainId, url);
    } catch (error) {
      found = { problem: error.cause?.code ?? error.message };
    }
    const problem =
      found.problem ??
      (simulateV1 === true && found.simulateV1 === false
        ? "flagged simulateV1, and eth_simulateV1 did not run"
        : programAccounts === true && found.programAccounts === false
          ? "flagged programAccounts, and getProgramAccounts was refused"
          : undefined);
    if (problem !== undefined) failures++;
    const note =
      problem === undefined && simulateV1 === false && found.simulateV1 === true
        ? "  (eth_simulateV1 ran, though flagged false)"
        : "";
    console.log(
      `  ${problem === undefined ? "ok  " : "FAIL"} ${slug.padEnd(10)} ${url}` +
        (SOLANA_CLUSTERS[chainId] !== undefined
          ? `  programAccounts=${found.programAccounts ?? "?"}`
          : `  simulateV1=${found.simulateV1 ?? "?"}`) +
        (problem === undefined ? note : `  -- ${problem}`),
    );
  }
}
console.log(failures === 0 ? "every endpoint passed" : `${failures} failed: update the list`);
process.exitCode = failures === 0 ? 0 : 1;
