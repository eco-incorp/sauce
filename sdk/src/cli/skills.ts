/**
 * `sauce skills install`: the Claude Code agent skills this package ships, copied into a project.
 *
 * The package carries them under `skills/<name>/` (a `SKILL.md` and whatever it refers to); a
 * project gets them under `.claude/skills/<name>/`, where Claude Code looks. Beside them the install
 * writes `.sauce-skills.json`, the digest of every file it put there. That record is what lets a
 * later install tell the two reasons a file can differ from the package apart: the package moved on
 * (the file is still what was installed — replace it) or somebody edited it (refuse, unless
 * `--force`). Without it every difference would look like an edit, every SDK upgrade would need
 * `--force`, and `--force` would then flatten real edits too.
 *
 * Only paths the package ships, or once shipped, are ever touched: a project's own skills beside
 * them are not this command's business.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError } from "./commands.js";

/** The agent skills in this package: `skills/` at the package root, three levels above this
 *  module in `sdk/{src,dist}/cli`. */
export const PACKAGED_SKILLS = fileURLToPath(new URL("../../../skills/", import.meta.url));

/** Where a project's skills live, relative to the project: one directory per skill. */
export const SKILLS_DIR = join(".claude", "skills");

/** The install record, inside {@link SKILLS_DIR}. */
export const INSTALL_RECORD = ".sauce-skills.json";

interface InstallRecord {
  readonly package: string;
  readonly version: string;
  /** Path under `SKILLS_DIR` (with `/`) to the sha256 of what was installed there. */
  readonly files: Readonly<Record<string, string>>;
}

/** Which package, at which version, is installing from where. */
export interface SkillsSource {
  readonly dir: string;
  readonly packageName: string;
  readonly version: string;
}

/**
 * One file's fate: `added` (not in the project yet), `unchanged`, `updated` (differs, but is
 * exactly what an earlier install wrote), `stale` (installed earlier, no longer shipped, untouched)
 * or `edited` (differs from what was installed: somebody changed it).
 */
export interface SkillFile {
  /** Relative to the project, as printed. */
  readonly path: string;
  readonly state: "added" | "unchanged" | "updated" | "stale" | "edited";
  /** Whether the package ships it: an edited file the package dropped is not shipped. */
  readonly shipped: boolean;
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Every file under `dir`, as `/`-separated paths relative to it, sorted. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}

function packaged(source: SkillsSource): Map<string, Buffer> {
  if (!existsSync(source.dir)) {
    throw new CliError(`this package ships no agent skills: ${source.dir} does not exist`);
  }

  return new Map(
    filesUnder(source.dir).map((path) => [path, readFileSync(join(source.dir, path))]),
  );
}

function readRecord(skills: string): InstallRecord["files"] {
  const path = join(skills, INSTALL_RECORD);
  if (!existsSync(path)) return {};
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as InstallRecord).files ?? {};
  } catch {
    throw new CliError(`${path} is not the record sauce writes: delete it and install again`);
  }
}

const shown = (path: string): string => join(SKILLS_DIR, ...path.split("/"));

/** What installing `source` into `project` would do to each file, without doing it. */
export function planSkills(project: string, source: SkillsSource): SkillFile[] {
  const skills = join(project, SKILLS_DIR);
  const shipped = packaged(source);
  const record = readRecord(skills);
  const plan: SkillFile[] = [];

  for (const [path, bytes] of shipped) {
    const installed = join(skills, path);
    const current = existsSync(installed) ? readFileSync(installed) : undefined;
    const state =
      current === undefined
        ? "added"
        : current.equals(bytes)
          ? "unchanged"
          : record[path] === digest(current)
            ? "updated"
            : "edited";
    plan.push({ path: shown(path), state, shipped: true });
  }
  for (const path of Object.keys(record)) {
    const installed = join(skills, path);
    if (shipped.has(path) || !existsSync(installed)) continue;
    const untouched = record[path] === digest(readFileSync(installed));
    plan.push({ path: shown(path), state: untouched ? "stale" : "edited", shipped: false });
  }

  // By code unit, as `filesUnder` sorts: the same order in the record, the plan and the output.
  return plan.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Installs `source` into `project` as {@link planSkills} plans it. An edited file stops the install
 * before anything is written, unless `force`, which overwrites it (or, if the package no longer
 * ships it, deletes it) as well.
 */
export function installSkills(project: string, source: SkillsSource, force: boolean): SkillFile[] {
  const plan = planSkills(project, source);
  const edited = plan.filter((file) => file.state === "edited");
  if (edited.length > 0 && !force) {
    throw new CliError(
      "not installing: these changed since sauce installed them, and would be overwritten:\n" +
        edited.map((file) => `  ${file.path}`).join("\n") +
        "\nMove your changes out of them and install again, or pass --force to overwrite them.",
    );
  }
  const skills = join(project, SKILLS_DIR);
  for (const file of plan) {
    if (!file.shipped) rmSync(join(project, file.path));
  }
  const shipped = packaged(source);
  for (const [path, bytes] of shipped) {
    const target = join(skills, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const record: InstallRecord = {
    package: source.packageName,
    version: source.version,
    files: Object.fromEntries([...shipped].map(([path, bytes]) => [path, digest(bytes)])),
  };
  writeFileSync(join(skills, INSTALL_RECORD), `${JSON.stringify(record, null, 2)}\n`);

  return plan;
}

/** What an install did to each file, one line each. */
export function describeInstall(plan: readonly SkillFile[]): string[] {
  const verb = (file: SkillFile): string =>
    !file.shipped
      ? "removed"
      : { added: "wrote", unchanged: "unchanged", updated: "updated", edited: "overwrote" }[
          file.state as "added" | "unchanged" | "updated" | "edited"
        ];

  return plan.map((file) => `${verb(file).padEnd(10)} ${file.path}`);
}

/** How the installed copies differ from the package, one line each: empty when up to date. */
export function checkSkills(project: string, source: SkillsSource): string[] {
  return planSkills(project, source).flatMap((file) =>
    file.state === "unchanged"
      ? []
      : [
          `${(!file.shipped ? "no longer shipped" : file.state === "added" ? "missing" : "differs").padEnd(17)} ${file.path}`,
        ],
  );
}
