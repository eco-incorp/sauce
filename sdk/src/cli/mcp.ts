/**
 * `sauce mcp`: the Sauce MCP server — this command's read-only half as MCP tools, and the agent
 * skills as resources — over stdio for an agent to launch, or over Streamable HTTP to self-host:
 *
 *     npx -y @eco-incorp/sauce mcp
 *     npx -y @eco-incorp/sauce mcp --http 3000 --config sauce.config.json
 *
 * The server is the `mcp/` workspace, built to `mcp/dist` beside `sdk/dist` in the package. It is
 * LOADED HERE ONLY WHEN THIS COMMAND RUNS, by a dynamic import of that build, so no other command
 * pays for the MCP SDK; and it is reached through the interface below, which the workspace's own
 * entry module is checked against when it compiles (`mcp/src/entry.ts`), so neither side can drift.
 *
 * Like every command here it reads no environment: the chains it reads are `--config`'s, and it
 * holds no key — every transaction it builds comes back unsigned.
 */
import {
  CliError,
  repeatedFlag,
  stringFlag,
  UsageError,
  type FlagSpecs,
  type ParsedArgs,
} from "./args.js";
import type { CommandOutput } from "./commands.js";

/** How `sauce mcp` serves, as given on the command line; the server checks each value. */
export interface McpServeOptions {
  /** `--config`: the RPC endpoints file. */
  readonly config?: string;
  /** `--http <port>`: Streamable HTTP on this port instead of stdio. */
  readonly http?: string;
  readonly host?: string;
  readonly allowedHosts: readonly string[];
  readonly maxBody?: string;
  /** `--allow-private-rpc`: a caller's rpcUrl may be http: or a private address (never link-local
   *  or a metadata service). Over HTTP only: over stdio a caller's endpoint is not guarded. */
  readonly allowPrivateRpc: boolean;
  /** Where the server says what it is doing: stderr, never stdout, which stdio's protocol owns. */
  readonly log: (text: string) => void;
}

/** `sauce mcp setup`, as given. */
export interface McpSetupOptions {
  readonly agents: readonly string[];
  readonly dir?: string;
  readonly config?: string;
  readonly force: boolean;
}

/** What `mcp/dist/entry.js` exports as `mcpEntry`. */
export interface McpEntry {
  /** Starts serving; resolves once it is (the process then lives as long as the transport). */
  readonly serve: (options: McpServeOptions) => Promise<void>;
  /** Writes each agent's project configuration; returns the lines that report it. */
  readonly setup: (options: McpSetupOptions) => readonly string[];
}

export const MCP_FLAGS: FlagSpecs = {
  config: {
    type: "string",
    value: "<file>",
    help: 'RPC endpoints: { "rpcUrls": { "<chain id>": "<url>" } }. Without one, no chain is read',
  },
  http: {
    type: "string",
    value: "<port>",
    help: "Serve Streamable HTTP on this port (0 picks one), instead of stdio",
  },
  host: {
    type: "string",
    value: "<address>",
    help: "With --http: the interface to bind (default 127.0.0.1)",
  },
  "allowed-host": {
    type: "string",
    multiple: true,
    value: "<name>",
    help: "With --http: a Host it answers besides loopback's; required off loopback ('*': any)",
  },
  "max-body": {
    type: "string",
    value: "<bytes>",
    help: "The largest message it reads, over either transport (default 2 MiB)",
  },
  "allow-private-rpc": {
    type: "boolean",
    help: "With --http: let a caller's rpcUrl be http: or a private address (a private deployment)",
  },
  agent: {
    type: "string",
    multiple: true,
    value: "<agent>",
    help: "setup: claude, codex, cursor, copilot, gemini or all (default all)",
  },
  dir: { type: "string", value: "<project>", help: "setup: the project (default .)" },
  force: { type: "boolean", help: 'setup: replace a "sauce" entry that differs' },
};

/** The server, from the package's build of `mcp/`. */
async function loadMcp(): Promise<McpEntry> {
  // A specifier TypeScript does not follow, so the SDK builds without the workspace built after it.
  const entry = new URL("../../../mcp/dist/entry.js", import.meta.url).href;
  let module: { mcpEntry?: McpEntry };
  try {
    module = (await import(entry)) as { mcpEntry?: McpEntry };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND") {
      throw new CliError(
        "the MCP server is not built here (mcp/dist is missing): `pnpm --filter './mcp' build`",
      );
    }
    throw error;
  }
  if (module.mcpEntry === undefined) throw new CliError("mcp/dist/entry.js exports no mcpEntry");

  return module.mcpEntry;
}

const SERVE_ONLY = ["http", "host", "allowed-host", "max-body", "allow-private-rpc"] as const;
const SETUP_ONLY = ["agent", "dir", "force"] as const;

/** `sauce mcp [setup]`. Prints nothing on stdout while it serves: stdio's protocol owns it. */
export async function mcpCommand(
  args: ParsedArgs,
  io: { readonly stderr: (text: string) => void },
): Promise<CommandOutput | undefined> {
  const [sub, ...rest] = args.positionals;
  if (rest.length > 0 || (sub !== undefined && sub !== "setup")) {
    throw new UsageError(`unexpected argument ${sub === "setup" ? rest[0] : sub}`);
  }
  const given = (flags: readonly string[]) => flags.find((flag) => args.values[flag] !== undefined);
  const config = stringFlag(args, "config");
  if (sub === "setup") {
    const serving = given(SERVE_ONLY);
    if (serving !== undefined) throw new UsageError(`--${serving} is for serving, not setup`);
    const dir = stringFlag(args, "dir");
    const lines = (await loadMcp()).setup({
      agents: repeatedFlag(args, "agent"),
      ...(dir === undefined ? {} : { dir }),
      ...(config === undefined ? {} : { config }),
      force: args.values.force === true,
    });

    return { text: lines.join("\n"), json: {} };
  }
  const setting = given(SETUP_ONLY);
  if (setting !== undefined) throw new UsageError(`--${setting} goes with sauce mcp setup`);
  const http = stringFlag(args, "http");
  const host = stringFlag(args, "host");
  const maxBody = stringFlag(args, "max-body");
  await (
    await loadMcp()
  ).serve({
    ...(config === undefined ? {} : { config }),
    ...(http === undefined ? {} : { http }),
    ...(host === undefined ? {} : { host }),
    allowedHosts: repeatedFlag(args, "allowed-host"),
    ...(maxBody === undefined ? {} : { maxBody }),
    allowPrivateRpc: args.values["allow-private-rpc"] === true,
    log: io.stderr,
  });

  return undefined;
}
