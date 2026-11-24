#!/usr/bin/env node
// Puts the third-party Solana programs that are NOT committed where the suites read them.
//
// `test/fixtures/fetched-programs.json` names them: every program of `test/fixtures/svm-venue-programs`
// and `test/fixtures/svm-exact-in-programs` that is not under a permissive licence. Their bytes are
// never in the repository; the pins are, in each fixture's own `manifest.json` (`programId`,
// `sha256` of the ELF as `solana program dump` wrote it). For each, this:
//
//   1. leaves a `<fixture>/<file>` that already gunzips to its pin as it is;
//   2. else takes the ELF from `node_modules/.cache/sauce-program-fixtures/`, re-hashed on every run
//      (a cache entry failing its pin is deleted and fetched again);
//   3. else reads it from mainnet-beta (`lib/solana-program-elf.mjs`: `getAccountInfo` of the program
//      and its ProgramData, nothing else), through the explicit public-only `--rpc-config`,
//      retrying a failure or rate limit;
//   4. refuses it, writing nothing, when its sha256 is not the pin: the program was upgraded (or
//      closed) since it was dumped, and a suite run against other bytes proves nothing about the pin.
//
// It then gzips the ELF into `<fixture>/<file>`, which `.gitignore` keeps out of git. Every program
// is attempted before it exits, so one run names every refusal. It also refuses a program that is
// neither listed here nor present on disk (a dump not committed and not fetched), and, where git is
// available, a listed program whose bytes are tracked.
//
// Invalid in-place copies are removed and repaired from the verified raw cache when available,
// otherwise fetched and checked against the same pin. Offline setup refuses an uncached program.
//
// Run: `pnpm --filter './sdk' fetch-program-fixtures --rpc-config <path>` (CI's setup does).
// `--offline` reads only the cache and the fixture directories, with no config or network.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";

import { readFixtureRpcConfig } from "./lib/fixture-rpc-config.mjs";
import { createReader, readProgramElf, sha256 } from "./lib/solana-program-elf.mjs";

const SDK = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SDK, "..");
const FIXTURES = join(SDK, "test", "fixtures");
const CACHE = join(REPO, "node_modules", ".cache", "sauce-program-fixtures");
/** Solana mainnet-beta, under the chain id the SDK gives it. */
const SOLANA = 1399811149;

const { values } = parseArgs({
  options: { offline: { type: "boolean", default: false }, "rpc-config": { type: "string" } },
});
const say = (line) => console.log(`[fetch-program-fixtures] ${line}`);
let endpoints;
try {
  endpoints = readFixtureRpcConfig(values, [SOLANA]);
} catch (error) {
  console.error(`[fetch-program-fixtures] ${error.message}`);
  process.exit(1);
}

const { programs: list } = JSON.parse(
  readFileSync(join(FIXTURES, "fetched-programs.json"), "utf8"),
);
const manifests = new Map();
const manifestOf = (fixture) => {
  if (!manifests.has(fixture))
    manifests.set(
      fixture,
      JSON.parse(readFileSync(join(FIXTURES, fixture, "manifest.json"), "utf8")).programs,
    );
  return manifests.get(fixture);
};
const listed = new Set(list.map(({ fixture, name }) => `${fixture}/${name}`));

const refusals = [];
const refuse = (what, why) => refusals.push(`${what}: ${why}`);

// Every program of these fixtures is either committed or fetched.
for (const fixture of new Set(list.map((entry) => entry.fixture)))
  for (const program of manifestOf(fixture))
    if (
      !listed.has(`${fixture}/${program.name}`) &&
      !existsSync(join(FIXTURES, fixture, program.file))
    )
      refuse(
        `${fixture}/${program.file}`,
        "neither committed nor listed in fetched-programs.json; commit it if its licence is " +
          "permissive, list it there if not",
      );

/** The tracked files under the fixtures, or null where there is no git. */
const tracked = (() => {
  try {
    return new Set(
      execFileSync("git", ["ls-files", "--", relative(REPO, FIXTURES)], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .filter(Boolean),
    );
  } catch {
    return null;
  }
})();

let reader;
const readerFor = () => {
  if (reader !== undefined) return reader;
  reader = createReader({
    endpoints: endpoints.get(SOLANA),
    log: (line) => say(`  ${line}`),
  });
  return reader;
};

const writeAtomically = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
};

let placed = 0;
let cached = 0;
let fetched = 0;
for (const { fixture, name } of list) {
  const what = `${fixture}/${name}`;
  const pin = manifestOf(fixture).find((program) => program.name === name);
  if (pin === undefined) {
    refuse(what, `no program ${name} in ${fixture}/manifest.json`);
    continue;
  }
  const dest = join(FIXTURES, fixture, pin.file);
  if (tracked?.has(relative(REPO, dest))) {
    refuse(what, `${relative(REPO, dest)} is tracked by git: its bytes must not be committed`);
    continue;
  }
  if (existsSync(dest)) {
    let matches = false;
    try {
      matches = sha256(gunzipSync(readFileSync(dest))) === pin.sha256;
    } catch {
      // An unreadable gzip is an invalid materialization, never evidence for the pin.
    }
    if (matches) {
      placed++;
      continue;
    }
    rmSync(dest);
  }

  const entry = join(CACHE, `${pin.programId}-${pin.sha256}.so`);
  let elf;
  if (existsSync(entry)) {
    const bytes = readFileSync(entry);
    if (sha256(bytes) === pin.sha256) {
      elf = bytes;
      cached++;
    } else {
      say(`cached ${name} failed its pin; deleted it`);
      rmSync(entry, { force: true });
    }
  }
  if (elf === undefined) {
    if (values.offline) {
      refuse(what, "not in the cache, and --offline");
      continue;
    }
    const now = await readProgramElf(readerFor(), pin.programId);
    if (now.status !== "ok") {
      refuse(what, `${pin.programId} cannot be fetched (${now.status}: ${now.reason})`);
      continue;
    }
    const actual = sha256(now.elf);
    if (actual !== pin.sha256) {
      refuse(
        what,
        `${pin.programId} on mainnet-beta is not the pinned program: its ELF hashes to ${actual}, ` +
          `the pin is ${pin.sha256}` +
          (now.lastDeploySlot === undefined
            ? ""
            : ` (deployed again at slot ${now.lastDeploySlot}` +
              (pin.lastDeploySlot === undefined ? ")" : `, the pin's was ${pin.lastDeploySlot})`)) +
          ". It was upgraded since the dump; re-pinning it means re-dumping and re-verifying the " +
          "suites that run it, not editing the hash",
      );
      continue;
    }
    writeAtomically(entry, now.elf);
    elf = now.elf;
    fetched++;
  }
  writeAtomically(dest, gzipSync(elf));
}

say(
  `${list.length} listed: ${placed} already in place, ${cached} from the cache, ${fetched} fetched, ` +
    `${refusals.length} refused`,
);
if (refusals.length > 0) {
  for (const refusal of refusals) console.error(`[fetch-program-fixtures] refused ${refusal}`);
  process.exit(1);
}
