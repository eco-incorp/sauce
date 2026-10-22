/**
 * The Sauce MCP server: the `sauce` command's read-only tools, `sauce_send` for what the caller
 * signed, the agent skills as resources, and a task prompt — and, over stdio, the wallet tools
 * (unless `--no-wallets`) and, with the command's stores (on by default), what keeps them: every
 * Pot a tool's transaction deploys is recorded, and `sauce_pot_list` and `sauce_pot_import` read
 * the store. One server per connection — over stdio, one for the process; over
 * Streamable HTTP, one per request, stateless, and never with wallets or stores.
 */
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";

import type { Endpoints } from "./config.js";
import type { RpcGuard } from "./guard.js";
import { registerPotTools } from "./pots.js";
import { registerPrompts } from "./prompts.js";
import { registerResources, SKILLS_INDEX, WRITE_IT_YOURSELF } from "./resources.js";
import { registerSendTools } from "./send.js";
import { registerSkillTools } from "./skilltools.js";
import { COMMAND_TOOLS, flagInputLines } from "./terms.js";
import {
  CHAIN_SUPPORT_NEW_ISSUE_URL,
  supportedChainNames,
  type LocalStores,
  type McpWallets,
} from "./sdk.js";
import { registerTools } from "./tools.js";
import { noteResults } from "./update-note.js";
import { registerWalletTools, WalletSession } from "./wallets.js";

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

/**
 * How a result reaches the user's own wallet's MCP server, which signs it: what every building
 * tool's result carries for one (`handoff.ts`), and how each server takes it.
 */
const SIGN_WITH_THE_USERS_WALLET = [
  "SIGN WITH THE USER'S OWN WALLET: its MCP server signs what these tools build, and the key",
  "never leaves it. Build for that wallet's address (owner), simulate, show the user, then",
  "hand it over. Each EVM transaction a tool returns is itself what a send-transaction tool",
  "takes ({ chainId, to, data, value, gas }, amounts hex), and the result's `sendCalls` is every",
  "transaction in order, as one atomic batch, so nothing is converted:",
  "- Coinbase Wallet MCP (Base, Ethereum): send_calls with `sendCalls` as its input. The user",
  "  approves in their wallet through the link it returns; get_request_status says when it",
  "  landed. Its smart wallet's address is the owner, and one batch deploys the Pot and cooks.",
  "- Phantom MCP (Solana, Ethereum, Base): evm_send with each transaction as it is, in order,",
  "  each landed before the next; on Solana solana_send with each `transaction` (base64, the fee",
  "  payer's signature the one missing). Without confirmed it previews; confirmed true signs and",
  "  sends, returning the signature: give it to sauce_send with the cursor, which returns the",
  "  next step. A Solana transaction lands within about a minute of being built or never: when",
  "  the user takes longer, build it again (sauce_send with the cursor alone, or the tool that",
  "  built it) and send the new one.",
];

/** What the server tells a client about itself when it connects. */
export function instructions(
  endpoints: Endpoints,
  wallets?: WalletSession,
  local = false,
  stores: LocalStores = {},
): string {
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
    "   a swap's price limits (with pool, from the pool now). The distributed swap's priceLimit",
    "   and maxAvgPrice are input paid per output bought: sauce_pools' sides[].priceLimit, or",
    "   sauce_price's buy.priceLimit. minAvgPrice runs the other way round and is never a",
    "   maxAvgPrice. Simulate at the block sauce_pools read.",
    "4. sauce_pot for the owner's Pot: its address, whether it exists, the Kitchen's fee and what",
    "   the Pot holds. A Pot with no code yet needs no step of its own: sauce_tx plans its",
    "   deployment first, and sauce_simulate runs it before the cook.",
    "5. sauce_simulate: the cook simulated (any owner will do; nothing is signed).",
    "6. sauce_tx for the unsigned cook, for the owner to sign; sauce_send broadcasts it signed.",
    "   A Solana cook of several transactions (a program staged in a code buffer, a lookup",
    "   table) comes as a plan: sign each step's transactions and send them with its cursor;",
    "   sauce_send returns the next step, until it is done. sauce_reclaim closes the code",
    "   buffers and lookup tables a plan left open, returning their rent; it leaves open what",
    "   is in use, and the plans whose cursors it is given to keep.",
    "",
    "FROM THE sauce COMMAND TO THE TOOLS. A skill or a note may name a command line:",
    ...COMMAND_TOOLS,
    "Each flag is the input:",
    ...flagInputLines(),
    "",
    ...(stores.pots === undefined
      ? []
      : [
          `THIS SERVER KEEPS THE sauce COMMAND'S POT STORE, in ${stores.pots.dir}, as the command`,
          "does: every Pot a transaction it sends deploys (sauce_send, sauce_wallet_send) is",
          "recorded there, with",
          "the release it was minted under. sauce_pot_list lists them; sauce_pot_import records a",
          "Pot deployed some other way, read from the chain.",
          "",
        ]),
    ...SIGN_WITH_THE_USERS_WALLET,
    "",
    ...(wallets === undefined
      ? [
          "NOTHING HERE SIGNS. Every transaction comes back unsigned, for the user to sign with",
          "their own wallet or signer (a wallet's MCP server, a KMS, a hardware wallet); sauce_send",
          "takes the signed transactions, broadcasts them, waits for each to land and reports what",
          "it did. Never ask anyone for a private key or a seed phrase: no tool takes one.",
        ]
      : [
          "THIS SERVER ALSO SIGNS, WITH THE WALLETS IN ITS WALLET DIRECTORY (the sauce command's",
          "own, shared with it): for experiments and development, not for the user's real funds,",
          "which their own wallet signs (above). sauce_wallet_list names them and",
          "sauce_wallet_address gives one's address, with no password.",
          ...(wallets.source === undefined
            ? [
                "To create (sauce_wallet_create), import (sauce_wallet_import, a key file by its",
                "path) or send, the wallets must be enabled first: call sauce_wallet_enable once,",
                "naming where their password comes from, never the password — { env: NAME }, a",
                "variable the client's configuration passes to this server; { file: path }, a file",
                "only its owner can read; { dotenv: path, variable: NAME }, an entry of such a .env",
                "file; or { generate: true }, a new random password written to a new file beside",
                "the wallet directory. Ask the user which; with nothing set up, { generate: true },",
                "and tell the user where the file is. It holds for the life of the server.",
              ]
            : [
                `They are enabled by the password source the server was started with (${wallets.source}):`,
                "sauce_wallet_create makes one (evm, or solana), and sauce_wallet_import imports a",
                "key file by its path.",
              ]),
          "Each returns the wallet's address, never its key. Build a transaction for the wallet's",
          "address (owner), simulate it (sauce_simulate), then pass the building tool's",
          "whole result to sauce_wallet_send, which simulates it again, holds it to the wallet's",
          "policy, signs and sends it. Every other transaction still comes back unsigned: signed by",
          "any other signer, sauce_send sends it. These are hot wallets: keep small balances in",
          "them. Never ask anyone for a private key, a seed phrase or the password: no tool takes",
          "or returns one.",
        ]),
    "",
    `CHAINS. This release builds transactions only on ${supportedChainNames()}. Every other`,
    "chain is a preview chain (sauce_chains gives each chain's `support`): sauce_compile,",
    "sauce_actions, sauce_simulate, sauce_inspect, sauce_globals, sauce_price and the reads",
    "(sauce_pools, sauce_pot's prediction) work on it, so you can prototype any protocol on any",
    "chain. A tool that would return a transaction there — sauce_tx, sauce_pot's deployment,",
    "sauce_actions' cook — returns `refused` instead: the supported chains and, for that chain, a",
    "search for an existing chain-support request on GitHub, a prefilled new one, and the title,",
    "body and comment to post. Tell the user, and offer to find or open that request (or to add",
    "their use case to it) with the text given; do not build the transaction another way.",
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
  /** Over stdio, unless `--no-wallets` or `--no-stores`: the wallets it serves. Never given with
   *  `guard` (HTTP). */
  readonly wallets?: McpWallets;
  /** Over stdio: the `sauce` command's stores it keeps, as the command does. Never given with
   *  `guard` (HTTP). */
  readonly stores?: LocalStores;
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
  if (options.stores !== undefined && options.guard !== undefined) {
    throw new Error("internal: a server keeps stores over stdio only, and the guard is HTTP's");
  }
  // The wallets' state for the life of this server: over stdio, the process's.
  const wallets = options.wallets === undefined ? undefined : new WalletSession(options.wallets);
  const server = new McpServer(
    { name: "sauce", title: `Sauce (${name})`, version },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: instructions(
        options.endpoints,
        wallets,
        options.local === true,
        options.stores,
      ),
    },
  );
  if (options.updateNote !== undefined) noteResults(server, options.updateNote);
  const tools = {
    endpoints: options.endpoints,
    ...(options.guard === undefined ? {} : { guard: options.guard }),
    ...(options.local === true ? { local: true } : {}),
    ...(wallets === undefined ? {} : { wallets }),
    ...(options.stores === undefined ? {} : { stores: options.stores }),
  };
  registerTools(server, tools);
  registerSendTools(server, tools);
  if (wallets !== undefined) registerWalletTools(server, { ...tools, wallets });
  if (options.stores?.pots !== undefined) registerPotTools(server, tools, options.stores.pots);
  registerSkillTools(server, options.skillsDir, options.newerVersion);
  registerResources(server, options.skillsDir);
  registerPrompts(server, options.skillsDir);
  // Whatever transport it is connected to, a call that omits its arguments is a call with none.
  const connect = server.connect.bind(server);
  server.connect = async (transport) => {
    await connect(transport);
    argumentsDefaulted(transport);
  };

  return server;
}

/**
 * Gives every `tools/call` `transport` delivers that omits `arguments` the arguments `{}`. The spec
 * lets a client leave them out of a call with none to pass, and clients do; but the MCP SDK checks
 * a call's arguments against the tool's input schema as given, so a tool whose inputs are all
 * optional would refuse it as `undefined` where `{}` succeeds. It wraps the handler the server has
 * just installed on the transport, before the transport delivers anything (a transport delivers a
 * message from an I/O callback, or a request it is handed after the server connects), through the
 * transport's own `onmessage`, which a transport may forward to another inside it.
 */
function argumentsDefaulted(transport: Transport): void {
  const handle = transport.onmessage;
  if (handle === undefined) return;
  transport.onmessage = (message: JSONRPCMessage, extra?: MessageExtraInfo) =>
    handle(defaulted(message), extra);
}

/** `message`, a `tools/call` with no `arguments` given `{}`; any other as it is. */
function defaulted(message: JSONRPCMessage): JSONRPCMessage {
  if (!("method" in message) || message.method !== "tools/call") return message;
  const params = (message as { params?: Record<string, unknown> }).params;
  if (params === undefined || params.arguments !== undefined) return message;

  return { ...message, params: { ...params, arguments: {} } } as JSONRPCMessage;
}
