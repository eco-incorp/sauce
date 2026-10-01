#!/usr/bin/env node
/**
 * The package's `sauce-mcp` executable: the Sauce MCP server over stdio (what a coding agent
 * launches), or over Streamable HTTP with `--http <port>`; and `sauce-mcp setup`, which adds it to a
 * project for the agents that read a project-scoped MCP configuration. Its flags are read the way
 * the `sauce` command reads its own (`args.ts#parseFlags`).
 *
 * NODE-ONLY, and reached by nothing browser-facing: it is a `bin`, not an `exports` entry. It reads
 * no environment variable and ships no endpoint: the chains it reads are the `--config` file's,
 * and it never holds or asks for a key — every transaction it builds comes back unsigned.
 */
import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { NO_ENDPOINTS, readEndpoints, type Endpoints } from "./config.js";
import { DEFAULT_MAX_BODY, endpointUrl, isLoopback, serveHttp } from "./http.js";
import {
  describeFlags,
  parseFlags,
  repeatedFlag,
  scrub,
  stringFlag,
  UsageError,
  type FlagSpecs,
} from "./sdk.js";
import { createSauceServer, packageInfo } from "./server.js";
import { parseSetupAgents, SETUP_AGENTS, setupLines, setupProject } from "./setup.js";

const SERVE: FlagSpecs = {
  config: {
    type: "string",
    value: "<file>",
    help: 'RPC endpoints, as sauce reads them: { "rpcUrls": { "<chain id>": "<url>" } }',
  },
  http: {
    type: "string",
    value: "<port>",
    help: "Serve Streamable HTTP on this port (0 picks one), not stdio",
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
    help: "With --http: a Host it answers for besides loopback's (a proxy's name)",
  },
  "max-body": {
    type: "string",
    value: "<bytes>",
    help: `The largest message it reads (default ${DEFAULT_MAX_BODY})`,
  },
  help: { type: "boolean", short: "h", help: "Show this help" },
  version: { type: "boolean", help: "Print the package's name and version" },
};

const SETUP: FlagSpecs = {
  agent: {
    type: "string",
    multiple: true,
    value: "<agent>",
    help: `${SETUP_AGENTS.join(", ")} or all (default all)`,
  },
  dir: { type: "string", value: "<project>", help: "The project (default .)" },
  config: {
    type: "string",
    value: "<file>",
    help: "Have the agents start the server with --config <file>",
  },
  force: { type: "boolean", help: 'Replace a "sauce" entry that differs from this one' },
  help: { type: "boolean", short: "h", help: "Show this help" },
};

const HELP = [
  "sauce-mcp: the Sauce MCP server. It compiles SauceScript and builds unsigned transactions;",
  "nothing it does signs, and it never asks for a key.",
  "",
  "Usage:",
  "  sauce-mcp [--config <file>]                Serve over stdio: what a coding agent launches",
  "  sauce-mcp --http <port> [--host <address>] [--allowed-host <name>]… [--config <file>]",
  "                                             Serve Streamable HTTP, stateless, at /mcp",
  "  sauce-mcp setup [--agent <agent>,…] [--dir <project>] [--config <file>] [--force]",
  "                                             Add the server to a project's coding agents",
  "",
  "Options:",
  describeFlags(SERVE),
  "",
  "Without --config the server reads no chain: no simulation and no transaction hashes. Over",
  "HTTP it authenticates no one: bound anywhere but loopback, serve it behind your own",
  "authentication, and name the host it is served as with --allowed-host.",
  "",
  "setup writes .mcp.json (claude), .codex/config.toml (codex), .cursor/mcp.json (cursor),",
  ".vscode/mcp.json (copilot) and .gemini/settings.json (gemini), keeping what else each holds:",
  describeFlags(SETUP),
  "",
].join("\n");

function readConfig(path: string | undefined): Endpoints {
  if (path === undefined) return NO_ENDPOINTS;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new UsageError(`--config ${path}: ${code === "ENOENT" ? "no such file" : "unreadable"}`);
  }

  return readEndpoints(text, path);
}

function wholeNumber(flag: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    throw new UsageError(`--${flag}: '${raw}' is not a whole number from ${min} to ${max}`);
  }

  return Number(raw);
}

async function serve(argv: readonly string[]): Promise<void> {
  const args = parseFlags(argv, SERVE);
  if (args.values.help === true) {
    process.stdout.write(HELP);

    return;
  }
  if (args.values.version === true) {
    const { name, version } = packageInfo();
    process.stdout.write(`${name} ${version}\n`);

    return;
  }
  if (args.positionals.length > 0) {
    throw new UsageError(`unexpected argument ${args.positionals[0]}`);
  }
  const endpoints = readConfig(stringFlag(args, "config"));
  const server = () => createSauceServer({ endpoints });
  const maxBodyFlag = stringFlag(args, "max-body");
  const maxBody =
    maxBodyFlag === undefined
      ? DEFAULT_MAX_BODY
      : wholeNumber("max-body", maxBodyFlag, 1, 64 * 1024 * 1024);
  const port = stringFlag(args, "http");
  const host = stringFlag(args, "host");
  const allowedHosts = repeatedFlag(args, "allowed-host");
  if (port === undefined) {
    if (host !== undefined) throw new UsageError("--host goes with --http");
    if (allowedHosts.length > 0) throw new UsageError("--allowed-host goes with --http");
    // A message past the bound closes the connection: the stdio transport's own refusal.
    await server().connect(
      new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: maxBody }),
    );

    return;
  }
  const bind = host ?? "127.0.0.1";
  const http = await serveHttp({
    port: wholeNumber("http", port, 0, 65_535),
    host: bind,
    allowedHosts,
    maxBody,
    server,
  });
  process.stderr.write(
    `sauce-mcp: Streamable HTTP at ${endpointUrl(http, bind)} (stateless, no authentication)\n`,
  );
  if (!isLoopback(bind)) {
    process.stderr.write(
      "sauce-mcp: bound beyond loopback, and it authenticates no one: serve it behind your own " +
        "authentication" +
        (allowedHosts.length === 0
          ? ", and name the host it is served as with --allowed-host, or it answers any Host.\n"
          : ".\n"),
    );
  }
  const stop = () => http.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function setup(argv: readonly string[]): void {
  const args = parseFlags(argv, SETUP);
  if (args.values.help === true) {
    process.stdout.write(HELP);

    return;
  }
  if (args.positionals.length > 0) {
    throw new UsageError(`unexpected argument ${args.positionals[0]}`);
  }
  const project = stringFlag(args, "dir") ?? ".";
  const config = stringFlag(args, "config");
  const { name, version } = packageInfo();
  const files = setupProject({
    project,
    agents: parseSetupAgents(repeatedFlag(args, "agent")),
    ...(config === undefined ? {} : { config }),
    force: args.values.force === true,
    packageName: name,
    version,
  });
  process.stdout.write(
    [`The ${name} MCP server, in ${project}:`, ...setupLines(files), ""].join("\n"),
  );
}

/** Runs `sauce-mcp <argv…>`; resolves to the exit code once it has done what it was asked, which
 *  for a server is once it is serving. 2 is a usage error, 1 any other failure. */
async function main(argv: readonly string[]): Promise<number> {
  try {
    if (argv[0] === "setup") setup(argv.slice(1));
    else await serve(argv);

    return 0;
  } catch (error) {
    const message = scrub(error instanceof Error ? error.message : String(error));
    const usage = error instanceof UsageError;
    process.stderr.write(
      `sauce-mcp: ${message}\n${usage ? "Run `sauce-mcp --help` for usage.\n" : ""}`,
    );

    return usage ? 2 : 1;
  }
}

const code = await main(process.argv.slice(2));
if (code !== 0) process.exitCode = code;
