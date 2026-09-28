/**
 * The two pages that describe this package, `docs/guides/actions.md` and `actions/README.md`, name
 * its actions and its exports. Nothing else ties either to the code, so this reads both back.
 *
 * Each page's "## Supported actions" section must list every action type in the table the parser
 * and the lowering use (`ACTION_SPECS`), exactly once and nothing else, and the guide must state each
 * one's output as the lowering produces it: an action added, renamed or removed, or an output
 * changed, fails here until the pages say so too. The guide's rows are located by their first cell
 * and read by their last, so its prose and other columns can change freely.
 *
 * Every export either page names must be one `src/index.ts` exports, so a removed or renamed export
 * fails here until the pages stop naming it. The names are read by `scripts/documented-exports.mjs`,
 * which `sdk/scripts/check-packed-package.mjs` also uses to check each one resolves from the packed
 * `./actions` subpath.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
import { documentedExports, mentionedExports, PAGES } from "../scripts/documented-exports.mjs";
import { REPO_ROOT } from "./anvil.js";

const GUIDE = readFileSync(resolve(REPO_ROOT, "docs/guides/actions.md"), "utf8");
const README = readFileSync(resolve(REPO_ROOT, "actions/README.md"), "utf8");
const SRC = resolve(REPO_ROOT, "actions/src");
const INDEX = resolve(SRC, "index.ts");

/** A page's "## Supported actions" section, up to the next `##` heading. */
function supportedSection(page: string, name: string): string {
  const start = page.indexOf("## Supported actions");
  assert.ok(start >= 0, `${name} has no '## Supported actions' section`);
  const end = page.indexOf("\n## ", start + 1);

  return page.slice(start, end === -1 ? undefined : end);
}

/** The `type` in the first cell of every table row under the guide's "## Supported actions". */
function listedTypes(): string[] {
  const section = supportedSection(GUIDE, "the guide");

  return [...section.matchAll(/^\| `([A-Za-z0-9]+)` +\|/gm)].map((m) => m[1]!);
}

/** Every code span in the README's "## Supported actions" bullets, each of which is an action type. */
function readmeTypes(): string[] {
  const section = supportedSection(README, "actions/README.md");

  return section
    .split("\n")
    .filter((line) => /^(- | {2})/.test(line))
    .flatMap((line) => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
}

/**
 * Every name `src/index.ts` exports, types included, as the TypeScript checker resolves them. Only
 * `src/` is loaded: a re-export resolves within it, and parsing the SDK and viem behind it would
 * cost seconds for nothing this reads.
 */
function indexExports(): Set<string> {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    noLib: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...rest) =>
    resolve(file).startsWith(`${SRC}/`) ? getSourceFile(file, ...rest) : undefined;
  const program = ts.createProgram([INDEX], options, host);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(program.getSourceFile(INDEX)!);
  assert.ok(module, "src/index.ts did not resolve as a module");

  return new Set(checker.getExportsOfModule(module).map((symbol) => symbol.name));
}

describe("docs/guides/actions.md lists the actions the package supports", () => {
  it("every action type exactly once, and nothing else", () => {
    const listed = listedTypes();
    const duplicates = listed.filter((type, i) => listed.indexOf(type) !== i);
    assert.deepEqual(duplicates, [], "listed more than once");
    assert.deepEqual([...listed].sort(), [...ACTION_TYPES].sort());
  });

  it("states each action's output as the lowering produces it", () => {
    const wording = { realized: "received", passThrough: "its amount", value: "the value read" };
    const start = GUIDE.indexOf("## Supported actions");
    for (const type of ACTION_TYPES) {
      const row = new RegExp(`^\\| \`${type}\` +\\|[^\\n]*$`, "m").exec(GUIDE.slice(start))?.[0];
      assert.ok(row, `${type} has no row`);
      const output = row.split("|").at(-2)!.trim();
      assert.equal(output, wording[ACTION_SPECS[type].output], `${type}'s output`);
    }
  });
});

describe("actions/README.md lists the actions the package supports", () => {
  it("every action type exactly once, and nothing else", () => {
    const listed = readmeTypes();
    const duplicates = listed.filter((type, i) => listed.indexOf(type) !== i);
    assert.deepEqual(duplicates, [], "listed more than once");
    assert.deepEqual([...listed].sort(), [...ACTION_TYPES].sort());
  });
});

describe("the exports the README and the guide name exist", () => {
  const exported = indexExports();

  it("src/index.ts resolves to its exports, types included", () => {
    // Guards the check below against passing because nothing resolved.
    for (const name of ["parseProgram", "compileProgram", "ProgramError", "ActionProgram"]) {
      assert.ok(exported.has(name), `${name} is not among src/index.ts's exports`);
    }
  });

  it("the packed-package check reads these same pages, and every name they mention", () => {
    assert.deepEqual([...PAGES], ["actions/README.md", "docs/guides/actions.md"]);
    const union = new Set([...mentionedExports(README), ...mentionedExports(GUIDE)]);
    assert.deepEqual(documentedExports(REPO_ROOT), [...union].sort());
  });

  for (const [page, text] of [
    ["actions/README.md", README],
    ["docs/guides/actions.md", GUIDE],
  ] as const) {
    it(`every export ${page} names is one src/index.ts exports`, () => {
      const mentioned = mentionedExports(text);
      assert.ok(mentioned.length > 0, `${page} names no exports`);
      assert.deepEqual(
        mentioned.filter((name) => !exported.has(name)),
        [],
        `${page} names exports that src/index.ts does not export`,
      );
    });
  }
});
