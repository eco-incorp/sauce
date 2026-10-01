/**
 * The agent skills this package ships, served as resources: every file under the package's
 * `skills/` — each skill's `SKILL.md`, its `references/` and its `examples/` — at
 * `sauce://skills/<skill>/<path>`, and an index of them at `sauce://skills/index`. They are the
 * same files `sauce skills install` copies into a project, read from the package as they are, so an
 * agent with only this server reads what an agent with the installed skills reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PACKAGED_SKILLS } from "./sdk.js";

export const SKILLS_SCHEME = "sauce://skills/";
export const SKILLS_INDEX = `${SKILLS_SCHEME}index`;

/** One shipped file, as a resource. */
export interface SkillFile {
  readonly uri: string;
  /** `/`-separated, from `skills/`: `sauce-run/SKILL.md`. */
  readonly path: string;
  readonly skill: string;
  readonly mimeType: string;
}

/** A skill, by its SKILL.md's frontmatter. */
export interface Skill {
  readonly dir: string;
  readonly name: string;
  readonly description: string;
  readonly uri: string;
  readonly files: readonly SkillFile[];
}

const MIME: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.md$/, "text/markdown"],
  [/\.json$/, "application/json"],
  [/\.(?:m?ts|js)$/, "text/typescript"],
];

const mimeOf = (path: string): string =>
  MIME.find(([pattern]) => pattern.test(path))?.[1] ?? "text/plain";

/** A skill's `name` and `description`, from its SKILL.md frontmatter (agentskills.io). */
function frontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([^]*?)\r?\n---/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of (match?.[1] ?? "").split(/\r?\n/)) {
    const field = /^(name|description):\s*(.*)$/.exec(line);
    if (field !== null) fields[field[1]!] = field[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }

  return fields;
}

let cached: readonly Skill[] | undefined;

/** The shipped skills, read once: the package's files do not change while it runs. */
export function shippedSkills(dir: string = PACKAGED_SKILLS): readonly Skill[] {
  if (dir === PACKAGED_SKILLS && cached !== undefined) return cached;
  const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    // In a skill's directory, and no dotfile (an editor's or a file manager's, never shipped).
    .filter((path) => path.includes("/") && !path.split("/").some((part) => part.startsWith(".")))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dirs = [...new Set(paths.map((path) => path.split("/")[0]!))].filter((skill) =>
    paths.includes(`${skill}/SKILL.md`),
  );
  const skills = dirs.map((skill) => {
    const meta = frontmatter(readFileSync(join(dir, skill, "SKILL.md"), "utf8"));
    const files = paths
      .filter((path) => path.startsWith(`${skill}/`))
      .map((path) => ({ uri: `${SKILLS_SCHEME}${path}`, path, skill, mimeType: mimeOf(path) }));

    return {
      dir: skill,
      name: meta.name ?? skill,
      description: meta.description ?? "",
      uri: `${SKILLS_SCHEME}${skill}/SKILL.md`,
      // SKILL.md first: it is the file the rest hang from.
      files: [
        ...files.filter((file) => file.path === `${skill}/SKILL.md`),
        ...files.filter((file) => file.path !== `${skill}/SKILL.md`),
      ],
    };
  });
  if (dir === PACKAGED_SKILLS) cached = skills;

  return skills;
}

/** The index: each skill, what it is for, and the files it holds. */
export function skillsIndex(skills: readonly Skill[]): string {
  return [
    "# Sauce agent skills",
    "",
    "Each skill is a SKILL.md and the files it refers to. When a task matches a skill below,",
    "read its SKILL.md and follow it; it names any further file to read, by a path relative to",
    `itself — \`references/x.md\` in skill \`s\` is ${SKILLS_SCHEME}s/references/x.md.`,
    "",
    ...skills.flatMap((skill) => [
      `## ${skill.name}`,
      "",
      skill.description,
      "",
      ...skill.files.map((file) => `- ${file.uri}`),
      "",
    ]),
  ].join("\n");
}

const indexes = new WeakMap<readonly Skill[], string>();

export function registerResources(server: McpServer, dir: string = PACKAGED_SKILLS): void {
  const skills = shippedSkills(dir);
  const index = (): string => {
    const built = indexes.get(skills) ?? skillsIndex(skills);
    indexes.set(skills, built);

    return built;
  };
  server.registerResource(
    "skills-index",
    SKILLS_INDEX,
    {
      title: "Sauce agent skills: index",
      description:
        "Every Sauce agent skill, what it is for, and the resources it holds. Read it first, " +
        "then the SKILL.md of the skill a task needs.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: index() }],
    }),
  );
  for (const skill of skills) {
    for (const file of skill.files) {
      const main = file.path === `${skill.dir}/SKILL.md`;
      server.registerResource(
        main ? skill.name : file.path,
        file.uri,
        {
          title: main ? `Skill: ${skill.name}` : file.path,
          description: main ? skill.description : `${file.path}, from the ${skill.name} skill`,
          mimeType: file.mimeType,
        },
        (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: file.mimeType,
              text: readFileSync(join(dir, file.path), "utf8"),
            },
          ],
        }),
      );
    }
  }
}
