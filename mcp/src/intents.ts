/**
 * An eco-routes intent's life after it is published, as tools: where it stands, and every
 * transaction that moves it on, built UNSIGNED by the SDK's lifecycle core
 * (`sdk/src/cli/lifecycle.ts`), the module `sauce intent fill|prove|claim|refund|cancel|import`
 * are a layer over. Each tool calls one of its functions and returns that function's JSON.
 *
 * Stateless. The command line keeps intents in a store under `~/.sauce`; this server keeps
 * nothing, so every call names its intent: the `record` a tool returned (sauce_intent_publish,
 * sauce_intent_import, sauce_intent_status), as the store would hold it, or the source
 * transaction that published it (`txHash` with `chain`), whose `IntentPublished` log is read back.
 * A record is checked against its own hash before anything is built from it (`intentOf`).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hex } from "viem";
import * as z from "zod";

import type { Reach } from "./reach.js";
import {
  buildCancel,
  buildClaim,
  buildFill,
  buildProve,
  buildRefund,
  defineLabels,
  fillCommand,
  fillTargets,
  importIntents,
  INTENT_SCHEMA,
  intentOf,
  intentRecord,
  intentStatus,
  parseAddress,
  parseChain,
  requireChain,
  UsageError,
  type CanonicalChain,
  type FillTarget,
  type IntentRecord,
} from "./sdk.js";
import { noEndpoint } from "./config.js";
import {
  CLAIMANT,
  chainRef,
  endpointsByChain,
  fromCommand,
  LIMITS,
  PROGRAM,
  programOf,
  READS_CHAIN,
  RPC_URLS,
  toolRegistrar,
  TX_HASH,
  UNSIGNED,
  type ProgramArgs,
  type ToolContext,
  type ToolOutput,
} from "./tools.js";

/** The intent tools, in the order `tools/list` gives them: the order of an intent's life. */
export const INTENT_TOOL_NAMES = [
  "sauce_intent_import",
  "sauce_intent_status",
  "sauce_intent_fill",
  "sauce_intent_prove",
  "sauce_intent_claim",
  "sauce_intent_refund",
  "sauce_intent_cancel",
] as const;

// ---------------------------------------------------------------------------------------------
// Naming the intent
// ---------------------------------------------------------------------------------------------

/** An intent record as JSON, checked for its shape here and for its hash by `intentOf`. */
const RECORD = z.looseObject({
  schema: z.string(),
  intentHash: z.string(),
  source: z.looseObject({ chainId: z.number(), portal: z.string() }),
  destination: z.looseObject({ chainId: z.number() }),
  route: z.looseObject({}),
  reward: z.looseObject({}),
});
// The input takes any object, so a malformed record reaches `recordOf`, which names what is wrong
// with it, rather than the transport's bare "invalid input".
const RECORD_INPUT = z.union([z.looseObject({}), z.string().min(2).max(LIMITS.source)]);

const RECORD_HELP =
  `The intent in full: the \`record\` sauce_intent_publish, sauce_intent_import or ` +
  `sauce_intent_status returns (schema ${INTENT_SCHEMA}), as an object or its JSON text. Its ` +
  "route and reward are checked against its intentHash. Give this or txHash.";

/** The ways a call names one intent. */
const ONE = {
  intent: RECORD_INPUT.optional().describe(RECORD_HELP),
  txHash: z
    .string()
    .regex(TX_HASH, "a transaction hash: 0x and 64 hex digits")
    .optional()
    .describe(
      "Instead of intent: the SOURCE chain transaction that published it, with chain. Its " +
        "IntentPublished log is read back, which needs the source chain's endpoint.",
    ),
  chain: chainRef
    .optional()
    .describe("With txHash: the SOURCE chain it was sent on (slug, alias or id)."),
  index: z
    .number()
    .int()
    .min(0)
    .max(255)
    .optional()
    .describe("With txHash: which intent it published, from 0, when it published several."),
};

/** The same, for a tool that takes several intents at once. */
const MANY = {
  ...ONE,
  intent: z
    .union([RECORD_INPUT, z.array(RECORD_INPUT).min(1).max(LIMITS.entries)])
    .optional()
    .describe(
      `${RECORD_HELP} Or a list of records, to act on them together; with txHash and no ` +
        "index, every intent the transaction published.",
    ),
};

/** `rpcUrl` (the chain the tool needs, named) and `rpcUrls` (by chain). */
const endpointInputs = (which: string) => ({
  rpcUrl: z
    .string()
    .min(1)
    .max(2048)
    .optional()
    .describe(
      `${which}'s endpoint, for this call only: never returned or logged. rpcUrls instead ` +
        "gives each chain's.",
    ),
  rpcUrls: RPC_URLS.describe(
    'Endpoints by chain, slug or id: { "arbitrum": "<url>", "base": "<url>" }, for a call ' +
      "that reads both the intent's chains. Used for this call only; the server's own " +
      "endpoints fill the gaps.",
  ),
});

interface RefArgs {
  readonly intent?: unknown;
  readonly txHash?: string | undefined;
  readonly chain?: string | number | undefined;
  readonly index?: number | undefined;
  readonly rpcUrl?: string | undefined;
  readonly rpcUrls?: Readonly<Record<string, string>> | undefined;
}

/** `value` as an intent record: JSON text parsed, the shape checked, the hash checked. */
function recordOf(value: unknown, where: string): IntentRecord {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new UsageError(`${where}: not JSON`);
    }
  }
  const shaped = RECORD.safeParse(parsed);
  if (!shaped.success) {
    const issues = shaped.error.issues
      .map((issue) => `${issue.path.join(".") || "the record"}: ${issue.message}`)
      .join("; ");
    throw new UsageError(
      `${where} is not an intent record (${INTENT_SCHEMA}): ${issues}. Pass the record ` +
        "sauce_intent_import or sauce_intent_publish returns",
    );
  }
  const record = shaped.data as unknown as IntentRecord;
  intentOf(record);

  return record;
}

/** Which of an intent's chains a tool's `rpcUrl` is for. */
type Side = "source" | "destination";

/**
 * The intents a call names, and the endpoint of every chain they touch: the call's (`rpcUrls`
 * by chain, `rpcUrl` for `side`), else the server's. An imported intent is read from its source
 * transaction first, through the source chain's endpoint.
 */
async function located(
  args: RefArgs,
  reach: Reach,
  options: { readonly side?: Side; readonly many: boolean },
): Promise<{ readonly records: IntentRecord[]; readonly endpoints: Record<string, string> }> {
  if ((args.intent === undefined) === (args.txHash === undefined)) {
    throw new UsageError(
      "give intent (its record, as sauce_intent_import or sauce_intent_publish returns it) or " +
        "txHash with chain (the transaction that published it), not both",
    );
  }
  const byChain = await endpointsByChain(args.rpcUrls, reach);
  const prepared = new Map<number, string | undefined>();
  const endpointOf = async (chain: CanonicalChain, side: Side): Promise<string | undefined> => {
    const given = byChain.get(chain.id);
    if (given !== undefined) return given;
    if (!prepared.has(chain.id)) {
      prepared.set(
        chain.id,
        await reach.endpoint(chain, options.side === side ? args.rpcUrl : undefined),
      );
    }

    return prepared.get(chain.id);
  };

  let records: IntentRecord[];
  if (args.intent !== undefined) {
    if (args.chain !== undefined || args.index !== undefined) {
      throw new UsageError("chain and index go with txHash: a record names its own chains");
    }
    const given = Array.isArray(args.intent) ? args.intent : [args.intent];
    records = given.map((each, at) =>
      recordOf(each, given.length === 1 ? "intent" : `intent[${at}]`),
    );
  } else {
    if (args.chain === undefined) {
      throw new UsageError("txHash needs chain: the source chain the transaction was sent on");
    }
    const source = parseChain(String(args.chain), "chain");
    const url =
      (await endpointOf(source, "source")) ??
      (await reach.require(source, undefined, "Reading the transaction that published it"));
    const imported = await importIntents(
      {
        txHash: args.txHash as Hex,
        chain: source.id,
        ...(args.index === undefined ? {} : { index: args.index }),
      },
      { [String(source.id)]: url },
    );
    records = imported.intents.map((each) => each.record);
  }
  if (!options.many && records.length > 1) {
    throw new UsageError(
      `${args.txHash} published ${records.length} intents: give index (0 to ` +
        `${records.length - 1}), or pass the one record`,
    );
  }

  const endpoints: Record<string, string> = {};
  for (const record of records) {
    for (const [id, side] of [
      [record.source.chainId, "source"],
      [record.destination.chainId, "destination"],
    ] as const) {
      const url = await endpointOf(requireChain(id), side);
      if (url !== undefined) endpoints[String(id)] = url;
    }
  }

  return { records, endpoints };
}

/**
 * The core's plan as a tool result. No one in particular signs it — every step after the fill is
 * permissionless — so `from` is null, and a ready plan's notes say who may send it.
 */
function anyone(
  plan: { readonly ready: boolean; readonly notes: readonly string[] },
  what: string,
): ToolOutput {
  const { notes, ...rest } = plan;

  return {
    json: { from: null, ...rest },
    notes: [
      ...notes,
      ...(plan.ready
        ? [
            `Any account may send ${what}, in order, on the chain each transaction names; the ` +
              "sender pays the gas and its value, and receives nothing.",
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------

/** What a plan returns, at the least. */
const PLAN_OUTPUT = {
  ready: z.boolean(),
  why: z.string().optional(),
  from: z.string().nullable(),
  transactions: z.array(
    z.looseObject({
      chainId: z.number(),
      to: z.string(),
      data: z.string(),
      value: z.string(),
      what: z.string(),
    }),
  ),
};

const NOT_YET =
  "A step that cannot be taken yet is a result, not an error: ready false and `why` (the " +
  "state that stops it, and when it can).";

export function registerIntentTools(server: McpServer, context: ToolContext): void {
  const { endpoints: serverEndpoints } = context;
  const tool = toolRegistrar(server, context);

  tool(
    "sauce_intent_import",
    {
      title: "Read a published intent back from its transaction",
      description:
        "Rebuilds the intents a source-chain transaction published, from its IntentPublished " +
        "logs: each one's full `record` (what every other sauce_intent_* tool takes as " +
        "`intent`), with its vault, block, time and whether the same transaction funded it. " +
        "Use it for an intent someone else published, or one published outside this server. " +
        "Needs the source chain's endpoint. Reads only.",
      input: {
        txHash: ONE.txHash.unwrap().describe("The source chain transaction that published it."),
        chain: chainRef.describe("The SOURCE chain it was sent on (slug, alias or id)."),
        index: ONE.index,
        ...endpointInputs("The source chain"),
      },
      output: {
        intents: z.array(
          z.looseObject({ record: z.looseObject({ intentHash: z.string() }), funded: z.boolean() }),
        ),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const source = parseChain(String(args.chain), "chain");
      const byChain = await endpointsByChain(args.rpcUrls, reach);
      const url =
        byChain.get(source.id) ??
        (await reach.require(source, args.rpcUrl, "Reading the transaction that published it"));
      const imported = await importIntents(
        {
          txHash: args.txHash as Hex,
          chain: source.id,
          ...(args.index === undefined ? {} : { index: args.index }),
        },
        { [String(source.id)]: url },
      );

      return { json: { intents: imported.intents }, notes: imported.notes };
    },
  );

  tool(
    "sauce_intent_status",
    {
      title: "Where an intent stands, and what can be done next",
      description:
        "Reads an intent's state from both its chains: `state` (unfunded, funded, filled, " +
        "cancelled, proven, cancelProven, claimed, refunded: the furthest one read), the " +
        "source side (reward status, vault and what it holds, the prover's proof) and the " +
        "destination side (the claimant the Portal recorded, cancelled or not, whether its " +
        "Portal can cancel), the route's and the reward's deadlines, the prover, and `can`: for " +
        "fill, prove, claim, refund and cancel, whether it can be done now (`ok`), why not, and " +
        "from when (`at`, Unix seconds). With one chain's endpoint only, it reads that side and " +
        "says what it could not. Use it before any other intent step. Reads only.",
      input: {
        ...ONE,
        rpcUrls: endpointInputs("").rpcUrls,
      },
      output: {
        intentHash: z.string(),
        state: z.string(),
        can: z.looseObject({}),
        record: z.looseObject({}),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const { records, endpoints } = await located(args, reach, { many: false });
      const record = records[0]!;
      if (Object.keys(endpoints).length === 0) {
        const [source, destination] = [record.source.chain, record.destination.chain];
        throw new UsageError(
          `Reading where an intent stands needs an endpoint for ${source} or ${destination}: ` +
            `pass rpcUrls { "${source}": "<url>", "${destination}": "<url>" } with the call ` +
            "(both, to read both sides; or the server's operator adds them to its --config file)",
        );
      }
      const status = await intentStatus(record, endpoints);

      const { notes, ...read } = status;

      return { json: { ...read, record }, notes };
    },
  );

  tool(
    "sauce_intent_fill",
    {
      title: "Fill an intent on its destination: the solver's transactions, or a rehearsal",
      description:
        "What a solver sends on an intent's DESTINATION chain to fill it, built unsigned for " +
        "the solver (`from`) to sign: the shared intent Pot's deployment when the route cooks " +
        "on it and it is not there yet, an approval of the Portal for each token the route " +
        "delivers (reset to 0 first where an allowance stands, for USDT), then " +
        "Portal.fulfillAndProve with the prover's fee quoted into its value — or Portal.fulfill " +
        "with prove false, or where this server cannot drive the reward's prover (notes say). " +
        "Name the intent by its record or txHash, or give the program that opens it (source " +
        "and the sauce_intent_publish inputs, chain the SOURCE). With dryRun, instead rehearse " +
        "the fill there in one eth_simulateV1 block, from any solver (no from needed): per " +
        "intent ok with gas and what moved, or the decoded reason it reverts. Needs the " +
        "destination's endpoint, and the source's to check the prover. " +
        UNSIGNED,
      input: {
        ...PROGRAM,
        source: PROGRAM.source
          .optional()
          .describe(
            "Or the SauceScript program that opens the intents, as sauce_intent_publish takes " +
              "it: every intent it opens, fixed when it is built.",
          ),
        chain: chainRef
          .optional()
          .describe(
            "The SOURCE chain: where the program publishes (with source), or where txHash was " +
              "sent.",
          ),
        intent: MANY.intent,
        txHash: ONE.txHash,
        index: ONE.index,
        from: z
          .string()
          .max(64)
          .optional()
          .describe(
            "The solver's 0x address, which signs these: its balances and standing allowances " +
              "plan them. Needed unless dryRun.",
          ),
        claimant: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Who claims the reward, as fulfill records it: a 0x address or 32 bytes of hex " +
              "(default: the solver).",
          ),
        prove: z
          .boolean()
          .optional()
          .describe(
            "true: fulfillAndProve, the proof sent in the same transaction (its fee in the " +
              "value); false: fulfill, proven later with sauce_intent_prove. Default: prove " +
              "where the reward's prover is one this server drives.",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe("Rehearse the fill (eth_simulateV1) instead of building it; nothing signed."),
        ...endpointInputs("The destination chain"),
      },
      output: {
        intents: z.array(z.looseObject({ intentHash: z.string() })),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const named = [args.source, args.intent, args.txHash].filter((each) => each !== undefined);
      if (named.length !== 1) {
        throw new UsageError(
          "name the intents one way: source (the program that opens them), intent (a record or " +
            "a list), or txHash with chain",
        );
      }
      if (args.claimant !== undefined && !CLAIMANT.test(args.claimant)) {
        throw new UsageError(
          `claimant: '${args.claimant}' is neither an address (20 bytes) nor 32 bytes of hex`,
        );
      }
      let records: IntentRecord[];
      let endpoints: Record<string, string>;
      let labels: ReturnType<typeof defineLabels> = [];
      let from = "the call's intent";
      if (args.source !== undefined) {
        const program = programOf(args as ProgramArgs);
        const targets = fillTargets(program.input, program.files);
        records = targets.map((target) =>
          intentRecord(target.intent, { sourcePortal: target.sourcePortal }),
        );
        labels = defineLabels(program.input);
        from = program.input.file;
        // A program's intents are named by the program, and their endpoints by the call.
        ({ endpoints } = await located(
          { intent: records, rpcUrl: args.rpcUrl, rpcUrls: args.rpcUrls },
          reach,
          { side: "destination", many: true },
        ));
      } else {
        ({ records, endpoints } = await located(args, reach, {
          side: "destination",
          many: true,
        }));
      }
      const claimant = args.claimant as Hex | undefined;

      if (args.dryRun === true) {
        const targets: FillTarget[] = records.map((record) => ({
          intent: intentOf(record),
          source: requireChain(record.source.chainId),
          destination: requireChain(record.destination.chainId),
          sourcePortal: record.source.portal,
        }));
        const output = await fillCommand({
          intents: targets,
          from,
          labels,
          endpointOf: (chain) => {
            const url = endpoints[String(chain.id)];
            if (url === undefined) throw noEndpoint(chain, serverEndpoints, "Rehearsing a fill");

            return url;
          },
          sourceEndpointOf: (chain) => endpoints[String(chain.id)],
          endpointFlag: args.rpcUrl === undefined ? "--config" : "--rpc-url",
          ...(args.from === undefined ? {} : { solver: parseAddress("from", args.from) }),
          ...(claimant === undefined ? {} : { claimant }),
          ...(args.prove === undefined ? {} : { prove: args.prove }),
        });

        return fromCommand(output);
      }
      if (args.from === undefined) {
        throw new UsageError(
          "give from: the solver's address, which signs these (its balances and allowances plan " +
            "them), or dryRun to rehearse the fill with no account",
        );
      }
      const solver = parseAddress("from", args.from);
      const fills = [];
      const notes: string[] = [];
      for (const record of records) {
        const destination = requireChain(record.destination.chainId);
        if (endpoints[String(destination.id)] === undefined) {
          throw noEndpoint(destination, serverEndpoints, "Building a fill");
        }
        const built = await buildFill(record, endpoints, {
          from: solver,
          ...(claimant === undefined ? {} : { claimant }),
          ...(args.prove === undefined ? {} : { prove: args.prove }),
        });
        const { notes: said, ...fill } = built;
        fills.push({ intentHash: record.intentHash, destination: destination.slug, ...fill });
        notes.push(...said);
      }
      notes.push(
        `Only ${solver} may send these, in order, on each intent's destination: the Portal pulls ` +
          "what the route delivers from the account that calls fulfill.",
      );

      return { json: { from: solver, intents: fills }, notes };
    },
  );

  tool(
    "sauce_intent_prove",
    {
      title: "Prove filled or cancelled intents back to their source",
      description:
        "The destination-chain transaction that sends the proof of one or more fills (or " +
        "cancellations) to the source chain's prover, so the reward can be claimed (or, for a " +
        "cancellation, refunded early): Portal.prove with the bridge's fee, quoted from the " +
        "destination prover, as its value. Intents proven together share one message, and must " +
        "share their chains and prover; one the source has proven already is left out, saying " +
        "so. Needed after a fill with prove false or a cancel without it; a fulfillAndProve " +
        "proved already. The proof arrives after the bridge delivers it: sauce_intent_status " +
        `then says proven. ${NOT_YET} Any account may send it. ${UNSIGNED}`,
      input: {
        ...MANY,
        cancelledIn: z
          .record(z.string().max(80), z.string().max(30))
          .optional()
          .describe(
            "For a cancelled intent: the destination block its cancel landed in, by intent " +
              "hash; the proof waits until that block is final (eco-routes asks so).",
          ),
        ...endpointInputs("The destination chain"),
      },
      output: PLAN_OUTPUT,
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const { records, endpoints } = await located(args, reach, {
        side: "destination",
        many: true,
      });
      const plan = await buildProve(records, endpoints, {
        ...(args.cancelledIn === undefined ? {} : { cancelledIn: args.cancelledIn }),
      });

      return anyone(plan, "the proof (its value pays the bridge)");
    },
  );

  tool(
    "sauce_intent_claim",
    {
      title: "Claim proven intents' rewards on their source",
      description:
        "The source-chain transaction that pays each proven intent's reward out of its vault to " +
        "the claimant the proof names: Portal.withdraw for one, batchWithdraw for several " +
        "(same source chain). Returns what each claim moves. An intent not proven yet, already " +
        "claimed, refunded, or proven cancelled (which pays no claimant) is refused or left " +
        `out, saying why. ${NOT_YET} Any account may send it: the reward goes to the claimant, ` +
        `not the sender. Needs the source chain's endpoint. ${UNSIGNED}`,
      input: { ...MANY, ...endpointInputs("The source chain") },
      output: { ...PLAN_OUTPUT, claims: z.array(z.looseObject({})).optional() },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const { records, endpoints } = await located(args, reach, { side: "source", many: true });

      return anyone(await buildClaim(records, endpoints), "the claim");
    },
  );

  tool(
    "sauce_intent_refund",
    {
      title: "Refund an intent's reward to its creator",
      description:
        "The source-chain transaction that returns an intent's reward from its vault to its " +
        "creator: Portal.refund. Allowed from the reward's deadline for an intent no one " +
        "proved, or EARLIER once a proven cancellation is recorded on the source (a source " +
        "Portal that predates proven cancellation is never refunded early), and for a claimed " +
        `one only what is left. Returns the refundee and what moves. ${NOT_YET} Any account ` +
        `may send it: the reward goes to the creator. Needs the source chain's endpoint. ${UNSIGNED}`,
      input: { ...ONE, ...endpointInputs("The source chain") },
      output: {
        ...PLAN_OUTPUT,
        refundee: z.string().optional(),
        moves: z.array(z.unknown()).optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const { records, endpoints } = await located(args, reach, { side: "source", many: false });

      return anyone(await buildRefund(records[0]!, endpoints), "the refund");
    },
  );

  tool(
    "sauce_intent_cancel",
    {
      title: "Cancel an unfilled intent on its destination",
      description:
        "The destination-chain transaction that records an intent cancelled, so no solver can " +
        "fill it and its reward can be refunded before the reward's deadline: Portal.cancel, or " +
        "with prove true Portal.cancelAndProve, which also sends the proof of cancellation to " +
        "the source (the bridge's fee quoted into its value; eco-routes asks for the proof to " +
        "wait for the destination's finality, so the default is cancel, then sauce_intent_prove " +
        "once final, then sauce_intent_refund). Permissionless, and only after the route's " +
        "deadline has passed with the intent unfilled; refused on a destination Portal that " +
        "cannot cancel, or a source Portal that would pay a proven cancellation to no one, " +
        `saying when the refund is instead. ${NOT_YET} Any account may send it. ${UNSIGNED}`,
      input: {
        ...ONE,
        prove: z
          .boolean()
          .optional()
          .describe(
            "true: cancelAndProve, the proof sent at once (before finality; the result warns). " +
              "Default false: cancel only.",
          ),
        ...endpointInputs("The destination chain"),
      },
      output: PLAN_OUTPUT,
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const { records, endpoints } = await located(args, reach, {
        side: "destination",
        many: false,
      });
      const plan = await buildCancel(records[0]!, endpoints, {
        ...(args.prove === undefined ? {} : { prove: args.prove }),
      });

      return anyone(
        plan,
        args.prove === true ? "the cancellation (its value pays the bridge)" : "the cancellation",
      );
    },
  );
}
