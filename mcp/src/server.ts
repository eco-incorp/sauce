/**
 * The Sauce MCP server: the `sauce` command's read-only tools, the agent skills as resources, and
 * two task prompts. One server per connection — over stdio, one for the process; over Streamable
 * HTTP, one per request, stateless.
 */
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Endpoints } from "./config.js";
import { registerPrompts } from "./prompts.js";
import { registerResources, SKILLS_INDEX } from "./resources.js";
import { registerTools } from "./tools.js";

/** This package's name and version, from the manifest at its root, two levels above this module
 *  in `mcp/{src,dist}`. */
export function packageInfo(): { readonly name: string; readonly version: string } {
  const manifest = new URL("../../package.json", import.meta.url);

  return JSON.parse(readFileSync(manifest, "utf8")) as { name: string; version: string };
}

/** What the server tells a client about itself when it connects. */
export function instructions(endpoints: Endpoints): string {
  return [
    "Sauce compiles SauceScript — a checked subset of TypeScript, in .sauce.ts files — into",
    "programs that run atomically in one transaction: on an EVM chain through the owner's Pot",
    "(Pot.cook), on Solana through the Kitchen. These tools are the read-only half of the `sauce`",
    "command: compile a program (sauce_compile), list the names a chain gives it (sauce_globals),",
    "build the unsigned cook (sauce_tx), predict and deploy a Pot (sauce_pot), rehearse a cook",
    "(sauce_simulate), build an intent's publish transactions (sauce_publish), and take calls",
    "apart or check a settle (sauce_inspect, sauce_verify).",
    "",
    "NOTHING HERE SIGNS OR SENDS. Every transaction comes back unsigned, for the user to sign",
    "with a wallet they hold; never ask anyone for a private key or a seed phrase.",
    "",
    `Before writing a program, read ${SKILLS_INDEX} and the SKILL.md of the skill the task`,
    "needs: they are the rules every program follows, with examples.",
    "",
    endpoints.chainIds.length === 0
      ? "This server reads no chain (it has no RPC endpoint), so sauce_simulate and transaction " +
        "hashes are unavailable, sauce_tx on an EVM chain needs `value`, and a Solana sauce_tx " +
        "cannot be built here."
      : `This server reads chains ${endpoints.chainIds.join(", ")} (sauce_chains marks them).`,
  ].join("\n");
}

export interface SauceServerOptions {
  readonly endpoints: Endpoints;
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
  registerTools(server, { endpoints: options.endpoints });
  registerResources(server, options.skillsDir);
  registerPrompts(server, options.skillsDir);

  return server;
}
