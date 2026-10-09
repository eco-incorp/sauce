/**
 * The package's OPTIONAL dependencies: what one command of the `sauce` bin loads when it runs, and
 * nothing else does — no export of the package reaches them (`optional-dependencies.test.ts`).
 *
 *   - `@modelcontextprotocol/sdk` and `zod`: the MCP server, `sauce mcp` (`mcp.ts` loads `mcp/dist`).
 *   - `litesvm`: a Solana cook rehearsed in a local copy of its accounts (`svm-fork.ts`).
 *
 * npm installs optional dependencies by default, so `npx @eco-incorp/sauce mcp` and a Solana
 * rehearsal need nothing else. A library install leaves them out with `--omit=optional`, and a
 * platform LiteSVM ships no binary for no longer fails the install; the command that needs one then
 * stops with {@link optionalMissing}'s message, which gives the line that installs it.
 */
import { readFileSync } from "node:fs";

/** What `sauce mcp` loads: the MCP SDK, and the schemas its tools declare their inputs in. */
export const MCP_DEPENDENCIES = ["@modelcontextprotocol/sdk", "zod"] as const;

/** What rehearses a Solana cook in a local copy of its accounts. */
export const LITESVM_DEPENDENCY = "litesvm";

/** Every optional dependency the package declares, as its manifest lists them. */
export const OPTIONAL_DEPENDENCIES = [...MCP_DEPENDENCIES, LITESVM_DEPENDENCY].sort();

/**
 * The package among `packages` that `error`, thrown by an `import()`, could not find: `undefined`
 * for any other failure — a module of the package's own that is missing, or a native binary that
 * does not load.
 */
export function missingPackage(error: unknown, packages: readonly string[]): string | undefined {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code !== "ERR_MODULE_NOT_FOUND" || typeof message !== "string") return undefined;
  // "Cannot find package 'zod' imported from …": the package's name, whatever subpath was asked.
  const name = /^Cannot find package '([^']+)'/.exec(message)?.[1];

  return packages.find((each) => each === name);
}

/**
 * Why `what` cannot run here: it needs `packages`, optional dependencies this install left out. The
 * line that installs them names the versions the package pins.
 */
export function optionalMissing(what: string, packages: readonly string[]): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { name: string; optionalDependencies?: Record<string, string> };
  const pinned = manifest.optionalDependencies ?? {};
  // A range a shell would read (`^1.2.1`) in double quotes, which every shell keeps as written.
  const specs = packages.map((each) => {
    const spec = `${each}@${pinned[each] ?? "latest"}`;

    return /^[\w@./:-]+$/.test(spec) ? spec : `"${spec}"`;
  });
  const one = packages.length === 1;
  const names = one
    ? packages[0]
    : `${packages.slice(0, -1).join(", ")} and ${packages[packages.length - 1]}`;

  return (
    `${what} needs ${names}, ${one ? "an optional dependency" : "optional dependencies"} of ` +
    `${manifest.name} that this install left out (--omit=optional): install ` +
    `${one ? "it" : "them"} with \`npm i ${specs.join(" ")}\`, or install ${manifest.name} ` +
    "without --omit=optional"
  );
}
