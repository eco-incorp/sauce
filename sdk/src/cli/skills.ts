/**
 * `sauce skills install | update | status`: the agent skills this package ships, kept in a project
 * for every coding agent that reads them.
 *
 * ONE SOURCE. The package carries the skills once, as Agent Skills directories (`skills/<name>/`,
 * a `SKILL.md` and what it refers to — https://agentskills.io/specification). Nothing per tool is
 * stored; each target is produced from that at install time:
 *
 * | agent       | where its skills go                                   | documented at                    |
 * | ----------- | ----------------------------------------------------- | -------------------------------- |
 * | `claude`    | `.claude/skills/`                                     | code.claude.com/docs/en/skills   |
 * | `codex`     | `.agents/skills/`                                     | developers.openai.com/codex/skills |
 * | `cursor`    | `.agents/skills/` (it also reads `.cursor/skills/`)   | cursor.com/docs/skills           |
 * | `copilot`   | `.agents/skills/` (it also reads `.github/skills/`)   | docs.github.com (create skills)  |
 * | `gemini`    | `.agents/skills/` (it also reads `.gemini/skills/`)   | geminicli.com/docs/cli/skills    |
 * | `agents-md` | `.agents/skills/`, indexed in a block of `AGENTS.md`  | agents.md                        |
 *
 * Every tool but Claude Code reads `.agents/skills/` natively, so one copy there serves them all —
 * a copy per tool would only show each of them the same skill twice. Claude Code reads nothing
 * under `.agents/`, so it gets its own. A tool that reads no skills, only `AGENTS.md`, gets an
 * index: a block of that file, owned by this command and delimited by markers, listing each skill
 * and where its `SKILL.md` is. The user's own text around the block is never touched.
 *
 * WHAT WAS INSTALLED. Each skills directory holds `.sauce-skills.json`: the package and version
 * the files came from and the sha256 of each as written. The index block carries the same in its
 * opening marker. That record is what tells the two reasons a file differs from the package apart
 * — the package moved on (the file is still as installed: `update` replaces it) or somebody edited
 * it (`update` keeps it and shows the change, unless `--force`). The skills' own content records
 * no version.
 *
 * `install` is the first install only and never overwrites; a second one says whether the project
 * is current and what to run if not. `update` brings installed targets to the package. `status`
 * reports, and fails while a target is outdated.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError, UsageError } from "./args.js";

/** The agent skills in this package: `skills/` at the package root, three levels above this
 *  module in `sdk/{src,dist}/cli`. */
export const PACKAGED_SKILLS = fileURLToPath(new URL("../../../skills/", import.meta.url));

export const AGENTS = ["claude", "codex", "cursor", "copilot", "gemini", "agents-md"] as const;
export type Agent = (typeof AGENTS)[number];

/** The install record, inside each skills directory. */
export const INSTALL_RECORD = ".sauce-skills.json";

const CLAUDE_DIR = join(".claude", "skills");
const SHARED_DIR = join(".agents", "skills");
const INDEX_FILE = "AGENTS.md";

/** Where an agent's skills go. */
const DIRECTORY: Readonly<Record<Agent, string>> = {
  claude: CLAUDE_DIR,
  codex: SHARED_DIR,
  cursor: SHARED_DIR,
  copilot: SHARED_DIR,
  gemini: SHARED_DIR,
  "agents-md": SHARED_DIR,
};

/** One place skills are kept: a skills directory, or the index block of `AGENTS.md`. */
export interface Target {
  readonly kind: "directory" | "index";
  /** Relative to the project. */
  readonly path: string;
  /** The agents it serves, among those asked for. */
  readonly agents: readonly Agent[];
}

/** Which package, at which version, the skills come from, and where they are. */
export interface SkillsSource {
  readonly dir: string;
  readonly packageName: string;
  readonly version: string;
}

/** `--agent`: names, comma-separated or repeated, or `all`; `undefined` to detect. */
export function parseAgents(raws: readonly string[]): Agent[] | undefined {
  if (raws.length === 0) return undefined;
  const names = raws.flatMap((raw) => raw.split(",")).map((name) => name.trim());
  if (names.includes("all")) return [...AGENTS];
  for (const name of names) {
    if (!(AGENTS as readonly string[]).includes(name)) {
      throw new UsageError(`--agent: '${name}' is not one of ${AGENTS.join(", ")}, all`);
    }
  }

  return [...new Set(names)] as Agent[];
}

/**
 * The agents a project already shows signs of: its own config directory or instructions file.
 * None found means `claude` and `agents-md`, which between them reach every tool above.
 */
export function detectAgents(project: string): Agent[] {
  const has = (...paths: string[]): boolean =>
    paths.some((path) => existsSync(join(project, path)));
  const found = AGENTS.filter((agent) => {
    switch (agent) {
      case "claude":
        return has(".claude", "CLAUDE.md");
      case "codex":
        return has(".codex", ".agents");
      case "cursor":
        return has(".cursor", ".cursorrules");
      case "copilot":
        return has(join(".github", "copilot-instructions.md"), join(".github", "skills"));
      case "gemini":
        return has(".gemini", "GEMINI.md");
      case "agents-md":
        return has(INDEX_FILE);
    }
  });

  return found.length > 0 ? found : ["claude", "agents-md"];
}

/** The places `agents` read skills from, each once. */
export function targetsFor(agents: readonly Agent[]): Target[] {
  const targets: Target[] = [];
  for (const agent of agents) {
    const path = DIRECTORY[agent];
    const existing = targets.find((target) => target.path === path);
    if (existing === undefined) targets.push({ kind: "directory", path, agents: [agent] });
    else (existing.agents as Agent[]).push(agent);
  }
  if (agents.includes("agents-md")) {
    targets.push({ kind: "index", path: INDEX_FILE, agents: ["agents-md"] });
  }

  return targets;
}

/** The targets a project has installed, whichever agents they were for. */
export function installedTargets(project: string): Target[] {
  const targets: Target[] = [];
  for (const [path, agents] of [
    [CLAUDE_DIR, ["claude"]],
    [SHARED_DIR, AGENTS.filter((agent) => DIRECTORY[agent] === SHARED_DIR)],
  ] as const) {
    if (existsSync(join(project, path, INSTALL_RECORD))) {
      targets.push({ kind: "directory", path, agents });
    }
  }
  if (readBlock(project) !== undefined) {
    targets.push({ kind: "index", path: INDEX_FILE, agents: ["agents-md"] });
  }

  return targets;
}

// ---------------------------------------------------------------------------------------------
// What the package ships
// ---------------------------------------------------------------------------------------------

const digest = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Every file under `dir`, as `/`-separated paths relative to it, sorted by code unit. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function packaged(source: SkillsSource): Map<string, Buffer> {
  if (!existsSync(source.dir)) {
    throw new CliError(`this package ships no agent skills: ${source.dir} does not exist`);
  }

  return new Map(
    filesUnder(source.dir).map((path) => [path, readFileSync(join(source.dir, path))]),
  );
}

/** A skill's `name` and `description`, from its SKILL.md frontmatter. */
function frontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([^]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^(name|description):\s*(.*)$/.exec(line);
    if (field !== null) fields[field[1]!] = field[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }

  return fields;
}

// ---------------------------------------------------------------------------------------------
// The AGENTS.md index block
// ---------------------------------------------------------------------------------------------

const BEGIN = /<!-- sauce-skills:begin (\S+)@(\S+) sha256=([0-9a-f]{64}) -->\n/;
const END = "<!-- sauce-skills:end -->";

/** The index of every packaged skill, pointing at its copy in `.agents/skills/`. */
function indexBody(source: SkillsSource): string {
  const shipped = packaged(source);
  const skills = [...shipped.keys()]
    .filter((path) => /^[^/]+\/SKILL\.md$/.test(path))
    .map((path) => ({
      dir: path.split("/")[0]!,
      ...frontmatter(shipped.get(path)!.toString("utf8")),
    }));

  return [
    `## Agent skills from ${source.packageName}`,
    "",
    "Each skill is a directory in `.agents/skills/`. When a task matches one below, read its",
    "`SKILL.md` and follow it; it names any further files to read.",
    "",
    ...skills.map((skill) =>
      `- **${skill.name ?? skill.dir}** (\`.agents/skills/${skill.dir}/SKILL.md\`): ${skill.description ?? ""}`.trimEnd(),
    ),
    "",
  ].join("\n");
}

interface Block {
  readonly packageName: string;
  readonly version: string;
  /** The digest the marker records, of the body as it was written. */
  readonly recorded: string;
  readonly body: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function readBlock(project: string): Block | undefined {
  const file = join(project, INDEX_FILE);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  const begin = BEGIN.exec(text);
  if (begin === null) return undefined;
  const bodyStart = begin.index + begin[0].length;
  const endAt = text.indexOf(END, bodyStart);
  if (endAt < 0) throw new CliError(`${INDEX_FILE}: the sauce-skills block has no end marker`);

  return {
    packageName: begin[1]!,
    version: begin[2]!,
    recorded: begin[3]!,
    body: text.slice(bodyStart, endAt),
    start: begin.index,
    end: endAt + END.length,
    text,
  };
}

function blockText(source: SkillsSource): string {
  const body = indexBody(source);

  return `<!-- sauce-skills:begin ${source.packageName}@${source.version} sha256=${digest(body)} -->\n${body}${END}`;
}

/** `text` with the sauce-skills block taken out — the part of `AGENTS.md` that is the user's. */
export function withoutBlock(text: string): string {
  const begin = BEGIN.exec(text);
  const endAt = begin === null ? -1 : text.indexOf(END, begin.index);
  if (begin === null || endAt < 0) return text;
  // The blank line that set the block apart goes with it.
  const before = text.slice(0, begin.index).replace(/\n+$/, "");
  const after = text.slice(endAt + END.length).replace(/^\n+/, "");
  if (before === "") return after;

  return after === "" ? `${before}\n` : `${before}\n\n${after}`;
}

// ---------------------------------------------------------------------------------------------
// Status: each file against the package and the record
// ---------------------------------------------------------------------------------------------

/**
 * One file's state. `add`, `update` and `remove` are what `update` will do; `current` needs
 * nothing; `modified` — changed here since installed, or there before sauce was, or a retired
 * skill somebody edited — is what `update` keeps unless `--force`.
 */
export interface FileStatus {
  readonly path: string;
  readonly change: "current" | "add" | "update" | "remove" | "modified";
  /** For a modified file the package still ships: what differs. */
  readonly diff?: string;
}

export interface TargetStatus {
  readonly target: Target;
  readonly state: "not installed" | "up to date" | "outdated" | "modified";
  /** The version the installed copy came from. */
  readonly installedVersion?: string;
  readonly files: readonly FileStatus[];
}

/** A few lines around the first difference: what the package has (-) and what is here (+). */
export function shortDiff(packagedText: string, localText: string): string {
  const before = packagedText.split("\n");
  const after = localText.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }
  const removed = before.slice(start, before.length - tail);
  const added = after.slice(start, after.length - tail);
  const show = (lines: string[], mark: string): string[] => [
    ...lines.slice(0, 4).map((line) => `${mark} ${line}`),
    ...(lines.length > 4 ? [`${mark} … ${lines.length - 4} more`] : []),
  ];

  return [`@@ line ${start + 1}`, ...show(removed, "-"), ...show(added, "+")].join("\n");
}

interface InstallRecord {
  readonly package: string;
  readonly version: string;
  readonly files: Readonly<Record<string, string>>;
}

function readRecord(dir: string): InstallRecord | undefined {
  const path = join(dir, INSTALL_RECORD);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InstallRecord;
  } catch {
    throw new CliError(`${path} is not the record sauce writes: delete it and install again`);
  }
}

function directoryStatus(project: string, source: SkillsSource, target: Target): TargetStatus {
  const dir = join(project, target.path);
  const record = readRecord(dir);
  const shipped = packaged(source);
  const shown = (path: string): string => join(target.path, ...path.split("/"));
  const files: FileStatus[] = [];
  for (const [path, bytes] of shipped) {
    const local = join(dir, path);
    const current = existsSync(local) ? readFileSync(local) : undefined;
    if (current === undefined) files.push({ path: shown(path), change: "add" });
    else if (current.equals(bytes)) files.push({ path: shown(path), change: "current" });
    else if (record?.files[path] === digest(current)) {
      files.push({ path: shown(path), change: "update" });
    } else {
      files.push({
        path: shown(path),
        change: "modified",
        diff: shortDiff(bytes.toString("utf8"), current.toString("utf8")),
      });
    }
  }
  for (const path of Object.keys(record?.files ?? {})) {
    const local = join(dir, path);
    if (shipped.has(path) || !existsSync(local)) continue;
    const untouched = record!.files[path] === digest(readFileSync(local));
    files.push({ path: shown(path), change: untouched ? "remove" : "modified" });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    target,
    state: stateOf(record !== undefined, files),
    ...(record === undefined ? {} : { installedVersion: record.version }),
    files,
  };
}

function stateOf(installed: boolean, files: readonly FileStatus[]): TargetStatus["state"] {
  if (!installed) return "not installed";
  if (files.some((file) => ["add", "update", "remove"].includes(file.change))) return "outdated";
  if (files.some((file) => file.change === "modified")) return "modified";

  return "up to date";
}

function indexStatus(project: string, source: SkillsSource, target: Target): TargetStatus {
  const block = readBlock(project);
  if (block === undefined) {
    return { target, state: "not installed", files: [{ path: target.path, change: "add" }] };
  }
  const wanted = indexBody(source);
  const change: FileStatus["change"] =
    digest(block.body) !== block.recorded
      ? "modified"
      : block.body === wanted
        ? "current"
        : "update";

  return {
    target,
    state: stateOf(true, [{ path: target.path, change }]),
    installedVersion: block.version,
    files: [
      {
        path: target.path,
        change,
        ...(change === "modified" ? { diff: shortDiff(wanted, block.body) } : {}),
      },
    ],
  };
}

/** Where `target` stands against the package. */
export function statusOf(project: string, source: SkillsSource, target: Target): TargetStatus {
  return target.kind === "index"
    ? indexStatus(project, source, target)
    : directoryStatus(project, source, target);
}

// ---------------------------------------------------------------------------------------------
// Install and update
// ---------------------------------------------------------------------------------------------

function writeRecord(dir: string, source: SkillsSource, files: Record<string, string>): void {
  const record: InstallRecord = { package: source.packageName, version: source.version, files };
  writeFileSync(join(dir, INSTALL_RECORD), `${JSON.stringify(record, null, 2)}\n`);
}

/** What `install` or `update` did to one target. */
export interface TargetReport {
  readonly target: Target;
  /** One line for the target, then its files. */
  readonly lines: readonly string[];
}

const label = (target: Target): string => `${target.agents.join(", ")} (${target.path})`;

function writeBlock(project: string, source: SkillsSource): void {
  const file = join(project, INDEX_FILE);
  const block = readBlock(project);
  const text = blockText(source);
  if (block !== undefined) {
    writeFileSync(file, `${block.text.slice(0, block.start)}${text}${block.text.slice(block.end)}`);
  } else if (existsSync(file)) {
    const existing = readFileSync(file, "utf8");
    writeFileSync(file, `${existing.replace(/\n*$/, "\n\n")}${text}\n`);
  } else {
    writeFileSync(file, `${text}\n`);
  }
}

/**
 * The first install of `target`. Never overwrites: on an installed target it only says where the
 * project stands, and a file already there that sauce did not write is left as it is.
 */
export function installTarget(project: string, source: SkillsSource, target: Target): TargetReport {
  const status = statusOf(project, source, target);
  if (status.state !== "not installed") {
    const line =
      status.state === "outdated"
        ? `skills are outdated for ${label(target)}: installed from ${status.installedVersion}, the ` +
          `package has ${source.version}; run \`sauce skills update\``
        : status.state === "modified"
          ? `skills are up to date for ${label(target)}, with local changes \`sauce skills status\` lists`
          : `skills are up to date (${label(target)})`;

    return { target, lines: [line] };
  }
  if (target.kind === "index") {
    writeBlock(project, source);

    return { target, lines: [`installed ${label(target)}: wrote its sauce-skills block`] };
  }
  const dir = join(project, target.path);
  const shipped = packaged(source);
  const recorded: Record<string, string> = {};
  const lines: string[] = [];
  for (const [path, bytes] of shipped) {
    const local = join(dir, path);
    if (existsSync(local) && !readFileSync(local).equals(bytes)) {
      lines.push(`  kept       ${join(target.path, path)} (already there, and different)`);
      continue;
    }
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, bytes);
    recorded[path] = digest(bytes);
    lines.push(`  wrote      ${join(target.path, path)}`);
  }
  writeRecord(dir, source, recorded);

  return { target, lines: [`installed ${label(target)}`, ...lines] };
}

/**
 * Brings an installed `target` to the package: adds new skill files, replaces changed ones and
 * removes retired ones. A file changed here since it was installed is kept, with what differs,
 * unless `force`.
 */
export function updateTarget(
  project: string,
  source: SkillsSource,
  target: Target,
  force: boolean,
): TargetReport {
  const status = statusOf(project, source, target);
  if (status.state === "not installed") {
    return {
      target,
      lines: [`${label(target)} is not installed: run \`sauce skills install\``],
    };
  }
  const counts = { added: 0, updated: 0, removed: 0, kept: 0 };
  const lines: string[] = [];
  if (target.kind === "index") {
    const [file] = status.files;
    if (file!.change === "modified" && !force) {
      counts.kept++;
      lines.push(`  kept       ${target.path}'s block, edited here:`, indent(file!.diff!));
    } else if (file!.change !== "current" || status.installedVersion !== source.version) {
      writeBlock(project, source);
      if (file!.change !== "current") counts.updated++;
    }
  } else {
    const dir = join(project, target.path);
    const shipped = packaged(source);
    const record = readRecord(dir)!;
    const recorded: Record<string, string> = {};
    for (const file of status.files) {
      const path = relative(target.path, file.path).split(sep).join("/");
      const bytes = shipped.get(path);
      const local = join(project, file.path);
      if (file.change === "modified" && !force) {
        counts.kept++;
        lines.push(
          `  kept       ${file.path}, edited here:`,
          ...(file.diff ? [indent(file.diff)] : []),
        );
        if (record.files[path] !== undefined) recorded[path] = record.files[path]!;
        continue;
      }
      if (bytes === undefined) {
        rmSync(local);
        removeEmptyParents(dirname(local), dir);
        counts.removed++;
        lines.push(`  removed    ${file.path}`);
        continue;
      }
      if (file.change !== "current") {
        mkdirSync(dirname(local), { recursive: true });
        writeFileSync(local, bytes);
        if (file.change === "add") counts.added++;
        else counts.updated++;
        lines.push(`  ${file.change === "add" ? "added  " : "updated"}    ${file.path}`);
      }
      recorded[path] = digest(bytes);
    }
    writeRecord(dir, source, recorded);
  }

  return {
    target,
    lines: [
      `${label(target)}: added ${counts.added}, updated ${counts.updated}, removed ` +
        `${counts.removed}, kept ${counts.kept} modified`,
      ...lines,
    ],
  };
}

/** Removes `from` and each parent left empty, up to (not including) `root`: a retired skill's
 *  directory goes with its last file. */
function removeEmptyParents(from: string, root: string): void {
  for (let dir = from; relative(root, dir) !== "" && !relative(root, dir).startsWith("..");) {
    if (readdirSync(dir).length > 0) return;
    rmSync(dir, { recursive: true });
    dir = dirname(dir);
  }
}

const indent = (text: string): string =>
  text
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");

/** One target's status as lines: its state, then each file that is not current. */
export function describeStatus(status: TargetStatus, source: SkillsSource): string[] {
  const head =
    status.state === "outdated"
      ? `outdated: installed from ${status.installedVersion}, the package has ${source.version}`
      : status.state === "up to date"
        ? `up to date (${source.version})`
        : status.state;

  return [
    `${label(status.target)}: ${head}`,
    ...status.files
      .filter((file) => file.change !== "current" && status.state !== "not installed")
      .flatMap((file) => [
        `  ${file.change.padEnd(9)} ${file.path}`,
        ...(file.diff === undefined ? [] : [indent(file.diff)]),
      ]),
  ];
}
