/**
 * Sending what the caller signed: `sauce_send`, the `sauce send` command as a tool. The other tools
 * build transactions unsigned; whoever holds the key — a KMS, a hardware wallet, another wallet's
 * MCP server — signs them, and this broadcasts the signed bytes, waits for each to land and reports
 * what it did. It takes no key and returns none, so it is served over HTTP as over stdio: the
 * server spends nothing of its own, and the caller's endpoint goes through the guard like any
 * other.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import {
  parseChain,
  requireSupported,
  sendCommand,
  signedChain,
  supportedChainNames,
} from "./sdk.js";
import { chainRef, LIMITS, refusable, RPC_URL, toolRegistrar, type ToolContext } from "./tools.js";

/**
 * The most a call sends, and the longest one signed transaction can be: an EVM transaction's 128
 * KiB as hex (a Solana one is 1232 bytes, base64). Over HTTP the server is no unbounded relay.
 */
export const SEND_MOST = 32;
export const SIGNED_MOST = 2 + 2 * 128 * 1024;

/** The sending tools, in the order `tools/list` gives them (after the intent tools). */
export const SEND_TOOL_NAMES = ["sauce_send"] as const;

/** Broadcasts what the caller signed: what it spends is gone, and sending it twice changes nothing. */
const BROADCASTS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerSendTools(server: McpServer, context: ToolContext): void {
  const tool = toolRegistrar(server, context);

  tool(
    "sauce_send",
    {
      title: "Send signed transactions",
      description:
        "Broadcasts transactions the caller has signed — the ones sauce_tx, sauce_pot, " +
        "sauce_actions, sauce_intent_publish and the intent tools build unsigned, signed by any " +
        "wallet or signer (a KMS, a hardware wallet, another wallet's tool) — waits for each to " +
        "land, and reports what it did. It takes no key and never signs. `transactions` are the " +
        "SIGNED bytes, in the order to send them: on an EVM chain the raw 0x… hex a signer " +
        "returns (chain and sender read from it), on Solana the base64 wire transaction (every " +
        "signature checked). Each is simulated as signed first — EVM an eth_call from its sender " +
        "with its gas limit held to what that used, Solana a simulation that checks the " +
        "signatures — and one that would fail is not sent: the call fails with the reason, or, " +
        "once an earlier one landed, stops there with ok false. Each lands before the next is " +
        "simulated, so a cook after its Pot's deployment runs on the Pot. One already on chain is " +
        "read back, not sent again; one the chain had, pending, then lost (dropped or reorged " +
        "out) is reported gone, to sign anew. A Solana transaction missing a signature (its fee " +
        "payer's, or any its message names) is refused by name. Returns `sent`: each one's hash (a Solana signature), " +
        "status, `explorer` and `trace` (links to give the user, never to fetch), fee or gas, " +
        "the decoded `reason` of a failure, and for a cook what moved (`moves` on EVM, " +
        "`tokenChanges` and `lamportChanges` on Solana), `leftInPot`, and on Solana `returns` " +
        "(main's value, hex); and on a transaction that deployed a Pot, `pots`: each Pot as the " +
        "sauce command records it (chain, address, owner, salt, kind, Kitchen, the engine and " +
        "compiler release it was minted under, the deploying transaction), to keep: this server " +
        "keeps none. A Solana transaction lands within about a minute of being built, " +
        "or never: one whose blockhash expired is refused, to build and sign again. A Solana " +
        "cook too large " +
        "for one transaction comes from sauce_tx as a plan: its first step's `transactions` " +
        "(the setup: the Pot and token accounts, the program staged in a code buffer, a lookup " +
        "table), and a `cursor`. Send them signed with that cursor, and `next` is the step " +
        "after (the cook, then the code buffer's close), built fresh, with its own cursor; " +
        "repeat until `next.step` is done. Whatever did not land is built again, so a step " +
        "that expired comes back with only what is left: send the cursor alone for it. A step " +
        "with nothing to sign says why in `next.wait` (a cook handed out that can still land, " +
        "or a lookup table in use only from the next slot, about half a second on): call again " +
        "with the cursor alone for it; nothing waits here. A cook its simulation says would " +
        "fail is not built: `next.fails` says why, with `next.logs`, and the cursor alone " +
        "simulates it again once what it needs is there. Needs " +
        "the chain's " +
        `endpoint (rpcUrl, or the server's). It sends only on ${supportedChainNames()}, the ` +
        "chains this release supports; on any other it is refused before any endpoint is " +
        "reached, with `refused` saying how to request the chain.",
      input: {
        transactions: z
          .array(z.string().min(2).max(SIGNED_MOST))
          .max(SEND_MOST)
          .optional()
          .describe(
            `The signed transactions, in the order to send them (at most ${SEND_MOST}): raw 0x… ` +
              "hex on an EVM chain, base64 wire transactions on Solana.",
          ),
        cursor: z
          .string()
          .min(1)
          .max(LIMITS.cursor)
          .optional()
          .describe(
            "Solana: the plan's cursor sauce_tx (or the last sauce_send's `next`) returned. With " +
              "it, `next` is the plan's next step, built fresh from what the cluster shows. Alone " +
              "(no transactions), it builds that step without sending anything.",
          ),
        signatures: z
          .array(z.string().min(32).max(100))
          .max(SEND_MOST)
          .optional()
          .describe(
            "Solana: signatures of the plan's transactions you broadcast another way, to confirm " +
              "and report — so the plan knows how its cook went.",
          ),
        close: z
          .boolean()
          .optional()
          .describe(
            "Solana, with cursor: give up on the cook, and close the code buffer the plan staged.",
          ),
        chain: chainRef
          .optional()
          .describe(
            "The chain; needed only for a legacy EVM transaction signed without a chain id.",
          ),
        rpcUrl: RPC_URL,
      },
      output: refusable({
        chain: z.string(),
        chainId: z.number(),
        ok: z.boolean(),
        sent: z.array(z.looseObject({ hash: z.string(), status: z.string() })),
        next: z.looseObject({ step: z.string() }),
      }),
      annotations: BROADCASTS,
    },
    async (args, reach) => {
      const input = {
        transactions: args.transactions ?? [],
        signatures: args.signatures ?? [],
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      };
      const chain = signedChain(
        input,
        args.chain === undefined ? undefined : parseChain(String(args.chain), "chain"),
      );
      // Before any endpoint is reached.
      requireSupported("sending", [chain]);
      const rpcUrl = await reach.require(chain, args.rpcUrl, "Sending");
      const output = await sendCommand({
        ...input,
        chain,
        rpcUrl,
        ...(args.close === true ? { close: true } : {}),
      });

      return {
        json: output.json,
        notes: output.notes,
        ...(output.exitCode === undefined ? {} : { isError: true }),
      };
    },
  );
}
