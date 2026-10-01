/**
 * The tools: the `sauce` command's read-only half, one tool per command, each calling the function
 * that command calls (`sdk.ts`) with the inputs it takes. No tool signs or sends anything, and
 * none takes a key: a transaction comes back unsigned, for a wallet the caller holds.
 *
 * A tool that reads a chain uses the call's own `rpcUrl`, else the server's endpoint for that chain
 * from `--config`, else says plainly that it has none (`reach.ts`). Every result and every error is
 * scrubbed of both, so no endpoint URL — which usually carries a provider key — leaves the server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { formatUnits, getAddress, numberToHex, parseAbi, type Address, type Hex } from "viem";
import * as z from "zod";

import { noEndpoint, type Endpoints } from "./config.js";
import { callFiles, DEFAULT_FILE } from "./files.js";
import type { RpcGuard } from "./guard.js";
import { callReach, type Reach } from "./reach.js";
import { toolTerms } from "./terms.js";
import {
  actionSource,
  assumedBalances,
  CANONICAL_CHAINS,
  chainById,
  compileCommand,
  compileProgram,
  connect,
  definesReach,
  fillCommand,
  fundingFor,
  globalsCommand,
  inspectCommand,
  inspectFile,
  kitchenFee,
  parseAccounts,
  parseAddress,
  parseChain,
  parseDefineMap,
  parsePin,
  parsePriceToken,
  parsePubkey,
  parseSalt,
  parseUnixSeconds,
  parseWei,
  potCommand,
  potState,
  potTarget,
  priceCommand,
  pricedChain,
  priceGiven,
  programChain,
  publishCommand,
  registeredBalances,
  simulateCommand,
  svmPotCommand,
  svmPotExists,
  svmPotTokenAccounts,
  svmSimulateCommand,
  svmTxCommand,
  svmVerifyCommand,
  txCommand,
  UsageError,
  verifyCommand,
  type CanonicalChain,
  type CliFiles,
  type CommandOutput,
  type CookInput,
  type DefineValue,
  type ProgramInput,
  type SvmCookInput,
} from "./sdk.js";

/** Input bounds, so one call cannot hand the server unbounded work. */
export const LIMITS = {
  /** Characters of one program or module, or of an action document. */
  source: 256 * 1024,
  /** Modules besides the program. */
  modules: 32,
  /** Characters of every module together. */
  modulesTotal: 512 * 1024,
  /** Characters of hex: calldata, a payload, a program. */
  hex: 1024 * 1024,
  /** Entries of a list or map: defines, arguments, accounts, balances. */
  entries: 64,
} as const;

// ---------------------------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------------------------

const chainRef = z
  .union([z.string().min(1).max(64), z.number().int().nonnegative()])
  .describe(
    "The chain: its slug (base, arbitrum, solana), an alias, or its numeric id (8453). " +
      "sauce_chains lists every one.",
  );

/** An integer as a JSON number (exact to 2^53) or as a decimal or 0x-hex string. */
const integer = z.union([z.string().min(1).max(80), z.number().int().nonnegative()]);

const RPC_URL = z
  .string()
  .min(1)
  .max(2048)
  .optional()
  .describe(
    "An RPC endpoint for the chain, used for this call only; it takes precedence over the " +
      "server's own endpoint for the chain. It is never returned or logged. A server someone " +
      "else runs sees it, so pass only a key you would share with them, or run the server " +
      "yourself. A server served over HTTP reaches only public https endpoints.",
  );

const PROGRAM = {
  source: z
    .string()
    .min(1)
    .max(LIMITS.source)
    .describe("The SauceScript program: the whole text of a .sauce.ts file."),
  file: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe(
      `The program's file name, for messages and for resolving its relative imports ` +
        `(default ${DEFAULT_FILE}).`,
    ),
  modules: z
    .record(z.string().min(1).max(256), z.string().max(LIMITS.source))
    .optional()
    .describe(
      "Other files the program imports by relative path, as path → text, each path from the " +
        "directory of `file` (lib/math.sauce.ts). The server reads nothing from its own disk, " +
        "but serves what the SDK ships without being passed: @sauce/token, @sauce/router, " +
        "./artifacts/IERC20.json, ./artifacts/ISauceRouter.json and ./protocols/<slug>/<Export>.json.",
    ),
  chain: chainRef
    .optional()
    .describe(
      "The chain the program runs on: slug, alias or id. Default: the program's own " +
        "`// @chain <slug>` header line; with target svm alone, solana.",
    ),
  target: z
    .enum(["evm", "svm"])
    .optional()
    .describe("evm or svm, checked against the chain; svm alone means solana."),
  defines: z
    .record(
      z.string().min(1).max(128),
      z.union([z.string().max(100), z.number().int().nonnegative(), z.boolean()]),
    )
    .optional()
    .describe(
      "Compile-time values, by the name the program reads: an integer in base units (decimal " +
        "or 0x hex; a string past 2^53), an EVM address as 0x hex, a Solana key in base58 " +
        "(Solana programs), true or false. A define replaces the program's module-level const " +
        "of that name.",
    ),
  compactArgs: z
    .boolean()
    .optional()
    .describe("Encode main's arguments compact-v1 instead of ABI-v1 (default false)."),
  intentDeadline: integer
    .optional()
    .describe("For intents the program opens: their deadline, as Unix seconds."),
  intentCreator: z
    .string()
    .max(64)
    .optional()
    .describe(
      "For intents the program opens: their creator (0x address), who may reclaim an unearned " +
        "reward.",
    ),
  intentExecutionFee: integer
    .optional()
    .describe(
      "For intents that run a program on their destination: that chain's Kitchen fee, in wei.",
    ),
};

const POT = {
  owner: z
    .string()
    .max(64)
    .optional()
    .describe(
      "The Pot's owner: a 0x address on an EVM chain, a base58 public key on Solana. With the " +
        "salt it derives the Pot; only the owner may cook on it. To rehearse (sauce_simulate) any " +
        "address will do: nothing is signed, and a missing Pot or balance is supplied.",
    ),
  salt: z
    .string()
    .max(256)
    .optional()
    .describe(
      "A label naming one of the owner's Pots; the salt is keccak256 of it. With neither salt " +
        "nor saltHex: the owner's default Pot (salt 0).",
    ),
  saltHex: z.string().max(66).optional().describe("Or the salt itself, 32 bytes of 0x hex."),
};

const ARGS = z
  .array(z.unknown())
  .max(LIMITS.entries)
  .optional()
  .describe(
    "main's runtime arguments, in order, as JSON values: an integer in base units as a decimal " +
      "string (or a number up to 2^53), an address as 0x hex (on Solana a base58 key), bytes " +
      "as 0x hex, a bool as true/false, an array as an array, a tuple as an array of its fields " +
      "or an object naming them. sauce_compile's entryParams lists what main takes.",
  );

const COOK = {
  ...POT,
  pot: z
    .string()
    .max(64)
    .optional()
    .describe("EVM only: the Pot by its 0x address, instead of owner and salt."),
  value: integer
    .optional()
    .describe(
      "EVM only: the cook's value in wei — the Kitchen's execution fee plus any native " +
        "currency the program spends. Default: the fee, read from the chain (which needs an " +
        "endpoint: rpcUrl or the server's).",
    ),
  args: ARGS,
  accounts: z
    .record(z.string().min(1).max(64), z.string().max(64))
    .optional()
    .describe(
      "Solana only: each Account parameter main takes, by name: a base58 address, or `pot` (the " +
        "Pot, signed for by the Kitchen) or `owner`. sauce_compile's manifest lists them.",
    ),
  rpcUrl: RPC_URL,
};

const TOKEN_AMOUNTS = z
  .array(z.string().min(3).max(200))
  .max(LIMITS.entries)
  .optional()
  .describe(
    "Each <TOKEN|address>:<amount>: a symbol the chain registers or a 0x token address, and " +
      "the amount in whole units (USDC:1.5) or in base units ending in n (USDC:1500000n); " +
      "ETH:<amount> is the chain's native currency.",
  );

// ---------------------------------------------------------------------------------------------
// Reading a call's arguments into the commands' inputs
// ---------------------------------------------------------------------------------------------

type ProgramArgs = z.infer<z.ZodObject<typeof PROGRAM>>;
type CookArgs = Omit<ProgramArgs, "source"> & z.infer<z.ZodObject<typeof COOK>>;

/** A program and the files it compiles from: what every compiling tool starts with. */
interface Program {
  readonly input: ProgramInput;
  readonly files: CliFiles;
}

/** An integer argument as the text the commands parse; a JSON number only while it is exact. */
function integerText(value: string | number, name: string): string {
  if (typeof value === "string") return value;
  if (!Number.isSafeInteger(value)) {
    throw new UsageError(`${name}: ${value} is past 2^53 as a JSON number; give it as a string`);
  }

  return String(value);
}

/** The intents a program opens, as `ProgramInput.intents` takes them. */
function intentsOf(
  args: Pick<ProgramArgs, "intentDeadline" | "intentCreator" | "intentExecutionFee">,
) {
  const { intentDeadline, intentCreator, intentExecutionFee } = args;

  return {
    ...(intentDeadline === undefined
      ? {}
      : {
          deadline: parseUnixSeconds(
            "intent-deadline",
            integerText(intentDeadline, "intentDeadline"),
          ),
        }),
    ...(intentCreator === undefined
      ? {}
      : { creator: parseAddress("intent-creator", intentCreator) }),
    ...(intentExecutionFee === undefined
      ? {}
      : {
          executionFee: parseWei(
            "intent-execution-fee",
            integerText(intentExecutionFee, "intentExecutionFee"),
          ),
        }),
  };
}

function programOf(args: ProgramArgs, fallback?: CanonicalChain): Program {
  const moduleText = Object.values(args.modules ?? {});
  if (moduleText.length > LIMITS.modules) {
    throw new UsageError(`modules: at most ${LIMITS.modules} files`);
  }
  if (moduleText.reduce((sum, text) => sum + text.length, 0) > LIMITS.modulesTotal) {
    throw new UsageError(`modules: at most ${LIMITS.modulesTotal} characters in all`);
  }
  if (Object.keys(args.defines ?? {}).length > LIMITS.entries) {
    throw new UsageError(`defines: at most ${LIMITS.entries}`);
  }
  const { file, files } = callFiles(args.file, args.source, args.modules);
  const chain = programChain(
    {
      ...(args.chain === undefined ? {} : { chain: String(args.chain) }),
      ...(args.target === undefined ? {} : { target: args.target }),
    },
    file,
    args.source,
    fallback,
  );
  const defines = parseDefineMap(args.defines ?? {}, "defines", chain.kind);
  definesReach(file, args.source, Object.keys(defines));

  return {
    input: {
      file,
      text: args.source,
      chain,
      defines,
      compactArgs: args.compactArgs === true,
      intents: intentsOf(args),
    },
    files,
  };
}

const argsOf = (args: { readonly args?: readonly unknown[] | undefined }) =>
  args.args === undefined ? {} : { args: { from: "--args-json" as const, values: args.args } };

/** An EVM cook: the program on the Pot `owner`/`salt` or `pot` names. */
function evmCook(args: CookArgs, program: Program): CookInput {
  if (args.accounts !== undefined) {
    throw new UsageError(
      `accounts names a Solana program's accounts; a program on ${program.input.chain.slug} takes none`,
    );
  }

  if (args.owner === undefined && args.pot === undefined) {
    throw new UsageError(
      "give owner (the Pot's owner, whose Pot the cook runs on; to rehearse, any address will do) " +
        "or pot (the Pot's address)",
    );
  }

  return {
    ...program.input,
    target: potTarget({ pot: args.pot, owner: args.owner, salt: args.salt, saltHex: args.saltHex }),
    ...(args.value === undefined
      ? {}
      : { value: parseWei("value", integerText(args.value, "value")) }),
    ...argsOf(args),
  };
}

/** A Solana cook: the program on the Kitchen Pot of `owner` and `salt`, with its accounts. */
function svmCook(args: CookArgs, program: Program, rpcUrl: string): SvmCookInput {
  if (args.pot !== undefined) {
    throw new UsageError(
      "on Solana a cook names its Pot by owner and salt, which the Kitchen derives it from: give " +
        "owner (and salt), not pot",
    );
  }
  if (args.value !== undefined) {
    throw new UsageError(
      "value is for EVM: on Solana the Kitchen's fee is read from the cluster, and lamports a " +
        "program spends come from its accounts",
    );
  }
  if (args.owner === undefined) {
    throw new UsageError("missing owner: whose Pot it is (a base58 public key)");
  }
  if (Object.keys(args.accounts ?? {}).length > LIMITS.entries) {
    throw new UsageError(`accounts: at most ${LIMITS.entries}`);
  }

  return {
    ...program.input,
    owner: parsePubkey("owner", args.owner),
    ...parseSalt(args.salt, args.saltHex),
    accounts: parseAccounts(
      Object.entries(args.accounts ?? {}).map(([name, value]) => `${name}=${value}`),
    ),
    ...argsOf(args),
    rpcUrl,
  };
}

/** The unsigned cook of `program` with `args`'s Pot, value and arguments: `sauce tx`'s output. */
async function cookTransaction(
  args: CookArgs,
  program: Program,
  reach: Reach,
): Promise<CommandOutput> {
  const chain = program.input.chain;
  if (chain.kind === "svm") {
    const rpcUrl = await reach.require(
      chain,
      args.rpcUrl,
      "A Solana cook transaction (its blockhash and the Kitchen's fee)",
    );

    return svmTxCommand(svmCook(args, program, rpcUrl), program.files);
  }
  const cook = evmCook(args, program);
  const rpcUrl = await reach.endpoint(chain, args.rpcUrl);
  if (cook.value === undefined && rpcUrl === undefined) {
    throw new UsageError(
      `missing value: the cook pays the Kitchen's execution fee plus any native the program ` +
        `spends, and there is no endpoint for ${chain.slug} to read the fee from. Give value, in ` +
        "wei, or rpcUrl.",
    );
  }

  return txCommand({ ...cook, ...(rpcUrl === undefined ? {} : { rpcUrl }) }, program.files);
}

/** A define's value as JSON: an address-sized integer as its address, a wider one (a Solana key,
 *  a hash) as 32 bytes of hex, any other in decimal. */
function defineJson(value: DefineValue): string | boolean {
  if (typeof value === "boolean") return value;
  if (value >= 1n << 160n) return numberToHex(value, { size: 32 });

  return value >= 1n << 64n ? getAddress(numberToHex(value, { size: 20 })) : value.toString();
}

/** `sauce compile --json`, with the defines the compile was given as JSON beneath the command's
 *  own report of them, which wins where it gives one. */
async function compiled(program: Program): Promise<ToolOutput> {
  const output = await compileCommand(program.input, program.files);

  return {
    json: {
      defines: Object.fromEntries(
        Object.entries(program.input.defines).map(([name, value]) => [name, defineJson(value)]),
      ),
      ...output.json,
    },
    notes: output.notes,
  };
}

const POOL = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/** A Uniswap V3-style pool's price, liquidity, fee and tokens, read now. */
async function readPool(client: Awaited<ReturnType<typeof connect>>, pool: Address) {
  const read = async <T>(what: string, call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      const why = ((error as { shortMessage?: string }).shortMessage ?? String(error)).split(
        "\n",
      )[0];
      throw new UsageError(
        `reading the pool's ${what} failed (${why}): is ${pool} a V3-style pool on this chain?`,
      );
    }
  };
  const [slot0, liquidity, fee, token0, token1] = await Promise.all([
    read("slot0()", () => client.readContract({ address: pool, abi: POOL, functionName: "slot0" })),
    read("liquidity()", () =>
      client.readContract({ address: pool, abi: POOL, functionName: "liquidity" }),
    ),
    read("fee()", () => client.readContract({ address: pool, abi: POOL, functionName: "fee" })),
    read("token0()", () =>
      client.readContract({ address: pool, abi: POOL, functionName: "token0" }),
    ),
    read("token1()", () =>
      client.readContract({ address: pool, abi: POOL, functionName: "token1" }),
    ),
  ]);

  return { sqrtPriceX96: slot0[0], tick: slot0[1], liquidity, fee, token0, token1 };
}

/** The decimal `price` times `numerator / denominator`, to 24 decimal places. */
function scaled(price: string, numerator: bigint, denominator: bigint): string {
  const [whole = "0", fraction = ""] = price.split(".");
  const PLACES = 24;
  const units = BigInt(`${whole}${fraction.padEnd(PLACES, "0").slice(0, PLACES)}`);
  const result = (units * numerator) / denominator;
  const text = result.toString().padStart(PLACES + 1, "0");
  const integer = text.slice(0, -PLACES);
  const decimals = text.slice(-PLACES).replace(/0+$/, "");

  return decimals === "" ? integer : `${integer}.${decimals}`;
}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
/** An intent's claimant, as fulfill records it: an address, or 32 bytes. */
const CLAIMANT = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function hexArg(raw: string, what: string): Hex {
  if (!HEX.test(raw)) throw new UsageError(`${what}: not 0x-prefixed hex bytes`);

  return raw as Hex;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** What a tool returns: the command's JSON, and its notes — what must be true for it to land. */
interface ToolOutput {
  readonly json: Record<string, unknown>;
  readonly notes?: readonly string[] | undefined;
}

const fromCommand = (output: CommandOutput): ToolOutput => ({
  json: output.json,
  notes: output.notes,
});

/** Fields that hold a program's or a file's own text, never reworded. */
const VERBATIM = new Set(["source", "text"]);

/** `value` with every string passed through `scrub`, and put in the tools' words (`terms.ts`)
 *  unless it is a program's own text. */
function scrubbed(value: unknown, scrub: (text: string) => string, verbatim = false): unknown {
  if (typeof value === "string") return verbatim ? scrub(value) : toolTerms(scrub(value));
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((each) => scrubbed(each, scrub, verbatim));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [scrub(k), scrubbed(v, scrub, VERBATIM.has(k))]),
    );
  }

  return value;
}

/** A failure as the one message the caller reads, scrubbed by `scrub` (the call's, by default
 *  the server's alone). */
export function errorText(
  error: unknown,
  scrub: (text: string) => string = callReach(
    { chainIds: [], endpoint: () => undefined },
    undefined,
  ).scrub,
): string {
  // The command's message, in the tools' words: an input where it names a flag.
  return toolTerms(scrub(error instanceof Error ? error.message : String(error)));
}

const result = (output: ToolOutput, scrub: (text: string) => string): CallToolResult => {
  const notes = output.notes ?? [];
  const structured = scrubbed(
    { ...output.json, ...(notes.length === 0 ? {} : { notes }) },
    scrub,
  ) as Record<string, unknown>;

  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
  };
};

/** Reads nothing, writes nothing: the result follows from the arguments. */
const PURE: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** May read a chain, through an endpoint, and never writes one. */
const READS_CHAIN: ToolAnnotations = { ...PURE, openWorldHint: true };

const notesSchema = z.array(z.string()).optional();

/** The sentence every tool that builds a transaction ends on. */
const UNSIGNED =
  "Nothing is signed or sent: the caller signs and sends with its own wallet or signer.";

// ---------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------

/** What every tool can reach: the operator's endpoints, and over HTTP the guard callers' go through. */
export interface ToolContext {
  readonly endpoints: Endpoints;
  readonly guard?: RpcGuard;
}

/** The names of the tools, in the order `tools/list` gives them. */
export const TOOL_NAMES = [
  "sauce_chains",
  "sauce_globals",
  "sauce_price",
  "sauce_compile",
  "sauce_actions",
  "sauce_tx",
  "sauce_pot",
  "sauce_simulate",
  "sauce_publish",
  "sauce_fill",
  "sauce_inspect",
  "sauce_verify",
] as const;

export function registerTools(server: McpServer, context: ToolContext): void {
  const { endpoints, guard } = context;

  // Registers one tool whose handler returns a ToolOutput; a throw becomes an error result. Each
  // call gets its own reach: its rpcUrl, scrubbed from everything it returns, and released after.
  const tool = <Input extends z.ZodRawShape, Output extends z.ZodRawShape>(
    name: (typeof TOOL_NAMES)[number],
    config: {
      readonly title: string;
      readonly description: string;
      readonly input: Input;
      readonly output: Output;
      readonly annotations: ToolAnnotations;
    },
    run: (args: z.infer<z.ZodObject<Input>>, reach: Reach) => Promise<ToolOutput> | ToolOutput,
  ): void => {
    server.registerTool(
      name,
      {
        title: config.title,
        description: config.description,
        // A tool that takes nothing declares no schema, so a call that sends no arguments is
        // still a call; every other refuses a field it does not know.
        inputSchema:
          Object.keys(config.input).length === 0 ? undefined : z.object(config.input).strict(),
        outputSchema: z.looseObject({ ...config.output, notes: notesSchema }),
        annotations: { title: config.title, ...config.annotations },
      },
      async (args: unknown) => {
        const reach = callReach(endpoints, guard);
        try {
          return result(await run(args as z.infer<z.ZodObject<Input>>, reach), reach.scrub);
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: errorText(error, reach.scrub) }],
          };
        } finally {
          reach.release();
        }
      },
    );
  };

  tool(
    "sauce_chains",
    {
      title: "List the chains",
      description:
        "Lists every chain a Sauce program can run on, to choose the `chain` the other tools " +
        "take: each chain's slug, numeric id, name, kind (evm or svm) and aliases, and " +
        "`endpoint`: whether this server has its own RPC endpoint for it. A tool that reads a " +
        "chain without one needs the call's rpcUrl. Reads nothing.",
      input: {},
      output: {
        chains: z.array(
          z.looseObject({
            slug: z.string(),
            id: z.number(),
            kind: z.enum(["evm", "svm"]),
            endpoint: z.boolean(),
          }),
        ),
      },
      annotations: PURE,
    },
    () => ({
      json: {
        chains: CANONICAL_CHAINS.map((chain) => ({
          slug: chain.slug,
          id: chain.id,
          name: chain.name,
          kind: chain.kind,
          aliases: chain.aliases,
          endpoint: endpoints.chainIds.includes(chain.id),
        })),
      },
    }),
  );

  tool(
    "sauce_globals",
    {
      title: "List the names a program can use on a chain",
      description:
        "Lists the names a program on one chain may use without declaring them — use it before " +
        "writing a program, to call tokens and protocols by name instead of by address: token " +
        "symbols with their addresses and decimals, protocol namespaces with each contract's " +
        "address (with `protocol`, also its methods), the chain names that open intents, the " +
        "defines, and the @sauce/token functions. With no filter, everything. Reads nothing.",
      input: {
        chain: chainRef,
        tokens: z.boolean().optional().describe("Only the token symbols."),
        protocols: z.boolean().optional().describe("Only the protocol namespaces."),
        protocol: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "One namespace, as a program writes it (UniswapV4) or by its slug (uniswap-v4), " +
              "with its methods' signatures.",
          ),
      },
      output: { chain: z.looseObject({ slug: z.string(), id: z.number() }) },
      annotations: PURE,
    },
    (args) => {
      const output = fromCommand(
        globalsCommand({
          chain: parseChain(String(args.chain), "chain"),
          tokens: args.tokens === true,
          protocols: args.protocols === true,
          ...(args.protocol === undefined ? {} : { protocol: args.protocol }),
        }),
      );
      const protocols = output.json.protocols as
        Array<{ contracts?: Array<Record<string, unknown>> }> | undefined;
      // Every namespace's methods are tens of kilobytes: they come with `protocol`, for one.
      return protocols === undefined
        ? output
        : {
            ...output,
            json: {
              ...output.json,
              protocols: protocols.map((namespace) => ({
                ...namespace,
                contracts: (namespace.contracts ?? []).map(
                  ({ methods: _methods, ...contract }) => contract,
                ),
              })),
            },
          };
    },
  );

  tool(
    "sauce_price",
    {
      title: "Turn a price into a swap's limits, or read a pool's price",
      description:
        "The numbers a swap program takes, for a pair on an EVM chain: the pool's sqrtPriceX96 " +
        "for the pair's order (token0 is the lower address) — which is also a swap's " +
        "sqrtPriceLimitX96 — and, for selling and for buying the base token, the minAvgPrice a " +
        "program checks a fill against (out * 1e18 >= minAvgPrice * spent). Give the price one " +
        "of three ways: `price` (a decimal), `sqrtPriceX96` (to read it back), or `pool` with an " +
        "endpoint, which reads a Uniswap V3-style pool's slot0, liquidity and fee now. With " +
        "slippageBps, `limits` gives each direction's sqrtPriceLimitX96 that far from the price, " +
        "and a minAvgPrice that also pays the pool's fee (feePpm, or the pool's own). Uniswap V3 " +
        "and V4 and their forks share the arithmetic. Use it to set a swap's limits, then pass " +
        "them as defines or arguments.",
      input: {
        chain: chainRef,
        base: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "The token the price is per one of: a symbol the chain registers (WETH), or " +
              "<0x address>:<decimals>.",
          ),
        quote: z
          .string()
          .min(1)
          .max(64)
          .describe("The token the price is in: a symbol (USDC), or <0x address>:<decimals>."),
        price: z
          .string()
          .max(80)
          .optional()
          .describe("How many whole quote tokens one whole base token is worth, a decimal: 2700."),
        sqrtPriceX96: z
          .string()
          .max(80)
          .optional()
          .describe("A pool's sqrtPriceX96, a decimal integer, to read back as a price."),
        pool: z
          .string()
          .max(64)
          .optional()
          .describe(
            "A Uniswap V3-style pool of the pair (0x address), read now through an endpoint: its " +
              "slot0 price, liquidity and fee. (A V4 pool has no address; read it with its " +
              "StateView in sauce_simulate.)",
          ),
        slippageBps: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .describe(
            "How far from the price each direction's limit sits, in basis points: 50 = 0.5%.",
          ),
        feePpm: z
          .number()
          .int()
          .min(0)
          .max(999_999)
          .optional()
          .describe(
            "The pool's fee in millionths (3000 = 0.3%), paid into each minAvgPrice. Default: the " +
              "pool's own when `pool` is given, else none.",
          ),
        rpcUrl: RPC_URL,
      },
      output: {
        price: z.string(),
        sqrtPriceX96: z.string(),
        token0: z.string(),
        token1: z.string(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const chain = pricedChain(parseChain(String(args.chain), "chain"));
      const base = parsePriceToken(args.base, chain);
      const quote = parsePriceToken(args.quote, chain);
      const given = [args.price, args.sqrtPriceX96, args.pool].filter((each) => each !== undefined);
      if (given.length !== 1) {
        throw new UsageError("give one of price, sqrtPriceX96, or pool (with an endpoint)");
      }
      let pool: Record<string, unknown> | undefined;
      let sqrtPriceX96 = args.sqrtPriceX96;
      let feePpm = args.feePpm;
      if (args.pool !== undefined) {
        const address = parseAddress("pool", args.pool);
        const rpcUrl = await reach.require(chain, args.rpcUrl, "Reading a pool");
        const read = await readPool(await connect(rpcUrl, chain), address);
        const pair = [base.address, quote.address].map((token) => token.toLowerCase()).sort();
        if (read.token0.toLowerCase() !== pair[0] || read.token1.toLowerCase() !== pair[1]) {
          throw new UsageError(
            `the pool trades ${read.token0} and ${read.token1}, not ${base.symbol} and ${quote.symbol}`,
          );
        }
        sqrtPriceX96 = read.sqrtPriceX96.toString();
        feePpm ??= read.fee;
        pool = {
          address,
          sqrtPriceX96: read.sqrtPriceX96.toString(),
          tick: read.tick,
          liquidity: read.liquidity.toString(),
          feePpm: read.fee,
          readFrom: chain.slug,
        };
      }
      const at = (price: { decimal: string } | { sqrtPriceX96: bigint }) =>
        priceCommand({ chain, base, quote, price });
      const now = at(priceGiven(args.price, sqrtPriceX96));
      const json: Record<string, unknown> = {
        ...now.json,
        ...(pool === undefined ? {} : { pool }),
      };
      if (args.slippageBps !== undefined) {
        const price = now.json.price as string;
        const bps = BigInt(args.slippageBps);
        const fee = BigInt(feePpm ?? 0);
        const side = (output: CommandOutput, name: "sell" | "buy") =>
          output.json[name] as Record<string, unknown>;
        // The limit is the pool's price that far out; the floor also pays the pool's fee.
        const sellLimit = at({ decimal: scaled(price, 10_000n - bps, 10_000n) });
        const buyLimit = at({ decimal: scaled(price, 10_000n + bps, 10_000n) });
        const sellFloor = at({
          decimal: scaled(price, (10_000n - bps) * (1_000_000n - fee), 10_000n * 1_000_000n),
        });
        const buyFloor = at({
          decimal: scaled(price, (10_000n + bps) * 1_000_000n, 10_000n * (1_000_000n - fee)),
        });
        json.limits = {
          slippageBps: args.slippageBps,
          feePpm: feePpm ?? 0,
          sell: {
            price: sellLimit.json.price,
            sqrtPriceLimitX96: side(sellLimit, "sell").sqrtPriceLimitX96,
            minAvgPrice: side(sellFloor, "sell").minAvgPrice,
          },
          buy: {
            price: buyLimit.json.price,
            sqrtPriceLimitX96: side(buyLimit, "buy").sqrtPriceLimitX96,
            minAvgPrice: side(buyFloor, "buy").minAvgPrice,
          },
        };
      }

      return { json, notes: now.notes };
    },
  );

  tool(
    "sauce_compile",
    {
      title: "Compile a SauceScript program",
      description:
        "Compiles a SauceScript program for a chain — use it to check a program and to learn " +
        "what it takes, before sauce_simulate or sauce_tx. The chain's token symbols, protocol " +
        "namespaces, chainId, the @sauce/token functions and the intents the program opens all " +
        "resolve against that chain. Returns the bytecode (0x hex) and its size in bytes, " +
        "`entryParams` (main's runtime parameters, which sauce_tx's args fill) and how they are " +
        "encoded (`entryEncoding`; with compactArgs, the compact-v1 `entrySchema`), the defines " +
        "it was given, the compiler and the released engine it pairs with, and on Solana the " +
        "account `manifest` (the accounts a cook attaches, in order). A program that does not " +
        "compile is an error naming its line. For a program that opens intents, the result is " +
        "the program the source chain runs; sauce_inspect with the source alone lists each " +
        "intent's destination, route and reward. Reads nothing.",
      input: PROGRAM,
      output: {
        chain: z.string(),
        chainId: z.number(),
        target: z.enum(["evm", "svm"]),
        bytecode: z.string(),
        size: z.number(),
        entryEncoding: z.string(),
        entryParams: z.array(z.looseObject({ name: z.string(), type: z.string() })),
        entrySchema: z.string().nullable(),
        defines: z.unknown(),
        manifest: z.unknown().optional(),
      },
      annotations: PURE,
    },
    (args) => compiled(programOf(args)),
  );

  tool(
    "sauce_actions",
    {
      title: "Compile an action program, and build its cook",
      description:
        "Turns an action program — protocol operations written as JSON (swap, approve, wrap, " +
        "supply, bridge, …), validated against the action-program schema (resource " +
        "sauce://actions/schema.json) — into the SauceScript that runs them, and compiles it, " +
        "as sauce_compile would that source. Use it instead of writing SauceScript when the " +
        "task is a fixed list of protocol calls. Returns `source` (the generated program), " +
        "`compile` (sauce_compile's result for it), and, given owner or pot, `transaction`: the " +
        "unsigned cook, exactly as sauce_tx returns it. An `argument` action becomes one of " +
        "main's parameters, in order, filled by args. EVM chains only. " +
        UNSIGNED,
      input: {
        program: z
          .union([z.string().min(2).max(LIMITS.source), z.looseObject({})])
          .describe(
            "The action program: { version: 1, chainId, actions: [...] }, as an object or its " +
              "JSON text. Amounts are base-unit integers as decimal strings; addresses are 0x " +
              'hex; `recipient: "self"` is the Pot. Its chainId is the chain it runs on.',
          ),
        chain: chainRef.optional().describe("Checked against the program's chainId when given."),
        target: z.enum(["evm"]).optional().describe("Always evm: actions run on EVM chains."),
        compactArgs: PROGRAM.compactArgs,
        ...COOK,
      },
      output: {
        source: z.string(),
        compile: z.looseObject({ bytecode: z.string(), size: z.number() }),
        transaction: z.looseObject({}).optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      if (typeof args.program === "string" && args.program.length > LIMITS.source) {
        throw new UsageError(`program: at most ${LIMITS.source} characters`);
      }
      let document: unknown = args.program;
      if (typeof document === "string") {
        try {
          document = JSON.parse(document);
        } catch {
          throw new UsageError("program: not JSON");
        }
      }
      const actions = actionSource(document);
      const chain = chainById(actions.program.chainId);
      if (chain === undefined) {
        throw new UsageError(
          `program: chainId ${actions.program.chainId} is not a chain Sauce knows`,
        );
      }
      if (args.chain !== undefined && parseChain(String(args.chain), "chain").id !== chain.id) {
        throw new UsageError(
          `chain ${String(args.chain)} is not the program's chainId ${chain.id} (${chain.slug})`,
        );
      }
      const { file, files } = callFiles("actions.sauce.ts", actions.source, undefined);
      const program: Program = {
        input: {
          file,
          text: actions.source,
          chain,
          defines: {},
          compactArgs: args.compactArgs === true,
          intents: {},
          contracts: actions.contracts,
        },
        files,
      };
      const compile = await compiled(program);
      const building =
        args.owner !== undefined || args.pot !== undefined
          ? await cookTransaction(args, program, reach)
          : undefined;

      return {
        json: {
          source: actions.source,
          compile: compile.json,
          ...(building === undefined ? {} : { transaction: building.json }),
        },
        notes: [...(compile.notes ?? []), ...(building?.notes ?? [])],
      };
    },
  );

  tool(
    "sauce_tx",
    {
      title: "Build the unsigned cook transaction",
      description:
        "Builds the transaction that runs a program on its Pot, unsigned, for the Pot's owner to " +
        "sign — the last step, once sauce_compile succeeds (and, ideally, sauce_simulate). On " +
        "an EVM chain it returns { chainId, to: the Pot, data: Pot.cook(engine, program ++ " +
        "arguments), value }; only the owner may send it, and value (wei) is the Kitchen's fee " +
        "plus any native the program spends — give it, or an endpoint to read the fee from, " +
        "which also says whether the Pot is deployed. On Solana it returns { chain, feePayer, " +
        "pot, fee, transaction }: the Kitchen cook as a base64 transaction for the owner to sign, " +
        "which needs an endpoint (its blockhash and the fee). `notes` say what must be true for " +
        `it to land: a deployed, funded Pot (sauce_pot deploys it). ${UNSIGNED}`,
      input: { ...PROGRAM, ...COOK },
      output: {
        chainId: z.number().optional(),
        to: z.string().optional(),
        data: z.string().optional(),
        value: z.string().optional(),
        transaction: z.string().optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programOf(args);
      const output = await cookTransaction(args, program, reach);
      if (program.input.chain.kind === "svm") return fromCommand(output);
      const chain = program.input.chain;
      const rpcUrl = await reach.endpoint(chain, args.rpcUrl);
      const client = rpcUrl === undefined ? undefined : await connect(rpcUrl, chain);
      const fee = client === undefined ? undefined : await kitchenFee(client, chain);
      const owner =
        args.owner !== undefined
          ? parseAddress("owner", args.owner)
          : client === undefined
            ? undefined
            : (await potState(client, output.json.to as Address)).owner;

      return {
        json: {
          ...output.json,
          from: owner ?? null,
          kitchenFee:
            fee === undefined
              ? null
              : { wei: fee.toString(), native: formatUnits(fee, 18), readFrom: chain.slug },
        },
        notes: [
          ...(output.notes ?? []),
          ...(fee === undefined
            ? ["The Kitchen's fee was not read (no endpoint): value is as given."]
            : []),
          "sauce_tx does not rehearse the cook: run sauce_simulate to see whether it reverts now.",
        ],
      };
    },
  );

  tool(
    "sauce_pot",
    {
      title: "Predict a Pot, build its deployment, and read what it holds",
      description:
        "A Pot is the owner's on-chain account that runs their programs and holds their " +
        "tokens. Its address is known before it exists: the released Kitchen derives it from " +
        "(owner, salt). Returns `pot` and the unsigned deployment — on an EVM chain " +
        "Kitchen.deployPot as { to, data, value }, which any account may send (the Pot is the " +
        "owner's either way); on Solana the Kitchen's create_pot `instruction`, which the owner " +
        "signs. With an endpoint it also says `deployed` (null without one) — when true, do not " +
        "send the deployment — and reads what the cook will need: on an EVM chain the Kitchen's " +
        "fee (the least a cook's value can be) and the Pot's balance of the native currency and " +
        "of every token the chain registers; on Solana the Pot's associated token account for " +
        "each registered mint, whether it exists, and its balance. " +
        UNSIGNED,
      input: {
        chain: chainRef,
        ...POT,
        balances: z
          .boolean()
          .optional()
          .describe(
            "With an endpoint, read the Pot's balances (default true); false skips those reads.",
          ),
        rpcUrl: RPC_URL,
      },
      output: {
        pot: z.string(),
        owner: z.string(),
        salt: z.string(),
        deployed: z.boolean().nullable(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const chain = parseChain(String(args.chain), "chain");
      if (args.owner === undefined) throw new UsageError("missing owner: whose Pot");
      const salt = parseSalt(args.salt, args.saltHex);
      const rpcUrl = await reach.endpoint(chain, args.rpcUrl);
      const reading = rpcUrl !== undefined && args.balances !== false;
      const unchecked = `There is no endpoint for ${chain.slug}, so whether the Pot exists was not checked: pass rpcUrl to check.`;
      const deployedNote = "The Pot is deployed already: do not send the deployment.";
      if (chain.kind === "svm") {
        const target = { owner: parsePubkey("owner", args.owner), ...salt };
        const output = await svmPotCommand(target);
        const deployed = rpcUrl === undefined ? null : await svmPotExists(target, rpcUrl);
        const tokenAccounts = reading
          ? await svmPotTokenAccounts(target, rpcUrl!, chain)
          : undefined;

        return {
          json: {
            ...output.json,
            deployed,
            ...(tokenAccounts === undefined ? {} : { tokenAccounts }),
          },
          notes: [
            ...(output.notes ?? []),
            ...(deployed === null ? [unchecked] : deployed ? [deployedNote] : []),
          ],
        };
      }
      const output = potCommand({ chain, owner: parseAddress("owner", args.owner), ...salt });
      const pot = output.json.pot as Address;
      const client = rpcUrl === undefined ? undefined : await connect(rpcUrl, chain);
      const deployed = client === undefined ? null : (await potState(client, pot)).deployed;
      const fee = client === undefined ? undefined : await kitchenFee(client, chain);
      const held =
        reading && client !== undefined ? await registeredBalances(client, chain, pot) : undefined;

      return {
        json: {
          ...output.json,
          deployed,
          ...(fee === undefined
            ? {}
            : { kitchenFee: { wei: fee.toString(), native: formatUnits(fee, 18) } }),
          ...(held === undefined
            ? {}
            : {
                balances: {
                  native: { wei: held.native.toString(), formatted: formatUnits(held.native, 18) },
                  tokens: held.tokens.map((token) => ({
                    symbol: token.symbol,
                    address: token.address,
                    balance: token.balance === null ? null : token.balance.toString(),
                    formatted:
                      token.balance === null ? null : formatUnits(token.balance, token.decimals),
                  })),
                },
              }),
        },
        notes: [
          ...(output.notes ?? []),
          ...(deployed === null ? [unchecked] : deployed ? [deployedNote] : []),
        ],
      };
    },
  );

  tool(
    "sauce_simulate",
    {
      title: "Rehearse a cook, with no key and nothing sent",
      description:
        "Rehearses the cook from the Pot's owner on the chain as it is now, to see what it would " +
        "do before building the transaction with sauce_tx. Needs an endpoint (rpcUrl, or the " +
        "server's). EVM: through eth_simulateV1 (else eth_call with state overrides; `path` " +
        "says which), on a Pot that need not be deployed yet — the rehearsal deploys it first. " +
        "Returns ok, gas, what main returns, the ERC-20 transfers and approvals, native " +
        "transfers and each address's net balance change; or the `stage` and decoded `reason` " +
        "it reverts — a revert is a result (ok: false), not an error. assumeBalance gives the " +
        "Pot balances for the rehearsal only; fund rehearses pulling tokens from the owner into " +
        "the Pot in the cook, the Pot credited what they would bring. Solana: the Kitchen cook " +
        "simulated from the owner (a missing Pot created first): compute units, or the reason " +
        "and the program logs. Nothing is signed or sent.",
      input: {
        ...PROGRAM,
        ...COOK,
        assumeBalance: TOKEN_AMOUNTS.describe(
          "EVM only: balances the Pot holds for this rehearsal only, by state override. Each " +
            "<TOKEN|address>:<amount>, the amount in whole units (USDC:2) or base units ending " +
            "in n (USDC:2000000n); ETH:<amount> for the native currency.",
        ),
        fund: TOKEN_AMOUNTS.describe(
          "EVM only: tokens the cook would pull from the owner into the Pot before the program " +
            "runs; with no key here, the Pot is credited them instead. Each " +
            "<TOKEN|address>:<amount>, as assumeBalance.",
        ),
        fundMode: z
          .enum(["permit2", "permit", "allowance", "transfer"])
          .optional()
          .describe("How fund pulls (default permit2)."),
        sweep: z
          .boolean()
          .optional()
          .describe("With fund: return what is left of each funded token to the owner afterwards."),
      },
      output: { ok: z.boolean() },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programOf(args);
      const chain = program.input.chain;
      const rpcUrl = await reach.require(chain, args.rpcUrl, "Simulating");
      const funding = {
        chain,
        rpcUrl,
        fund: args.fund ?? [],
        ...(args.fundMode === undefined ? {} : { mode: args.fundMode }),
        sweep: args.sweep === true,
        // A rehearsal: nothing sent, no key, so the pulls are credited rather than signed.
        send: false,
        yes: false,
        confirm: async () => undefined,
      };
      if (chain.kind === "svm") {
        if ((args.assumeBalance ?? []).length > 0) {
          throw new UsageError(
            "assumeBalance is for EVM chains: a Solana endpoint's simulateTransaction takes no " +
              "account overrides, so on solana the rehearsal runs on the accounts as they are",
          );
        }
        fundingFor(funding);

        return fromCommand(await svmSimulateCommand(svmCook(args, program, rpcUrl), program.files));
      }
      const cook = evmCook(args, program);
      const assume = assumedBalances(args.assumeBalance ?? [], chain);
      const fund = fundingFor(funding);

      return fromCommand(
        await simulateCommand(
          { ...cook, rpcUrl, assume, ...(fund === undefined ? {} : { fund }) },
          program.files,
        ),
      );
    },
  );

  tool(
    "sauce_publish",
    {
      title: "Build an intent's unsigned publish transactions",
      description:
        "For a program that only opens cross-chain intents whose amounts are fixed when it is " +
        "built (every amount a define or a literal): the source chain's transactions that " +
        "publish and fund each intent from a wallet — each reward token's approve to the " +
        "Portal, then Portal.publishAndFund — with each intent's hash. Send them in order from " +
        "the wallet that funds the reward. With `from` and an endpoint, the approvals are " +
        "planned against that wallet's standing allowance (a USDT-style reset to 0 first where " +
        "needed). dryRun rehearses them together through eth_simulateV1 from `from` instead, " +
        "assumeBalance giving that wallet balances for the rehearsal only. A program that " +
        "measures an amount on chain, or does anything besides open intents, is refused: run " +
        `it on a Pot (sauce_tx) instead. ${UNSIGNED}`,
      input: {
        ...PROGRAM,
        from: z
          .string()
          .max(64)
          .optional()
          .describe(
            "The 0x wallet that publishes and funds: plans exact approvals, and is dryRun's " +
              "sender.",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe(
            "Rehearse the transactions together (eth_simulateV1) instead; needs from and an " +
              "endpoint.",
          ),
        assumeBalance: TOKEN_AMOUNTS.describe(
          "With dryRun: balances `from` holds for the rehearsal only, by state override. Each " +
            "<TOKEN|address>:<amount>, whole units or base units ending in n.",
        ),
        rpcUrl: RPC_URL,
      },
      output: { intents: z.array(z.looseObject({ intentHash: z.string() })) },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programOf(args);
      const chain = program.input.chain;
      const from = args.from === undefined ? undefined : parseAddress("from", args.from);
      const assume = chain.kind === "evm" ? assumedBalances(args.assumeBalance ?? [], chain) : [];
      if (assume.length > 0 && args.dryRun !== true) {
        throw new UsageError(
          "assumeBalance goes with dryRun: it gives the wallet a balance for a rehearsal, and " +
            "nothing to transactions that are sent",
        );
      }
      if (args.dryRun === true) {
        if (from === undefined) throw new UsageError("a dry run needs whose wallet: give from");

        return fromCommand(
          await publishCommand(
            {
              ...program.input,
              dryRun: true,
              rpcUrl: await reach.require(chain, args.rpcUrl, "A dry run"),
              from,
              ...(assume.length === 0 ? {} : { assume }),
            },
            program.files,
          ),
        );
      }
      const rpcUrl = from === undefined ? undefined : await reach.endpoint(chain, args.rpcUrl);

      return fromCommand(
        await publishCommand(
          {
            ...program.input,
            format: "json",
            dryRun: false,
            ...(from === undefined ? {} : { from }),
            ...(rpcUrl === undefined ? {} : { rpcUrl }),
          },
          program.files,
        ),
      );
    },
  );

  tool(
    "sauce_fill",
    {
      title: "Rehearse a solver filling an intent on its destination",
      description:
        "For a program that opens cross-chain intents fixed when it is built (as sauce_publish " +
        "takes): what happens on each intent's DESTINATION chain when a solver fills it, " +
        "rehearsed there with no key and nothing sent — the other half of sauce_publish's " +
        "dryRun, which rehearses the source. Give the same inputs as sauce_publish (chain is " +
        "the SOURCE) and the destination's endpoint: rpcUrl when every intent goes to one chain, " +
        "rpcUrls by chain otherwise. One eth_simulateV1 block from the solver: the destination's " +
        "shared intent Pot deployed when the route cooks on it and it is not there yet, the " +
        "solver's approval of the Portal for each token the route delivers, then " +
        "Portal.fulfill with the route's native amount (the Kitchen's fee for its cook) as " +
        "value. The solver is given the route's tokens and that value for the rehearsal. " +
        "Returns, per intent, ok with the gas and what the fill moved (transfers, net changes, " +
        "what it left in the shared Pot and the Portal's Executor), or the decoded reason it " +
        "reverts — a revert is a result (ok: false), not an error. Needs an endpoint that " +
        "serves eth_simulateV1; a Solana destination is not rehearsed. Nothing is signed or sent.",
      input: {
        ...PROGRAM,
        solver: z
          .string()
          .max(64)
          .optional()
          .describe("The 0x account the fill comes from (default: one nobody holds the key of)."),
        claimant: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Who claims the reward, as fulfill records it: a 0x address or 32 bytes of hex " +
              "(default: the solver).",
          ),
        rpcUrl: z
          .string()
          .min(1)
          .max(2048)
          .optional()
          .describe(
            "The DESTINATION chain's endpoint, when every intent goes to one chain: used for " +
              "this call only, never returned or logged.",
          ),
        rpcUrls: z
          .record(z.string().max(64), z.string().min(1).max(2048))
          .optional()
          .describe(
            'Each destination\'s endpoint by chain (slug or id): { "base": "<url>" }. ' +
              "Used for this call only, never returned or logged.",
          ),
      },
      output: {
        ok: z.boolean(),
        chain: z.string(),
        intents: z.array(
          z.looseObject({ ok: z.boolean(), intentHash: z.string(), destination: z.string() }),
        ),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programOf(args);
      if (args.rpcUrl !== undefined && args.rpcUrls !== undefined) {
        throw new UsageError("give rpcUrl (one destination) or rpcUrls (by chain), not both");
      }
      if (Object.keys(args.rpcUrls ?? {}).length > LIMITS.entries) {
        throw new UsageError(`rpcUrls: at most ${LIMITS.entries}`);
      }
      const solver = args.solver === undefined ? undefined : parseAddress("solver", args.solver);
      if (args.claimant !== undefined && !CLAIMANT.test(args.claimant)) {
        throw new UsageError(
          `claimant: '${args.claimant}' is neither an address (20 bytes) nor 32 bytes of hex`,
        );
      }
      const byChain = new Map<number, string>();
      for (const [key, url] of Object.entries(args.rpcUrls ?? {})) {
        const chain = parseChain(key, "rpcUrls");
        byChain.set(chain.id, (await reach.endpoint(chain, url))!);
      }
      const one =
        args.rpcUrl === undefined
          ? undefined
          : await reach.endpoint(program.input.chain, args.rpcUrl);

      return fromCommand(
        await fillCommand(
          {
            ...program.input,
            endpointOf: (chain) => {
              const url = byChain.get(chain.id) ?? one ?? endpoints.endpoint(chain);
              if (url === undefined) throw noEndpoint(chain, endpoints, "Rehearsing a fill");

              return url;
            },
            endpointFlag: one === undefined ? "--config" : "--rpc-url",
            ...(solver === undefined ? {} : { solver }),
            ...(args.claimant === undefined ? {} : { claimant: args.claimant as Hex }),
          },
          program.files,
        ),
      );
    },
  );

  tool(
    "sauce_inspect",
    {
      title: "Take a call or a program apart",
      description:
        "Reads a transaction, calldata or program back into what its author wrote — use it to " +
        "check what you are about to sign, or what landed: a Pot.cook (its engine, its program, " +
        "the intents the program opens), a Kitchen.deployPot (the Pot it makes), a Portal " +
        "publish or publishAndFund (the route and the reward), an ERC-20 call, or a bare " +
        "program. A 32-byte hash is a transaction on `chain`, fetched through an endpoint " +
        "(rpcUrl, or the server's). With `source`, a cook's program is checked against that " +
        "program's and the arguments after it are decoded against main; `source` alone is " +
        "compiled and the intents it opens are listed.",
      input: {
        hex: z
          .string()
          .max(LIMITS.hex)
          .optional()
          .describe("0x hex: calldata, a program, or a 32-byte transaction hash."),
        ...PROGRAM,
        source: PROGRAM.source
          .optional()
          .describe(
            "The program the hex was compiled from, to check and decode it against; or, with " +
              "no hex, the program to inspect.",
          ),
        rpcUrl: RPC_URL,
      },
      output: {},
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      if (args.hex === undefined) {
        if (args.source === undefined) {
          throw new UsageError("give hex (calldata, a program or a transaction hash), or source");
        }
        const program = programOf({ ...args, source: args.source });

        return fromCommand(
          inspectFile(program.input.file, compileProgram(program.input, program.files)),
        );
      }
      const hex = hexArg(args.hex, "hex");
      const given = args.chain === undefined ? undefined : parseChain(String(args.chain), "chain");
      const source =
        args.source === undefined ? undefined : programOf({ ...args, source: args.source }, given);
      const chain = given ?? source?.input.chain;
      let rpcUrl: string | undefined;
      if (TX_HASH.test(hex)) {
        if (chain === undefined) {
          throw new UsageError("32 bytes of hex is a transaction hash: give the chain it is on");
        }
        rpcUrl = await reach.require(chain, args.rpcUrl, "Fetching a transaction");
      }

      return fromCommand(
        await inspectCommand({
          hex,
          ...(chain === undefined ? {} : { chain }),
          ...(rpcUrl === undefined ? {} : { rpcUrl }),
          ...(source === undefined
            ? {}
            : {
                source: {
                  file: source.input.file,
                  program: compileProgram(source.input, source.files),
                },
              }),
        }),
      );
    },
  );

  tool(
    "sauce_verify",
    {
      title: "Check that a settle runs the audited program",
      description:
        "Checks whether a settle payload, a Pot.cook, a Portal publish or a transaction runs " +
        "the audited settle program, and with which parameters: valid with its tokens, minOut " +
        "and recipient, or valid: false with the rejection `code` (a rejection is a result, not " +
        "an error). A 32-byte hash is a transaction on `chain`, fetched through an endpoint " +
        "(rpcUrl, or the server's). On Solana (chain solana): a cook transaction's signature, " +
        "with the minOut and splCount the settle was compiled for. Use it to confirm an " +
        "intent's settlement before relying on it.",
      input: {
        hex: z
          .string()
          .max(LIMITS.hex)
          .optional()
          .describe(
            "0x hex: a settle payload, Pot.cook or Portal calldata, or a transaction hash.",
          ),
        signature: z
          .string()
          .max(128)
          .optional()
          .describe("Solana: the cook transaction's signature, base58."),
        chain: chainRef.optional().describe("The chain a transaction is on."),
        pins: z
          .array(z.string().max(100))
          .max(LIMITS.entries)
          .optional()
          .describe("Historical settle programs also accepted, each <0x keccak256>:<bytes>."),
        engines: z
          .array(z.string().max(64))
          .max(LIMITS.entries)
          .optional()
          .describe("Engines also accepted besides the released one, each a 0x address."),
        minOut: integer
          .optional()
          .describe("Solana: the floor the settle enforces, in base units."),
        splCount: integer
          .optional()
          .describe("Solana: how many escrows the settle sweeps with its first token program."),
        rpcUrl: RPC_URL,
      },
      output: { valid: z.boolean() },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const chain = args.chain === undefined ? undefined : parseChain(String(args.chain), "chain");
      if (chain?.kind === "svm") {
        if (args.signature === undefined) {
          throw new UsageError("missing signature: the cook's transaction on solana");
        }
        const amount = (name: "minOut" | "splCount"): bigint => {
          const raw = args[name];
          if (raw === undefined) throw new UsageError(`missing ${name}: the settle compiles it in`);
          const text = integerText(raw, name);
          if (!/^\d+$/.test(text)) throw new UsageError(`${name}: '${text}' is not a whole number`);

          return BigInt(text);
        };

        return fromCommand(
          await svmVerifyCommand({
            signature: args.signature,
            rpcUrl: await reach.require(chain, args.rpcUrl, "Verifying a Solana cook"),
            minOut: amount("minOut"),
            splCount: amount("splCount"),
          }),
        );
      }
      if (args.hex === undefined) {
        throw new UsageError("missing hex: a settle payload, calldata, or a transaction hash");
      }
      const hex = hexArg(args.hex, "hex");
      let fetched: { chain: CanonicalChain; rpcUrl: string } | undefined;
      if (TX_HASH.test(hex)) {
        if (chain === undefined) {
          throw new UsageError("32 bytes of hex is a transaction hash: give the chain it is on");
        }
        fetched = {
          chain,
          rpcUrl: await reach.require(chain, args.rpcUrl, "Fetching a transaction"),
        };
      }

      return fromCommand(
        await verifyCommand({
          hex,
          pins: (args.pins ?? []).map(parsePin),
          engines: (args.engines ?? []).map((engine) => parseAddress("engine", engine)),
          ...(fetched === undefined ? {} : fetched),
        }),
      );
    },
  );
}
