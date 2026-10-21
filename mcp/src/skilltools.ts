/**
 * The agent skills as TOOLS, for a client that calls tools but never reads resources: the list of
 * skills, one skill's file (or the part of it a task needs), the SDK's own documents for TypeScript
 * work, and how to install the skills where an agent reads them. Each serves only files the package
 * ships — a skill's files as `resources.ts` lists them, the manual under `docs/` — by name, never by
 * a path the caller builds.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import { shippedSkills, SKILLS_INDEX, type Skill } from "./resources.js";
import { installedViem, PACKAGED_SKILLS, skillTargets, UsageError } from "./sdk.js";
import { packageInfo } from "./server.js";
import { configSnippet, launch, SETUP_AGENTS, type SetupAgent } from "./setup.js";

/** The package's manual, two levels above this module in `mcp/{src,dist}`. */
const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));

/** The skill tools, in the order `tools/list` gives them (after `tools.ts#TOOL_NAMES`). */
export const SKILL_TOOL_NAMES = [
  "sauce_skills",
  "sauce_skill",
  "sauce_dev",
  "sauce_install_skills",
] as const;

/** The topics `sauce_dev` serves, each the shipped documents that cover it and the words that
 *  name it in a question. Every one is about application code or tooling, not SauceScript. */
export const DEV_TOPICS: ReadonlyArray<{
  readonly topic: string;
  readonly about: string;
  readonly keywords: readonly string[];
  readonly files: readonly string[];
}> = [
  {
    topic: "start",
    about:
      "install the package, run a first program on Base and on Solana, build a first intent, and compile and test a program from TypeScript; the glossary",
    keywords: ["start", "install", "quick", "first", "hello", "begin", "typescript", "glossary"],
    files: [
      "guides/quick-start.md",
      "guides/solana-quick-start.md",
      "guides/first-intent.md",
      "guides/typescript-quick-start.md",
      "guides/test-your-first-program.md",
      "concepts/glossary.md",
      "examples/first-intent.ts",
    ],
  },
  {
    topic: "compile",
    about: "compile a program from TypeScript: compileSauceProgram, compile(), arguments, defines",
    keywords: [
      "compile",
      "compiler",
      "compiling",
      "compilesauceprogram",
      "bytecode",
      "compact",
      "arguments",
      "defines",
      "entry",
      "wasm",
    ],
    files: ["guides/compiling.md", "api/compiler.md", "examples/compile-program.ts"],
  },
  {
    topic: "intents",
    about: "cross-chain intents from TypeScript: openRoute, rewards, publishing, nesting",
    keywords: [
      "intent",
      "intents",
      "route",
      "routes",
      "openroute",
      "reward",
      "portal",
      "crosschain",
      "nest",
      "nested",
      "cascade",
    ],
    files: [
      "guides/intents.md",
      "guides/nested-intents.md",
      "api/routes.md",
      "examples/cross-chain-intent.ts",
      "examples/cross-chain-intent.sauce.ts",
      "examples/ethereum-to-solana.ts",
    ],
  },
  {
    topic: "protocols",
    about: "tokens and protocols from TypeScript: the registries, the namespaces, coverage",
    keywords: ["registry", "registries", "coverage", "descriptor", "descriptors", "viem"],
    files: ["guides/protocols-and-tokens.md", "api/coverage.md", "examples/protocol-approval.ts"],
  },
  {
    topic: "actions",
    about: "action programs as JSON, compiled from TypeScript, and the builders",
    keywords: ["action", "actions", "json", "compileprogram", "builder", "builders", "schema"],
    files: ["guides/actions.md", "guides/builders-and-actions.md", "examples/action-program.ts"],
  },
  {
    topic: "execution",
    about: "running a program on a Pot from TypeScript: the cook, the engine, the Kitchen",
    keywords: ["execute", "execution", "cook", "engine", "client", "deployments", "architecture"],
    files: ["examples/evm-execution.ts", "concepts/architecture.md"],
  },
  {
    topic: "solana",
    about: "Solana from TypeScript: the SVM client, account plans, the Kitchen, staging",
    keywords: ["solana", "svm", "spl", "manifest", "lamports", "staging"],
    files: ["guides/solana.md", "guides/solana-from-typescript.md"],
  },
  {
    topic: "verification",
    about: "checking a settle program and a settlement from TypeScript",
    keywords: ["verify", "verification", "settle", "settlement", "audit", "validate"],
    files: ["guides/verification.md"],
  },
  {
    topic: "testing",
    about:
      "tests that run programs from TypeScript: fork() and local() on anvil or LiteSVM, fund, run, simulate, the testing kit's exports",
    keywords: ["test", "tests", "testing", "fork", "anvil", "litesvm", "snapshot", "fixture"],
    files: ["guides/test-your-first-program.md", "guides/testing.md", "api/testing-kit.md"],
  },
  {
    topic: "api",
    about: "every published import and what it holds, deployments included",
    keywords: ["api", "export", "exports", "import", "imports", "subpath", "package"],
    files: ["api/README.md"],
  },
  {
    topic: "language",
    about: "how the compiler sees SauceScript, as the TypeScript SDK documents it",
    keywords: ["semantics", "frontend", "concepts"],
    files: ["concepts/saucescript.md"],
  },
  {
    topic: "cli",
    about: "the sauce command: every command and flag, endpoints and signers",
    keywords: ["cli", "command", "commands", "terminal", "flags", "keystore", "sauce"],
    files: ["guides/cli.md"],
  },
  {
    topic: "mcp",
    about:
      "this MCP server and the agent skills: a first agent session, running it, endpoints, agent setup, skills, self-hosting",
    keywords: ["mcp", "server", "setup", "agent", "agents", "selfhost", "http", "stdio", "skills"],
    files: ["guides/agent-quick-start.md", "guides/mcp.md", "guides/skills.md"],
  },
];

/** The skill a TypeScript task starts from, by its directory. */
const TYPESCRIPT_SKILL = "sauce-typescript";

/** A skill's references past this many are summarized, not listed, by `sauce_skills`. */
const LISTED_REFERENCES = 12;

const PURE: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const json = (value: Record<string, unknown>): CallToolResult => ({
  structuredContent: value,
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

const failure = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
});

/** The skill named `name`, by its frontmatter name or its directory. */
function skillNamed(skills: readonly Skill[], name: string): Skill {
  const found = skills.find((skill) => skill.name === name || skill.dir === name);
  if (found === undefined) {
    throw new UsageError(
      `no skill named '${name}': the skills are ${skills.map((skill) => skill.name).join(", ")}`,
    );
  }

  return found;
}

/** The words of a question, lowercased, joined across hyphens and dots. */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[-.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);

/** The topics a question names, best first: every topic with the highest number of keyword hits. */
export function topicsFor(question: string): string[] {
  const asked = new Set(words(question));
  const scored = DEV_TOPICS.map((entry) => ({
    topic: entry.topic,
    score: entry.keywords.filter((keyword) => asked.has(keyword)).length,
  })).filter((entry) => entry.score > 0);
  const best = Math.max(0, ...scored.map((entry) => entry.score));

  return scored.filter((entry) => entry.score === best).map((entry) => entry.topic);
}

const docFiles = (): Set<string> =>
  new Set(
    readdirSync(DOCS, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(DOCS.length).split("\\").join("/")),
  );

/** The part of a markdown `text` under the heading that names `section`, to the next heading of
 *  its level or above; `undefined` when no heading names it. */
export function sectionOf(text: string, section: string): string | undefined {
  const lines = text.split("\n");
  const wanted = section.toLowerCase().replace(/^#+\s*/, "");
  const start = lines.findIndex(
    (line) =>
      /^#{1,6}\s/.test(line) &&
      line
        .replace(/^#+\s*/, "")
        .toLowerCase()
        .includes(wanted),
  );
  if (start < 0) return undefined;
  const level = /^#+/.exec(lines[start]!)![0].length;
  const end = lines.findIndex(
    (line, at) => at > start && /^#{1,6}\s/.test(line) && /^#+/.exec(line)![0].length <= level,
  );

  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

/** The lines of `text` that hold `query` (any case), each with two lines around it, the ranges
 *  merged and numbered; at most `limit` matches. */
export function linesMatching(text: string, query: string, limit = 40): string {
  const lines = text.split("\n");
  const wanted = query.toLowerCase();
  const hits = lines
    .map((line, at) => (line.toLowerCase().includes(wanted) ? at : -1))
    .filter((at) => at >= 0)
    .slice(0, limit);
  const keep = new Set<number>();
  for (const at of hits) {
    for (let near = Math.max(0, at - 2); near <= Math.min(lines.length - 1, at + 2); near++) {
      keep.add(near);
    }
  }
  const out: string[] = [];
  let previous = -2;
  for (const at of [...keep].sort((a, b) => a - b)) {
    if (at !== previous + 1 && out.length > 0) out.push("…");
    out.push(`${at + 1}: ${lines[at]}`);
    previous = at;
  }

  return out.join("\n");
}

/** Where each agent reads skills from, per the `sauce skills` command (the one source). */
const INSTALL_AGENTS = ["claude", "codex", "cursor", "copilot", "gemini", "agents-md"] as const;

/**
 * Registers the skill tools, serving the skills under `root`. `newerVersion` is the update check's
 * newer version, which `sauce_skills` returns as `latest` beside the version it runs.
 */
export function registerSkillTools(
  server: McpServer,
  root: string = PACKAGED_SKILLS,
  newerVersion?: () => string | undefined,
): void {
  const skills = shippedSkills(root);
  const { name: packageName, version } = packageInfo();
  const bytes = (path: string): number => statSync(join(root, path)).size;

  server.registerTool(
    "sauce_skills",
    {
      title: "List the Sauce agent skills",
      description:
        "Lists every agent skill this server carries: each skill's name, when to use it, and " +
        "its files with their sizes, with the package and version they belong to (and `latest`, " +
        "when a newer version of the package is published). Start here " +
        "before writing a Sauce program: read sauce-overview first, then the skill the task " +
        "needs, with sauce_skill (which can return one section, or the lines matching a term, " +
        "of a large file). A skill with many references (one document per protocol) lists a " +
        "few and how to name the rest. The same files are resources under sauce://skills/. " +
        "The skills teach SauceScript so you write each program yourself, for the task as " +
        "asked: their examples show idioms, not templates to copy or choose between.",
      annotations: { title: "List the Sauce agent skills", ...PURE },
      outputSchema: z.looseObject({
        package: z.string(),
        version: z.string(),
        latest: z.string().optional(),
        skills: z.array(z.looseObject({ name: z.string(), description: z.string() })),
      }),
    },
    () => {
      const latest = newerVersion?.();

      return json({
        package: packageName,
        version,
        ...(latest === undefined ? {} : { latest }),
        index: SKILLS_INDEX,
        skills: skills.map((skill) => {
          const files = skill.files.map((file) => ({
            path: file.path.slice(skill.dir.length + 1),
            bytes: bytes(file.path),
          }));
          // The documents a summary stands for; any other reference (a JSON file of data, say)
          // is always listed, since `rest` names only documents.
          const document = (file: { path: string }) =>
            file.path.startsWith("references/") && file.path.endsWith(".md");
          const references = files.filter(document);
          const many = references.length > LISTED_REFERENCES;

          return {
            name: skill.name,
            description: skill.description,
            uri: skill.uri,
            files: many ? files.filter((file) => !document(file)) : files,
            ...(many
              ? {
                  references: {
                    count: references.length,
                    some: references.slice(0, LISTED_REFERENCES).map((file) => file.path),
                    rest:
                      "every other file is references/<name>.md: sauce_skill with that path, " +
                      "or this skill's SKILL.md, which says how they are named",
                  },
                }
              : {}),
          };
        }),
      });
    },
  );

  server.registerTool(
    "sauce_skill",
    {
      title: "Read a Sauce agent skill",
      description:
        "Returns one skill's SKILL.md — its instructions — or, with `path`, one of its files " +
        "under references/ or examples/ (paths as sauce_skills lists them, such as " +
        "references/builtins.md). A large file need not come whole: `section` returns the part " +
        "under one heading, `query` the lines that hold a term, with the lines around them. " +
        "Follow a SKILL.md as written; it says which further files to read. An example program " +
        "shows an idiom and the rules a correct program follows: read it for the pattern, then " +
        "write the program the task needs. Only the files the package ships are served.",
      annotations: { title: "Read a Sauce agent skill", ...PURE },
      inputSchema: z
        .object({
          skill: z
            .string()
            .min(1)
            .max(100)
            .describe("The skill's name, as sauce_skills lists it: sauce-overview, sauce-cli, …"),
          path: z
            .string()
            .min(1)
            .max(256)
            .optional()
            .describe(
              "A file of that skill, relative to its directory (references/x.md, " +
                "examples/y.sauce.ts). Default: SKILL.md.",
            ),
          section: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe(
              "Only the part under the markdown heading that holds these words, to the next " +
                "heading of its level.",
            ),
          query: z
            .string()
            .min(2)
            .max(200)
            .optional()
            .describe(
              "Only the lines that hold this text (any case), numbered, with two lines around each.",
            ),
        })
        .strict(),
      outputSchema: z.looseObject({ skill: z.string(), path: z.string(), text: z.string() }),
    },
    (args) => {
      try {
        const skill = skillNamed(skills, args.skill);
        const path = args.path ?? "SKILL.md";
        // Served by exact match against the skill's own listing: no path the caller builds is read.
        const file = skill.files.find((each) => each.path === `${skill.dir}/${path}`);
        if (file === undefined) {
          throw new UsageError(
            `${skill.name} has no file '${path}': it has ` +
              skill.files.map((each) => each.path.slice(skill.dir.length + 1)).join(", "),
          );
        }
        if (args.section !== undefined && args.query !== undefined) {
          throw new UsageError("give section or query, not both");
        }
        const whole = readFileSync(join(root, file.path), "utf8");
        let text = whole;
        if (args.section !== undefined) {
          const found = sectionOf(whole, args.section);
          if (found === undefined) {
            const headings = whole
              .split("\n")
              .filter((line) => /^#{1,3}\s/.test(line))
              .map((line) => line.replace(/^#+\s*/, ""));
            throw new UsageError(
              `${path} has no heading holding '${args.section}': its headings are ` +
                headings.join("; "),
            );
          }
          text = found;
        } else if (args.query !== undefined) {
          text = linesMatching(whole, args.query);
          if (text === "") throw new UsageError(`${path} holds no '${args.query}'`);
        }

        return json({
          skill: skill.name,
          path,
          uri: file.uri,
          mimeType: file.mimeType,
          bytes: whole.length,
          ...(args.section === undefined ? {} : { section: args.section }),
          ...(args.query === undefined ? {} : { query: args.query }),
          text,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "sauce_dev",
    {
      title: "Get the SDK documents for a TypeScript or tooling task",
      description:
        "For application code that uses the @eco-incorp/sauce SDK from TypeScript, and for the " +
        "sauce command and this server — not for writing a SauceScript program, whose rules are " +
        "the skills (sauce_skill: sauce-script, sauce-globals, sauce-protocols). Returns the " +
        "package's own documents (guides, API pages, runnable examples, each with its path) for " +
        "a topic or for the topics a free-text question names, with the sauce-typescript skill " +
        "for a TypeScript topic. Topics: " +
        DEV_TOPICS.map((entry) => `${entry.topic} (${entry.about})`).join("; ") +
        ". With no match it lists them.",
      annotations: { title: "Get the SDK documents for a TypeScript or tooling task", ...PURE },
      inputSchema: z
        .object({
          topic: z
            .enum(DEV_TOPICS.map((entry) => entry.topic) as [string, ...string[]])
            .optional()
            .describe("One topic, by name."),
          question: z
            .string()
            .min(1)
            .max(2000)
            .optional()
            .describe("Or the task in words; its topics are found from them."),
        })
        .strict(),
      outputSchema: z.looseObject({
        topics: z.array(z.string()),
        documents: z.array(z.looseObject({ path: z.string(), text: z.string() })),
      }),
    },
    (args) => {
      try {
        const chosen =
          args.topic !== undefined
            ? [args.topic]
            : args.question !== undefined
              ? topicsFor(args.question)
              : [];
        const shipped = docFiles();
        const paths = [
          ...new Set(
            chosen.flatMap((topic) => DEV_TOPICS.find((entry) => entry.topic === topic)!.files),
          ),
        ].filter((path) => shipped.has(path));
        const available = DEV_TOPICS.map((entry) => ({ topic: entry.topic, about: entry.about }));
        // The TypeScript skill comes with a TypeScript topic, never with a miss or the tooling.
        const typescript = chosen.some((topic) => topic !== "cli" && topic !== "mcp");
        const skill = typescript ? skills.find((each) => each.dir === TYPESCRIPT_SKILL) : undefined;

        return json({
          topics: chosen,
          ...(chosen.length === 0
            ? {
                available,
                notes: [
                  "No topic matched: give one of these as topic, or ask with their words. For a " +
                    "SauceScript program, read the skills instead (sauce_skills).",
                ],
              }
            : {}),
          ...(skill === undefined
            ? {}
            : {
                skill: {
                  name: skill.name,
                  uri: skill.uri,
                  text: readFileSync(join(root, skill.dir, "SKILL.md"), "utf8"),
                },
              }),
          documents: paths.map((path) => ({
            path: `docs/${path}`,
            text: readFileSync(join(DOCS, path), "utf8"),
          })),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "sauce_install_skills",
    {
      title: "Set a project up for a coding agent: the skills and this server",
      description:
        "To set up a project for a coding agent, call this. It says how to put this server's " +
        "version of the package, its agent skills and this MCP server in a project for one " +
        "agent, and writes nothing (the server may be remote): the commands to run in the " +
        "project — add the package, install the skills (a no-op where they are installed), " +
        "update them (the upgrade), check them, or init a new project — where that agent reads " +
        "skills from, and the exact MCP configuration `mcp setup` writes for that agent.",
      annotations: {
        title: "Set a project up for a coding agent: the skills and this server",
        ...PURE,
      },
      inputSchema: z
        .object({
          agent: z
            .enum(INSTALL_AGENTS)
            .describe(
              "The coding agent: claude, codex, cursor, copilot, gemini, or agents-md (an index " +
                "in AGENTS.md, for a tool that reads that file and no skills directory).",
            ),
          dir: z
            .string()
            .min(1)
            .max(512)
            .optional()
            .describe("The project directory the commands are for (default: the current one)."),
          config: z
            .string()
            .min(1)
            .max(512)
            .optional()
            .describe(
              "An RPC endpoints file for the server to start with (--config), as the agent " +
                "will find it: it must exist then, holding real URLs, no <…> placeholders.",
            ),
        })
        .strict(),
      outputSchema: z.looseObject({ agent: z.string(), commands: z.looseObject({}) }),
    },
    (args) => {
      try {
        const agent = args.agent;
        // This server's own version, everywhere: the skills it serves describe this package. And
        // viem as installed beside it, which a TypeScript project using the package depends on too.
        const pinned = `${packageName}@${version}`;
        const viem = installedViem();
        const run = `npx -y ${pinned}`;
        const dir = args.dir === undefined ? "" : ` --dir ${JSON.stringify(args.dir)}`;
        const config = args.config === undefined ? "" : ` --config ${JSON.stringify(args.config)}`;
        const reads = skillTargets([agent]).map((target) => target.path.split("\\").join("/"));
        const mcp = (SETUP_AGENTS as readonly string[]).includes(agent)
          ? configSnippet(
              agent as SetupAgent,
              launch({
                packageName,
                version,
                ...(args.config === undefined ? {} : { config: args.config }),
              }),
            )
          : undefined;

        return json({
          agent,
          version,
          skillsFrom: reads,
          commands: {
            add: `npm install --save-exact ${pinned}${viem === undefined ? "" : ` viem@${viem}`}`,
            install: `${run} skills install --agent ${agent}${dir}`,
            update: `${run} skills update --agent ${agent}${dir}`,
            status: `${run} skills status --agent ${agent}${dir}`,
            init: `${run} init${args.dir === undefined ? "" : ` ${JSON.stringify(args.dir)}`} --agent ${agent}`,
            ...(mcp === undefined
              ? {}
              : { mcpSetup: `${run} mcp setup --agent ${agent}${dir}${config}` }),
          },
          ...(mcp === undefined ? {} : { mcp: { path: mcp.path, config: mcp.text } }),
          notes: [
            `Every command is pinned to ${pinned}, the version this server carries.`,
            "add puts the package in an existing project, with viem, which its TypeScript API is " +
              "typed in and the skills' runners import; init scaffolds a new one pinned the same " +
              "way, with its skills installed.",
            `The skills write the command as \`sauce <command>\`, which \`npm i -g ${packageName}\` ` +
              "installs; these commands run this server's version with no install.",
            "install is the first install, and a no-op on a project already installed: update " +
              "brings installed skills to the version that runs it; status exits 1 while they " +
              "are outdated.",
            ...(mcp === undefined
              ? ["agents-md is an index of the skills in AGENTS.md; it names no MCP configuration."]
              : [
                  `mcp is ${mcp.path} exactly as mcpSetup writes it, keeping what else the file ` +
                    "holds.",
                ]),
            ...(args.config === undefined
              ? []
              : [
                  `The server stops at start when ${args.config} is missing, malformed or holds a ` +
                    "<…> placeholder.",
                ]),
          ],
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
