#!/usr/bin/env node
// The release gate: proves, against live chains, that the PACKAGE a release ships does by default
// what the release is for. Run it by hand before dispatching a real release (on the packed tarball
// of the release commit) and again on the npm package after the publish. It is not part of CI,
// which reaches no live chain, and it sends nothing to a live chain: every transaction goes to a
// local anvil fork of it.
//
//   pnpm build && npm pack --pack-destination /tmp/gate && \
//     node sdk/scripts/release-gate.mjs --package /tmp/gate/eco-incorp-sauce-*.tgz --rpc-config sdk/rpc.config.json
//   node sdk/scripts/release-gate.mjs --package 1.2.0 --rpc-config sdk/rpc.config.json
//
// `--package` is a tarball or a version of the published package. `--rpc-config` is a JSON object of
// chain id to URL (sdk/rpc.config.json is one) that holds the seven chains the gate reads: 1
// (Ethereum), 8453 (Base), 5042 (Arc), 5042002 (Arc Testnet), 84532 (Base Sepolia), 11155111
// (Sepolia) and 1399811149 (Solana mainnet-beta); other entries are ignored. A URL is never printed:
// every message is scrubbed of the configured endpoints (each whole, in its parts, and by each path
// segment and query value of eight characters or more), an error prints one line, and a
// configuration the gate cannot read is named by its path alone. No endpoint reaches a command line,
// where the process list shows it: the Solana one goes to `sauce` in a 0600 `--config` file in the
// gate's temp dir, which exists for as long as that command runs. The gate's own environment is cut
// to PATH, TMPDIR, HOME and USERPROFILE once it has read npm's cache and before any installed code
// loads, since the installed testing kit runs in this process and starts anvil and its recorder with
// no environment of its own: they inherit it. Every child the gate starts itself gets PATH, TMPDIR,
// a temp HOME and USERPROFILE and npm's cache alone, and the installs run with `--ignore-scripts`.
// A command that carries a key is refused unless its endpoint is the kit's own loopback fork, so
// "sends nothing to a live chain" is checked, not assumed. Stopped by SIGINT, SIGTERM or SIGHUP, the
// gate stops its forks, removes its temp dir and exits 130.
//
// A MISSING KEY IS A FAILURE, never a skip. The gate checks all seven keys first, prints
// `FAIL <chain>: no endpoint in --rpc-config` for each one missing, runs every step on every chain it
// can, and exits 1 when any step failed. Every step prints one PASS or FAIL line naming its chain.
//
//   1. Installs the package into a temp project with a temp HOME (`npm install --engine-strict`),
//      and LiteSVM at the package's own `sdk/runtime` pin, for step 7.
//   2. The live stack, on all six supported EVM chains: the installed testing kit forks the chain
//      live and finds the Kitchen it runs, deploying nothing over it, with kitchen-evm 1.4.0
//      behind the proxy (its EIP-1967 implementation slot).
//   3. A new owner's Pot, on all six: the installed `sauce pot` names the Pot the Kitchen's own
//      `predictPot` names, finds none there, then deploys it (2,886 bytes of code).
//   4. A cook, on all six: the installed `sauce run` cooks on it; the mined transaction goes to that
//      Pot and names the package's engine, and the trace of it returns the program's 7.
//   5. A real Uniswap V3 swap, on Base: `sauce simulate` of the skill's `buy.sauce.ts` shows WETH
//      arriving.
//   6. The solver's kitchen-evm 1.3.0 Pot, on Ethereum, Base and Arc: simulated through engine
//      1.3.0, by address and by its owner.
//   7. Solana, through engine 1.4.1: `sauce simulate` of the manual's `pay.sauce.ts` names the
//      package's engine program, and its own effects show 1 USDC leaving the Pot and reaching the
//      recipient.
//   8. Prints the summary table, step by chain, and stops every fork.
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createPublicClient, decodeFunctionData, getAddress, http } from "viem";

import {
  childEnvironment,
  confineEnvironment,
  endpointSecrets,
  evmCookProblem,
  GATE_ENVIRONMENT,
  requireSigningEndpoint,
  solanaCookProblem,
  withEndpointConfig,
} from "./lib/release-gate-checks.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The six supported EVM chains the gate forks, and Solana's mainnet-beta, by slug and id. */
const EVM = [
  { slug: "ethereum", id: 1 },
  { slug: "base", id: 8453 },
  { slug: "arc", id: 5042 },
  { slug: "arc-testnet", id: 5042002 },
  { slug: "base-sepolia", id: 84532 },
  { slug: "sepolia", id: 11155111 },
];
const SOLANA = { slug: "solana", id: 1399811149 };
const CHAINS = [...EVM, SOLANA];

/** Where each step runs: step 2 to 4 on every EVM chain, 5 on Base, 6 on three, 7 on Solana. */
const STEPS = [
  { n: 2, name: "live stack", on: EVM.map((c) => c.slug) },
  { n: 3, name: "new owner's Pot", on: EVM.map((c) => c.slug) },
  { n: 4, name: "cook", on: EVM.map((c) => c.slug) },
  { n: 5, name: "V3 swap", on: ["base"] },
  { n: 6, name: "solver's 1.3.0 Pot", on: ["ethereum", "base", "arc"] },
  { n: 7, name: "Solana engine", on: ["solana"] },
];

/** The solver's kitchen-evm 1.3.0 Pot on Ethereum, Base and Arc, its owner (salt 0) and its engine. */
const SOLVER_POT = "0x59215bCa4923856d8DF96F5B5Dfe823645AC9411";
const SOLVER_OWNER = "0x8B5D51AF4C4542f241C4e54CFd903CeEd145f082";
const SOLVER_ENGINE = "0x0F50E5dB8d30c102f1da1301a1C8A06E06Fa0f67";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
/** EIP-1967's implementation slot. */
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ZERO_SALT = `0x${"00".repeat(32)}`;
/** What a Pot of this release weighs, in bytes of code. */
const POT_CODE_BYTES = 2886;
/** Solana mainnet-beta's USDC mint, and what step 7's payment moves of it: 1 USDC, in base units. */
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PAYMENT = 1_000_000n;

const { values } = parseArgs({
  options: { package: { type: "string" }, "rpc-config": { type: "string" } },
  strict: true,
});
if (values.package === undefined || values["rpc-config"] === undefined) {
  console.error(
    "usage: node sdk/scripts/release-gate.mjs --package <path-to.tgz | version> --rpc-config <file>",
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The endpoints, and what is kept from every message.

/** Every string a message is scrubbed of: the configured endpoints, whole and in their parts. */
const secrets = [];
const scrub = (text) => {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("<endpoint>");

  return out;
};
/** The first line of what went wrong, scrubbed. */
const reasonOf = (error) =>
  scrub(String((error instanceof Error ? error.message : error) ?? "failed"))
    .split("\n")[0]
    .slice(0, 400);

/**
 * Refuses a configuration the gate cannot use, exit 2. The message holds what is wrong and the file's
 * path, never a word of what the file holds, nor what the parser quotes of it (`Unexpected token 'h',
 * "https://ex"... is not valid JSON`): its values are endpoints, which carry keys.
 */
function refuseConfig(what) {
  console.error(`--rpc-config ${what}`);
  process.exit(2);
}

/**
 * Whether `text`, given where a file's path goes, is an endpoint instead: a URL scheme before `//`
 * once its whitespace is trimmed, or an http(s) or ws(s) URL inside it, as it stands after `resolve`
 * collapsed the slashes. An endpoint carries a key, so it is told apart before anything is echoed.
 */
const givenAsEndpoint = (text) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim()) || /\b(?:https?|wss?):\/+[^/\s]/i.test(text);

const configured = {};
{
  const given = values["rpc-config"];
  // An endpoint pasted where the path goes is not repeated either, whatever surrounds it.
  if (givenAsEndpoint(given)) refuseConfig("takes the path of a file, not a URL");
  const file = resolve(given);
  // With whitespace before it, `resolve` makes of an endpoint a path of the working directory that
  // holds it whole: not a path to name either.
  if (givenAsEndpoint(file)) refuseConfig("takes the path of a file, not a URL");
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    refuseConfig(`${file} cannot be read as JSON`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    refuseConfig(`${file} is not a JSON object of chain id to URL`);
  }
  for (const { id } of CHAINS) {
    const url = config[String(id)];
    if (typeof url !== "string" || url.trim() === "") continue;
    configured[id] = url.trim();
    for (const secret of endpointSecrets(url.trim())) {
      if (!secrets.includes(secret)) secrets.push(secret);
    }
  }
  secrets.sort((a, b) => b.length - a.length);
}

// ---------------------------------------------------------------------------
// Results: one line per step and chain, and the table at the end.

/** `results.get(step).get(chain)` is "PASS" or "FAIL". */
const results = new Map(STEPS.map(({ n }) => [n, new Map()]));
let failures = 0;

function report(n, chain, ok, detail) {
  const step = STEPS.find((each) => each.n === n);
  results.get(n).set(chain, ok ? "PASS" : "FAIL");
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${chain}: step ${n} ${step.name}${detail ? ` — ${detail}` : ""}`,
  );
}

/** Runs one step on one chain: PASS with what it returns, FAIL with the one line that went wrong. */
async function step(n, chain, body) {
  try {
    report(n, chain, true, (await body()) ?? "");
  } catch (error) {
    report(n, chain, false, reasonOf(error));
  }
}

/** Every step of `chain`'s that has not run, failed with the reason: a gap is never a skip. */
function failRest(chain, reason) {
  for (const { n, on } of STEPS) {
    if (on.includes(chain) && !results.get(n).has(chain)) report(n, chain, false, reason);
  }
}

// ---------------------------------------------------------------------------
// The commands.

const missing = CHAINS.filter(({ id }) => configured[id] === undefined);
for (const { slug } of missing) console.log(`FAIL ${slug}: no endpoint in --rpc-config`);

const tmp = mkdtempSync(join(tmpdir(), "sauce-release-gate-"));
const project = join(tmp, "project");
const home = join(tmp, "home");
mkdirSync(project);
mkdirSync(home);
writeFileSync(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
const seven = join(project, "seven.sauce.ts");
writeFileSync(seven, "function main(): Uint256 {\n  return 7;\n}\n");

const forks = [];
async function stopForks() {
  for (const fork of forks.splice(0)) await fork.stop().catch(() => undefined);
}
/** Stops one fork and forgets it. */
async function release(fork) {
  const at = forks.indexOf(fork);
  if (at >= 0) forks.splice(at, 1);
  await fork.stop().catch(() => undefined);
}
// Stopped by a signal, the gate stops its forks and removes its temp dir before it exits: the dir
// holds the Solana endpoint's file while step 7 runs, and the forks are what the signal interrupted.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    void stopForks().finally(() => {
      rmSync(tmp, { recursive: true, force: true });
      process.exit(130);
    });
  });
}

/**
 * The operator's npm cache, asked of npm with the operator's own HOME and the small environment;
 * unset where npm does not answer, which the first install then reports.
 */
const npmCache =
  (
    spawnSync("npm", ["config", "get", "cache"], {
      encoding: "utf8",
      env: childEnvironment(process.env, {
        home: process.env.HOME ?? process.env.USERPROFILE ?? tmpdir(),
        cache: process.env.npm_config_cache,
      }),
    }).stdout ?? ""
  ).trim() || undefined;

// The installed testing kit runs in this process, and starts anvil and its recorder with no
// environment of its own: they inherit this one. It is cut to what they need once the gate has read
// what it needs of the operator's, and before any installed code loads (`installed`, below).
confineEnvironment(process.env, GATE_ENVIRONMENT);

/**
 * `npm install` in the temp project, with the temp HOME, the operator's npm cache and no more of the
 * environment, and none of the lifecycle scripts of what it installs.
 */
function npm(args) {
  const ran = spawnSync(
    "npm",
    ["install", "--engine-strict", "--ignore-scripts", "--no-audit", "--no-fund", ...args],
    {
      cwd: project,
      encoding: "utf8",
      env: childEnvironment(process.env, { home, cache: npmCache }),
    },
  );
  if (ran.status !== 0) {
    // npm's own words, not its pointer to a log file: the first lines it reports as errors.
    const said = (ran.stderr || ran.stdout)
      .split("\n")
      .filter((text) => text.startsWith("npm error") && !text.includes("A complete log"))
      .slice(0, 2)
      .map((text) => text.replace(/^npm error\s*/, ""));
    throw new Error(
      `npm install ${args.join(" ")} exited ${ran.status}${said.length === 0 ? "" : `: ${said.join("; ")}`}`,
    );
  }
}

/**
 * A command of the installed `sauce`, run with the temp HOME and the small environment; its output
 * scrubbed. A command that carries a key is refused unless its endpoint is the kit's loopback fork.
 */
let sauceBin;
function sauce(args) {
  requireSigningEndpoint(args);
  const ran = spawnSync(process.execPath, [sauceBin, "--no-update-check", ...args], {
    cwd: project,
    encoding: "utf8",
    env: childEnvironment(process.env, { home, cache: npmCache }),
    maxBuffer: 256 * 1024 * 1024,
  });

  return { status: ran.status, stdout: scrub(ran.stdout ?? ""), stderr: scrub(ran.stderr ?? "") };
}
/** The result's JSON, once the command exited 0. */
function jsonOf(ran, what) {
  if (ran.status !== 0) {
    throw new Error(
      `${what} exited ${ran.status}: ${(ran.stderr.trim() || ran.stdout.trim()).split("\n").at(-1)}`,
    );
  }
  try {
    return JSON.parse(ran.stdout);
  } catch {
    throw new Error(`${what} printed no JSON`);
  }
}
const lower = (address) => String(address).toLowerCase();
const sameAddress = (a, b) => lower(a) === lower(b);

/** A fresh Solana public key (base58), for an owner that holds nothing on the cluster. */
function freshPublicKey() {
  const der = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" });
  const bytes = der.subarray(der.length - 32);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  for (; n > 0n; n /= 58n) out = alphabet[Number(n % 58n)] + out;
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Step 1: the package, installed the way a user installs it.

let installedRoot;
let installedManifest;
try {
  const name = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).name;
  const spec = existsSync(resolve(values.package))
    ? resolve(values.package)
    : /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(values.package)
      ? `${name}@${values.package}`
      : undefined;
  if (spec === undefined) {
    throw new Error(`--package ${values.package} is neither a tarball that exists nor a version`);
  }
  npm([spec]);
  installedRoot = join(project, "node_modules", name);
  installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  const pin = JSON.parse(readFileSync(join(installedRoot, "sdk/runtime/package.json"), "utf8"))
    .dependencies.litesvm;
  npm([`litesvm@${pin}`]);
  sauceBin = join(installedRoot, installedManifest.bin.sauce);
  console.log(
    `PASS install: ${installedManifest.name}@${installedManifest.version} and litesvm@${pin}, in a temp project with a temp HOME`,
  );
} catch (error) {
  console.log(`FAIL install: ${reasonOf(error)}`);
  failures += 1;
}

// ---------------------------------------------------------------------------
// Steps 2 to 7.

/** What the installed package exports: the testing kit, the addresses, the Pot and Kitchen ABIs. */
async function installed(subpath) {
  return import(
    pathToFileURL(join(installedRoot, installedManifest.exports[subpath].default)).href
  );
}

async function evmChain({ slug, id }, kit, dep, abis) {
  const url = configured[id];
  const needs = STEPS.filter(({ on }) => on.includes(slug));
  if (url === undefined) {
    for (const { n } of needs) report(n, slug, false, "no endpoint in --rpc-config");

    return;
  }
  let chain;
  await step(2, slug, async () => {
    // The kit forces the requested chain id onto its anvil (`--chain-id`), so what the endpoint
    // itself reports is the only evidence it serves this chain: another chain's endpoint under this
    // id would be forked as this one, and pass every step here for a chain the gate never read.
    const upstream = createPublicClient({ transport: http(url) });
    const served = await upstream.getChainId();
    if (served !== id) {
      throw new Error(`the endpoint in --rpc-config for chain id ${id} serves chain id ${served}`);
    }
    const block = await upstream.getBlockNumber();
    chain = await kit.fork(slug, { mode: "live", rpcUrl: url, block });
    forks.push(chain);
    if (chain.stack.origin !== "live") {
      throw new Error("the kit deployed a stack here: the chain runs no release of this package");
    }
    const slot = await chain.client.getStorageAt({
      address: dep.v12KitchenAddress(),
      slot: IMPLEMENTATION_SLOT,
    });
    const implementation = getAddress(`0x${(slot ?? "0x").slice(-40)}`);
    if (!sameAddress(implementation, dep.v12KitchenImplementationAddress())) {
      throw new Error(
        `the Kitchen's implementation is ${implementation}, not the package's ${dep.v12KitchenImplementationAddress()}`,
      );
    }

    return `used as it is, Kitchen implementation ${implementation} (kitchen-evm ${dep.v12ReleaseSet()["kitchen-evm"].version})`;
  });
  if (results.get(2).get(slug) !== "PASS") {
    failRest(slug, "step 2 failed: there is no live release stack to run on");
    if (chain !== undefined) await release(chain);

    return;
  }

  try {
    const a3 = chain.account(3);
    let pot;
    await step(3, slug, async () => {
      // Gas, the Kitchen's fee and a little more, in the chain's native coin (on Arc, USDC).
      const fee = await chain.executionFee();
      const balance = await chain.client.getBalance({ address: a3.address });
      const need = 10n * fee + 10n ** 17n;
      if (balance < need) {
        throw new Error(
          `kit account 3 holds ${balance} of the native coin: under 10 x the Kitchen fee ${fee} plus 0.1`,
        );
      }
      const before = jsonOf(
        sauce(["pot", "--owner", a3.address, "--chain", slug, "--rpc-url", chain.rpcUrl]),
        "sauce pot",
      );
      const predicted = await chain.client.readContract({
        address: dep.v12KitchenAddress(),
        abi: abis.v12KitchenAbi,
        functionName: "predictPot",
        args: [a3.address, ZERO_SALT],
      });
      if (!sameAddress(before.pot, predicted)) {
        throw new Error(`sauce pot names ${before.pot}, the Kitchen's predictPot ${predicted}`);
      }
      if (before.deployment?.pot?.deployed !== false) {
        throw new Error(`the Pot ${before.pot} of kit account 3 is already deployed on ${slug}`);
      }
      const deployed = sauce([
        ...["pot", "--owner", a3.address, "--deploy", "--private-key", a3.privateKey],
        ...["--chain", slug, "--rpc-url", chain.rpcUrl],
      ]);
      if (deployed.status !== 0) {
        throw new Error(
          `sauce pot --deploy exited ${deployed.status}: ${deployed.stderr.trim().split("\n").at(-1)}`,
        );
      }
      const code = await chain.client.getCode({ address: predicted });
      const bytes = code === undefined ? 0 : (code.length - 2) / 2;
      if (bytes !== POT_CODE_BYTES) {
        throw new Error(`the Pot ${predicted} holds ${bytes} bytes of code, not ${POT_CODE_BYTES}`);
      }
      pot = predicted;

      return `Pot ${predicted} is the Kitchen's prediction, was not deployed, and now has ${bytes} bytes of code`;
    });

    await step(4, slug, async () => {
      if (pot === undefined) throw new Error("step 3 did not deploy the Pot");
      const ran = jsonOf(
        sauce([
          ...["run", seven, "--chain", slug, "--rpc-url", chain.rpcUrl],
          ...["--private-key", a3.privateKey, "-y", "--json"],
        ]),
        "sauce run",
      );
      if (ran.cook?.status !== "success") throw new Error(`the cook is ${ran.cook?.status}`);
      const sent = await chain.client.getTransaction({ hash: ran.cook.hash });
      const decoded = decodeFunctionData({ abi: abis.v12PotAbi, data: sent.input });
      // What the cook DID, as the chain shows it: where the mined transaction went, and what its top
      // call returned (a program's return, with no ABI framing), traced as the kit reads a cook's.
      const traced = await chain.client.request({
        method: "debug_traceTransaction",
        params: [ran.cook.hash, { tracer: "callTracer", tracerConfig: { onlyTopCall: true } }],
      });
      const problem = evmCookProblem(
        { to: sent.to, engine: decoded.args[0], output: traced?.output },
        { pot, engine: dep.v12EngineAddress(), value: 7n },
      );
      if (problem !== undefined) throw new Error(problem);

      return `cook ${ran.cook.hash} went to the Pot ${pot}, on engine ${decoded.args[0]}, and returned 7`;
    });

    if (slug === "base") {
      await step(5, slug, async () => {
        const buy = join(installedRoot, "skills/sauce-cli/examples/buy.sauce.ts");
        const simulated = jsonOf(
          sauce([
            ...["simulate", buy, "--chain", "base", "--owner", a3.address],
            ...["--rpc-url", chain.rpcUrl, "--assume-balance", "USDC:100", "--json"],
            ...["--args", WETH_BASE, "100000000"],
            // MAX_SQRT_PRICE_X96 - 1: no price limit. WETH is token0 on Base, so buying it moves the
            // price up: the gate proves the swap path, not a price.
            ...["1461446703485210103287273052203988822378723970341", "1", a3.address],
          ]),
          "sauce simulate",
        );
        if (simulated.ok !== true)
          throw new Error(`the swap does not simulate: ${simulated.reason}`);
        const weth = (simulated.transfers ?? []).find(
          (move) => sameAddress(move.token, WETH_BASE) && sameAddress(move.to, a3.address),
        );
        if (weth === undefined || BigInt(weth.amount) === 0n) {
          throw new Error(`no WETH arrives at ${a3.address} in the simulation's effects`);
        }

        return `${weth.amount} WETH reaches ${a3.address}`;
      });
    }

    if (["ethereum", "base", "arc"].includes(slug)) {
      await step(6, slug, async () => {
        const code = await chain.client.getCode({ address: SOLVER_POT });
        if (code === undefined || code === "0x")
          throw new Error(`the solver's Pot ${SOLVER_POT} has no code`);
        const through = (...selector) => {
          const ran = sauce([
            ...["simulate", seven, "--chain", slug, ...selector],
            ...["--rpc-url", chain.rpcUrl, "--json"],
          ]);
          const out = jsonOf(ran, `sauce simulate ${selector[0]}`);
          if (out.ok !== true || String(out.returned) !== "7") {
            throw new Error(
              `sauce simulate ${selector[0]} does not return 7: ${out.reason ?? out.returned}`,
            );
          }
          if (!sameAddress(out.to, SOLVER_POT)) {
            throw new Error(`sauce simulate ${selector[0]} cooks on ${out.to}, not ${SOLVER_POT}`);
          }
          const notes = lower(`${ran.stdout}\n${ran.stderr}`);
          if (!notes.includes("kitchen-evm 1.3.0") || !notes.includes(lower(SOLVER_ENGINE))) {
            throw new Error(
              `sauce simulate ${selector[0]} names neither kitchen-evm 1.3.0 nor engine ${SOLVER_ENGINE}`,
            );
          }
        };
        through("--pot", SOLVER_POT);
        through("--owner", SOLVER_OWNER);

        return `Pot ${SOLVER_POT} returns 7 through engine ${SOLVER_ENGINE}, by address and by owner ${SOLVER_OWNER}`;
      });
    }
  } finally {
    await release(chain);
  }
}

async function solana(dep) {
  const url = configured[SOLANA.id];
  if (url === undefined) {
    report(7, SOLANA.slug, false, "no endpoint in --rpc-config");

    return;
  }
  await step(7, SOLANA.slug, async () => {
    // The command holds an endpoint to its chain's cluster by genesis hash, and the gate does too,
    // before it reads anything from it: no other cluster's endpoint passes for mainnet-beta.
    const MAINNET_BETA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const genesis = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }),
    }).then((reply) => reply.json());
    if (genesis.result !== MAINNET_BETA_GENESIS) {
      throw new Error(
        `the endpoint in --rpc-config for chain id ${SOLANA.id} is not mainnet-beta's: its genesis ` +
          `hash is ${genesis.result ?? `unanswered (${genesis.error?.message ?? "no result"})`}`,
      );
    }
    const pay = join(installedRoot, "docs/examples/pay.sauce.ts");
    const engine = dep.v12SvmEngineProgramId();
    const earlier = dep.V12_RELEASE_SETS.map((row) => row["v12-svm"].engine).filter(
      (id) => id !== null && id !== engine,
    );
    const recipient = freshPublicKey();
    // The endpoint reaches the command in a file only this process's owner reads, in the gate's temp
    // dir: never on a command line, where the process list shows it, and there only while the
    // command runs (a failure, or a signal that stops the gate, leaves nothing behind).
    const simulated = withEndpointConfig(tmp, SOLANA.id, url, (config) =>
      jsonOf(
        sauce([
          ...["simulate", pay, "--chain", "solana", "--owner", freshPublicKey()],
          ...["--config", config, "--assume-balance", "USDC:5", "--json"],
          ...["--args", recipient, String(PAYMENT)],
        ]),
        "sauce simulate",
      ),
    );
    // What the simulation shows it DID, in its own effects: the engine ran, and the payment is
    // there, from the Pot to the recipient.
    const problem = solanaCookProblem(simulated, {
      engine,
      earlier,
      recipient,
      mint: USDC_SOLANA,
      symbol: "USDC",
      amount: PAYMENT,
    });
    if (problem !== undefined) throw new Error(problem);

    return `the simulated cook invokes engine ${engine} and pays ${PAYMENT} USDC from the Pot ${simulated.pot} to ${recipient}`;
  });
}

try {
  if (installedRoot === undefined) {
    for (const { n, on } of STEPS) {
      for (const chain of on) report(n, chain, false, "not run: the package did not install");
    }
  } else {
    const anvil = spawnSync("anvil", ["--version"], {
      encoding: "utf8",
      env: childEnvironment(process.env, { home }),
    });
    const kit = await installed("./testing");
    const dep = await installed("./deployments");
    const abis = await installed("./evm/engine");
    for (const chain of EVM) {
      try {
        if (anvil.status !== 0) failRest(chain.slug, "anvil is not on PATH");
        else await evmChain(chain, kit, dep, abis);
      } catch (error) {
        // A step reports its own failure; this is what went wrong outside one.
        failRest(chain.slug, reasonOf(error));
      }
    }
    await solana(dep);
  }
} catch (error) {
  console.log(`FAIL gate: ${reasonOf(error)}`);
  failures += 1;
} finally {
  await stopForks();
  rmSync(tmp, { recursive: true, force: true });
}

// Step 8: the summary, one row per step and one column per chain.
const columns = CHAINS.map(({ slug }) => slug);
const widths = columns.map((slug) => Math.max(slug.length, "PASS".length));
const rows = STEPS.map(({ n, name, on }) => [
  `${n} ${name}`,
  ...columns.map((slug) => (on.includes(slug) ? (results.get(n).get(slug) ?? "FAIL") : "-")),
]);
const first = Math.max(...rows.map((row) => row[0].length), "step".length);
const line = (cells) =>
  `${cells[0].padEnd(first)}  ${cells
    .slice(1)
    .map((cell, i) => cell.padEnd(widths[i]))
    .join("  ")}`;
console.log(`\n${line(["step", ...columns])}`);
for (const row of rows) console.log(line(row));
console.log(
  failures === 0
    ? "\nthe gate passed: every step on every chain"
    : `\nthe gate FAILED: ${failures} failure${failures === 1 ? "" : "s"}${missing.length === 0 ? "" : ` (${missing.length} chain${missing.length === 1 ? "" : "s"} with no endpoint in --rpc-config)`}`,
);
process.exitCode = failures === 0 && missing.length === 0 ? 0 : 1;
