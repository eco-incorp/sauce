/**
 * What `sauce mcp` runs (`sdk/src/cli/mcp.ts` loads this build lazily): the server over stdio or
 * Streamable HTTP, and `setup`. The `sauce` command has already read the flags; the values are
 * checked here. `mcpEntry` is typed by the CLI's own `McpEntry`, so the two cannot drift.
 *
 * NODE-ONLY, and reached by nothing browser-facing. It reads no environment variable: it reads a
 * chain through the `--config` file's endpoint for it, else the built-in public endpoints the
 * `sauce` command hands it (`McpServeOptions.publicRpcs`). Over stdio it keeps the `sauce`
 * command's stores in the directories the command names (`McpServeOptions.stores`: the Pot store,
 * the intent store and the wallet directory, by default), and serves the wallet tools: they sign
 * with the wallets of that directory alone, once enabled — by the password the `sauce` command read
 * at start from the source it was given, or by the source an agent names to `sauce_wallet_enable`,
 * which that command reads for it. Over HTTP it never signs and keeps nothing. A newer
 * version the `sauce` command's update check has seen is noted once, in the process's first tool
 * result (`update-note.ts`).
 */
import { readFileSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { NO_ENDPOINTS, readEndpoints, type Endpoints } from "./config.js";
import { createRpcGuard } from "./guard.js";
import { DEFAULT_MAX_BODY, endpointUrl, isLoopback, serveHttp } from "./http.js";
import {
  IntentStore,
  keepsAny,
  PotStore,
  UsageError,
  type LocalStores,
  type McpEntry,
  type McpServeOptions,
  type McpSetupOptions,
} from "./sdk.js";
import { createSauceServer, packageInfo } from "./server.js";
import { parseSetupAgents, setupLines, setupProject } from "./setup.js";
import { once } from "./update-note.js";

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
  const endpoints: Endpoints = {
    ...readConfig(options.config),
    ...(options.publicRpcs === undefined ? {} : { public: options.publicRpcs }),
  };
  const maxBody =
    options.maxBody === undefined
      ? DEFAULT_MAX_BODY
      : wholeNumber("max-body", options.maxBody, 1, 64 * 1024 * 1024);
  // One note for the process: over HTTP every request has a server of its own.
  const update = {
    ...(options.updateNote === undefined ? {} : { updateNote: once(options.updateNote) }),
    ...(options.newerVersion === undefined ? {} : { newerVersion: options.newerVersion }),
  };
  if (options.http === undefined) {
    if (options.host !== undefined) throw new UsageError("--host goes with --http");
    if (options.allowedHosts.length > 0) throw new UsageError("--allowed-host goes with --http");
    if (options.allowPrivateRpc) {
      throw new UsageError(
        "--allow-private-rpc goes with --http: over stdio a caller's rpcUrl is not guarded at all",
      );
    }
    // Over stdio the caller is the server's own user, on the same machine: its endpoints, local
    // nodes included, are used as given. A message past the bound closes the connection.
    const wallets = options.stores?.wallets;
    // The command's stores, kept as the command keeps them: its caller is the user of this machine.
    const stores: LocalStores = {
      ...(options.stores?.pots === undefined ? {} : { pots: new PotStore(options.stores.pots) }),
      ...(options.stores?.intents === undefined
        ? {}
        : { intents: new IntentStore(options.stores.intents) }),
    };
    // Its caller's own files: a program may be named by path.
    await createSauceServer({
      endpoints,
      local: true,
      ...(wallets === undefined ? {} : { wallets }),
      ...(keepsAny(stores) ? { stores } : {}),
      ...update,
    }).connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: maxBody }));
    // A bare start says nothing: only what the operator chose is said, a password source or a
    // wallet directory named (`McpStores.named`).
    if (wallets?.start !== undefined) {
      options.log(`sauce mcp: signing with the wallets in ${wallets.dir}\n`);
    } else if (wallets !== undefined && options.stores?.named?.includes("wallets") === true) {
      options.log(
        `sauce mcp: serving the wallets in ${wallets.dir}; sauce_wallet_enable enables them ` +
          "to sign\n",
      );
    }
    // A store kept by default is not logged: a start says nothing it was not asked to (a client
    // logs every line), and the instructions say where the server keeps it. One whose directory
    // the operator named is.
    if (stores.pots !== undefined && options.stores?.named?.includes("pots") === true) {
      options.log(`sauce mcp: keeping the Pots its transactions deploy in ${stores.pots.dir}\n`);
    }
    if (stores.intents !== undefined && options.stores?.named?.includes("intents") === true) {
      options.log(
        `sauce mcp: keeping the intents its transactions touch in ${stores.intents.dir}\n`,
      );
    }

    return;
  }
  // The HTTP server never signs, and keeps nothing: it is given neither wallets nor stores.
  if (options.stores?.wallets !== undefined) {
    throw new UsageError("--wallets is for stdio: the HTTP server never signs");
  }
  if (options.stores !== undefined) {
    throw new UsageError("--pots and --store are for stdio: the HTTP server keeps nothing");
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
  // One guard for the process: every caller's rpcUrl is reached through it, checked again at
  // each connection.
  const guard = createRpcGuard({ allowPrivate: options.allowPrivateRpc });
  const http = await serveHttp({
    port,
    host,
    allowedHosts: options.allowedHosts,
    maxBody,
    server: () => createSauceServer({ endpoints, guard, ...update }),
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
