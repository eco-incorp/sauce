/**
 * `sauce init`: a project that needs nothing but this package — a manifest pinning it, agent
 * instructions, a `.gitignore` for the local config that holds endpoints and keys, a placeholder
 * example of that config, and the agent skills (`skills.ts`).
 *
 * It overwrites nothing without `--force`: every file it would write that already exists with other
 * content is listed and the whole scaffold refused, before anything is written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { CliError } from "./commands.js";
import { installSkills, planSkills, type SkillFile, type SkillsSource } from "./skills.js";

/** A package name npm accepts, from a directory's name. */
function packageNameOf(dir: string): string {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/-+$/, "");

  return name === "" ? "sauce-project" : name;
}

/** The files `sauce init` writes, by path relative to the project. */
export function scaffold(dir: string, source: SkillsSource): Record<string, string> {
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
    "CLAUDE.md": [
      "# CLAUDE.md",
      "",
      `This project writes Sauce programs with \`${source.packageName}\`, pinned in \`package.json\`.`,
      "",
      "- Use the agent skills in `.claude/skills/`: `sauce-run` covers compiling a program and",
      "  building the transaction that runs it. They describe the pinned version of the package.",
      "- Run the package's CLI as `npx sauce` (`npx sauce --help`). It signs and sends nothing:",
      "  transactions go out through `cast` or a wallet.",
      "- Keep RPC URLs and keys out of tracked files. RPC URLs go in `sauce.config.json`, which",
      "  is gitignored (start from `sauce.config.example.json`), and reach the CLI as `--rpc-url`.",
      "  Sign with a keystore (`cast send --account <name>`), never a key written into a file.",
      "- After upgrading the package, run `npx sauce skills install` to update the skills;",
      "  `npx sauce skills install --check` fails while they are out of date.",
      "",
    ].join("\n"),
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
  readonly skills: readonly SkillFile[];
}

/** Scaffolds `dir` (created if absent), then installs the agent skills into it. */
export function initProject(dir: string, source: SkillsSource, force: boolean): InitResult {
  const files = scaffold(dir, source);
  const states = Object.entries(files).map(([path, content]) => {
    const target = join(dir, path);
    const state = !existsSync(target)
      ? "wrote"
      : readFileSync(target, "utf8") === content
        ? "unchanged"
        : "overwrote";

    return { path, content, state };
  });
  const conflicts = [
    ...states.filter((file) => file.state === "overwrote").map((file) => file.path),
    ...(existsSync(dir)
      ? planSkills(dir, source)
          .filter((file) => file.state === "edited")
          .map((file) => file.path)
      : []),
  ];
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
    skills: installSkills(dir, source, force),
  };
}
