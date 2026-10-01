/**
 * The exports the package's two pages, `actions/README.md` and `docs/guides/actions.md`, name. Read
 * from the pages, so no list of them is kept anywhere: `tests/docs.unit.test.ts` checks that each is
 * one `src/index.ts` exports, and `sdk/scripts/check-packed-package.mjs` that each resolves from the
 * packed `./actions` subpath of a clean install. Plain JavaScript because that script runs under
 * `node` with no TypeScript loader; `documented-exports.d.mts` types it for the tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** The pages that document the package, relative to the repository root. */
export const PAGES = ["actions/README.md", "docs/guides/actions.md"];

/**
 * Code spans that name something the package would export, but do not. Each is here for a stated
 * reason; a new entry needs one too.
 */
export const NOT_EXPORTS = new Map([
  ["SafeERC20", "OpenZeppelin's library, whose semantics the ERC-20 writes follow"],
  ["IERC20", "the route compiler's own ERC-20 binding"],
  ["I", "the prefix binding names start with"],
  ["argumentOffset", "a method of the `CompiledProgram` that `compileProgram` returns"],
  ["v12RouterAddress", "the SDK's `./deployments` export, the Router address a quote is sent to"],
]);

/**
 * The export names a page mentions: the names it imports from `@eco-incorp/sauce/actions` in a code
 * block, and outside "## Supported actions" (whose code spans are action types and contract
 * functions) every code span that is a PascalCase identifier or a call `name(…)`.
 *
 * @param {string} page
 * @returns {string[]}
 */
export function mentionedExports(page) {
  const names = new Set();
  for (const m of page.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@eco-incorp\/sauce\/actions"/g,
  )) {
    for (const part of m[1].split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) names.add(name);
    }
  }
  const start = page.indexOf("## Supported actions");
  const end = start === -1 ? -1 : page.indexOf("\n## ", start + 1);
  const prose = start === -1 ? page : page.slice(0, start) + (end === -1 ? "" : page.slice(end));
  for (const m of prose.matchAll(/`([A-Z][A-Za-z0-9]*)`|`([a-z][A-Za-z0-9]*)\(/g)) {
    names.add(m[1] ?? m[2]);
  }

  return [...names].filter((name) => !NOT_EXPORTS.has(name));
}

/**
 * Every export either page names, sorted.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function documentedExports(repoRoot) {
  const names = new Set();
  for (const page of PAGES) {
    for (const name of mentionedExports(readFileSync(resolve(repoRoot, page), "utf8"))) {
      names.add(name);
    }
  }

  return [...names].sort();
}
