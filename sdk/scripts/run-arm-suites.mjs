#!/usr/bin/env node
/**
 * Runs the engine-executing suites on the legacy arms, in CI on every PR (.github/workflows/ci.yml,
 * `legacy-evm-<version>` and `legacy-svm-<version>`, one job per earlier engine version): the same
 * suites the default arm runs, with SAUCE_TEST_EVM_ARM or SAUCE_TEST_SVM_ARM set to that engine
 * version, which stands each suite's chain or engine up on the earlier release the installed
 * compiler's row lists in `alsoRunsOn` (sdk/test/release-arm.ts, over the artifacts
 * `sync-engine-artifacts.mjs` writes to sdk/src/artifacts/legacy/). A program a suite runs there
 * also proves the claim `alsoRunsOn` makes for it.
 *
 * `sdk/test/legacy-arm.json` is the list: what each target runs for each version, and why each other
 * engine-executing suite is left out. `sdk/test/legacy-arm.test.ts` holds the list to the suites on
 * disk.
 *
 *   node sdk/scripts/run-arm-suites.mjs <evm|svm> <sdk|actions|mcp> [version]
 *
 * With a version it runs that arm alone (CI's per-version jobs); without one, every version the row
 * lists, in its order. `sdk` runs each listed suite under sdk/test in a process of its own, as
 * ci.yml's `sdk-e2e` loop does. `actions` and `mcp` run the suites listed under that workspace in
 * one node:test process. Exit 0 when every suite passed, or when the installed row lists no earlier
 * engine for the target; exit 1 naming each suite that failed (with its version), a listed path that
 * does not exist, or a version the row does not list; exit 2 on a bad invocation.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SDK = resolve(ROOT, "sdk");

const TARGETS = ["evm", "svm"];
const WORKSPACES = ["sdk", "actions", "mcp"];
const VARIABLE = { evm: "SAUCE_TEST_EVM_ARM", svm: "SAUCE_TEST_SVM_ARM" };
const COMPONENT = { evm: "v12-evm", svm: "v12-svm" };

// pnpm may forward a literal `--` before the version a job passes to the script.
const given = process.argv.slice(2).filter((argument) => argument !== "--");
const [target, workspace, version] = given;
if (!TARGETS.includes(target) || !WORKSPACES.includes(workspace) || given.length > 3) {
  console.error(
    `usage: node sdk/scripts/run-arm-suites.mjs <${TARGETS.join("|")}> <${WORKSPACES.join("|")}> [version]`,
  );
  process.exit(2);
}

/** The installed `sauce-compiler`'s version: its manifest is the one that NAMES the package (the
 *  package also ships a `web/package.json` that is only `{"type":"module"}`). */
function installedCompilerVersion() {
  let dir = dirname(createRequire(resolve(SDK, "package.json")).resolve("sauce-compiler"));
  for (let up = 0; up < 10; up++) {
    const manifest = resolve(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed.name === "@eco-incorp/sauce-compiler" && parsed.version) return parsed.version;
    }
    dir = dirname(dir);
  }
  throw new Error("could not locate the installed @eco-incorp/sauce-compiler manifest");
}

const compiler = installedCompilerVersion();
const table = JSON.parse(readFileSync(resolve(SDK, "src/deployments/releases.json"), "utf8"));
const row = table.releases.find((candidate) => candidate.compiler === compiler);
if (row === undefined) {
  console.error(`releases.json has no row for the installed compiler ${compiler}`);
  process.exit(1);
}
const listed = row.alsoRunsOn?.[COMPONENT[target]] ?? [];
if (version !== undefined && !listed.includes(version)) {
  console.error(
    `${version} is not an earlier ${COMPONENT[target]} engine the installed row lists (${listed.join(", ")})`,
  );
  process.exit(1);
}
const versions = version === undefined ? listed : [version];
if (versions.length === 0) {
  console.log(
    `the installed row's alsoRunsOn lists no ${COMPONENT[target]} engine: nothing to run`,
  );
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(resolve(SDK, "test/legacy-arm.json"), "utf8"));
for (const each of versions) {
  if (manifest[target]?.[each] === undefined) {
    console.error(`sdk/test/legacy-arm.json has no ${target} list for the engine version ${each}`);
    process.exit(1);
  }
  const missing = manifest[target][each].run.filter((path) => !existsSync(resolve(ROOT, path)));
  if (missing.length > 0) {
    console.error(
      `sdk/test/legacy-arm.json lists ${missing.length} ${target} suite(s) for ${each} that do not exist:\n` +
        missing.map((path) => `  ${path}`).join("\n"),
    );
    process.exit(1);
  }
}

/** Runs a command with its output passed through and kept: the retry below reads it. */
function run(command, args, cwd, childEnv) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk;
    });
    child.on("error", (error) => {
      console.error(`could not run ${command}: ${error.message}`);
      done({ status: 1, output });
    });
    child.on("close", (status) => done({ status: status ?? 1, output }));
  });
}

const failed = [];
for (const each of versions) {
  const paths = manifest[target][each].run.filter((path) => path.startsWith(`${workspace}/`));
  if (paths.length === 0) {
    console.log(`[run-arm-suites] ${target} arm ${each}: no ${workspace} suite listed`);
    continue;
  }
  const env = { ...process.env, [VARIABLE[target]]: each };
  console.log(
    `[run-arm-suites] ${target} arm ${each} (${VARIABLE[target]}=${each}): ${paths.length} suite(s) ` +
      `under ${workspace}, compiler ${compiler}, earlier ${COMPONENT[target]} ${each}`,
  );

  if (workspace === "sdk") {
    // The flag the package's own `test` script sets: these runs invoke jest directly.
    const options = (process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean);
    if (!options.includes("--experimental-vm-modules")) options.push("--experimental-vm-modules");
    const jestEnv = { ...env, NODE_OPTIONS: options.join(" ") };
    const jest = (path) =>
      run(
        "node_modules/.bin/jest",
        ["--config", "jest.config.cjs", "--runInBand", "--forceExit", "--runTestsByPath", path],
        SDK,
        jestEnv,
      );
    for (const path of paths) {
      console.log(`\n=== ${each}: ${path}`);
      const absolute = resolve(ROOT, path);
      let { status, output } = await jest(absolute);
      // The retry ci.yml's `sdk-e2e` loop makes for the same litesvm teardown abort, and for that
      // abort alone (see the loop and its TODO(litesvm-abort): both go together): a real failure, a
      // crash with another message or a second bad_alloc still fails.
      if (status !== 0 && output.includes("std::bad_alloc")) {
        console.warn(
          `${path} aborted with std::bad_alloc (litesvm native teardown): retrying once`,
        );
        ({ status } = await jest(absolute));
      }
      if (status !== 0) failed.push(`${each}: ${path}`);
    }
  } else {
    // One node:test process for the workspace: its own output names the file that failed.
    const cwd = resolve(ROOT, workspace);
    const args = ["exec", "tsx", "--test", "--test-concurrency=1"];
    for (const path of paths) args.push(relative(cwd, resolve(ROOT, path)));
    const { status } = await run("pnpm", args, cwd, env);
    if (status !== 0)
      failed.push(`${each}: ${workspace}: ${paths.length} suite(s) in one node:test run`);
  }
}

if (failed.length > 0) {
  console.error(
    `\n[run-arm-suites] the ${target} legacy arm failed:\n${failed.map((what) => `  ${what}`).join("\n")}`,
  );
  process.exit(1);
}
console.log(`\n[run-arm-suites] the ${target} legacy arm passed for ${versions.join(", ")}`);
