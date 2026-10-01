/**
 * The Sauce MCP server: the `sauce` command's read-only tools, the agent skills as resources, and
 * two task prompts. One server per connection — over stdio, one for the process; over Streamable
 * HTTP, one per request, stateless.
 */
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Endpoints } from "./config.js";
import type { RpcGuard } from "./guard.js";
import { registerPrompts } from "./prompts.js";
import { registerResources, SKILLS_INDEX } from "./resources.js";
import { registerSkillTools } from "./skilltools.js";
import { registerTools } from "./tools.js";

let manifest: { readonly name: string; readonly version: string } | undefined;

/** This package's name and version, from the manifest at its root, two levels above this module
 *  in `mcp/{src,dist}` — read once: a stateless HTTP server builds a server per request. */
export function packageInfo(): { readonly name: string; readonly version: string } {
  manifest ??= JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    name: string;
    version: string;
  };

  return manifest;
}

/** What the server tells a client about itself when it connects. */
export function instructions(endpoints: Endpoints): string {
  return [
    "Sauce compiles SauceScript — a checked subset of TypeScript, in .sauce.ts files — into",
    "programs that run atomically in one transaction: on an EVM chain through the owner's Pot",
    "(Pot.cook), on Solana through the Kitchen.",
    "",
    "Before writing anything, read the agent skills: sauce_skills lists them and sauce_skill",
    `returns one (the same files are resources, indexed at ${SKILLS_INDEX}). Start with`,
    "sauce-overview. For TypeScript against the SDK, sauce_dev returns the SDK's own documents.",
    "",
    "The tools: sauce_globals (the names a chain gives a program), sauce_compile (compile and",
    "learn what main takes), sauce_actions (an action program in JSON, compiled), sauce_simulate",
    "(rehearse the cook), sauce_pot (a Pot and its deployment), sauce_tx (the unsigned cook),",
    "sauce_publish (an intent's unsigned publish transactions), sauce_price (a swap's price",
    "limits), sauce_inspect and sauce_verify (take calls apart, check a settle), sauce_chains.",
    "",
    "NOTHING HERE SIGNS OR SENDS. Every transaction comes back unsigned, for the user to sign",
    "with their own wallet; never ask anyone for a private key or a seed phrase.",
    "",
    "A tool that reads a chain takes rpcUrl, an endpoint for that call; it is never echoed.",
    endpoints.chainIds.length === 0
      ? "This server has no endpoint of its own: without rpcUrl, sauce_simulate, transaction " +
        "hashes and a Solana sauce_tx are unavailable, and an EVM sauce_tx needs `value`."
      : `This server has its own endpoints for chains ${endpoints.chainIds.join(", ")}.`,
  ].join("\n");
}

export interface SauceServerOptions {
  readonly endpoints: Endpoints;
  /** Over HTTP: the guard every caller's rpcUrl is reached through. */
  readonly guard?: RpcGuard;
  /** The skills directory; the package's own by default. */
  readonly skillsDir?: string;
}

export function createSauceServer(options: SauceServerOptions): McpServer {
  const { name, version } = packageInfo();
  const server = new McpServer(
    { name: "sauce", title: `Sauce (${name})`, version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: instructions(options.endpoints),
    },
  );
  registerTools(server, {
    endpoints: options.endpoints,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
  });
  registerSkillTools(server, options.skillsDir);
  registerResources(server, options.skillsDir);
  registerPrompts(server, options.skillsDir);

  return server;
}
