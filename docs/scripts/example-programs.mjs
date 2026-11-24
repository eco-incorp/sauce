// The rules every shipped SauceScript example program is held to beyond compiling: `docs:check`
// applies them to `docs/examples/*.sauce.ts` and `skills:check` to `skills/*/examples/*.sauce.ts`.
//
// EXECUTED. Compiling an example proves it compiles; only running it on an engine proves it does
// what its page says, so each example names the suites that run it: `docs/examples/executed.json`
// for the manual's, `sdk/scripts/skills-check/executed.json` for the skills' (which ship, so it is
// not beside them). A manifest is `{ "executed": { "<example>": ["<suite>", ...] }, "compileOnly":
// { "<example>": "<why>" } }`, examples relative to `examplesRoot`, suites to the repository. It
// holds each example to one of the two, and each suite to:
//   - existing;
//   - naming the example: its text has the example's directory and its name (without
//     `.sauce.ts`), so a suite that does not load the file cannot be listed for it;
//   - being one CI runs: jest takes every `sdk/test/**/*.test.ts` and the MCP test script every
//     `mcp/test/*.test.ts`, but the actions scripts list their suites, and `ci.yml` runs
//     `test:unit` and `test:mainnet` — a suite in neither never runs. An actions module a listed
//     suite imports runs inside it (`examples.mainnet.test.ts` registers its groups on one anvil),
//     so it counts as that suite.
// This only reads files: the suites themselves run in CI. Tests do not ship, so the installed
// package's checks skip it.
//
// BY NAME. A program writes what the registry names by its name, as a reader would: an address the
// registry records for a token or a protocol contract on any EVM chain is that symbol or
// `Namespace.Contract`, never a `0x` literal; and a call to a function a registry binding declares
// goes through that binding, never a hand-built `hex` selector. The names are the SDK's own
// (`routes.sourceGlobals`, what `sauce globals` prints), so there is no second list. Comments are
// not code: a usage line may show an address. A deliberately low-level call is allowed per example
// and selector, with its reason, by the checker that owns the example.
//
// INPUTS IN THE OPEN. A reader must see where every value a program reads comes from. A name the
// program uses without declaring it must be the registry's (a token, a namespace or a Solana venue's, a chain, a chain
// define, an ambient module's function), the language's (a builtin, or the SDK's `Token` and
// `pot`), an import, or a local or parameter — nothing else. An input is a `main`
// parameter, given with `--args`; a compile-time define is the SDK's own mechanism, never a user's
// input. An exception is the owning checker's, per example and name, with its reason.
//
// NO DEFINES TAUGHT. Beyond the programs, every shipped page, skill file and example: none names
// `--define` or `--defines`, which the `sauce` command keeps as low-level flags its `--help` lists
// apart, and no ```sauce fence compiles with `define=`. A value a reader supplies is a `main`
// argument, there as everywhere.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { toFunctionSelector } from "viem";

const ACTIONS_CI_SCRIPTS = ["test:unit", "test:mainnet"];

function ranByCi(repository, suite) {
  if (/^sdk\/test\/.+\.test\.ts$/.test(suite)) return true;
  if (/^mcp\/test\/[^/]+\.test\.ts$/.test(suite)) return true;
  // dev-tools' suites run as its `test` script lists them, CI's `pnpm --filter './dev-tools' test`.
  if (suite.startsWith("dev-tools/test/")) {
    const { scripts } = JSON.parse(
      readFileSync(join(repository, "dev-tools/package.json"), "utf8"),
    );
    return scripts.test?.split(/\s+/).includes(suite.slice("dev-tools/".length)) === true;
  }
  if (suite.startsWith("actions/tests/")) {
    const { scripts } = JSON.parse(readFileSync(join(repository, "actions/package.json"), "utf8"));
    const listed = new Set(
      ACTIONS_CI_SCRIPTS.flatMap((script) => scripts[script]?.split(/\s+/) ?? []).filter((arg) =>
        arg.startsWith("tests/"),
      ),
    );
    const named = suite.slice("actions/".length);
    if (listed.has(named)) return true;
    const specifier = `from "./${basename(named).replace(/\.ts$/, ".js")}"`;
    return [...listed].some((entry) => {
      const path = join(repository, "actions", entry);
      return existsSync(path) && readFileSync(path, "utf8").includes(specifier);
    });
  }
  return false;
}

/**
 * The problems with `manifest` (a path) for the `examples` (paths relative to `examplesRoot`), or
 * none. `compileOnly` false refuses any compile-only entry: every one of these must execute.
 * `pending` (example -> why), the owning checker's, excuses an example no suite runs yet, and fails
 * once the manifest names a suite for it.
 */
export function executedExamplesProblems({
  repository,
  examplesRoot,
  examples,
  manifest,
  compileOnly = true,
  pending = {},
}) {
  const where = relative(repository, manifest);
  const problems = [];
  const { executed = {}, compileOnly: unexecuted = {} } = JSON.parse(
    readFileSync(manifest, "utf8"),
  );
  if (!compileOnly && Object.keys(unexecuted).length > 0) {
    problems.push(`${where}: these examples must be executed, not listed as compile-only`);
  }
  for (const [example, why] of Object.entries(pending)) {
    if (!examples.includes(example))
      problems.push(`${where}: pending ${example} is not an example`);
    else if (example in executed) {
      problems.push(`${example}: ${where} names its suite now; remove its pending entry (${why})`);
    }
  }
  for (const example of examples) {
    const listed = [example in executed, example in unexecuted].filter(Boolean).length;
    if (listed === 0 && Object.hasOwn(pending, example)) continue;
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

/**
 * What the registry and the language name: each recorded address, lower case, to the names a
 * program writes it by; each function selector a binding declares to the bindings that call it; and
 * every name a program may use without declaring it. `sdk` is the package's root module,
 * `protocols` its protocol modules (`[slug, module]`: a namespace binding is named first, and a
 * function only a registry ABI declares by that ABI), and `builtins` the SauceScript reference's
 * `builtins.json`, whose documented intrinsics give the language's own names.
 */
export function registryNames(sdk, protocols, builtins) {
  const addresses = new Map();
  const selectors = new Map();
  // The SDK's own source-level names: the `Token(...)` wrapper, bare `pot` (its `pot.owner` with
  // it), and Solana's `Account(…)`.
  const globals = new Set(["Token", "pot", "Account"]);
  const add = (map, key, name) => map.set(key, (map.get(key) ?? new Set()).add(name));
  for (const chain of sdk.CANONICAL_CHAINS) {
    const sourceGlobals = sdk.routes.sourceGlobals(chain.slug);
    for (const token of sourceGlobals.tokens) globals.add(token.symbol);
    for (const namespace of [
      ...sourceGlobals.protocols,
      ...sourceGlobals.interfaces,
      ...(sourceGlobals.venues ?? []),
    ]) {
      // A Solana venue is its protocol's program (`Orca.Whirlpool`): the program reads `Orca`.
      globals.add(namespace.namespace.split(".")[0]);
    }
    for (const other of sourceGlobals.chains) globals.add(other.key);
    for (const name of Object.keys(sourceGlobals.defines)) globals.add(name);
    for (const module of sourceGlobals.modules) {
      for (const signature of module.functions) globals.add(signature.split("(")[0]);
    }
    if (chain.kind !== "evm") continue;
    const { tokens, protocols: namespaces, interfaces } = sourceGlobals;
    for (const token of tokens) add(addresses, token.address.toLowerCase(), token.symbol);
    for (const namespace of namespaces) {
      for (const contract of namespace.contracts) {
        const binding = `${namespace.namespace}.${contract.name}`;
        if (contract.address) add(addresses, contract.address.toLowerCase(), binding);
        for (const method of contract.methods ?? []) {
          add(
            selectors,
            toFunctionSelector(method.signature).slice(2),
            `${binding}.${method.name}`,
          );
        }
      }
    }
    for (const binding of interfaces) {
      for (const method of binding.methods ?? []) {
        add(
          selectors,
          toFunctionSelector(method.signature).slice(2),
          `${binding.namespace}.${binding.name}(<address>).${method.name}`,
        );
      }
    }
  }
  const bound = new Set(selectors.keys());
  for (const [slug, module] of protocols) {
    for (const [name, abi] of Object.entries(module)) {
      if (!name.endsWith("ABI") || !Array.isArray(abi)) continue;
      for (const item of abi) {
        if (item?.type !== "function") continue;
        const selector = toFunctionSelector(item).slice(2);
        if (!bound.has(selector)) add(selectors, selector, `${item.name} in ${slug}'s ${name}`);
      }
    }
  }
  // A builtin's root name — `ctx` of `ctx.self`, `hex` of a hex literal, `Array` of `new Array` —
  // where its own example program uses it as a name (so `Contract.at`'s placeholder is not one).
  for (const builtin of builtins.intrinsics) {
    const root = /^(?:new )?([A-Za-z_]\w*)/.exec(builtin.name)?.[1];
    if (root === undefined) continue;
    const programs = Object.values(builtin.example ?? {}).join("\n");
    if (new RegExp(`(?<![\\w.])${root}\\b`).test(programs)) globals.add(root);
  }
  return { addresses, selectors, globals };
}

const shown = (names) => {
  const all = [...names].sort();
  return all.length > 3 ? `${all.slice(0, 3).join(", ")}, …` : all.join(", ");
};

/**
 * The problems with one example program's `source` (`where` names it): a recorded address written
 * as a literal, or a selector a binding declares built by hand — unless `lowLevel`, a map of
 * selector to reason, allows it. `used` collects the allowed selectors met, so the caller can fail
 * an allowance nothing needs any more.
 */
export function namedProgramProblems({ where, source, names, lowLevel = {}, used = new Set() }) {
  const problems = [];
  const code = source.replace(/\/\*[^]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  for (const [, hex] of code.matchAll(/(?<![\w$])0x([0-9a-fA-F]{40})n?(?![\w$])/g)) {
    const named = names.addresses.get(`0x${hex.toLowerCase()}`);
    if (named) {
      problems.push(
        `${where}: writes 0x${hex}, which the registry names ${shown(named)}: use the name`,
      );
    }
  }
  for (const [, selector] of code.matchAll(/\bhex`([0-9a-fA-F]{8})/g)) {
    const bindings = names.selectors.get(selector.toLowerCase());
    if (!bindings) continue;
    if (Object.hasOwn(lowLevel, selector)) {
      used.add(selector);
      continue;
    }
    problems.push(
      `${where}: builds the call ${selector} by hand, which is ${shown(bindings)}: call it through ` +
        "that binding",
    );
  }
  return problems;
}

/** Every name `source` reads but never declares, by the TypeScript parser `ts`. */
function freeNames(ts, source) {
  const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const declared = new Set();
  const read = new Set();
  const declares = (node) =>
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportSpecifier(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportClause(node);
  const visit = (node) => {
    // A type names nothing a program reads at run time.
    if (ts.isTypeNode(node)) return;
    if (declares(node) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const named =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        ts.isImportSpecifier(parent) ||
        ((declares(parent) || ts.isPropertySignature(parent)) && parent.name === node);
      if (!named) read.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...read].filter((name) => !declared.has(name));
}

/**
 * The problems with one example program's inputs (see the header): each name `source` reads that
 * nothing declares and the registry and the language do not name, unless `allowed`, a map of name
 * to reason, allows it. `used` collects the allowed names met, so the caller can fail an allowance
 * nothing needs any more.
 */
export function inputProblems({ where, source, ts, names, allowed = {}, used = new Set() }) {
  const problems = [];
  for (const name of freeNames(ts, source)) {
    if (names.globals.has(name)) continue;
    if (Object.hasOwn(allowed, name)) {
      used.add(name);
      continue;
    }
    problems.push(
      `${where}: reads ${name}, which it never declares and the registry does not name: an input ` +
        "is a `main` parameter, given with --args",
    );
  }
  return problems;
}

/**
 * The problems with one shipped text, a page, a skill file or an example (`where` names it): each
 * line that names `--define` or `--defines`, or opens a ```sauce fence with `define=`.
 */
export function defineFlagProblems({ where, text }) {
  const problems = [];
  text.split("\n").forEach((line, index) => {
    const flag = /(?<![\w-])--defines?(?![\w-])/.exec(line)?.[0];
    if (flag !== undefined) {
      problems.push(
        `${where}:${index + 1}: names ${flag}, a low-level flag: a value the reader supplies is a ` +
          "`main` parameter, given with --args",
      );
    } else if (/^\s*```sauce\b.*\bdefine=/.test(line)) {
      problems.push(
        `${where}:${index + 1}: compiles a fence with define=: take the value as a \`main\` ` +
          "parameter instead",
      );
    }
  });
  return problems;
}
