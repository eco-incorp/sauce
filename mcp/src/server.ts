/**
 * The Sauce MCP server: the `sauce` command's read-only tools, the agent skills as resources, and
 * two task prompts — and, over stdio with `--wallets`, the wallet tools. One server per connection
 * — over stdio, one for the process; over Streamable HTTP, one per request, stateless, and never
 * with wallets.
 */
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Endpoints } from "./config.js";
import type { RpcGuard } from "./guard.js";
import { CHAIN_SUPPORT_NEW_ISSUE_URL, supportedChainNames } from "./sdk.js";
import { registerPrompts } from "./prompts.js";
import { registerResources, SKILLS_INDEX, WRITE_IT_YOURSELF } from "./resources.js";
import { registerSkillTools } from "./skilltools.js";
import { COMMAND_TOOLS, flagInputLines } from "./terms.js";
import { registerIntentTools } from "./intents.js";
import { registerTools, type WalletContext } from "./tools.js";
import { noteResults } from "./update-note.js";
import { registerWalletTools } from "./wallets.js";

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
export function instructions(endpoints: Endpoints, wallets?: WalletContext, local = false): string {
  const { name } = packageInfo();

  return [
    "Sauce compiles SauceScript — a checked subset of TypeScript, in .sauce.ts files — into",
    "programs that run atomically in one transaction: on an EVM chain through the owner's Pot",
    "(Pot.cook), on Solana through the Kitchen.",
    "",
    "Read the agent skills first: sauce_skills lists them, sauce_skill returns one (or one",
    `section of it). Start with sauce-overview. The same files are resources (${SKILLS_INDEX}).`,
    "For TypeScript against the SDK, or the sauce command, sauce_dev returns the package's own",
    "documents. To set a project up for a coding agent, call sauce_install_skills.",
    `The skills write the sauce command as \`sauce <command>\`: \`npm i -g ${name}\` installs it,`,
    `and \`npx -y ${name} <command>\` runs it with no install.`,
    "",
    ...WRITE_IT_YOURSELF,
    "",
    "To write and run a program:",
    "1. sauce_globals for the chain (tokens, protocols): call names, never invent addresses.",
    "   A fixed sequence of protocol operations can be an actions document in JSON instead:",
    "   sauce_actions (the sauce-actions skill says how).",
    "2. sauce_compile until it compiles; entryParams is what main takes, as args.",
    ...(local
      ? [
          "   Over stdio a program file on this machine is given by path (relative to the",
          "   server's directory) instead of source; sourceSha256 ties each result to its text.",
        ]
      : []),
    "3. sauce_pools for a pair's pools, their prices and depth, before a swap; sauce_price for",
    "   a swap's price limits (with pool, from the pool now). The distributed swap's maxPrice",
    "   and maxAvgPrice are input paid per output bought: sauce_pools' sides[].maxPrice, or",
    "   sauce_price's buy.maxPrice. minAvgPrice runs the other way round and is never a",
    "   maxAvgPrice. Rehearse at the block sauce_pools read.",
    "4. sauce_pot for the owner's Pot: its address, whether it exists, the Kitchen's fee and what",
    "   the Pot holds. A Pot with no code yet needs no step of its own: sauce_tx plans its",
    "   deployment first, and sauce_simulate rehearses it.",
    "5. sauce_simulate: the cook rehearsed (any owner will do; nothing is signed).",
    "6. sauce_tx for the unsigned cook, for the owner to sign.",
    "",
    "FROM THE sauce COMMAND TO THE TOOLS. A skill or a note may name a command line:",
    ...COMMAND_TOOLS,
    "Each flag is the input:",
    ...flagInputLines(),
    "",
    "An intent's life after it is published: sauce_intent_status says where it stands and what",
    "can happen next (`can`); sauce_intent_fill (with the solver as from), sauce_intent_prove,",
    "sauce_intent_claim, sauce_intent_refund and sauce_intent_cancel build each step unsigned;",
    "sauce_intent_import reads one back from its transaction. This server keeps no intents: pass",
    "the intent's `record` (sauce_intent_import returns it), or txHash",
    "and its source chain.",
    "",
    ...(wallets === undefined
      ? [
          "NOTHING HERE SIGNS OR SENDS. Every transaction comes back unsigned, for the user to sign",
          "with their own wallet; never ask anyone for a private key or a seed phrase.",
        ]
      : [
          "THIS SERVER SIGNS ONLY WITH THE WALLETS IN ITS WALLET DIRECTORY, unlocked by the password",
          `source it was started with (${wallets.source}). sauce_wallet_list names them;`,
          "sauce_wallet_create makes one (evm, or solana) and returns its address, never its key.",
          "Build a transaction for the wallet's address (owner, or from), rehearse it",
          "(sauce_simulate), then pass the building tool's whole result to sauce_wallet_send, which",
          "rehearses it again, holds it to the wallet's policy, signs and sends it. Every other",
          "transaction still comes back unsigned. These are hot wallets: keep small balances in",
          "them. Never ask anyone for a private key, a seed phrase or the password: no tool takes",
          "or returns one.",
        ]),
    "",
    `CHAINS. This release builds transactions only on ${supportedChainNames()}. Every other`,
    "chain is a preview chain (sauce_chains gives each chain's `support`): sauce_compile,",
    "sauce_actions, sauce_simulate, sauce_inspect, sauce_globals, sauce_price, the dry run",
    "(sauce_intent_fill with dryRun) and the reads (sauce_pools,",
    "sauce_pot's prediction, sauce_intent_status, sauce_intent_import) work on it, so you can",
    "prototype any protocol on any chain. A tool that would return a transaction there —",
    "sauce_tx, sauce_pot's deployment, sauce_actions' cook, and the intent",
    "steps on the chain they are sent on — returns `refused` instead: the supported chains and,",
    "for that chain, a search for an existing chain-support request on GitHub, a prefilled new",
    "one, and the title, body and comment to post. Tell the user, and offer to find or open that",
    "request (or to add their use case to it) with the text given; do not build the transaction",
    "another way.",
    `Requests: ${CHAIN_SUPPORT_NEW_ISSUE_URL}`,
    "",
    "A tool that reads a chain takes rpcUrl, an endpoint for that call; it is never echoed.",
    ...(endpoints.chainIds.length === 0
      ? []
      : [`This server has its own endpoints for chains ${endpoints.chainIds.join(", ")}.`]),
    endpoints.public !== undefined
      ? "Without rpcUrl, a chain is read through a built-in public endpoint, which can be slow or " +
        "rate-limited (a result's notes say when one was used): rpcUrl is optional."
      : endpoints.chainIds.length === 0
        ? "This server has no endpoint of its own: without rpcUrl, sauce_simulate, transaction " +
          "hashes and a Solana sauce_tx are unavailable, and an EVM sauce_tx needs `value`."
        : "Without rpcUrl, a chain it has no endpoint for is not read.",
  ].join("\n");
}

export interface SauceServerOptions {
  readonly endpoints: Endpoints;
  /** Over HTTP: the guard every caller's rpcUrl is reached through. */
  readonly guard?: RpcGuard;
  /** Over stdio: the caller is the server's own user, so a program may be named by `path`, read
   *  from disk. Never given with `guard` (HTTP). */
  readonly local?: boolean;
  /** Over stdio with `--wallets`: the wallets it signs with. Never given with `guard` (HTTP). */
  readonly wallets?: WalletContext;
  /** The skills directory; the package's own by default. */
  readonly skillsDir?: string;
  /** A newer version's note, asked after each tool result and added to it when it says something:
   *  `update-note.ts#once` of the `sauce` command's note, shared by every server of the process. */
  readonly updateNote?: () => string | undefined;
  /** The newer version the update check's cache names, which `sauce_skills` returns as `latest`. */
  readonly newerVersion?: () => string | undefined;
}

export function createSauceServer(options: SauceServerOptions): McpServer {
  const { name, version } = packageInfo();
  if (options.wallets !== undefined && options.guard !== undefined) {
    throw new Error("internal: wallets are served over stdio only, and the guard is HTTP's");
  }
  if (options.local === true && options.guard !== undefined) {
    throw new Error("internal: a server reads files over stdio only, and the guard is HTTP's");
  }
  const server = new McpServer(
    { name: "sauce", title: `Sauce (${name})`, version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: instructions(options.endpoints, options.wallets, options.local === true),
    },
  );
  if (options.updateNote !== undefined) noteResults(server, options.updateNote);
  const tools = {
    endpoints: options.endpoints,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    ...(options.local === true ? { local: true } : {}),
    ...(options.wallets === undefined ? {} : { wallets: options.wallets }),
  };
  registerTools(server, tools);
  registerIntentTools(server, tools);
  if (options.wallets !== undefined)
    registerWalletTools(server, { ...tools, wallets: options.wallets });
  registerSkillTools(server, options.skillsDir, options.newerVersion);
  registerResources(server, options.skillsDir);
  registerPrompts(server, options.skillsDir);

  return server;
}
