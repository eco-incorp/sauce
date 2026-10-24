/**
 * The wallet tools, on a server over stdio (unless it was started with `--no-wallets`): enable the
 * wallets, create or import one, list them, name one's address, and send what the other tools
 * build from one. They are the `sauce` command's own (`sdk/src/cli/wallets.ts`,
 * `wallet-commands.ts`, `wallet-send.ts`): the same directory, `~/.sauce/wallets` unless the server
 * was started with another, the same keystores, the same policy and ledger, the same simulation
 * before anything is sent.
 *
 * Listing the wallets, and naming one's address, need no password: each file names its address in
 * the clear. Creating, importing and sending need the wallets ENABLED, by the password source the
 * server was started with (`sdk/src/cli/mcp.ts` read it then) or else by `sauce_wallet_enable`,
 * which names a source — a variable of the server's environment, a file only its owner can read,
 * an entry of such a `.env` file, or a new random password written to a new file — and never the
 * password, nor a command (a command the model chose would be a shell for it). The `sauce` command
 * reads that source for the server (`McpWallets.read`), and the password stays in this process's
 * memory, never on disk, for the life of the process. So it is never a tool's input and never in
 * the model's context. No tool takes a key, a password or a seed, and none returns one: a key
 * leaves its file only to sign, in this process, and an import names its file by path. There is
 * no export tool (the CLI's `sauce wallet export` shows a key only at a terminal). Over HTTP none
 * of these tools is registered: the HTTP server never signs.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import {
  checkPlan,
  describeSource,
  ENV_NAME,
  generatedPasswordFile,
  generatePasswordFile,
  HOT_WALLET,
  looksLikeKey,
  noPolicyNote,
  openWallet,
  parseAddress,
  parseChain,
  planChain,
  plannedCursor,
  plannedHandedOut,
  planFor,
  plannedTransactions,
  readImport,
  readPolicy,
  secret,
  sendPlan,
  sendSvmPlan,
  supportedChainNames,
  UsageError,
  walletName,
  WalletStore,
  type McpWallets,
  type PasswordSource,
  type SendGuard,
} from "./sdk.js";
import {
  chainRef,
  LIMITS,
  potsKept,
  refusable,
  SIGNED_COOK_OUTPUT,
  signedCookCall,
  signedCookInputs,
  toolRegistrar,
  type ToolContext,
} from "./tools.js";

/** The wallet tools, in the order `tools/list` gives them. */
export const WALLET_TOOL_NAMES = [
  "sauce_wallet_enable",
  "sauce_wallet_create",
  "sauce_wallet_import",
  "sauce_wallet_list",
  "sauce_wallet_address",
  "sauce_wallet_send",
  "sauce_sign",
] as const;

/** The `.env` entry `sauce_wallet_enable { dotenv }` reads when told no other: the docs' name. */
export const DOTENV_VARIABLE = "SAUCE_WALLET_PASSWORD";

/** The largest key file an import reads: a keystore is about half a kilobyte. */
const KEY_FILE_MAX = 64 * 1024;

/** The four ways `sauce_wallet_enable` names a password's source, as its refusals spell them. */
const SOURCES =
  "{ env: \"<NAME>\" } (a variable of this server's environment, which the client's " +
  'configuration passes), { file: "<path>" } (a file only its owner can read), { dotenv: ' +
  `"<path>", variable: "<NAME>" } (an entry of such a .env file; ${DOTENV_VARIABLE} when ` +
  "variable is left out) or { generate: true } (a new random password, written to a new file " +
  "beside the wallet directory)";

/** Enables the wallets: reads a source, or writes one; never over a file. */
const ENABLES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
/** Writes one new file, and never over another. */
const CREATES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const READS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Signs and sends: what it spends is gone. */
const SENDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

/**
 * The wallets a stdio server serves, and — once they are enabled — the password they open with:
 * the one the server was started with, or the one `sauce_wallet_enable` named the source of. One
 * per server, and over stdio one server per process; held in memory, never written anywhere.
 */
export class WalletSession {
  readonly options: McpWallets;
  /** The wallet directory: the server's, or the one `sauce_wallet_enable` named. */
  store: WalletStore;
  private enabled: { readonly password: string; readonly source: string } | undefined;

  constructor(options: McpWallets) {
    this.options = options;
    this.store = new WalletStore(options.dir);
    this.enabled = options.start;
  }

  /** The source the wallets are enabled with, as the instructions name it; none before. */
  get source(): string | undefined {
    return this.enabled?.source;
  }

  /** Whether the server was started with a password source: the operator's, which stays. */
  get byOperator(): boolean {
    return this.options.start !== undefined;
  }

  /** The password, for `doing`; refused, saying how to enable the wallets, before they are. */
  password(doing: string): string {
    if (this.enabled === undefined) {
      throw new UsageError(
        `${doing} needs the wallets enabled: call sauce_wallet_enable once, naming where their ` +
          `password comes from, never the password itself: ${SOURCES}. Ask the user which; ` +
          "sauce_wallet_list and sauce_wallet_address need none",
      );
    }

    return this.enabled.password;
  }

  /** Enables the wallets of `store` with `password`, read from `source`; replaces any before. */
  enable(store: WalletStore, password: string, source: string): void {
    this.store = store;
    this.enabled = { password, source };
  }
}

const WALLET = z
  .string()
  .min(1)
  .max(64)
  .describe("The wallet's name, as sauce_wallet_list gives it.");

/** A path on this machine, as an input names one. */
const PATH = z.string().min(1).max(4096);

const walletJson = (
  info: { name: string; kind: string; address: string; path: string; policyPath: string },
  hasPolicy: boolean,
) => ({
  name: info.name,
  kind: info.kind,
  address: info.address,
  path: info.path,
  policy: hasPolicy ? info.policyPath : null,
});

const WALLET_OUTPUT = {
  name: z.string(),
  kind: z.enum(["evm", "solana"]),
  address: z.string(),
  policy: z.string().nullable(),
};

/** Whether a wallet has a policy, a broken one counted as one (a send refuses it). */
function hasPolicy(info: Parameters<typeof readPolicy>[0]): boolean {
  try {
    return readPolicy(info) !== undefined;
  } catch {
    return true;
  }
}

/** A path an input names: `~/` is the home directory, and a relative one is the server's. */
const localPath = (path: string): string =>
  resolve(path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path);

/** Whether `path` is `dir` or inside it. */
function inside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), path);

  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The git work tree a path is in, if any: the nearest directory above it holding `.git`. */
function workTreeOf(path: string): string | undefined {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** An env-style name an input gives, checked; a value given in its place is a secret at once. */
function variableName(input: string, value: string): string {
  if (!ENV_NAME.test(value)) {
    secret(value);
    throw new UsageError(
      `${input} takes the NAME of an environment variable (letters, digits and _), never its ` +
        "value: the password never goes in a tool's input",
    );
  }

  return value;
}

/**
 * The key file an import names: a regular file only its owner can read, as a password file must
 * be, and no larger than a key file is. Never quoted back.
 */
function readKeyFile(path: string): string {
  const unreadable = (error: unknown) =>
    new UsageError(
      `${path}: ${(error as { code?: string }).code === "ENOENT" ? "no such file" : "unreadable"}`,
    );
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error) {
    throw unreadable(error);
  }
  if (!stat.isFile()) throw new UsageError(`${path} is not a regular file`);
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new UsageError(
      `${path} can be read or written by others (mode ` +
        `${(stat.mode & 0o777).toString(8).padStart(3, "0")}): a key file must be yours alone. ` +
        `Run \`chmod 600 ${path}\`, then import it`,
    );
  }
  if (stat.size > KEY_FILE_MAX) {
    throw new UsageError(`${path} is ${stat.size} bytes: no key file this reads is that large`);
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw unreadable(error);
  }
}

export function registerWalletTools(
  server: McpServer,
  context: ToolContext & { readonly wallets: WalletSession },
): void {
  const tool = toolRegistrar(server, context);
  const session = context.wallets;

  tool(
    "sauce_wallet_enable",
    {
      title: "Enable the wallets",
      description:
        "Enables this server's wallets to create, import and sign, for the rest of its life, " +
        "with the password from the SOURCE this names — never the password itself: no input " +
        "takes it, and no result returns it. Give exactly one: env, a variable of this server's " +
        "environment (the client's configuration passes it, in the server entry's env block); " +
        "file, a file only its owner can read (chmod 600), the password on its first line; " +
        `dotenv, a .env file only its owner can read, and variable, its entry (${DOTENV_VARIABLE} ` +
        "by default); or generate: true, a new random password the server writes to a new file " +
        "beside the wallet directory (~/.sauce/wallets.password for the default), or to the " +
        "path given, never over a file that exists. Ask the user where the password should " +
        "come from; with nothing set up, generate: true. A password file holds the key of every " +
        "wallet it opens, with the wallet's file: keep it out of repositories and synced " +
        "folders. dir names another wallet directory (default the server's). Calling it again " +
        "replaces the source; on a server started with a password source, the wallets are " +
        "enabled already. sauce_wallet_list and sauce_wallet_address need no password.",
      input: {
        env: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe("The NAME of a variable in this server's environment (never its value)."),
        file: PATH.optional().describe(
          "A password file only its owner can read: ~/ for the home directory, else absolute or " +
            "relative to the server's directory.",
        ),
        dotenv: PATH.optional().describe("A .env file only its owner can read."),
        variable: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe(`With dotenv: the entry's NAME (default ${DOTENV_VARIABLE}).`),
        generate: z
          .union([z.literal(true), PATH])
          .optional()
          .describe(
            "true: write a new random password to a new file beside the wallet directory " +
              "(<dir>.password); or the path of the new file, in a directory that exists, " +
              "outside the wallet directory. Never over a file that exists.",
          ),
        dir: PATH.optional().describe(
          "The wallet directory (default the server's, ~/.sauce/wallets unless it was started " +
            "with another).",
        ),
      },
      output: {
        dir: z.string(),
        enabled: z.literal(true),
        source: z.string(),
        wallets: z.array(z.string()),
        passwordFile: z.string().optional(),
      },
      annotations: ENABLES,
    },
    async (args) => {
      if (session.byOperator) {
        throw new UsageError(
          `the wallets are enabled already, by the password source this server was started with ` +
            `(${session.source}): it is its operator's to change`,
        );
      }
      const given = (["env", "file", "dotenv", "generate"] as const).filter(
        (field) => args[field] !== undefined,
      );
      if (given.length !== 1) {
        throw new UsageError(
          `give one source of the wallets' password${given.length > 1 ? `, not ${given.join(" and ")}` : ""}: ${SOURCES}`,
        );
      }
      if (args.variable !== undefined && args.dotenv === undefined) {
        throw new UsageError("variable names an entry of the dotenv file: it goes with dotenv");
      }
      const dir = args.dir === undefined ? session.store.dir : localPath(args.dir);
      if (session.options.dirNamed && resolve(dir) !== resolve(session.options.dir)) {
        throw new UsageError(
          `this server was started with the wallet directory ${session.options.dir} ` +
            "(--wallets): it is its operator's to change",
        );
      }
      const notes: string[] = [];
      let password: string;
      let source: string;
      let passwordFile: string | undefined;
      if (args.generate !== undefined) {
        const path = args.generate === true ? generatedPasswordFile(dir) : localPath(args.generate);
        if (inside(dir, path)) {
          throw new UsageError(
            `${path} is in the wallet directory: a password file goes beside it, never in it, so ` +
              "a copy of the directory never carries both",
          );
        }
        password = generatePasswordFile(path, args.generate === true);
        source = `file ${path}`;
        passwordFile = path;
        notes.push(
          `${path} holds the wallets' new password, readable by you alone: whoever can read it ` +
            "and a wallet's file holds that wallet's key, so keep it out of repositories, " +
            `backups and synced folders. After a restart, enable with { file: "${path}" }.`,
        );
        const tree = workTreeOf(path);
        if (tree !== undefined) {
          notes.push(
            `${path} is inside the git work tree ${tree}: keep it out of the repository ` +
              "(add it to .gitignore).",
          );
        }
      } else {
        const chosen: PasswordSource =
          args.env !== undefined
            ? { from: "env", name: variableName("env", args.env) }
            : args.file !== undefined
              ? { from: "file", path: localPath(args.file) }
              : {
                  from: "dotenv",
                  path: localPath(args.dotenv!),
                  name: variableName("variable", args.variable ?? DOTENV_VARIABLE),
                };
        password = await session.options.read(chosen);
        source = describeSource(chosen, "tool");
      }
      const replaced = session.source;
      const store = new WalletStore(dir);
      session.enable(store, password, source);
      const { wallets, warnings } = store.list();
      if (replaced !== undefined) notes.push(`It replaces the source before, ${replaced}.`);
      if (passwordFile !== undefined && wallets.length > 0) {
        notes.push(
          `The wallets already in ${dir} (${wallets.map((info) => info.name).join(", ")}) were ` +
            "made under another password, and do not open with this one.",
        );
      }

      return {
        json: {
          dir: store.dir,
          enabled: true,
          source,
          wallets: wallets.map((info) => info.name),
          ...(passwordFile === undefined ? {} : { passwordFile }),
        },
        notes: [...warnings, ...notes],
      };
    },
  );

  tool(
    "sauce_wallet_create",
    {
      title: "Create a wallet",
      description:
        "Creates a wallet with a fresh key in this server's wallet directory, encrypted under " +
        "the password the wallets are enabled with (sauce_wallet_enable, unless the server was " +
        "started with one), and returns its name, kind and address — never its key. kind evm " +
        "(the default) signs on EVM chains, solana on Solana. A name is never reused: an " +
        "existing wallet is never overwritten. Fund the address before sending from it. It is " +
        "a hot wallet, so keep small balances in it; the user may limit what it sends with a " +
        "policy file beside it (path in the result). `sauce wallet new`, over MCP.",
      input: {
        name: z
          .string()
          .min(1)
          .max(64)
          .describe("The new wallet's name: lowercase letters, digits, - and _ (agent, trader-1)."),
        kind: z
          .enum(["evm", "solana"])
          .optional()
          .describe("evm (default): a key for EVM chains. solana: a Solana keypair."),
      },
      output: WALLET_OUTPUT,
      annotations: CREATES,
    },
    async (args) => {
      const name = walletName(args.name);
      const { store } = session;
      if (store.list().wallets.some((wallet) => wallet.name === name)) {
        throw new UsageError(
          `wallet ${name} exists: a wallet is never overwritten (pick another name)`,
        );
      }
      const password = session.password("Creating a wallet");
      const { info, warnings } = await store.create(name, args.kind ?? "evm", password);

      return {
        json: walletJson(info, hasPolicy(info)),
        notes: [...warnings, noPolicyNote(info), HOT_WALLET],
      };
    },
  );

  tool(
    "sauce_wallet_import",
    {
      title: "Import a wallet from a key file",
      description:
        "Imports, as a new wallet in this server's wallet directory, the key a file on this " +
        "machine holds, named by its path — never the key itself: a keystore (geth's, cast's or " +
        "another Sauce wallet's, which must open with the password the wallets are enabled " +
        "with, and keeps it), a Solana keypair file (solana-keygen's JSON array of 64 bytes, or " +
        "its base58), or an EVM private key in hex. The file must be a regular file only its " +
        "owner can read (chmod 600), and is left as it is. The key is encrypted under the " +
        "wallets' password (sauce_wallet_enable) and never returned: the result is the " +
        "wallet's name, kind and address. `sauce wallet import`, over MCP.",
      input: {
        name: z
          .string()
          .min(1)
          .max(64)
          .describe("The new wallet's name: lowercase letters, digits, - and _."),
        path: PATH.describe(
          "The key file's path: ~/ for the home directory, else absolute or relative to the " +
            "server's directory.",
        ),
        kind: z
          .enum(["evm", "solana"])
          .optional()
          .describe("What the file must hold: evm, a key for EVM chains; solana, a keypair."),
      },
      output: WALLET_OUTPUT,
      annotations: CREATES,
    },
    async (args) => {
      const name = walletName(args.name);
      if (looksLikeKey(args.path)) {
        secret(args.path.trim());
        throw new UsageError(
          "path names the file a key is in, never the key: a key never goes in a tool's input",
        );
      }
      const { store } = session;
      if (store.list().wallets.some((wallet) => wallet.name === name)) {
        throw new UsageError(
          `wallet ${name} exists: a wallet is never overwritten (pick another name)`,
        );
      }
      const password = session.password("Importing a wallet");
      const path = localPath(args.path);
      const text = readKeyFile(path);
      let imported: ReturnType<typeof readImport>;
      try {
        imported = readImport(text, password, path);
      } catch (error) {
        if (!text.trim().startsWith("{")) throw error;
        throw new UsageError(
          `${path}: ${(error as Error).message}. A keystore is imported under its own ` +
            "password, which must be the one the wallets are enabled with",
        );
      }
      try {
        if (args.kind !== undefined && imported.kind !== args.kind) {
          throw new UsageError(
            `${path} holds ${imported.kind === "evm" ? "an EVM key" : "a Solana keypair"}, not ` +
              `${args.kind === "evm" ? "an EVM key" : "a Solana keypair"}`,
          );
        }
        const { info, warnings } = await store.store(name, imported.kind, imported.bytes, password);

        return {
          json: walletJson(info, hasPolicy(info)),
          notes: [...warnings, noPolicyNote(info), HOT_WALLET],
        };
      } finally {
        imported.bytes.fill(0);
      }
    },
  );

  tool(
    "sauce_wallet_list",
    {
      title: "List the wallets",
      description:
        "Lists this server's wallets: each one's name, kind (evm or solana), address, and the " +
        "policy that limits what it sends (null: no limits), with the wallet directory and " +
        "whether the wallets are enabled to create, import and sign (sauce_wallet_enable), " +
        "and by which source. Needs no password. Use an address as `owner` in the other tools, " +
        "and the name in sauce_wallet_send. Reads no chain.",
      input: {},
      output: {
        dir: z.string(),
        enabled: z.boolean(),
        source: z.string().nullable(),
        wallets: z.array(z.looseObject({ name: z.string(), address: z.string() })),
      },
      annotations: READS,
    },
    () => {
      const { wallets, warnings } = session.store.list();
      const source = session.source;

      return {
        json: {
          dir: session.store.dir,
          enabled: source !== undefined,
          source: source ?? null,
          wallets: wallets.map((info) => walletJson(info, hasPolicy(info))),
        },
        notes: [
          ...warnings,
          ...(source === undefined
            ? [
                "The wallets are not enabled: sauce_wallet_enable enables them to create, " +
                  "import and sign, naming where their password comes from.",
              ]
            : []),
        ],
      };
    },
  );

  tool(
    "sauce_wallet_address",
    {
      title: "A wallet's address",
      description:
        "One of this server's wallets by name: its kind (evm or solana), address and policy " +
        "(null: no limits), read from its file, which names the address in the clear. Needs no " +
        "password, and reads no chain. `sauce wallet address`, over MCP.",
      input: { name: WALLET },
      output: WALLET_OUTPUT,
      annotations: READS,
    },
    (args) => {
      const info = session.store.info(walletName(args.name));

      return { json: walletJson(info, hasPolicy(info)) };
    },
  );

  tool(
    "sauce_wallet_send",
    {
      title: "Send transactions from a wallet",
      description:
        "Signs and sends, from one of this server's wallets, the transactions another tool built " +
        "unsigned: pass that tool's whole result as `transaction` — sauce_tx (a Solana plan " +
        "too, sent step by step from its cursor, each step built fresh), sauce_pot, " +
        "sauce_actions (with owner) — or one transaction ({ to, " +
        "data, value }, or a Solana { transaction }), or a list. Needs the wallets enabled " +
        "(sauce_wallet_enable). It simulates them unsigned. On an EVM chain they are simulated " +
        "all together in one eth_simulateV1 block from the wallet first, and it refuses, sending " +
        "nothing, if any would revert or the wallet's policy does not allow it, naming the limit. " +
        "On Solana each is simulated with no signature as it is sent, the wallet its fee payer " +
        "(one another key pays for is refused), and a plan's cost is checked against the policy " +
        "before any step; a list of transactions is sent one by one, so one refused after others " +
        "landed leaves those landed. Each is signed only once the policy let it go, and it stops at " +
        "the first that does not succeed. Returns each one's hash (a Solana " +
        "signature) and status, with `explorer` and `trace` (Phalcon: calls and balance changes) " +
        "beside it, links to give the user to open in a browser, never to fetch; and for an EVM " +
        "cook, from its receipt, `moves` (what moved, in order, by role), `leftInPot` (what the " +
        "Pot holds after it of what it moved, not in the wallet) and `summary`, the same as lines " +
        "to read and report; and on a transaction that deployed a Pot, `pots`: each Pot as the " +
        "sauce command records it (chain, address, owner, salt, kind, Kitchen, the engine and " +
        `compiler release it was minted under, the deploying transaction), ${potsKept(context)}. ` +
        "Build the transactions for the wallet's address: as `owner` in the tool that builds " +
        "them. Needs the chain's endpoint (rpcUrl, or the " +
        "server's). What it sends is spent: simulate with sauce_simulate first. It sends only on " +
        `${supportedChainNames()}, the chains this release supports; on any other it is refused ` +
        "before any endpoint is reached, with `refused` saying how to request the chain.",
      input: {
        wallet: WALLET,
        transaction: z
          .union([
            z.looseObject({}),
            z.array(z.looseObject({})).min(1).max(LIMITS.entries),
            z.string().min(2).max(LIMITS.hex),
          ])
          .describe(
            "What to send: another tool's whole result, one transaction, or a list of them, as " +
              "JSON or its text. Each EVM transaction is { chainId, to, data, value } (value in " +
              "wei, a hex quantity or a decimal string); a Solana one is { transaction } in base64, built for the " +
              "wallet as its fee payer.",
          ),
        chain: chainRef
          .optional()
          .describe(
            "The chain to send on; needed only when the transactions do not say (each tool's " +
              "result names its chainId).",
          ),
        rpcUrl: z
          .string()
          .min(1)
          .max(2048)
          .optional()
          .describe(
            "The chain's RPC endpoint, for this call only (else the server's); never returned or " +
              "logged.",
          ),
      },
      output: refusable({
        wallet: z.string(),
        from: z.string(),
        chain: z.string(),
        ok: z.boolean(),
        sent: z.array(z.looseObject({ hash: z.string(), status: z.string() })),
        policy: z.string().nullable(),
      }),
      annotations: SENDS,
    },
    async (args, reach) => {
      const { store } = session;
      // A Solana plan (sauce_tx's, or sauce_send's `next`): every step, from its cursor.
      const cursor = plannedCursor(args.transaction);
      if (cursor !== undefined) {
        // The plan's owner, held to the wallet before the wallet is unlocked or anything is read.
        planFor(cursor, store.info(walletName(args.wallet)));
        const chain =
          args.chain === undefined
            ? parseChain("solana", "chain")
            : parseChain(String(args.chain), "chain");
        const password = session.password("Sending");
        const { unlocked, guard } = await openWallet(store, walletName(args.wallet), password);
        guard.gate(chain);
        const rpcUrl = await reach.require(chain, args.rpcUrl, "Sending");
        const sent = await sendSvmPlan({
          wallet: unlocked,
          guard,
          chain,
          cursor,
          rpcUrl,
          handedOut: plannedHandedOut(args.transaction),
        });

        return { json: sent.json, notes: sent.notes };
      }
      const transactions = plannedTransactions(args.transaction);
      const chain = planChain(
        transactions,
        args.chain === undefined ? undefined : parseChain(String(args.chain), "chain"),
      );
      const password = session.password("Sending");
      const { unlocked, guard } = await openWallet(store, walletName(args.wallet), password);
      // Before any endpoint is reached: what this wallet can send there, and the release's chains,
      // for a raw transaction as for a built one.
      checkPlan(unlocked, chain, transactions);
      guard.gate(chain);
      const rpcUrl = await reach.require(chain, args.rpcUrl, "Sending");
      const sent = await sendPlan({ wallet: unlocked, guard, chain, transactions, rpcUrl });

      return { json: sent.json, notes: sent.notes };
    },
  );

  tool(
    "sauce_sign",
    {
      title: "Sign a cook with a wallet, for another account to submit",
      description:
        "Signs, with one of this server's EVM wallets as the Pot's owner, a cook another account " +
        "submits with the Pot's own cookSigned — what sauce_signed_cook builds, signed here: " +
        "the same inputs (but signature), the Pot the wallet's own unless owner or pot says " +
        "(the wallet must own it). Returns `typedData`, `digest`, `signature` and `cook`, { " +
        "chainId, to: the Pot, data: cookSigned(…), value }, which the submitter sends with " +
        "exactly `value` and pays gas for — another of this server's wallets through " +
        "sauce_wallet_send, or any account — and `deployPot` first when the Pot has no code " +
        "yet. The Pot pays the Kitchen's fee itself, from its balance. Whoever holds the " +
        "signature may submit it until the deadline, once. Needs the wallets enabled " +
        "(sauce_wallet_enable). The wallet's policy applies: its chains and to (the Pot) are " +
        "held to, and a policy that limits native or tokens refuses to sign, naming the limit, " +
        "since what a signed cook moves is known only when it is submitted. With `cancel` " +
        "(nonces) instead of a program it SENDS the owner's invalidateNonces from the wallet, " +
        "so those signatures never run. It signs only on " +
        `${supportedChainNames()}, the chains this release supports, and never on Solana; on ` +
        "a preview chain it is refused before any endpoint is reached, with `refused`.",
      input: { wallet: WALLET, ...signedCookInputs(context.local === true) },
      output: refusable(SIGNED_COOK_OUTPUT),
      annotations: SENDS,
    },
    async (args, reach) => {
      const { store } = session;
      const name = walletName(args.wallet);
      const info = store.info(name);
      if (info.kind !== "evm") {
        throw new UsageError(
          `wallet ${name} is a Solana wallet: a signed cook is an EVM Pot's, signed by an EVM wallet`,
        );
      }
      let guard: SendGuard | undefined;
      const output = await signedCookCall(args, context.local === true, reach, {
        address: parseAddress("wallet", info.address),
        unlock: async () => {
          const opened = await openWallet(store, name, session.password("Signing"));
          if (opened.unlocked.kind !== "evm") {
            throw new Error("internal: an EVM wallet unlocked as a Solana one");
          }
          guard = opened.guard;

          return opened.unlocked.account;
        },
      });

      return {
        json: output.json,
        notes: [
          ...(guard === undefined
            ? []
            : guard.policy === undefined
              ? [noPolicyNote(info)]
              : guard.policy.notes),
          ...(output.notes ?? []),
          ...(output.json.cook === undefined
            ? []
            : [
                "To submit it from another of this server's wallets: sauce_wallet_send { wallet, " +
                  "transaction: <this result> } (it sends deployPot first, when there is one).",
              ]),
          HOT_WALLET,
        ],
      };
    },
  );
}
