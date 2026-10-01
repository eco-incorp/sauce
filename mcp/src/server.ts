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
import { registerIntentTools } from "./intents.js";
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
    "Read the agent skills first: sauce_skills lists them, sauce_skill returns one (or one",
    `section of it). Start with sauce-overview. The same files are resources (${SKILLS_INDEX}).`,
    "For TypeScript against the SDK, or the sauce command, sauce_dev returns the package's own",
    "documents. To set a project up for a coding agent, call sauce_install_skills.",
    "",
    "To write and run a program:",
    "1. sauce_globals for the chain (tokens, protocols): call names, never invent addresses.",
    "   A fixed sequence of protocol operations can be an actions document in JSON instead:",
    "   sauce_actions (the sauce-actions skill says how).",
    "2. sauce_compile until it compiles; entryParams is what main takes, as args.",
    "3. sauce_price for a swap's price limits (with pool and rpcUrl, from the pool now).",
    "4. sauce_pot for the owner's Pot: its address, its unsigned deployment, and, with rpcUrl,",
    "   whether it exists, the Kitchen's fee and what the Pot holds.",
    "5. sauce_simulate with rpcUrl: the cook rehearsed (any owner will do; nothing is signed).",
    "6. sauce_tx for the unsigned cook, for the owner to sign. An intent fixed when it is built",
    "   publishes from a wallet instead: sauce_intent_publish, and sauce_intent_fill with dryRun",
    "   rehearses a solver filling it on its destination.",
    "",
    "An intent's life after it is published: sauce_intent_status says where it stands and what",
    "can happen next (`can`); sauce_intent_fill (with the solver as from), sauce_intent_prove,",
    "sauce_intent_claim, sauce_intent_refund and sauce_intent_cancel build each step unsigned;",
    "sauce_intent_import reads one back from its transaction. This server keeps no intents: pass",
    "the intent's `record` (sauce_intent_publish and sauce_intent_import return it), or txHash",
    "and its source chain, and rpcUrls with both chains' endpoints.",
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
  const tools = {
    endpoints: options.endpoints,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
  };
  registerTools(server, tools);
  registerIntentTools(server, tools);
  registerSkillTools(server, options.skillsDir);
  registerResources(server, options.skillsDir);
  registerPrompts(server, options.skillsDir);

  return server;
}
