/**
 * `sauce mcp`: the Sauce MCP server — this command's read-only half as MCP tools, and the agent
 * skills as resources — over stdio for an agent to launch, or over Streamable HTTP to self-host:
 *
 *     sauce mcp
 *     sauce mcp --http 3000
 *
 * The server is the `mcp/` workspace, built to `mcp/dist` beside `sdk/dist` in the package. It is
 * LOADED HERE ONLY WHEN THIS COMMAND RUNS, by a dynamic import of that build, so no other command
 * pays for the MCP SDK; and it is reached through the interface below, which the workspace's own
 * entry module is checked against when it compiles (`mcp/src/entry.ts`), so neither side can drift.
 * The MCP SDK and zod are optional peer dependencies of the package: the user's own copies at the
 * versions pinned, else this version's runtime folder, which this command installs on first use
 * (`optional.ts`) — `sauce mcp setup` up front, so an agent's first start of the server does not
 * wait for it.
 *
 * It reads a chain through a caller's `rpcUrl`, else `--config`'s entry for the chain, else the
 * built-in public endpoints the command hands it. Over stdio, `--wallets [dir]` with a password
 * source (as `sauce wallet` takes one, never a prompt: stdin is the protocol's) lets it sign, with
 * the wallets of that directory alone: the password is read here, once, before the server starts,
 * and never reaches a tool's input or result. Without `--wallets`, and always over HTTP, it holds
 * no key and every transaction it builds comes back unsigned.
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
import { MCP_EXTRA, provide } from "./optional.js";
import { describeSource, passwordSource, readPassword, type PasswordIo } from "./password.js";
import type { PublicEndpoints } from "./public-endpoints.js";
import { PASSWORD, WALLETS } from "./wallet-commands.js";
import { defaultWalletsDir } from "./wallets.js";

/** How `sauce mcp` serves, as given on the command line; the server checks each value. */
export interface McpServeOptions {
  /** `--config`: the RPC endpoints file. */
  readonly config?: string;
  /** The built-in public endpoints, started: a chain's when neither the call nor `--config` has one. */
  readonly publicRpcs?: PublicEndpoints;
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
  /** `--wallets`, over stdio only: the wallets its tools create, list and send from. */
  readonly wallets?: McpWallets;
}

/** The wallet directory `sauce mcp --wallets` serves, and the password its wallets open with. */
export interface McpWallets {
  readonly dir: string;
  /** Read once, from the source the server was started with; a registered secret. */
  readonly password: string;
  /** That source, as the instructions name it: `--password-env SAUCE_WALLET_PASSWORD`. */
  readonly source: string;
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
    help: 'Your own RPC endpoints: { "rpcUrls": { "<chain id>": "<url>" } } (default: public ones)',
  },
  offline: {
    type: "boolean",
    help: "Reach no network of its own: no built-in endpoint, and nothing installed",
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
  wallets: {
    ...WALLETS.wallets!,
    help: "Over stdio: sign with the wallets in this directory (default ~/.sauce/wallets)",
  },
  ...PASSWORD,
  agent: {
    type: "string",
    multiple: true,
    value: "<agent>",
    help: "setup: claude, codex, cursor, copilot, gemini or all (default all)",
  },
  dir: { type: "string", value: "<project>", help: "setup: the project (default .)" },
  force: { type: "boolean", help: 'setup: replace a "sauce" entry that differs' },
};

/** The server, from the package's build of `mcp/`, its packages provided first. */
async function loadMcp(offline: boolean, log: (text: string) => void): Promise<McpEntry> {
  await provide(MCP_EXTRA, { offline, log });
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

const SERVE_ONLY = [
  "http",
  "host",
  "allowed-host",
  "max-body",
  "allow-private-rpc",
  "wallets",
  "password-env",
  "password-file",
  "password-command",
] as const;
const PASSWORDS = ["password-env", "password-file", "password-command"] as const;
const SETUP_ONLY = ["agent", "dir", "force"] as const;

/** `sauce mcp [setup]`. Prints nothing on stdout while it serves: stdio's protocol owns it. */
export async function mcpCommand(
  args: ParsedArgs,
  io: {
    readonly stderr: (text: string) => void;
    readonly publicRpcs?: PublicEndpoints | undefined;
  } & PasswordIo,
): Promise<CommandOutput | undefined> {
  const [sub, ...rest] = args.positionals;
  if (rest.length > 0 || (sub !== undefined && sub !== "setup")) {
    throw new UsageError(`unexpected argument ${sub === "setup" ? rest[0] : sub}`);
  }
  const given = (flags: readonly string[]) => flags.find((flag) => args.values[flag] !== undefined);
  const config = stringFlag(args, "config");
  const offline = args.values.offline === true;
  if (sub === "setup") {
    const serving = given(SERVE_ONLY);
    if (serving !== undefined) throw new UsageError(`--${serving} is for serving, not setup`);
    const dir = stringFlag(args, "dir");
    // Setup installs the server's packages now, so an agent's first start of it does not wait.
    const lines = (await loadMcp(offline, io.stderr)).setup({
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
  const wallets = await walletsOf(args, io, http !== undefined);
  await (
    await loadMcp(offline, io.stderr)
  ).serve({
    ...(config === undefined ? {} : { config }),
    ...(io.publicRpcs === undefined || offline ? {} : { publicRpcs: io.publicRpcs }),
    ...(http === undefined ? {} : { http }),
    ...(host === undefined ? {} : { host }),
    allowedHosts: repeatedFlag(args, "allowed-host"),
    ...(maxBody === undefined ? {} : { maxBody }),
    allowPrivateRpc: args.values["allow-private-rpc"] === true,
    log: io.stderr,
    ...(wallets === undefined ? {} : { wallets }),
  });

  return undefined;
}

/**
 * `--wallets` and its password source, the password read now — before anything is served — so a
 * source that does not work stops the server at start. Over HTTP there are no wallets: the HTTP
 * server never signs.
 */
async function walletsOf(
  args: ParsedArgs,
  io: PasswordIo,
  http: boolean,
): Promise<McpWallets | undefined> {
  const dir = stringFlag(args, "wallets");
  const given = PASSWORDS.find((flag) => args.values[flag] !== undefined);
  if (dir === undefined) {
    if (given !== undefined) throw new UsageError(`--${given} goes with --wallets`);

    return undefined;
  }
  if (http) {
    throw new UsageError(
      "--wallets is for stdio: the HTTP server never signs, and serves no wallet tools",
    );
  }
  const source = passwordSource({
    env: stringFlag(args, "password-env"),
    file: stringFlag(args, "password-file"),
    command: stringFlag(args, "password-command"),
  });
  if (source.from === "prompt") {
    throw new UsageError(
      "--wallets needs its password source, --password-env <NAME>, --password-file <path> or " +
        "--password-command <command>: over stdio there is no terminal to ask on (stdin carries " +
        "the protocol)",
    );
  }
  const password = await readPassword(source, io, { what: "the wallets" });

  return { dir: dir || defaultWalletsDir(), password, source: describeSource(source) };
}
