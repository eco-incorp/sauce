// Which shipped SauceScript examples a test EXECUTES, held to the repository: `docs:check` runs it
// for `docs/examples/*.sauce.ts` and `skills:check` for `skills/*/examples/*.sauce.ts`. Compiling an
// example proves it compiles; only running it on an engine proves it does what its page says, so
// each example names, in a manifest beside its checker, the suites that run it.
//
// A manifest is `{ "executed": { "<example>": ["<suite>", ...] }, "compileOnly": { "<example>":
// "<why>" } }`, examples relative to `examplesRoot`, suites to the repository. It holds each example
// to one of the two, and each suite to:
//   - existing;
//   - naming the example: its text has the example's directory and its name (without
//     `.sauce.ts`), so a suite that does not load the file cannot be listed for it;
//   - being one CI runs: jest takes every `sdk/test/**/*.test.ts` and the MCP test script every
//     `mcp/test/*.test.ts`, but the actions scripts list their suites, and `ci.yml` runs
//     `test:unit` and `test:mainnet` — a suite in neither never runs.
// This only reads files: the suites themselves run in CI. Tests do not ship, so the installed
// package's checks skip it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ACTIONS_CI_SCRIPTS = ["test:unit", "test:mainnet"];

function ranByCi(repository, suite) {
  if (/^sdk\/test\/.+\.test\.ts$/.test(suite)) return true;
  if (/^mcp\/test\/[^/]+\.test\.ts$/.test(suite)) return true;
  if (suite.startsWith("actions/tests/")) {
    const { scripts } = JSON.parse(readFileSync(join(repository, "actions/package.json"), "utf8"));
    const named = suite.slice("actions/".length);
    return ACTIONS_CI_SCRIPTS.some((script) => scripts[script]?.split(/\s+/).includes(named));
  }
  return false;
}

/**
 * The problems with `manifest` (a path) for the `examples` (paths relative to `examplesRoot`), or
 * none. `compileOnly` false refuses any compile-only entry: every one of these must execute.
 */
export function executedExamplesProblems({
  repository,
  examplesRoot,
  examples,
  manifest,
  compileOnly = true,
}) {
  const where = relative(repository, manifest);
  const problems = [];
  const { executed = {}, compileOnly: unexecuted = {} } = JSON.parse(
    readFileSync(manifest, "utf8"),
  );
  if (!compileOnly && Object.keys(unexecuted).length > 0) {
    problems.push(`${where}: these examples must be executed, not listed as compile-only`);
  }
  for (const example of examples) {
    const listed = [example in executed, example in unexecuted].filter(Boolean).length;
    if (listed === 0) {
      problems.push(
        `${example}: no test executes it — run it in a suite and name that suite in ${where}` +
          (compileOnly ? ', or list it under "compileOnly" with the reason' : ""),
      );
    }
    if (listed === 2) problems.push(`${example}: ${where} lists it as executed AND compile-only`);
  }
  for (const example of [...Object.keys(executed), ...Object.keys(unexecuted)]) {
    if (!examples.includes(example)) problems.push(`${where}: ${example} is not an example`);
  }
  for (const [example, suites] of Object.entries(executed)) {
    if (!Array.isArray(suites) || suites.length === 0) {
      problems.push(`${where}: ${example} names no suite`);
      continue;
    }
    const directory = relative(repository, join(examplesRoot, dirname(example)));
    const name = example
      .split("/")
      .pop()
      .replace(/\.sauce\.ts$/, "");
    const named = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
    for (const suite of suites) {
      const path = join(repository, suite);
      if (!existsSync(path)) {
        problems.push(`${where}: ${example}'s suite ${suite} does not exist`);
        continue;
      }
      const text = readFileSync(path, "utf8");
      if (!text.includes(directory) || !named.test(text)) {
        problems.push(`${where}: ${suite} does not name ${directory}/${name}, so it cannot run it`);
      }
      if (!ranByCi(repository, suite)) {
        problems.push(`${where}: ${suite} is not a suite CI runs`);
      }
    }
  }
  return problems;
}
