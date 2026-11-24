// What the release gate (`sdk/scripts/release-gate.mjs`) holds a cook's outcome to, as pure functions
// of what the command and the chain reported, so each check is tested against the outcomes it must
// refuse. Each returns the problem, a sentence for the gate's FAIL line, or `undefined` when the
// outcome is the one expected.
//
// A cook that ran and succeeded is not yet the cook the gate is for: a simulation can succeed and
// move nothing, or move another token, or pay another account, and a mined cook can go to another
// contract. Each check therefore reads what the cook DID.

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sameAddress = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * The net change of `holder`'s `mint`, in base units, over the entries of a simulation's
 * `tokenChanges` that name BOTH: another mint's entry, or another holder's, never stands in for it.
 * Each entry's `owner` is the token account's owner and its `delta` a decimal string, negative
 * where the account is debited. `{ delta: undefined }` where no entry matches, and `{ problem }`
 * where one that does has no delta to read.
 */
function netChange(changes, holder, mint) {
  let delta;
  for (const entry of changes) {
    if (entry === null || typeof entry !== "object") continue;
    if (entry.owner !== holder || entry.mint !== mint) continue;
    if (typeof entry.delta !== "string" || !/^-?\d+$/.test(entry.delta)) {
      return {
        problem: `the simulation's change of ${entry.account ?? "an account"} has no readable delta (${String(entry.delta)})`,
      };
    }
    delta = (delta ?? 0n) + BigInt(entry.delta);
  }

  return { delta };
}

/**
 * A simulated Solana payment: `simulated` is `sauce simulate --json`'s object, read by its
 * top-level `ok`, `logs`, `pot` and `tokenChanges`. It must have run on the package's engine and
 * shown, in its own effects, `expected.amount` of the mint leaving the Pot and reaching the
 * recipient.
 */
export function solanaCookProblem(simulated, expected) {
  const { engine, earlier, recipient, mint, amount, symbol } = expected;
  if (simulated.ok !== true) return `the cook does not simulate: ${simulated.reason}`;
  const logs = Array.isArray(simulated.logs) ? simulated.logs : [];
  if (!logs.some((line) => String(line).startsWith(`Program ${engine} invoke`))) {
    return `the simulated cook never invokes the package's engine ${engine}`;
  }
  const other = earlier.find((id) =>
    logs.some((line) => String(line).startsWith(`Program ${id} invoke`)),
  );
  if (other !== undefined) return `the simulated cook invokes the earlier engine ${other}`;

  const pot = simulated.pot;
  if (typeof pot !== "string" || pot === "") {
    return "the simulation names no Pot, so the payment it makes cannot be read";
  }
  const changes = Array.isArray(simulated.tokenChanges) ? simulated.tokenChanges : [];
  const received = netChange(changes, recipient, mint);
  if (received.problem !== undefined) return received.problem;
  if (received.delta === undefined) {
    return `the simulation shows no ${symbol} change for the recipient ${recipient}: the payment is not in its effects`;
  }
  if (received.delta !== amount) {
    return `the recipient ${recipient} receives ${received.delta} ${symbol}, not ${amount}`;
  }
  const paid = netChange(changes, pot, mint);
  if (paid.problem !== undefined) return paid.problem;
  if (paid.delta === undefined) {
    return `the simulation shows no ${symbol} change for the Pot ${pot}: nothing is paid from it`;
  }
  if (paid.delta !== -amount) {
    return `the Pot ${pot}'s ${symbol} changes by ${paid.delta}, not ${-amount}`;
  }

  return undefined;
}

/**
 * A mined EVM cook: `observed` is what the chain shows of it (the transaction's target, the engine
 * its calldata names, and the output of its top call from `debug_traceTransaction`), `expected`
 * what step 3 deployed and the package names. A program's return comes back with no ABI framing:
 * `return 7` is the one 32-byte word 7.
 */
export function evmCookProblem(observed, expected) {
  if (!sameAddress(observed.engine, expected.engine)) {
    return `the cook names engine ${observed.engine}, not the package's ${expected.engine}`;
  }
  if (
    observed.to === null ||
    observed.to === undefined ||
    !sameAddress(observed.to, expected.pot)
  ) {
    return `the cook went to ${observed.to ?? "no account (it created a contract)"}, not to the Pot ${expected.pot} that step 3 deployed`;
  }
  const { output } = observed;
  if (typeof output !== "string") {
    return "the cook's trace has no output, so what it returned cannot be read";
  }
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(output)) {
    return `the cook's traced output ${output.slice(0, 74)} is not hex`;
  }
  const bytes = (output.length - 2) / 2;
  if (bytes !== 32) {
    return `the cook returned ${bytes} bytes, not the one word of ${expected.value}`;
  }
  const returned = BigInt(output);
  if (returned !== expected.value) {
    return `the cook returned ${returned}, not ${expected.value}`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Endpoints, environments and keys. The gate's endpoints carry provider keys and its steps sign.

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** A path segment or a query value is taken for a key, and scrubbed, from this many characters. */
const KEY_LENGTH = 8;

/**
 * Every string a message of the gate is scrubbed of for `url`, an endpoint that carries a key: it
 * whole, its user name, password, host, path and query, each path segment and each query value of
 * eight characters or more (a provider's message may repeat the key alone), each as written and
 * decoded. Shorter segments and values are words, which scrubbed would mangle every message. A
 * string that is no URL is held whole.
 */
export function endpointSecrets(url) {
  const secrets = [url];
  const add = (text, least = 3) => {
    for (const one of [text, decoded(text)]) {
      if (one.length >= least && !secrets.includes(one)) secrets.push(one);
    }
  };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return secrets;
  }
  for (const part of [
    parsed.username,
    parsed.password,
    parsed.search,
    parsed.pathname,
    parsed.host,
  ]) {
    add(part);
  }
  for (const segment of parsed.pathname.split("/")) add(segment, KEY_LENGTH);
  for (const pair of parsed.search.slice(1).split("&")) {
    const at = pair.indexOf("=");
    if (at >= 0) add(pair.slice(at + 1), KEY_LENGTH);
  }

  return secrets;
}

/**
 * The environment of a child of the gate: PATH and TMPDIR of `env` where it has them, `home` as its
 * HOME and USERPROFILE (the gate's temp one, so the operator's npm credentials file is not read),
 * and npm's `cache`. Nothing else of the operator's environment (registry settings, tokens, any
 * other variable) reaches a child, and npm runs dependency lifecycle scripts only if it is allowed to.
 */
export function childEnvironment(env, { home, cache }) {
  const out = {};
  for (const name of ["PATH", "TMPDIR"]) {
    if (env[name] !== undefined) out[name] = env[name];
  }
  out.HOME = home;
  out.USERPROFILE = home;
  if (cache !== undefined) out.npm_config_cache = cache;

  return out;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Throws unless `url` is the loopback endpoint of the kit's own fork. The message repeats nothing
 * of `url`: a live endpoint carries a key.
 */
export function requireLoopback(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    host = undefined;
  }
  if (host === undefined || !LOOPBACK.has(host)) {
    throw new Error(
      "the endpoint a key is used with is not a loopback address, the kit's own fork: nothing is " +
        "signed or sent",
    );
  }
}

/**
 * Throws for a `sauce` command line that carries a key unless its `--rpc-url` is the kit's loopback
 * fork: another endpoint, a `--config` file (which may name live ones) and no endpoint at all (the
 * command then reaches a public one) are all refused. A command that signs nothing may read any
 * endpoint. This is what makes "sends nothing to a live chain" a checked property of the gate.
 */
export function requireSigningEndpoint(args) {
  if (!args.some((arg) => ["--private-key", "--keystore", "--wallet", "--keypair"].includes(arg))) {
    return;
  }
  const at = args.indexOf("--rpc-url");
  requireLoopback(at < 0 ? "" : (args[at + 1] ?? ""));
}

/**
 * Writes `{ "rpcUrls": { "<id>": url } }` as a file in `dir` only its owner can read, and returns its
 * path: a command's `--config`, so an endpoint reaches a child without ever being on its command
 * line, where the process list shows it.
 */
export function writeEndpointConfig(dir, id, url) {
  const path = join(dir, `endpoints-${id}.config.json`);
  writeFileSync(path, JSON.stringify({ rpcUrls: { [String(id)]: url } }), { mode: 0o600 });

  return path;
}

/**
 * Runs `use` with the path of an endpoint's `--config` file (`writeEndpointConfig`) and removes the
 * file when `use` returns or throws: the endpoint is in a file for as long as a command reads it,
 * not for as long as the gate lives, which a signal may end with the file there.
 */
export function withEndpointConfig(dir, id, url, use) {
  const path = writeEndpointConfig(dir, id, url);
  try {
    return use(path);
  } finally {
    rmSync(path, { force: true });
  }
}

/** What the kit's children need of the operator's environment: `PATH` finds anvil, the rest is a
 *  place for temporary files and a home. */
export const GATE_ENVIRONMENT = ["PATH", "TMPDIR", "HOME", "USERPROFILE"];

/**
 * `env` with every variable but those of `keep` deleted, in place; returns it. The installed testing
 * kit runs inside the gate's own process and starts anvil, and its recorder, with no environment of
 * its own, so they inherit the gate's: cut to what they need, the operator's tokens, keys and
 * settings go no further. (What the gate starts itself is given its own small environment:
 * `childEnvironment`.)
 */
export function confineEnvironment(env, keep) {
  for (const name of Object.keys(env)) {
    if (!keep.includes(name)) delete env[name];
  }

  return env;
}

// ---------------------------------------------------------------------------------------------
// The Router a release hands out, the code it put on a chain, and the chains the Kitchen is on.

/** `UnauthorizedCallback()`: what a Router that has a V3 callback says to a call no swap is in flight for. */
const UNAUTHORIZED_CALLBACK = "0xf5c6c81a";

/**
 * Why a probe of one callback `name` (`selector`) on a Router did not find what it should, or
 * `undefined`. `outcome` is what an `eth_call` of the selector with the callback's arguments, from an
 * account no swap is in flight for, did: `{ succeeded: true }` or `{ revertData }`.
 * `expect: "answered"`: the Router has the name, so it reverts `UnauthorizedCallback()`.
 * `expect: "missing"`: the control, a name no Router has, which reverts with no data at all because
 * the Router has no `fallback`: a Router that answers it is a different release.
 */
export function routerProbeProblem({ name, selector, expect, outcome }) {
  const label = `${name} (${selector})`;
  if (outcome.succeeded === true) {
    return `the Router's ${label} answered with success: with no swap in flight it must revert`;
  }
  const data = String(outcome.revertData ?? "0x").toLowerCase();
  if (expect === "answered") {
    if (data.startsWith(UNAUTHORIZED_CALLBACK)) return undefined;
    if (data === "0x") return `the Router does not answer ${label}`;

    return `the Router's ${label} reverted with ${data}, not UnauthorizedCallback() (${UNAUTHORIZED_CALLBACK})`;
  }

  return data === "0x"
    ? undefined
    : `${selector} reverted with ${data}, not with no data: a Router that answers a name it does not declare has a fallback, which this release's does not`;
}

/**
 * Why the code at `address` on `chain` is not `expected`, the runtime the release deploys, or
 * `undefined`. Hex compares by value, not by case.
 */
export function runtimeProblem({ chain, address, expected, actual }) {
  if (actual === undefined || actual === "0x") return `${chain}: ${address} has no code`;
  if (String(actual).toLowerCase() === String(expected).toLowerCase()) return undefined;

  return (
    `${chain}: the code at ${address} is not the release's runtime ` +
    `(${(String(actual).length - 2) / 2} bytes there, ${(String(expected).length - 2) / 2} expected)`
  );
}

/**
 * What is wrong with the keys of the gate's endpoint file, or undefined. Every key must be a chain
 * id. A key is never repeated: an endpoint pasted where a key goes carries its credential, and
 * `endpointSecrets` registers values only.
 */
export function configKeyProblem(keys) {
  const bad = keys.filter((key) => !/^[1-9][0-9]*$/.test(key)).length;
  if (bad === 0) return undefined;

  return `has ${bad === 1 ? "a key that is not a chain id" : `${bad} keys that are not chain ids`}`;
}

/**
 * The other chains of the gate's endpoint file whose Kitchen proxy has code although ROUTER_CHAINS
 * lacks them. Only a canonical EVM chain is read: an id the package marks "svm" (Solana's
 * clusters) or does not know is never sent an EVM call, and comes back in `skipped`. A chain that
 * cannot be read is a problem, never a skip. `ids` are numbers, `routerIds` the chains already read.
 */
export async function kitchenCoverage({ ids, routerIds, canonical, hasCode, reasonOf }) {
  const problems = [];
  const skipped = [];
  for (const id of ids) {
    if (routerIds.includes(id)) continue;
    const known = canonical.find((chain) => chain.id === id);
    if (known === undefined || known.kind !== "evm") {
      skipped.push(id);
      continue;
    }
    try {
      if (await hasCode(id)) {
        problems.push(
          `${id}: the Kitchen proxy has code here, but ROUTER_CHAINS does not list this chain`,
        );
      }
    } catch (error) {
      problems.push(`${id}: the Kitchen proxy could not be read — ${reasonOf(error)}`);
    }
  }

  return { problems, skipped: skipped.sort((a, b) => a - b) };
}

/**
 * What an `eth_call` that threw says of the contract, for the Router probe: `{ revertData }`. It is
 * a revert first: viem names one (`ExecutionRevertedError`) and only what sits under it is read, so
 * an RPC error that is no revert, whatever `data` it carries, says nothing of the Router and is
 * thrown, as a network error or a timeout is. The data is the first cause under the revert with a
 * string `data` (viem wraps the RPC error twice and the revert itself carries none), or `"0x"` for
 * a revert with none.
 */
export function revertOutcome(error) {
  const reverted = error?.walk?.((cause) => cause.name === "ExecutionRevertedError");
  if (reverted === undefined || reverted === null) throw error;
  const carried = reverted.walk?.((cause) => typeof cause.data === "string");

  return { revertData: carried?.data ?? "0x" };
}
