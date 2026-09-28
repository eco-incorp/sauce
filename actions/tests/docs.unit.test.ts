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
 * fails here until the pages stop naming it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
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
 * Code spans that name something the package would export, but do not. Each is here for a stated
 * reason; a new entry needs one too.
 */
const NOT_EXPORTS = new Map([
  ["SafeERC20", "OpenZeppelin's library, whose semantics the ERC-20 writes follow"],
  ["IERC20", "the route compiler's own ERC-20 binding"],
  ["I", "the prefix binding names start with"],
  ["argumentOffset", "a method of the `CompiledProgram` that `compileProgram` returns"],
]);

/**
 * The export names a page mentions: the names it imports from `@eco-incorp/sauce/actions` in a code
 * block, and outside "## Supported actions" (whose code spans are action types and contract
 * functions) every code span that is a PascalCase identifier or a call `name(…)`.
 */
function mentionedExports(page: string): string[] {
  const names = new Set<string>();
  for (const m of page.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@eco-incorp\/sauce\/actions"/g,
  )) {
    for (const part of m[1]!.split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name) names.add(name);
    }
  }
  const start = page.indexOf("## Supported actions");
  const end = start === -1 ? -1 : page.indexOf("\n## ", start + 1);
  const prose = start === -1 ? page : page.slice(0, start) + (end === -1 ? "" : page.slice(end));
  for (const m of prose.matchAll(/`([A-Z][A-Za-z0-9]*)`|`([a-z][A-Za-z0-9]*)\(/g)) {
    names.add((m[1] ?? m[2])!);
  }

  return [...names].filter((name) => !NOT_EXPORTS.has(name));
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
