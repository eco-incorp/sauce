/**
 * What `sauce mcp` runs (`sdk/src/cli/mcp.ts` loads this build lazily): the server over stdio or
 * Streamable HTTP, and `setup`. The `sauce` command has already read the flags; the values are
 * checked here. `mcpEntry` is typed by the CLI's own `McpEntry`, so the two cannot drift.
 *
 * NODE-ONLY, and reached by nothing browser-facing. It reads no environment variable and ships no
 * endpoint: the chains it reads are the `--config` file's, and it never holds or asks for a key —
 * every transaction it builds comes back unsigned.
 */
import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { NO_ENDPOINTS, readEndpoints, type Endpoints } from "./config.js";
import { DEFAULT_MAX_BODY, endpointUrl, isLoopback, serveHttp } from "./http.js";
import { UsageError, type McpEntry, type McpServeOptions, type McpSetupOptions } from "./sdk.js";
import { createSauceServer, packageInfo } from "./server.js";
import { parseSetupAgents, setupLines, setupProject } from "./setup.js";

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

async function serve(options: McpServeOptions): Promise<void> {
  const endpoints = readConfig(options.config);
  const server = () => createSauceServer({ endpoints });
  const maxBody =
    options.maxBody === undefined
      ? DEFAULT_MAX_BODY
      : wholeNumber("max-body", options.maxBody, 1, 64 * 1024 * 1024);
  if (options.http === undefined) {
    if (options.host !== undefined) throw new UsageError("--host goes with --http");
    if (options.allowedHosts.length > 0) throw new UsageError("--allowed-host goes with --http");
    // A message past the bound closes the connection: the stdio transport's own refusal.
    await server().connect(
      new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: maxBody }),
    );

    return;
  }
  const port = wholeNumber("http", options.http, 0, 65_535);
  const host = options.host ?? "127.0.0.1";
  // Off loopback the Host check is what stands between a browser and the server, so the name it
  // is served as has to be given: `*` only by an operator whose proxy checks Host itself.
  if (!isLoopback(host) && options.allowedHosts.length === 0) {
    throw new UsageError(
      `--host ${host} is beyond loopback: name the host the server is served as with ` +
        "--allowed-host <name> (or --allowed-host '*' behind a proxy that checks the Host itself)",
    );
  }
  const http = await serveHttp({
    port,
    host,
    allowedHosts: options.allowedHosts,
    maxBody,
    server,
    log: options.log,
  });
  options.log(
    `sauce mcp: Streamable HTTP at ${endpointUrl(http, host)} (stateless, no authentication)\n`,
  );
  if (!isLoopback(host)) {
    options.log(
      "sauce mcp: bound beyond loopback, and it authenticates no one: serve it behind your own " +
        "authentication.\n",
    );
  }
  const stop = () => http.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function setup(options: McpSetupOptions): string[] {
  const project = options.dir ?? ".";
  const { name, version } = packageInfo();
  const files = setupProject({
    project,
    agents: parseSetupAgents(options.agents),
    ...(options.config === undefined ? {} : { config: options.config }),
    force: options.force,
    packageName: name,
    version,
  });

  return [`The ${name} MCP server, in ${project}:`, ...setupLines(files)];
}

export const mcpEntry: McpEntry = { serve, setup };
