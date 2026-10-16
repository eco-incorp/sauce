/**
 * The Pot store's tools, on a LOCAL server (over stdio), which keeps the `sauce` command's Pot store
 * as the command does (`McpServeOptions.stores`): `sauce_pot_list` and `sauce_pot_import`, calling
 * the functions `sauce pot list` and `sauce pot import` call, on the same directory. The records
 * themselves are written where a tool's transaction lands (`keep.ts`), as the command writes them.
 * Over HTTP they are not registered: that server keeps nothing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";

import {
  parseChain,
  potImportCommand,
  potImportTarget,
  potListCommand,
  potOwner,
  type PotStore,
} from "./sdk.js";
import { chainRef, POT, RPC_URL, toolRegistrar, type ToolContext } from "./tools.js";

/** The Pot store's tools, in the order `tools/list` gives them. */
export const POT_TOOL_NAMES = ["sauce_pot_list", "sauce_pot_import"] as const;

/** Reads the store, and nothing else. */
const READS_STORE: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Reads a chain, and adds to the store what it finds there; never changes a record. */
const RECORDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const POTS_OUTPUT = {
  store: z.string(),
  pots: z.array(z.looseObject({ chain: z.string(), pot: z.string(), owner: z.string() })),
};

const OWNER = z
  .string()
  .max(66)
  .describe(
    "A Pot's owner: a 0x address on an EVM chain; on Solana a public key, in base58 or as its 32 " +
      "bytes of 0x hex.",
  );

export function registerPotTools(server: McpServer, context: ToolContext, store: PotStore): void {
  const tool = toolRegistrar(server, context);

  tool(
    "sauce_pot_list",
    {
      title: "List the Pots deployed from this machine",
      description:
        "Lists the sauce command's Pot store, which this server keeps as the command does: every " +
        "Pot a transaction it sent deployed (sauce_send, sauce_wallet_send), every Pot the " +
        "sauce command deployed on this machine, and every Pot sauce_pot_import recorded. " +
        "Returns `pots`, each with its chain, address, owner, salt and kind (private, " +
        "private-fixed-router or shared), the Kitchen and the release it was minted under " +
        "(`release`: the compiler whose programs it runs and the engine's and Kitchen's " +
        "versions; `engine`), and `deployment`, the transaction that deployed it. It reads no " +
        "chain: sauce_pot says what a Pot holds now.",
      input: {
        chain: chainRef.optional().describe("Only the Pots on this chain."),
        owner: OWNER.optional().describe("Only this owner's Pots."),
      },
      output: POTS_OUTPUT,
      annotations: READS_STORE,
    },
    (args) => {
      const chain = args.chain === undefined ? undefined : parseChain(String(args.chain), "chain");
      const output = potListCommand(store, {
        ...(chain === undefined ? {} : { chain }),
        ...(args.owner === undefined ? {} : { owner: potOwner(chain, args.owner) }),
      });

      return { json: output.json, notes: output.notes };
    },
  );

  tool(
    "sauce_pot_import",
    {
      title: "Record a Pot deployed elsewhere",
      description:
        "Records in the Pot store a Pot this machine did not deploy, read from the chain, as " +
        "`sauce pot import` does. Give `pot`, its address (EVM chains): its owner, salt and " +
        "Kitchen are read off it, and its kind and release told from its address; an address " +
        "no release this server knows mints is refused. Or give `owner` with its salt (salt or " +
        "saltHex; default zero): every known release's Pot of that owner and salt that has code " +
        "is recorded. A Solana Pot names no owner, so there only owner and salt find it. A Pot " +
        "already recorded keeps its record. Returns `pots`, as sauce_pot_list gives them.",
      input: {
        chain: chainRef,
        pot: z.string().max(64).optional().describe("The Pot's 0x address (EVM chains)."),
        owner: OWNER.optional(),
        salt: POT.salt,
        saltHex: POT.saltHex,
        rpcUrl: RPC_URL,
      },
      output: POTS_OUTPUT,
      annotations: RECORDS,
    },
    async (args, reach) => {
      const chain = parseChain(String(args.chain), "chain");
      // The rules `sauce pot import` holds its flags to, its inputs named alike.
      const target = potImportTarget(chain, args);
      const output = await potImportCommand({
        store,
        chain,
        rpcUrl: await reach.require(chain, args.rpcUrl, "reading the Pot"),
        ...target,
      });

      return { json: output.json, notes: output.notes };
    },
  );
}
