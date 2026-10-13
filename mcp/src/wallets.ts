/**
 * The wallet tools, on a server started over stdio with `--wallets` and a password source: create a
 * wallet, list them, and send what the other tools build from one. They are the `sauce` command's
 * own (`sdk/src/cli/wallets.ts`, `wallet-commands.ts`, `wallet-send.ts`): the same directory, the
 * same keystores, the same policy and ledger, the same rehearsal before anything is sent.
 *
 * The password was read when the server started (`sdk/src/cli/mcp.ts`), from the source its
 * operator named — an environment variable the client's config passes from the agent's `.env`, a
 * file, a secret manager's command — so it is never a tool's input and never in the model's
 * context. No tool takes a key, a password or a seed, and none returns one: a wallet's key leaves
 * its file only to sign, in this process. There is no export tool (the CLI's `sauce wallet export`
 * shows a key only at a terminal). Over HTTP these tools are not registered at all: the HTTP server
 * never signs.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import {
  checkPlan,
  HOT_WALLET,
  noPolicyNote,
  openWallet,
  parseChain,
  planChain,
  plannedCursor,
  plannedHandedOut,
  planFor,
  plannedTransactions,
  readPolicy,
  sendPlan,
  sendSvmPlan,
  supportedChainNames,
  UsageError,
  walletName,
} from "./sdk.js";
import {
  chainRef,
  LIMITS,
  refusable,
  toolRegistrar,
  type ToolContext,
  type WalletContext,
} from "./tools.js";

/** The wallet tools, in the order `tools/list` gives them. */
export const WALLET_TOOL_NAMES = [
  "sauce_wallet_create",
  "sauce_wallet_list",
  "sauce_wallet_send",
] as const;

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

const WALLET = z
  .string()
  .min(1)
  .max(64)
  .describe("The wallet's name, as sauce_wallet_list gives it.");

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

/** Whether a wallet has a policy, a broken one counted as one (a send refuses it). */
function hasPolicy(info: Parameters<typeof readPolicy>[0]): boolean {
  try {
    return readPolicy(info) !== undefined;
  } catch {
    return true;
  }
}

export function registerWalletTools(
  server: McpServer,
  context: ToolContext & { readonly wallets: WalletContext },
): void {
  const tool = toolRegistrar(server, context);
  const { store, password } = context.wallets;

  tool(
    "sauce_wallet_create",
    {
      title: "Create a wallet",
      description:
        "Creates a wallet with a fresh key in this server's wallet directory, encrypted under " +
        "the password the server was started with, and returns its name, kind and address — " +
        "never its key. kind evm (the default) signs on EVM chains, solana on Solana. A name is " +
        "never reused: an existing wallet is never overwritten. Fund the address before sending " +
        "from it. It is a hot wallet, so keep small balances in it; the user may limit what it " +
        "sends with a policy file beside it (path in the result).",
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
      output: {
        name: z.string(),
        kind: z.enum(["evm", "solana"]),
        address: z.string(),
        policy: z.string().nullable(),
      },
      annotations: CREATES,
    },
    async (args) => {
      const name = walletName(args.name);
      if (store.list().wallets.some((wallet) => wallet.name === name)) {
        throw new UsageError(
          `wallet ${name} exists: a wallet is never overwritten (pick another name)`,
        );
      }
      const { info, warnings } = await store.create(name, args.kind ?? "evm", password);

      return {
        json: walletJson(info, hasPolicy(info)),
        notes: [...warnings, noPolicyNote(info), HOT_WALLET],
      };
    },
  );

  tool(
    "sauce_wallet_list",
    {
      title: "List the wallets",
      description:
        "Lists this server's wallets: each one's name, kind (evm or solana), address, and the " +
        "policy that limits what it sends (null: no limits). Use an address as `from` or `owner` " +
        "in the other tools, and the name in sauce_wallet_send. Reads no chain.",
      input: {},
      output: { wallets: z.array(z.looseObject({ name: z.string(), address: z.string() })) },
      annotations: READS,
    },
    () => {
      const { wallets, warnings } = store.list();

      return {
        json: { wallets: wallets.map((info) => walletJson(info, hasPolicy(info))) },
        notes: warnings,
      };
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
        "sauce_actions (with owner), sauce_intent_publish, sauce_intent_fill, sauce_intent_prove, " +
        "sauce_intent_claim, sauce_intent_refund, sauce_intent_cancel — or one transaction ({ to, " +
        "data, value }, or a Solana { transaction }), or a list. First it rehearses them: on an " +
        "EVM chain all together in one eth_simulateV1 block from the wallet, on Solana each as " +
        "signed; it refuses, sending nothing, if any would revert, and refuses what the wallet's " +
        "policy does not allow, naming the limit. Then it sends each in order, rehearsing it " +
        "again, and stops at the first that does not succeed. Returns each one's hash (a Solana " +
        "signature) and status, with `explorer` and `trace` (Phalcon: calls and balance changes) " +
        "beside it, links to give the user to open in a browser, never to fetch; and for an EVM " +
        "cook, from its receipt, `moves` (what moved, in order, by role), `leftInPot` (what the " +
        "Pot holds after it of what it moved, not in the wallet) and `summary`, the same as lines " +
        "to read and report. Build the transactions for the wallet's address: as `owner` or " +
        "`from` in the tool that builds them. Needs the chain's endpoint (rpcUrl, or the " +
        "server's). What it sends is spent: rehearse with sauce_simulate first. It sends only on " +
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
              "wei, a decimal string); a Solana one is { transaction } in base64, built for the " +
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
      // A Solana plan (sauce_tx's, or sauce_send's `next`): every step, from its cursor.
      const cursor = plannedCursor(args.transaction);
      if (cursor !== undefined) {
        // The plan's owner, held to the wallet before the wallet is unlocked or anything is read.
        planFor(cursor, store.info(walletName(args.wallet)));
        const chain =
          args.chain === undefined
            ? parseChain("solana", "chain")
            : parseChain(String(args.chain), "chain");
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
}
