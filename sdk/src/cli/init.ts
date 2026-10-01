/**
 * `sauce init`: a project that needs nothing but this package — a manifest pinning it, agent
 * instructions every coding agent reads, a `.gitignore` for the local config that holds
 * endpoints, a placeholder example of that config, and the agent skills (`skills.ts`).
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
import { basename, join, resolve } from "node:path";

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
      "  `sauce-run` covers compiling a program, rehearsing it and running it on a Pot. They",
      "  describe the pinned version of the package.",
      "- Run the package's CLI as `npx sauce` (`npx sauce --help`). `sauce simulate` rehearses a",
      "  program with no key, `sauce run` signs and sends it, and `sauce tx` prints the unsigned",
      "  transaction for a wallet.",
      "- Keep RPC URLs and keys out of tracked files. RPC URLs go in `sauce.config.json`, which is",
      "  gitignored (start from `sauce.config.example.json`), and reach the CLI as",
      "  `--config sauce.config.json`. Sign with a keystore (`--keystore`), not a key on the",
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
  };
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
    if (file.state !== "unchanged") writeFileSync(join(dir, file.path), file.content);
  }

  return {
    files: states.map(({ path, state }) => ({ path, state })),
    skills: targetsFor(agents).map((target) => installTarget(dir, source, target)),
  };
}
