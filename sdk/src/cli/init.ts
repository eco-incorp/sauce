/**
 * `sauce init`: a project that needs nothing but this package — a manifest pinning it, agent
 * instructions every coding agent reads, a `.gitignore` for the local config that holds
 * endpoints, a placeholder example of that config, a `programs/` directory whose tsconfig.json
 * gives an editor SauceScript's names (`sauceScriptTsconfig`), and the agent skills (`skills.ts`).
 *
 * The instructions are `AGENTS.md`, which Codex, Cursor, Copilot and Claude Code read
 * (agents.md). Claude Code reads it only while no `CLAUDE.md` exists, and Gemini CLI reads
 * `GEMINI.md`, so for those two agents `init` adds the one-line file each documents for sharing it:
 * `@AGENTS.md` (code.claude.com/docs/en/memory) and `@./AGENTS.md` (geminicli.com, GEMINI.md
 * imports).
 *
 * It overwrites nothing without `--force`: every file it would write that already exists with
 * other content is listed and the whole scaffold refused, before anything is written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { CliError } from "./args.js";
import {
  installTarget,
  targetsFor,
  withoutBlock,
  type Agent,
  type SkillsSource,
  type TargetReport,
} from "./skills.js";

/** A package name npm accepts, from a directory's name. */
function packageNameOf(dir: string): string {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+$/, "");

  return name === "" ? "sauce-project" : name;
}

/** Where `sauce init` puts the project's SauceScript programs: the directory its tsconfig covers. */
export const PROGRAMS_DIR = "programs";

/**
 * The tsconfig.json of the programs directory: a TypeScript project of SauceScript files alone,
 * with the package's declarations of the language (`<package>/sauce-script`) and its plugin, which
 * drops what TypeScript reports on valid SauceScript (integer indexes, `1` beside `1n`, undeclared
 * UPPER_CASE defines). Its own project, because those declarations name `require`, `crypto` and
 * `eval` as SauceScript has them: kept out of the project's other TypeScript, they cannot change
 * it. An editor takes a file's nearest tsconfig.json, so every program in the directory gets it.
 */
export function sauceScriptTsconfig(packageName: string): Record<string, unknown> {
  return {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022"],
      module: "ESNext",
      moduleResolution: "Bundler",
      // Each program is a module of its own: two programs' `main` never collide.
      moduleDetection: "force",
      // Only SauceScript's names: no Node, no DOM.
      types: [`${packageName}/sauce-script`],
      // An unannotated helper parameter is a number in SauceScript, not an error.
      strict: true,
      noImplicitAny: false,
      noEmit: true,
      allowImportingTsExtensions: true,
      // A JSON import is a contract binding, which the declarations type, not the file's JSON.
      resolveJsonModule: false,
      skipLibCheck: true,
      // Loaded by an editor running the project's own TypeScript (node_modules/typescript).
      plugins: [{ name: `${packageName}/sdk/dist/sauce-script/ts-plugin.cjs` }],
    },
    include: ["**/*.sauce.ts"],
  };
}

/** The files `sauce init` writes for `agents`, by path relative to the project. */
export function scaffold(
  dir: string,
  source: SkillsSource,
  agents: readonly Agent[],
): Record<string, string> {
  const manifest = {
    name: packageNameOf(dir),
    version: "0.0.0",
    private: true,
    type: "module",
    engines: { node: ">=24" },
    // Exactly the version that scaffolded it: the skills installed beside it describe this one.
    dependencies: { [source.packageName]: source.version },
    // The TypeScript an editor runs for the programs' plugin: the project's own.
    devDependencies: { typescript: source.typescript ?? "^5.7.0" },
  };

  return {
    "package.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "AGENTS.md": [
      "# AGENTS.md",
      "",
      `This project writes Sauce programs with \`${source.packageName}\`, pinned in \`package.json\`.`,
      "",
      "- Use the agent skills the package installed (`npx sauce skills status` lists them).",
      "  Start with `sauce-overview`, which says what Sauce is and which skill covers a task;",
      "  `sauce-cli` covers compiling a program, rehearsing it and running it on a Pot. They",
      "  describe the pinned version of the package.",
      "- Run the package's CLI as `npx sauce` (`npx sauce --help`). `sauce simulate` rehearses a",
      "  program with no key, `sauce run` signs and sends it, and `sauce tx` prints the unsigned",
      "  transaction for a wallet.",
      `- Write programs in \`${PROGRAMS_DIR}/\`, as \`*.sauce.ts\`. Its \`tsconfig.json\` gives an editor`,
      "  SauceScript's names (its types and builtins, the chains, token symbols, protocol",
      "  namespaces and the package's ABIs) and a TypeScript plugin that drops what TypeScript",
      "  reports on valid SauceScript: integer indexes, `1` beside `1n`, undeclared UPPER_CASE",
      "  defines. The plugin loads where the editor runs the project's own TypeScript. The compile",
      "  (`npx sauce compile <file> --chain <chain>`) is what decides.",
      "- The CLI reads a chain through a built-in public endpoint, which can be slow or",
      "  rate-limited. For your own, put its URL in `sauce.config.json`, which is gitignored",
      "  (start from `sauce.config.example.json`), and pass `--config sauce.config.json`. Keep RPC",
      "  URLs and keys out of tracked files: sign with a keystore (`--keystore`), not a key on the",
      "  command line.",
      "- After upgrading the package, run `npx sauce skills update`; `npx sauce skills status`",
      "  fails while the skills are outdated.",
      "",
    ].join("\n"),
    ...(agents.includes("claude") ? { "CLAUDE.md": "@AGENTS.md\n" } : {}),
    ...(agents.includes("gemini") ? { "GEMINI.md": "@./AGENTS.md\n" } : {}),
    ".gitignore": [
      "node_modules/",
      "",
      "# Local configuration: RPC URLs, and anything secret. Commit the example, never these.",
      "sauce.config.json",
      ".env",
      ".env.*",
      "",
    ].join("\n"),
    "sauce.config.example.json": `${JSON.stringify(
      {
        rpcUrls: {
          "1": "<RPC_URL for Ethereum>",
          "8453": "<RPC_URL for Base>",
        },
      },
      null,
      2,
    )}\n`,
    [`${PROGRAMS_DIR}/tsconfig.json`]: `${JSON.stringify(sauceScriptTsconfig(source.packageName), null, 2)}\n`,
  };
}

/**
 * `sauce init <dir> --tsconfig`: only `<dir>/tsconfig.json`, the programs' TypeScript project of
 * {@link sauceScriptTsconfig}, for a directory of programs in a project `init` did not write (or
 * outside `programs/`). Never overwrites a different file without `force`.
 */
export function writeSauceScriptTsconfig(
  dir: string,
  packageName: string,
  force: boolean,
): { readonly path: string; readonly state: string } {
  const path = join(dir, "tsconfig.json");
  const content = `${JSON.stringify(sauceScriptTsconfig(packageName), null, 2)}\n`;
  const state = !existsSync(path)
    ? "wrote"
    : readFileSync(path, "utf8") === content
      ? "unchanged"
      : "overwrote";
  if (state === "overwrote" && !force) {
    throw new CliError(
      `${path} already exists with other content: pass --force to replace it with SauceScript's ` +
        "project, or merge its compilerOptions (`types`, `plugins`) and include into it",
    );
  }
  if (state !== "unchanged") {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, content);
  }

  return { path, state };
}

export interface InitResult {
  /** Each scaffold file, with whether it was `wrote`, `unchanged` or `overwrote`. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly state: string }>;
  readonly skills: readonly TargetReport[];
}

/** A file as `init` compares it: `AGENTS.md` without the skills block, which is not its own. */
const comparable = (path: string, text: string): string =>
  path === "AGENTS.md" ? withoutBlock(text).trimEnd() : text;

/** Scaffolds `dir` (created if absent) for `agents`, then installs their skills into it. */
export function initProject(
  dir: string,
  source: SkillsSource,
  agents: readonly Agent[],
  force: boolean,
): InitResult {
  const files = scaffold(dir, source, agents);
  const states = Object.entries(files).map(([path, content]) => {
    const target = join(dir, path);
    const state = !existsSync(target)
      ? "wrote"
      : comparable(path, readFileSync(target, "utf8")) === comparable(path, content).trimEnd() ||
          readFileSync(target, "utf8") === content
        ? "unchanged"
        : "overwrote";

    return { path, content, state };
  });
  const conflicts = states.filter((file) => file.state === "overwrote").map((file) => file.path);
  if (conflicts.length > 0 && !force) {
    throw new CliError(
      `${dir} already has files init would overwrite:\n` +
        conflicts.map((path) => `  ${path}`).join("\n") +
        "\nPass --force to overwrite them.",
    );
  }
  mkdirSync(dir, { recursive: true });
  for (const file of states) {
    if (file.state === "unchanged") continue;
    mkdirSync(dirname(join(dir, file.path)), { recursive: true });
    writeFileSync(join(dir, file.path), file.content);
  }

  return {
    files: states.map(({ path, state }) => ({ path, state })),
    skills: targetsFor(agents).map((target) => installTarget(dir, source, target)),
  };
}
