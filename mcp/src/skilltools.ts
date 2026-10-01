/**
 * The agent skills as TOOLS, for a client that calls tools but never reads resources: the list of
 * skills, one skill's file, the SDK's own documents for TypeScript work, and how to install the
 * skills where an agent reads them. Each serves only files the package ships — a skill's files as
 * `resources.ts` lists them, the manual under `docs/` — by name, never by a path the caller builds.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import { shippedSkills, SKILLS_INDEX, type Skill } from "./resources.js";
import { PACKAGED_SKILLS, skillTargets, UsageError } from "./sdk.js";
import { packageInfo } from "./server.js";
import { configSnippet, launch, SETUP_AGENTS, type SetupAgent } from "./setup.js";

/** The package's manual, two levels above this module in `mcp/{src,dist}`. */
const DOCS = fileURLToPath(new URL("../../docs/", import.meta.url));

/** The topics `sauce_dev` serves, each the shipped documents that cover it and the words that
 *  name it in a question. */
export const DEV_TOPICS: ReadonlyArray<{
  readonly topic: string;
  readonly about: string;
  readonly keywords: readonly string[];
  readonly files: readonly string[];
}> = [
  {
    topic: "start",
    about: "install the package and build a first intent from TypeScript",
    keywords: ["start", "install", "quick", "first", "hello", "setup", "begin"],
    files: ["guides/quick-start.md", "examples/first-intent.ts"],
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
      "argument",
      "arguments",
      "define",
      "defines",
      "entry",
      "wasm",
    ],
    files: ["guides/compiling.md", "api/compiler.md", "examples/compile-program.ts"],
  },
  {
    topic: "intents",
    about: "cross-chain intents from TypeScript: routes, rewards, publishing, nesting",
    keywords: [
      "intent",
      "intents",
      "route",
      "routes",
      "openroute",
      "reward",
      "portal",
      "crosschain",
      "cross",
      "chain",
      "bridge",
      "nest",
      "nested",
      "cascade",
      "publish",
    ],
    files: [
      "guides/intents.md",
      "guides/nested-intents.md",
      "api/routes.md",
      "examples/cross-chain-intent.ts",
      "examples/cross-chain-intent.sauce.ts",
    ],
  },
  {
    topic: "protocols",
    about: "tokens and protocols by name, the registries, and what is covered",
    keywords: [
      "protocol",
      "protocols",
      "token",
      "tokens",
      "namespace",
      "registry",
      "uniswap",
      "aave",
      "coverage",
      "approval",
      "approve",
    ],
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
    keywords: ["execute", "execution", "cook", "pot", "kitchen", "engine", "evm", "run", "deploy"],
    files: ["examples/evm-execution.ts", "concepts/architecture.md"],
  },
  {
    topic: "solana",
    about: "Solana from TypeScript: the SVM client, accounts, the Kitchen, staging",
    keywords: ["solana", "svm", "spl", "account", "accounts", "manifest", "lamports", "staging"],
    files: ["guides/solana.md"],
  },
  {
    topic: "verification",
    about: "checking a settle program and a settlement",
    keywords: ["verify", "verification", "settle", "settlement", "audit", "validate"],
    files: ["guides/verification.md"],
  },
  {
    topic: "api",
    about: "every published import and what it holds, deployments included",
    keywords: [
      "api",
      "export",
      "exports",
      "import",
      "imports",
      "subpath",
      "deployments",
      "address",
    ],
    files: ["api/README.md"],
  },
  {
    topic: "language",
    about: "SauceScript itself: what runs on chain and what the compiler accepts",
    keywords: ["saucescript", "language", "syntax", "builtin", "builtins", "semantics"],
    files: ["concepts/saucescript.md"],
  },
];

/** The skill tools, in the order `tools/list` gives them (after `tools.ts#TOOL_NAMES`). */
export const SKILL_TOOL_NAMES = [
  "sauce_skills",
  "sauce_skill",
  "sauce_dev",
  "sauce_install_skills",
] as const;

/** The skill a TypeScript task starts from, by its directory. */
const TYPESCRIPT_SKILL = "sauce-typescript";

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

/** Where each agent reads skills from, per the `sauce skills` command (the one source). */
const INSTALL_AGENTS = ["claude", "codex", "cursor", "copilot", "gemini", "agents-md"] as const;

export function registerSkillTools(server: McpServer, root: string = PACKAGED_SKILLS): void {
  const skills = shippedSkills(root);
  const { name: packageName, version } = packageInfo();

  server.registerTool(
    "sauce_skills",
    {
      title: "List the Sauce agent skills",
      description:
        "Lists every agent skill this server carries — each skill's name, a description of " +
        "when to use it, and its files — with the package and version they belong to. Start " +
        "here before writing a Sauce program: read sauce-overview first, then the skill the " +
        "task needs, with sauce_skill. (The same files are resources under sauce://skills/.)",
      annotations: { title: "List the Sauce agent skills", ...PURE },
      outputSchema: z.looseObject({
        package: z.string(),
        version: z.string(),
        skills: z.array(z.looseObject({ name: z.string(), description: z.string() })),
      }),
    },
    () =>
      json({
        package: packageName,
        version,
        index: SKILLS_INDEX,
        skills: skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          uri: skill.uri,
          files: skill.files.map((file) => file.path.slice(skill.dir.length + 1)),
        })),
      }),
  );

  server.registerTool(
    "sauce_skill",
    {
      title: "Read a Sauce agent skill",
      description:
        "Returns one skill's SKILL.md — its instructions — or, with `path`, one of the files it " +
        "names under its references/ or examples/ (paths as sauce_skills lists them, such as " +
        "references/builtins.md). Follow a SKILL.md as written; it says which further files to " +
        "read. Only the files the package ships are served.",
      annotations: { title: "Read a Sauce agent skill", ...PURE },
      inputSchema: z
        .object({
          skill: z
            .string()
            .min(1)
            .max(100)
            .describe("The skill's name, as sauce_skills lists it: sauce-overview, sauce-run, …"),
          path: z
            .string()
            .min(1)
            .max(256)
            .optional()
            .describe(
              "A file of that skill, relative to its directory (references/x.md, " +
                "examples/y.sauce.ts). Default: SKILL.md.",
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

        return json({
          skill: skill.name,
          path,
          uri: file.uri,
          mimeType: file.mimeType,
          text: readFileSync(join(root, file.path), "utf8"),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "sauce_dev",
    {
      title: "Get the SDK documents for a TypeScript task",
      description:
        "For writing TypeScript against the @eco-incorp/sauce SDK, rather than a SauceScript " +
        "program: returns the sauce-typescript skill and the package's own documents (guides, " +
        "API pages, runnable examples, each with its path) for a topic, or for the topics a " +
        "free-text question names. Topics: " +
        DEV_TOPICS.map((entry) => `${entry.topic} (${entry.about})`).join("; ") +
        ". With no match it lists them.",
      annotations: { title: "Get the SDK documents for a TypeScript task", ...PURE },
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
        const skill = skills.find((each) => each.dir === TYPESCRIPT_SKILL);
        const available = DEV_TOPICS.map((entry) => ({ topic: entry.topic, about: entry.about }));

        return json({
          topics: chosen,
          ...(chosen.length === 0
            ? {
                available,
                notes: ["No topic matched: give one of these as topic, or ask with their words."],
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
      title: "How to install the Sauce skills for an agent",
      description:
        "Says how to put the latest Sauce agent skills, and this MCP server, in a project for " +
        "one coding agent. Writes nothing (the server may be remote): it returns the commands " +
        "to run in the project — install, update, status, and init for a new project — where " +
        "that agent reads skills from, and that agent's MCP configuration for this server. " +
        "install is a no-op on a project already installed; update is how installed skills are " +
        "upgraded.",
      annotations: { title: "How to install the Sauce skills for an agent", ...PURE },
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
        })
        .strict(),
      outputSchema: z.looseObject({ agent: z.string(), commands: z.looseObject({}) }),
    },
    (args) => {
      try {
        const agent = args.agent;
        const latest = `npx -y ${packageName}@latest`;
        const dir = args.dir === undefined ? "" : ` --dir ${JSON.stringify(args.dir)}`;
        const reads = skillTargets([agent]).map((target) => target.path.split("\\").join("/"));
        const mcp = (SETUP_AGENTS as readonly string[]).includes(agent)
          ? configSnippet(agent as SetupAgent, launch({ packageName }))
          : undefined;

        return json({
          agent,
          skillsFrom: reads,
          commands: {
            install: `${latest} skills install --agent ${agent}${dir}`,
            update: `${latest} skills update --agent ${agent}${dir}`,
            status: `${latest} skills status --agent ${agent}${dir}`,
            init: `${latest} init${args.dir === undefined ? "" : ` ${JSON.stringify(args.dir)}`} --agent ${agent}`,
            ...(mcp === undefined
              ? {}
              : { mcpSetup: `${latest} mcp setup --agent ${agent}${dir}` }),
          },
          ...(mcp === undefined ? {} : { mcp: { path: mcp.path, config: mcp.text } }),
          notes: [
            "install is the first install, and a no-op on a project already installed: update " +
              "brings installed skills to the version that runs it; status exits 1 while they " +
              "are outdated.",
            "init scaffolds a new project pinned to one version, with its skills installed.",
            ...(mcp === undefined
              ? ["agents-md is an index of the skills in AGENTS.md; it names no MCP configuration."]
              : [
                  `mcp is ${mcp.path} as the agent reads it from the project; \`mcp setup\` writes ` +
                    "it, keeping what else the file holds.",
                ]),
          ],
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
