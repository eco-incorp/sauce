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
 * built-in public endpoints the command hands it. Over stdio it serves the wallet tools by default,
 * on the CLI's own wallet directory, one of its stores (`--wallets <dir>` names another,
 * `--no-wallets` serves none):
 * listing them needs no password, and signing needs the wallets ENABLED — by a password source
 * given here (as `sauce wallet` takes one, never a prompt: stdin is the protocol's), read once
 * before the server starts, or else by the agent's `sauce_wallet_enable`, which names a source
 * (never the password) that this command reads for it (`McpWallets.read`), so the environment is
 * still read in one place only. No password reaches a tool's input or result. Over HTTP it holds no
 * key and serves no wallet tool: every transaction it builds comes back unsigned.
 *
 * Over stdio it is the command for an agent that has no shell, so it keeps the command's stores
 * ({@link McpStores}) as the command does, in the same directories, BY DEFAULT: every Pot a tool's
 * transaction deploys is recorded where `sauce pot list` reads it. `--pots <dir>` names another
 * directory, and `--no-stores` keeps none. Over HTTP it keeps nothing.
 *
 * It prints no update notice — over stdio its stdout is the protocol — but notes a newer version in
 * the first tool result of its life instead, and `sauce_skills` returns it as `latest`, from the
 * same cache the command's notice reads (`update-check.ts`), refreshed the same way;
 * `--no-update-check` or the config's `"updateCheck": false` turns both off.
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
import { MCP_EXTRA, provide, useRuntime } from "./optional.js";
import {
  describeSource,
  passwordSource,
  readPassword,
  type PasswordIo,
  type PasswordSource,
} from "./password.js";
import type { PublicEndpoints } from "./public-endpoints.js";
import { updateCheckOff, updateNote, type UpdateCheck } from "./update-check.js";
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
  /** Over stdio, unless `--no-stores`: the command's stores the server keeps. Never over HTTP. */
  readonly stores?: McpStores;
  /**
   * The update check's note on a newer version, or `undefined`, from its cache as it is when asked
   * (`update-check.ts`). The server asks once, for the first tool result of its life. Absent with
   * `--no-update-check`, the config's `"updateCheck": false`, or in a test.
   */
  readonly updateNote?: () => string | undefined;
  /** The newer version the update check's cache names, or `undefined`, as it is when asked:
   *  `sauce_skills` returns it as `latest`. Absent when `updateNote` is. */
  readonly newerVersion?: () => string | undefined;
}

/**
 * The `sauce` command's stores a LOCAL server keeps, as the command keeps them, each in the
 * directory the command keeps it in (`--pots`, `--wallets` for another): the server's caller is the
 * user of this machine, and an agent that reaches Sauce only through it keeps what the command
 * would. On by default over stdio; `--no-stores` keeps none. One absent is not kept.
 */
export interface McpStores {
  /** The Pot store (`pot-store.ts`): every Pot a tool's transaction deploys is recorded there, and
   *  `sauce_pot_list` and `sauce_pot_import` read and write it. */
  readonly pots?: string;
  /** The wallet directory (`wallets.ts`), which the wallet tools serve; `--no-wallets` alone keeps
   *  the other stores. */
  readonly wallets?: McpWallets;
  /**
   * The stores whose directory the operator named (`--pots`, `--wallets <dir>`). A start says
   * where it keeps those, and nothing of a store kept by default: a client logs every line a start
   * writes, and the server's instructions say where it keeps them.
   */
  readonly named?: ReadonlyArray<"pots" | "wallets">;
}

/** The wallet directory the stdio server serves, and what enables its wallets to sign. */
export interface McpWallets {
  /** `--wallets <dir>`, else the CLI's own, `~/.sauce/wallets`. */
  readonly dir: string;
  /** Whether `--wallets <dir>` named it: then it is the operator's, and stays. */
  readonly dirNamed: boolean;
  /**
   * The password source the server was started with, read once, before anything is served: the
   * wallets are enabled from the start. Absent without one: `sauce_wallet_enable` enables them.
   */
  readonly start?: {
    /** A registered secret. */
    readonly password: string;
    /** That source, as the instructions name it: `--password-env SAUCE_WALLET_PASSWORD`. */
    readonly source: string;
  };
  /**
   * Reads the password a source `sauce_wallet_enable` names gives (never a command: that is the
   * operator's alone), its messages naming it by the tool's inputs; registered as a secret.
   */
  readonly read: (source: PasswordSource) => Promise<string>;
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
    help: "Over stdio: the wallet directory its wallet tools serve (default ~/.sauce/wallets)",
  },
  "no-wallets": { type: "boolean", help: "Over stdio: serve no wallet tools; nothing signs" },
  ...PASSWORD,
  pots: {
    type: "string",
    value: "<dir>",
    help: "Over stdio: keep the Pot store here (default ~/.sauce/pots, as sauce pot list reads)",
  },
  "no-stores": {
    type: "boolean",
    help: "Over stdio: keep none of the command's stores (by default it keeps them, as sauce does)",
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
  "no-wallets",
  "password-env",
  "password-file",
  "password-command",
  "pots",
  "no-stores",
] as const;
const PASSWORDS = ["password-env", "password-file", "password-command"] as const;
const SETUP_ONLY = ["agent", "dir", "force"] as const;

/** `sauce mcp [setup]`. Prints nothing on stdout while it serves: stdio's protocol owns it. */
export async function mcpCommand(
  args: ParsedArgs,
  io: {
    readonly stderr: (text: string) => void;
    readonly publicRpcs?: PublicEndpoints | undefined;
    readonly updateCheck?: UpdateCheck | undefined;
    /** The command's own Pot store (`CliIo.potsDir`): the executable's `~/.sauce/pots`. */
    readonly potsDir?: string | undefined;
    /** The command's own wallet directory, where a test names one (`CliIo.walletsDir`). */
    readonly walletsDir?: string | undefined;
  } & PasswordIo,
): Promise<CommandOutput | undefined> {
  const [sub, ...rest] = args.positionals;
  if (rest.length > 0 || (sub !== undefined && sub !== "setup")) {
    throw new UsageError(`unexpected argument ${sub === "setup" ? rest[0] : sub}`);
  }
  const given = (flags: readonly string[]) => flags.find((flag) => args.values[flag] !== undefined);
  const config = stringFlag(args, "config");
  const offline = args.values.offline === true;
  // The whole process installs nothing: a tool's Solana rehearsal later refuses as the start does.
  if (offline) useRuntime({ offline: true });
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
  const stores = await storesOf(args, io, http !== undefined);
  const check = updateCheckOff(args.values, io.readText) ? undefined : io.updateCheck;
  // Asked now as well, so a cache a day old is refreshed before the first tool call reads it.
  check?.latest();
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
    ...(stores === undefined ? {} : { stores }),
    ...(check === undefined
      ? {}
      : {
          updateNote: () => {
            const latest = check.latest();

            return latest === undefined ? undefined : updateNote(check.version, latest);
          },
          newerVersion: () => check.latest(),
        }),
  });

  return undefined;
}

/**
 * The wallets the stdio server serves — unless `--no-wallets` or `--no-stores` — and, given a
 * password source, the password that enables them, read now, before anything is served, so a
 * source that does not work stops the server at start. Over HTTP there are no wallets: the HTTP
 * server never signs.
 */
async function walletsOf(
  args: ParsedArgs,
  io: PasswordIo & { readonly walletsDir?: string | undefined },
  http: boolean,
): Promise<McpWallets | undefined> {
  const dir = stringFlag(args, "wallets");
  const given = PASSWORDS.find((flag) => args.values[flag] !== undefined);
  const named = dir !== undefined ? "--wallets" : given === undefined ? undefined : `--${given}`;
  const off = (["no-wallets", "no-stores"] as const).find((flag) => args.values[flag] === true);
  if (off !== undefined) {
    if (named !== undefined) throw new UsageError(`${named} goes with wallets, not --${off}`);

    return undefined;
  }
  if (http) {
    if (named !== undefined) {
      throw new UsageError(
        `${named} is for stdio: the HTTP server never signs, and serves no wallet tools`,
      );
    }

    return undefined;
  }
  const source = passwordSource({
    env: stringFlag(args, "password-env"),
    file: stringFlag(args, "password-file"),
    command: stringFlag(args, "password-command"),
  });
  // No source given: the wallets are listed, and the agent enables them with sauce_wallet_enable.
  // Never the prompt: over stdio there is no terminal to ask on (stdin carries the protocol).
  const start =
    source.from === "prompt"
      ? undefined
      : {
          password: await readPassword(source, io, { what: "the wallets" }),
          source: describeSource(source),
        };

  // A bare --wallets, as the server once had to be started with, is the default directory.
  return {
    dir: dir || io.walletsDir || defaultWalletsDir(),
    dirNamed: dir !== undefined && dir !== "",
    ...(start === undefined ? {} : { start }),
    read: async (chosen) => {
      if (chosen.from === "command" || chosen.from === "prompt") {
        throw new UsageError("a password command is the operator's: --password-command at start");
      }

      return readPassword(chosen, io, { what: "the wallets", creating: true, by: "tool" });
    },
  };
}

/**
 * The command's stores the server keeps: over stdio, each where the command keeps it unless
 * `--pots` or `--wallets` says otherwise, or none with `--no-stores` (`--no-wallets` leaves out the
 * wallets alone); over HTTP, none.
 */
async function storesOf(
  args: ParsedArgs,
  io: PasswordIo & {
    readonly potsDir?: string | undefined;
    readonly walletsDir?: string | undefined;
  },
  http: boolean,
): Promise<McpStores | undefined> {
  const pots = stringFlag(args, "pots");
  const none = args.values["no-stores"] === true;
  const given = pots !== undefined ? "pots" : undefined;
  if (http) {
    if (given !== undefined || none) {
      throw new UsageError(`--${given ?? "no-stores"} is for stdio: the HTTP server keeps nothing`);
    }
    // Refuses a wallet flag: the HTTP server never signs.
    await walletsOf(args, io, http);

    return undefined;
  }
  if (none && given !== undefined) {
    throw new UsageError(`give --${given} or --no-stores, not both`);
  }
  const wallets = await walletsOf(args, io, http);
  if (none) return undefined;
  const dir = pots ?? io.potsDir;
  const named = [
    ...(pots === undefined ? [] : (["pots"] as const)),
    ...(wallets?.dirNamed === true ? (["wallets"] as const) : []),
  ];

  return {
    ...(dir === undefined ? {} : { pots: dir }),
    ...(wallets === undefined ? {} : { wallets }),
    ...(named.length === 0 ? {} : { named }),
  };
}
