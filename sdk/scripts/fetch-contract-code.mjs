#!/usr/bin/env node
// Puts the third-party contract code that is NOT committed where the suites read it.
//
// Two kinds of fixture pin EVM runtime code by its keccak256 instead of holding it:
//
//   - the captured chain states, `actions/tests/state/*.genesis.json.gz`: an alloc entry with a
//     `codeHash` and no `code`, on the chain the file's own `config.chainId` names. A capture writes
//     that form (`actions/tests/mainnet.ts#genesisFrom`), and a replay fills each `code` in from
//     the cache below before anvil boots from the file. An entry that still carries `code` is not
//     this script's: such a file replays as it always did.
//   - the testing kit's recorded EVM states, `dev-tools/test/testing/state/*.json.gz` (`{ sauce,
//     genesis }`, the chain in `sauce.chainId`): the same `codeHash` entries, which the kit's own
//     suites put back (`dev-tools/test/testing/support.ts#replayState`) before replaying. A Solana
//     state file there has no `genesis` and is not this script's.
//   - canonical Permit2, `test/fixtures/cli/Permit2.pin.json` (chain, address, codeHash). From it
//     this writes `test/fixtures/cli/Permit2.json`, the pin plus its `runtime`, where the CLI suites
//     read it; `.gitignore` keeps that file out of git.
//
// For each distinct (chain, address, codeHash), this:
//
//   1. takes the code from `node_modules/.cache/sauce-contract-code/<codeHash>.hex`, re-hashed on
//      every run (a cache entry failing its pin is deleted and fetched again);
//   2. else reads it with `eth_getCode` at `latest` (`lib/evm-code.mjs`), through the chain's public
//      endpoints in `src/cli/public-rpcs.ts`, retrying and falling back from one to the next. The
//      code at an address does not change unless the account self-destructs or becomes an EIP-7702
//      delegation, and public endpoints are not archive nodes, so `latest` is what is read;
//   3. refuses it, caching nothing, when its keccak256 is not the pin, naming the chain, the
//      address, the pin, the hash it got and why (no code, a delegation, other code): a suite run
//      against other code proves nothing about the pinned state.
//
// Every pin is attempted before it exits, so one run names every refusal.
//
// Run: `pnpm --filter './sdk' fetch-contract-code` (CI's setup does). `--offline` reads only the
// cache.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  ADDRESS_PATTERN,
  HASH_PATTERN,
  codeHashOf,
  createEvmReader,
  describeMismatch,
} from "./lib/evm-code.mjs";
import { createTsLoader } from "./lib/load-ts.mjs";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SDK, "..");
const STATE = join(REPO, "actions", "tests", "state");
const TESTING_STATE = join(REPO, "dev-tools", "test", "testing", "state");
const PERMIT2_PIN = join(SDK, "test", "fixtures", "cli", "Permit2.pin.json");
const PERMIT2 = join(SDK, "test", "fixtures", "cli", "Permit2.json");
const CACHE = join(REPO, "node_modules", ".cache", "sauce-contract-code");
/** Reads in flight at once, over every chain. */
const CONCURRENCY = 4;

const { values } = parseArgs({ options: { offline: { type: "boolean", default: false } } });
const say = (line) => console.log(`[fetch-contract-code] ${line}`);

const refusals = [];
const refuse = (what, why) => refusals.push(`${what}: ${why}`);

/** `chain:address:codeHash` -> `{ chainId, address, codeHash, where }`, `where` the files pinning it. */
const pins = new Map();
function pin(chainId, address, codeHash, where) {
  if (!Number.isSafeInteger(chainId) || chainId <= 0)
    return refuse(`${where} ${address}`, `no chain id (${JSON.stringify(chainId)})`);
  if (typeof address !== "string" || !ADDRESS_PATTERN.test(address))
    return refuse(where, `${JSON.stringify(address)} is not an address`);
  if (typeof codeHash !== "string" || !HASH_PATTERN.test(codeHash))
    return refuse(
      `${where} ${address}`,
      `codeHash ${JSON.stringify(codeHash)} is not 0x and 64 lowercase hex digits`,
    );
  const key = `${chainId}:${address.toLowerCase()}:${codeHash}`;
  const entry = pins.get(key) ?? { chainId, address: address.toLowerCase(), codeHash, where: [] };
  entry.where.push(where);
  pins.set(key, entry);
}

/** Pins every `codeHash` entry of `alloc` on `chainId`; whether there was one. */
function pinAlloc(alloc, chainId, where) {
  let pinsHere = 0;
  for (const [address, entry] of Object.entries(alloc ?? {})) {
    if (entry.codeHash === undefined) continue;
    if (entry.code !== undefined) {
      refuse(`${where} ${address}`, "carries both code and codeHash; a pinned entry has no code");
      continue;
    }
    pin(chainId, address, entry.codeHash, where);
    pinsHere++;
  }
  return pinsHere > 0;
}

/** The gzipped JSON `file` in `dir`, or undefined having refused it. */
function readGzipJson(dir, file) {
  try {
    return JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString("utf8"));
  } catch (error) {
    refuse(relative(REPO, join(dir, file)), `not a gzipped JSON file (${error.message})`);
    return undefined;
  }
}

let converted = 0;
for (const file of readdirSync(STATE)
  .filter((name) => name.endsWith(".genesis.json.gz"))
  .sort()) {
  const genesis = readGzipJson(STATE, file);
  if (genesis === undefined) continue;
  if (pinAlloc(genesis.alloc, genesis.config?.chainId, relative(REPO, join(STATE, file))))
    converted++;
}
for (const file of readdirSync(TESTING_STATE)
  .filter((name) => name.endsWith(".json.gz"))
  .sort()) {
  const state = readGzipJson(TESTING_STATE, file);
  if (state?.genesis === undefined) continue;
  if (
    pinAlloc(state.genesis.alloc, state.sauce?.chainId, relative(REPO, join(TESTING_STATE, file)))
  )
    converted++;
}

const permit2 = JSON.parse(readFileSync(PERMIT2_PIN, "utf8"));
pin(permit2.chainId, permit2.address, permit2.codeHash, relative(REPO, PERMIT2_PIN));

/** Whether git tracks `path`: a fetched file must never be committed. False where there is no git. */
const tracked = (path) => {
  try {
    return (
      execFileSync("git", ["ls-files", "--", relative(REPO, path)], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() !== ""
    );
  } catch {
    return false;
  }
};
if (tracked(PERMIT2))
  refuse(relative(REPO, PERMIT2), "is tracked by git: Permit2's runtime must not be committed");

const readers = new Map();
let publicRpcs;
const readerFor = (chainId) => {
  if (!readers.has(chainId)) {
    publicRpcs ??= createTsLoader(SDK)(join(SDK, "src/cli/public-rpcs.ts")).PUBLIC_RPCS;
    const endpoints = (publicRpcs[chainId] ?? []).map((endpoint) => endpoint.url);
    readers.set(
      chainId,
      endpoints.length === 0
        ? null
        : createEvmReader({
            chainId,
            endpoints,
            log: (line) => say(`  chain ${chainId}: ${line}`),
          }),
    );
  }
  return readers.get(chainId);
};

const writeAtomically = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
};

/** codeHash -> its code, verified this run. */
const codes = new Map();
/** codeHash -> the read in flight for it, so two pins of one code read it once. */
const reading = new Map();

function fromCache(codeHash) {
  const entry = join(CACHE, `${codeHash}.hex`);
  if (!existsSync(entry)) return undefined;
  const code = readFileSync(entry, "utf8").trim().toLowerCase();
  if (/^0x([0-9a-f]{2})+$/.test(code) && codeHashOf(code) === codeHash) return code;
  say(`cached ${codeHash} failed its pin; deleted it`);
  rmSync(entry, { force: true });
  return undefined;
}

/** Distinct codes taken from the cache, and fetched. A second pin of a code counts in neither. */
let cached = 0;
let fetched = 0;
async function settle({ chainId, address, codeHash, where }) {
  const what = `chain ${chainId} ${address} (${where.join(", ")})`;
  if (codes.has(codeHash)) return;
  const code = fromCache(codeHash);
  if (code !== undefined) {
    codes.set(codeHash, code);
    return void cached++;
  }
  if (values.offline) return refuse(what, `code ${codeHash} is not in the cache, and --offline`);
  const reader = readerFor(chainId);
  if (reader === null)
    return refuse(what, `src/cli/public-rpcs.ts lists no public endpoint for chain ${chainId}`);
  let live;
  try {
    live = await reader.getCode(address);
  } catch (error) {
    return refuse(what, `cannot be fetched: ${error.message}`);
  }
  const actual = codeHashOf(live);
  if (actual !== codeHash)
    return refuse(
      what,
      `is not the pinned code: on chain ${chainId} now, ${address} holds code hashing to ` +
        `${actual}; the pin is ${codeHash}. ${describeMismatch(live)}`,
    );
  if (!codes.has(codeHash)) {
    writeAtomically(join(CACHE, `${codeHash}.hex`), live);
    codes.set(codeHash, live);
  }
  fetched++;
}

const queue = [...pins.values()];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      // A second pin of a code being read waits for that read, then takes it from `codes`.
      while (reading.has(item.codeHash)) await reading.get(item.codeHash);
      const done = settle(item);
      reading.set(item.codeHash, done);
      await done;
      reading.delete(item.codeHash);
    }
  }),
);

// Permit2's fixture: the pin plus the code, written only when it differs from what is there.
const runtime = codes.get(permit2.codeHash);
if (runtime !== undefined && !tracked(PERMIT2)) {
  const text = `${JSON.stringify({ ...permit2, runtime }, null, 2)}\n`;
  if (!existsSync(PERMIT2) || readFileSync(PERMIT2, "utf8") !== text) {
    writeAtomically(PERMIT2, text);
    say(`wrote ${relative(REPO, PERMIT2)}`);
  }
} else if (existsSync(PERMIT2) && !tracked(PERMIT2)) {
  rmSync(PERMIT2, { force: true });
  say(`removed ${relative(REPO, PERMIT2)}: its code was not verified against the pin`);
}

const distinct = new Set([...pins.values()].map((entry) => entry.codeHash)).size;
say(
  `${pins.size} pins (${distinct} distinct codes) in ${converted} state file(s) and the Permit2 ` +
    `pin: ${cached} codes from the cache, ${fetched} fetched` +
    (fetched === 0 && refusals.length === 0 ? " (no request made)" : "") +
    `, ${refusals.length} refused`,
);
if (refusals.length > 0) {
  for (const refusal of refusals) console.error(`[fetch-contract-code] refused ${refusal}`);
  process.exit(1);
}
