/**
 * `sauce mcp setup`: this server added to a project for the coding agents that read a
 * project-scoped MCP configuration, each in the file and shape its vendor documents:
 *
 * - `claude`: `.mcp.json`, `mcpServers` (code.claude.com/docs/en/mcp, project scope).
 * - `codex`: `.codex/config.toml`, `[mcp_servers.<name>]` — read only in a project Codex trusts
 *   (learn.chatgpt.com/docs/extend/mcp, config reference).
 * - `cursor`: `.cursor/mcp.json`, `mcpServers` (cursor.com/docs/mcp).
 * - `copilot`: `.vscode/mcp.json`, `servers`, for VS Code's agent mode
 *   (code.visualstudio.com/docs/agent-customization/mcp-servers).
 * - `gemini`: `.gemini/settings.json`, `mcpServers` (geminicli.com/docs/tools/mcp-server).
 *
 * Every entry launches the same thing: `npx -y <this package>@<this version> mcp`, the package's
 * `sauce mcp`, pinned to the version that wrote it, as `sauce init` pins the package. It never overwrites: an existing
 * `sauce` entry that differs is left alone and reported, unless `force`. The rest of each file is
 * kept, and a file that is not plain JSON (a comment in it, say) is refused rather than rewritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { UsageError } from "./sdk.js";

export const SETUP_AGENTS = ["claude", "codex", "cursor", "copilot", "gemini"] as const;
export type SetupAgent = (typeof SETUP_AGENTS)[number];

/** The name the server goes by in every agent's configuration. */
export const SERVER_NAME = "sauce";

export interface SetupInput {
  readonly project: string;
  readonly agents: readonly SetupAgent[];
  /** `--config` to pass the server: the RPC endpoints file, as the agent will launch it. */
  readonly config?: string;
  readonly force: boolean;
  readonly packageName: string;
  readonly version: string;
}

/** What setup did to one file. */
export interface SetupFile {
  readonly path: string;
  readonly agents: readonly SetupAgent[];
  readonly state: "wrote" | "added" | "unchanged" | "kept" | "overwrote";
}

/** The command an agent runs: the package's `sauce mcp` through npx, at `version` when given
 *  (else the project's own install, or the latest). */
export function launch(
  input: Pick<SetupInput, "config" | "packageName"> & { readonly version?: string },
): {
  readonly command: string;
  readonly args: readonly string[];
} {
  return {
    command: "npx",
    args: [
      "-y",
      input.version === undefined ? input.packageName : `${input.packageName}@${input.version}`,
      "mcp",
      ...(input.config === undefined ? [] : ["--config", input.config]),
    ],
  };
}

/** `--agent`: names, comma-separated or repeated; `all` (the default) is every agent. */
export function parseSetupAgents(raws: readonly string[]): SetupAgent[] {
  if (raws.length === 0) return [...SETUP_AGENTS];
  const names = raws.flatMap((raw) => raw.split(",")).map((name) => name.trim());
  for (const name of names) {
    if (name !== "all" && !(SETUP_AGENTS as readonly string[]).includes(name)) {
      throw new UsageError(`--agent: '${name}' is not one of ${SETUP_AGENTS.join(", ")}, all`);
    }
  }

  return [
    ...new Set(names.flatMap((name) => (name === "all" ? SETUP_AGENTS : [name as SetupAgent]))),
  ];
}

interface JsonTarget {
  readonly kind: "json";
  readonly path: string;
  /** The key the servers are under. */
  readonly key: "mcpServers" | "servers";
  readonly entry: (launched: ReturnType<typeof launch>) => Record<string, unknown>;
}

interface TomlTarget {
  readonly kind: "toml";
  readonly path: string;
}

const stdio = (launched: ReturnType<typeof launch>) => ({
  type: "stdio",
  command: launched.command,
  args: launched.args,
});

const TARGETS: Readonly<Record<SetupAgent, JsonTarget | TomlTarget>> = {
  claude: { kind: "json", path: ".mcp.json", key: "mcpServers", entry: stdio },
  codex: { kind: "toml", path: join(".codex", "config.toml") },
  cursor: { kind: "json", path: join(".cursor", "mcp.json"), key: "mcpServers", entry: stdio },
  copilot: { kind: "json", path: join(".vscode", "mcp.json"), key: "servers", entry: stdio },
  // Gemini CLI documents no `type`: a `command` is what makes a server stdio.
  gemini: {
    kind: "json",
    path: join(".gemini", "settings.json"),
    key: "mcpServers",
    entry: (launched) => ({ command: launched.command, args: launched.args }),
  },
};

/** `agent`'s project configuration for the server, as the text `setup` would add: the file,
 *  and the JSON document or TOML table that names it. */
export function configSnippet(
  agent: SetupAgent,
  launched: ReturnType<typeof launch>,
): { readonly path: string; readonly text: string } {
  const target = TARGETS[agent];
  if (target.kind === "toml") {
    const quoted = (text: string) => JSON.stringify(text);

    return {
      path: target.path.split("\\").join("/"),
      text: [
        `[mcp_servers.${SERVER_NAME}]`,
        `command = ${quoted(launched.command)}`,
        `args = [${launched.args.map(quoted).join(", ")}]`,
        "",
      ].join("\n"),
    };
  }

  return {
    path: target.path.split("\\").join("/"),
    text: `${JSON.stringify({ [target.key]: { [SERVER_NAME]: target.entry(launched) } }, null, 2)}\n`,
  };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function writeJson(project: string, target: JsonTarget, input: SetupInput): SetupFile["state"] {
  const file = join(project, target.path);
  const entry = target.entry(launch(input));
  let document: Record<string, unknown> = {};
  const existed = existsSync(file);
  if (existed) {
    try {
      document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      throw new UsageError(
        `${target.path} is not plain JSON (a comment in it, perhaps), so setup leaves it alone: ` +
          `add "${SERVER_NAME}": ${JSON.stringify(entry)} under "${target.key}" yourself`,
      );
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      throw new UsageError(`${target.path} is not a JSON object, so setup leaves it alone`);
    }
  }
  const servers = (document[target.key] ?? {}) as Record<string, unknown>;
  if (typeof servers !== "object" || servers === null || Array.isArray(servers)) {
    throw new UsageError(`${target.path}: "${target.key}" is not an object`);
  }
  const current = servers[SERVER_NAME];
  if (current !== undefined && sameJson(current, entry)) return "unchanged";
  if (current !== undefined && !input.force) return "kept";
  document = { ...document, [target.key]: { ...servers, [SERVER_NAME]: entry } };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);

  return current !== undefined ? "overwrote" : existed ? "added" : "wrote";
}

/** The `[mcp_servers.sauce]` table, as TOML. */
const tomlBlock = (input: SetupInput): string => configSnippet("codex", launch(input)).text;

const TABLE = new RegExp(`^\\[mcp_servers\\.${SERVER_NAME}\\]\\s*$`, "m");
/** The same server written another way TOML allows — a quoted or spaced header, a comment after
 *  it, a dotted key or an inline table — which setup does not rewrite: appending its own table
 *  beside one of these would define the server twice, and Codex would refuse the whole file. */
const OTHER_SPELLING = new RegExp(
  `^\\s*(?:\\[\\s*mcp_servers\\s*\\.\\s*["']?${SERVER_NAME}["']?\\s*[\\].]|` +
    `(?:mcp_servers\\s*\\.\\s*)?["']?${SERVER_NAME}["']?\\s*[.=])`,
  "m",
);

function writeToml(project: string, target: TomlTarget, input: SetupInput): SetupFile["state"] {
  const file = join(project, target.path);
  const block = tomlBlock(input);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, block);

    return "wrote";
  }
  const text = readFileSync(file, "utf8");
  const at = TABLE.exec(text);
  if (at === null && OTHER_SPELLING.test(text)) return "kept";
  if (at === null) {
    writeFileSync(
      file,
      `${text}${text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"}${block}`,
    );

    return "added";
  }
  // The table runs to the next table header, or the end.
  const rest = text.slice(at.index + at[0].length);
  const next = /^\[/m.exec(rest);
  const end = next === null ? text.length : at.index + at[0].length + next.index;
  const existing = text.slice(at.index, end);
  if (existing.replace(/\r\n/g, "\n").trimEnd() === block.trimEnd()) return "unchanged";
  if (!input.force) return "kept";
  writeFileSync(
    file,
    `${text.slice(0, at.index)}${block}${next === null ? "" : "\n"}${text.slice(end)}`,
  );

  return "overwrote";
}

/** Adds the server to each agent's project configuration. */
export function setupProject(input: SetupInput): SetupFile[] {
  const done = new Map<string, SetupFile>();
  for (const agent of input.agents) {
    const target = TARGETS[agent];
    const seen = done.get(target.path);
    if (seen !== undefined) {
      done.set(target.path, { ...seen, agents: [...seen.agents, agent] });
      continue;
    }
    const state =
      target.kind === "json"
        ? writeJson(input.project, target, input)
        : writeToml(input.project, target, input);
    done.set(target.path, { path: target.path, agents: [agent], state });
  }

  return [...done.values()];
}

/** What setup reports, a line per file. */
export function setupLines(files: readonly SetupFile[]): string[] {
  const width = Math.max(...files.map((file) => file.path.length));

  return [
    ...files.map(
      (file) =>
        `  ${file.state.padEnd(9)} ${file.path.padEnd(width)}  (${file.agents.join(", ")})` +
        (file.state === "kept"
          ? `: it already names a "${SERVER_NAME}" server, which differs; edit it, or --force ` +
            "replaces a JSON entry or a [mcp_servers.sauce] table"
          : ""),
    ),
    ...(files.some((file) => file.path.startsWith(".codex"))
      ? ["Codex reads .codex/config.toml only in a project it trusts."]
      : []),
  ];
}
