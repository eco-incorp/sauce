/**
 * The tools: the `sauce` command's read-only half, one tool per command, each calling the function
 * that command calls (`sdk.ts`) with the inputs it takes. No tool signs or sends anything, and
 * none takes a key: a transaction comes back unsigned, for a wallet the caller holds.
 *
 * A tool that reads a chain does so through the endpoints the server's operator configured
 * (`config.ts`); without one it says so. Every result and every error is passed through `scrub`,
 * so no endpoint URL — which often carries a provider key — ever leaves the server.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { getAddress, numberToHex, type Address, type Hex } from "viem";
import * as z from "zod";

import { noEndpoint, requireEndpoint, type Endpoints } from "./config.js";
import { callFiles, DEFAULT_FILE } from "./files.js";
import {
  assumedBalances,
  CANONICAL_CHAINS,
  compileCommand,
  compileProgram,
  connect,
  definesReach,
  fundingFor,
  globalsCommand,
  inspectCommand,
  inspectFile,
  parseAccounts,
  parseAddress,
  parseChain,
  parseDefineMap,
  parsePin,
  parsePubkey,
  parseSalt,
  parseUnixSeconds,
  parseWei,
  potCommand,
  potState,
  potTarget,
  parsePriceToken,
  priceCommand,
  pricedChain,
  priceGiven,
  programChain,
  publishCommand,
  scrub,
  simulateCommand,
  svmPotCommand,
  svmPotExists,
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
  /** Characters of one program or module. */
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
      "sauce_chains lists them.",
  );

/** An integer as a JSON number (to 2^53) or as a decimal or 0x-hex string. */
const integer = z.union([z.string().min(1).max(80), z.number().int().nonnegative()]);

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
      "Other files the program imports by relative path, keyed by their path from the same " +
        "directory as `file` (lib/math.sauce.ts). The server reads nothing from its own disk.",
    ),
  chain: chainRef
    .optional()
    .describe(
      "The chain the program runs on: slug, alias or id. Default: the program's `// @chain` " +
        "header line; with target svm alone, solana.",
    ),
  target: z
    .enum(["evm", "svm"])
    .optional()
    .describe("Checked against the chain; svm alone means solana."),
  defines: z
    .record(
      z.string().min(1).max(128),
      z.union([z.string().max(100), z.number().int().nonnegative(), z.boolean()]),
    )
    .optional()
    .describe(
      "Compile-time values the program reads by name: an address, an integer (decimal or 0x " +
        "hex; a string past 2^53), true or false, and on Solana a base58 public key. A define " +
        "replaces the program's module-level const of that name.",
    ),
  compactArgs: z
    .boolean()
    .optional()
    .describe("Encode main's arguments as compact-v1 instead of ABI-v1."),
  intentDeadline: integer
    .optional()
    .describe("For intents the program opens: their deadline, in Unix seconds."),
  intentCreator: z
    .string()
    .max(64)
    .optional()
    .describe("For intents the program opens: their creator, who may reclaim an unearned reward."),
  intentExecutionFee: integer
    .optional()
    .describe("For intents that run a program on their destination: that Kitchen's fee, in wei."),
};

const POT = {
  owner: z
    .string()
    .max(64)
    .optional()
    .describe(
      "The Pot's owner: a 0x address on an EVM chain, a base58 public key on Solana. With the " +
        "salt it derives the Pot; cook() is the owner's alone.",
    ),
  salt: z
    .string()
    .max(256)
    .optional()
    .describe(
      "Names one of the owner's Pots: the salt is keccak256 of this label. With neither salt " +
        "nor saltHex, the owner's default Pot (salt 0).",
    ),
  saltHex: z.string().max(66).optional().describe("Or the salt itself: 32 bytes of 0x hex."),
};

const COOK = {
  ...POT,
  pot: z
    .string()
    .max(64)
    .optional()
    .describe("EVM only: the Pot by its address, instead of owner and salt."),
  value: integer
    .optional()
    .describe(
      "EVM only: the cook's value in wei — the Kitchen's execution fee plus any native the " +
        "program spends. Default: the fee, read from the chain.",
    ),
  args: z
    .array(z.unknown())
    .max(LIMITS.entries)
    .optional()
    .describe(
      "main's runtime arguments, in order, as JSON values: an integer as a number or a decimal " +
        "string, an address or bytes as 0x hex, a bool as true/false, an array as an array, a " +
        "tuple as an array of its fields or an object naming them.",
    ),
  accounts: z
    .record(z.string().min(1).max(64), z.string().max(64))
    .optional()
    .describe(
      "Solana only: each account main takes, by its name: a base58 address, `pot` or `owner`.",
    ),
};

const TOKEN_AMOUNTS = z
  .array(z.string().min(3).max(200))
  .max(LIMITS.entries)
  .optional()
  .describe(
    "<TOKEN|address>:<amount> each: whole units (USDC:1.5) or base units ending in n " +
      "(USDC:1500000n); ETH:<amount> for the chain's native currency.",
  );

// ---------------------------------------------------------------------------------------------
// Reading a call's arguments into the commands' inputs
// ---------------------------------------------------------------------------------------------

type ProgramArgs = z.infer<z.ZodObject<typeof PROGRAM>>;
type CookArgs = ProgramArgs & z.infer<z.ZodObject<typeof COOK>>;

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
  const { intentDeadline, intentCreator, intentExecutionFee } = args;

  return {
    input: {
      file,
      text: args.source,
      chain,
      defines,
      compactArgs: args.compactArgs === true,
      intents: {
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
      },
    },
    files,
  };
}

const argsOf = (args: CookArgs) =>
  args.args === undefined ? {} : { args: { from: "--args-json" as const, values: args.args } };

/** An EVM cook: the program on the Pot `owner`/`salt` or `pot` names. */
function evmCook(args: CookArgs, program: Program): CookInput {
  if (args.accounts !== undefined) {
    throw new UsageError(
      `accounts names a Solana program's accounts; a program on ${program.input.chain.slug} takes none`,
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

/** A define's value as JSON: an address-sized integer as its address, a wider one (a Solana key,
 *  a hash) as 32 bytes of hex, any other in decimal. */
function defineJson(value: DefineValue): string | boolean {
  if (typeof value === "boolean") return value;
  if (value >= 1n << 160n) return numberToHex(value, { size: 32 });

  return value >= 1n << 64n ? getAddress(numberToHex(value, { size: 20 })) : value.toString();
}

const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
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

/** `value` with every string scrubbed of the server's secrets. */
function scrubbed(value: unknown): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(scrubbed);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [scrub(k), scrubbed(v)]));
  }

  return value;
}

const FLAGS_NOTE =
  "(This message names the sauce command's flags. Each is this tool's input of the same name in " +
  "camelCase — --salt-hex is saltHex — and --args and --args-json are args.)";

/** A failure as the one message the caller reads. */
export function errorText(error: unknown): string {
  const message = scrub(error instanceof Error ? error.message : String(error));

  // `--config` is the operator's flag, not an input: only the others are the tools' inputs.
  return /(^|[\s(`'"])--(?!config\b)[a-z]/.test(message) ? `${message}\n${FLAGS_NOTE}` : message;
}

const result = (output: ToolOutput): CallToolResult => {
  const notes = output.notes ?? [];
  const structured = scrubbed({
    ...output.json,
    ...(notes.length === 0 ? {} : { notes }),
  }) as Record<string, unknown>;

  return {
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
  };
};

const failure = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: errorText(error) }],
});

/** Reads nothing, writes nothing: the result follows from the arguments. */
const PURE: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
/** Reads a chain, through the server's endpoints, and never writes one. */
const READS_CHAIN: ToolAnnotations = { ...PURE, openWorldHint: true };

const notesSchema = z.array(z.string()).optional();

// ---------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------

/** What every tool can reach: the endpoints the operator configured. */
export interface ToolContext {
  readonly endpoints: Endpoints;
}

/** The names of the tools, in the order `tools/list` gives them. */
export const TOOL_NAMES = [
  "sauce_chains",
  "sauce_globals",
  "sauce_price",
  "sauce_compile",
  "sauce_tx",
  "sauce_pot",
  "sauce_simulate",
  "sauce_publish",
  "sauce_inspect",
  "sauce_verify",
] as const;

export function registerTools(server: McpServer, context: ToolContext): void {
  const { endpoints } = context;

  // Registers one tool whose handler returns a ToolOutput; a throw becomes an error result.
  const tool = <Input extends z.ZodRawShape, Output extends z.ZodRawShape>(
    name: (typeof TOOL_NAMES)[number],
    config: {
      readonly title: string;
      readonly description: string;
      readonly input: Input;
      readonly output: Output;
      readonly annotations: ToolAnnotations;
    },
    run: (args: z.infer<z.ZodObject<Input>>) => Promise<ToolOutput> | ToolOutput,
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
        try {
          return result(await run(args as z.infer<z.ZodObject<Input>>));
        } catch (error) {
          return failure(error);
        }
      },
    );
  };

  tool(
    "sauce_chains",
    {
      title: "List chains",
      description:
        "Every chain a Sauce program can run on: its slug, numeric id, name, kind (evm or svm) " +
        "and aliases, and whether this server has an RPC endpoint for it — the chains " +
        "sauce_simulate, a sauce_pot deployment check and the Solana sauce_tx can read.",
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
          endpoint: endpoints.endpoint(chain) !== undefined,
        })),
      },
    }),
  );

  tool(
    "sauce_globals",
    {
      title: "List a chain's names",
      description:
        "The names a program on one chain may use without declaring them — what `sauce globals` " +
        "lists: token symbols with their addresses and decimals, protocol namespaces with each " +
        "contract's address (and, with `protocol`, its methods), the chain names that open " +
        "intents, the defines, and the zero-import @sauce/token functions. With no filter, " +
        "everything.",
      input: {
        chain: chainRef,
        tokens: z.boolean().optional().describe("Only the token symbols."),
        protocols: z.boolean().optional().describe("Only the protocol namespaces."),
        protocol: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("One namespace (UniswapV4, or its slug uniswap-v4), with its methods."),
      },
      output: { chain: z.looseObject({ slug: z.string(), id: z.number() }) },
      annotations: PURE,
    },
    (args) =>
      fromCommand(
        globalsCommand({
          chain: parseChain(String(args.chain), "chain"),
          tokens: args.tokens === true,
          protocols: args.protocols === true,
          ...(args.protocol === undefined ? {} : { protocol: args.protocol }),
        }),
      ),
  );

  tool(
    "sauce_price",
    {
      title: "Turn a price into a pool's sqrtPriceX96",
      description:
        "A human price for a pair as the numbers a swap program takes, as `sauce price` gives " +
        "them: the pool's sqrtPriceX96 for the pair's order on the chain (token0 is the lower " +
        "address) — which is also the swap's sqrtPriceLimitX96 — and, for selling and for buying " +
        "the base token, the minAvgPrice a program checks a fill against (out * 1e18 >= " +
        "minAvgPrice * spent). Uniswap V3 and V4 and their forks share it. With sqrtPriceX96, a " +
        "pool's price is read back the other way. Reads no chain.",
      input: {
        chain: chainRef,
        base: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "The token the price is per one of: a registered symbol (WETH), or 0x…:<decimals>.",
          ),
        quote: z
          .string()
          .min(1)
          .max(64)
          .describe("The token the price is in: a registered symbol (USDC), or 0x…:<decimals>."),
        price: z
          .string()
          .max(80)
          .optional()
          .describe("How many quote tokens one base token is worth, in whole tokens: 2700."),
        sqrtPriceX96: z
          .string()
          .max(80)
          .optional()
          .describe("Or a pool's sqrtPriceX96, to read as a price."),
      },
      output: {
        price: z.string(),
        sqrtPriceX96: z.string(),
        token0: z.string(),
        token1: z.string(),
      },
      annotations: PURE,
    },
    (args) => {
      const chain = pricedChain(parseChain(String(args.chain), "chain"));
      const given = priceGiven(args.price, args.sqrtPriceX96);

      return fromCommand(
        priceCommand({
          chain,
          base: parsePriceToken(args.base, chain),
          quote: parsePriceToken(args.quote, chain),
          price: given,
        }),
      );
    },
  );

  tool(
    "sauce_compile",
    {
      title: "Compile a program",
      description:
        "Compiles a SauceScript program for a chain, as `sauce compile --json` does: the chain's " +
        "token symbols, protocol namespaces, chainId, the @sauce/token functions and intents " +
        "opened in the program all resolve against it. Returns the bytecode and its size, main's " +
        "runtime parameters and how they are encoded (with compactArgs, the compact-v1 schema), " +
        "the defines it was given, the compiler and the released engine it pairs with, and on " +
        "Solana the account manifest — the accounts a cook attaches, in order. A program that " +
        "does not compile is an error naming the line.",
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
    async (args) => {
      const program = programOf(args);
      const output = await compileCommand(program.input, program.files);

      return {
        // The command's own report of the defines, where it gives one, is the one to read.
        json: {
          defines: Object.fromEntries(
            Object.entries(program.input.defines).map(([name, value]) => [name, defineJson(value)]),
          ),
          ...output.json,
        },
        notes: output.notes,
      };
    },
  );

  tool(
    "sauce_tx",
    {
      title: "Build the unsigned cook transaction",
      description:
        "The transaction that runs a program, unsigned, for a wallet to sign — what `sauce tx` " +
        "prints. On an EVM chain { chainId, to: the Pot, data: Pot.cook(engine, program ++ " +
        "arguments), value }, sent by the Pot's owner (cook() is onlyOwner); give value, or let " +
        "the server read the Kitchen's fee where it has an endpoint (which also checks the Pot). " +
        "On Solana { chain, feePayer, pot, fee, transaction }: the Kitchen cook as a base64 " +
        "transaction signed by no one, for the owner to sign; it needs the server's Solana " +
        "endpoint (for the blockhash and the fee). notes say what must be true for it to land. " +
        "Nothing is signed or sent.",
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
    async (args) => {
      const program = programOf(args);
      const chain = program.input.chain;
      const rpcUrl = endpoints.endpoint(chain);
      if (chain.kind === "svm") {
        if (rpcUrl === undefined) {
          throw noEndpoint(chain, endpoints, "A Solana cook transaction (its blockhash and fee)");
        }

        return fromCommand(await svmTxCommand(svmCook(args, program, rpcUrl), program.files));
      }
      const cook = evmCook(args, program);
      if (cook.value === undefined && rpcUrl === undefined) {
        throw new UsageError(
          `missing value: the cook pays the Kitchen's execution fee plus any native the program ` +
            `spends, and this server has no endpoint for ${chain.slug} to read the fee from. ` +
            "Give value, in wei.",
        );
      }

      return fromCommand(
        await txCommand({ ...cook, ...(rpcUrl === undefined ? {} : { rpcUrl }) }, program.files),
      );
    },
  );

  tool(
    "sauce_pot",
    {
      title: "Predict a Pot and build its deployment",
      description:
        "A Pot's address — known before it exists, from the released Kitchen over (owner, salt) " +
        "— and the unsigned transaction that deploys it, as `sauce pot` prints them: on an EVM " +
        "chain Kitchen.deployPot { to, data, value }, which any account may send (the Pot is the " +
        "owner's either way); on Solana the Kitchen's create_pot instruction, which the owner " +
        "signs. `deployed` says whether it exists, where the server has an endpoint for the " +
        "chain; null where it has none. Nothing is signed or sent.",
      input: { chain: chainRef, ...POT },
      output: {
        pot: z.string(),
        owner: z.string(),
        salt: z.string(),
        deployed: z.boolean().nullable(),
      },
      annotations: READS_CHAIN,
    },
    async (args) => {
      const chain = parseChain(String(args.chain), "chain");
      if (args.owner === undefined) throw new UsageError("missing owner: whose Pot");
      const salt = parseSalt(args.salt, args.saltHex);
      const rpcUrl = endpoints.endpoint(chain);
      const unchecked = `This server has no endpoint for ${chain.slug}, so whether the Pot exists was not checked.`;
      if (chain.kind === "svm") {
        const target = { owner: parsePubkey("owner", args.owner), ...salt };
        const output = await svmPotCommand(target);
        const deployed = rpcUrl === undefined ? null : await svmPotExists(target, rpcUrl);

        return {
          json: { ...output.json, deployed },
          notes: [...(output.notes ?? []), ...(deployed === null ? [unchecked] : [])],
        };
      }
      const output = potCommand({ chain, owner: parseAddress("owner", args.owner), ...salt });
      const deployed =
        rpcUrl === undefined
          ? null
          : (await potState(await connect(rpcUrl, chain), output.json.pot as Address)).deployed;

      return {
        json: { ...output.json, deployed },
        notes: [...(output.notes ?? []), ...(deployed === null ? [unchecked] : [])],
      };
    },
  );

  tool(
    "sauce_simulate",
    {
      title: "Rehearse a cook",
      description:
        "Rehearses the cook from the Pot's owner with no key and nothing sent, as `sauce " +
        "simulate` does, on the server's endpoint for the chain. EVM: through eth_simulateV1 " +
        "(else eth_call with state overrides; `path` says which), on a Pot that need not be " +
        "deployed yet — the rehearsal deploys it first — returning ok, the gas, what main " +
        "returns, the ERC-20 transfers and approvals, native transfers and each address's net " +
        "change; or the stage and decoded reason it reverts. assumeBalance gives the Pot " +
        "balances for the rehearsal only; fund rehearses `sauce run --fund`'s pulls, the Pot " +
        "credited what they would bring. Solana: the Kitchen cook simulated from the owner " +
        "(a missing Pot created first), returning the compute units, or the reason and the " +
        "program logs. A revert is a result (ok: false), not an error.",
      input: {
        ...PROGRAM,
        ...COOK,
        assumeBalance: TOKEN_AMOUNTS.describe(
          "EVM only: balances the Pot holds for this rehearsal only, by state override. " +
            "<TOKEN|address>:<amount> each: whole units (USDC:2) or base units ending in n; " +
            "ETH:<amount> for the native currency.",
        ),
        fund: TOKEN_AMOUNTS.describe(
          "EVM only: what `sauce run --fund` would pull from the owner into the Pot in the " +
            "cook. With no key here, the Pot is credited it instead. <TOKEN|address>:<amount> each.",
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
    async (args) => {
      const program = programOf(args);
      const chain = program.input.chain;
      const rpcUrl = requireEndpoint(chain, endpoints, "Simulating");
      if (chain.kind === "svm") {
        if ((args.assumeBalance ?? []).length > 0) {
          throw new UsageError(
            "assumeBalance is for EVM chains: a Solana endpoint's simulateTransaction takes no " +
              "account overrides, so on solana the rehearsal runs on the accounts as they are",
          );
        }
        fundingFor({
          chain,
          rpcUrl,
          fund: args.fund ?? [],
          ...(args.fundMode === undefined ? {} : { mode: args.fundMode }),
          sweep: args.sweep === true,
          send: false,
          yes: false,
          confirm: async () => undefined,
        });

        return fromCommand(await svmSimulateCommand(svmCook(args, program, rpcUrl), program.files));
      }
      const cook = evmCook(args, program);
      const assume = assumedBalances(args.assumeBalance ?? [], chain);
      const fund = fundingFor({
        chain,
        rpcUrl,
        fund: args.fund ?? [],
        ...(args.fundMode === undefined ? {} : { mode: args.fundMode }),
        sweep: args.sweep === true,
        // A rehearsal: nothing sent, no key, so the pulls are credited rather than signed.
        send: false,
        yes: false,
        confirm: async () => undefined,
      });

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
        "For a program whose intents are fixed when it is built (every amount a define or a " +
        "literal), the source chain's transactions that publish and fund each intent from a " +
        "wallet, unsigned, as `sauce publish --format json` prints them: each reward token's " +
        "approve to the Portal, then Portal.publishAndFund, with the intent hash. Send them in " +
        "order from the wallet that funds the reward. With `from` and an endpoint, the approvals " +
        "are planned against that wallet's standing allowance (a USDT-style reset first where " +
        "needed). dryRun rehearses them together through eth_simulateV1 from `from` instead, " +
        "with assumeBalance giving that wallet balances for the rehearsal only. A program that " +
        "measures a value on chain, or does anything besides open intents, is refused: run it " +
        "on a Pot (sauce_tx). Nothing is signed or sent.",
      input: {
        ...PROGRAM,
        from: z
          .string()
          .max(64)
          .optional()
          .describe(
            "The wallet that publishes and funds: plans exact approvals, and is dryRun's sender.",
          ),
        dryRun: z
          .boolean()
          .optional()
          .describe("Rehearse the transactions together (eth_simulateV1) instead; needs from."),
        assumeBalance: TOKEN_AMOUNTS.describe(
          "With dryRun: balances `from` holds for the rehearsal only, by state override. " +
            "<TOKEN|address>:<amount> each.",
        ),
      },
      output: { intents: z.array(z.looseObject({ intentHash: z.string() })) },
      annotations: READS_CHAIN,
    },
    async (args) => {
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
              rpcUrl: requireEndpoint(chain, endpoints, "A dry run"),
              from,
              ...(assume.length === 0 ? {} : { assume }),
            },
            program.files,
          ),
        );
      }
      const rpcUrl = from === undefined ? undefined : endpoints.endpoint(chain);

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
    "sauce_inspect",
    {
      title: "Take a call or a program apart",
      description:
        "Reads what a SauceScript author wrote back out of bytes, as `sauce inspect` does: a " +
        "Pot.cook (its engine, its program, the intents the program opens), a Kitchen.deployPot " +
        "(the Pot it makes), a Portal publish or publishAndFund (the route and the reward), an " +
        "ERC-20 call, or a bare program. A 32-byte hash is a transaction, fetched through the " +
        "server's endpoint for `chain`. With `source`, a cook's program is checked against that " +
        "program's and its arguments are decoded against main; `source` alone is compiled and " +
        "its intents listed.",
      input: {
        hex: z
          .string()
          .max(LIMITS.hex)
          .optional()
          .describe("Calldata, a program, or a 32-byte transaction hash; all 0x hex."),
        ...PROGRAM,
        source: PROGRAM.source
          .optional()
          .describe(
            "The program the hex was compiled from, to check and decode it against; or, with no " +
              "hex, the program to inspect.",
          ),
      },
      output: {},
      annotations: READS_CHAIN,
    },
    async (args) => {
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
        rpcUrl = requireEndpoint(chain, endpoints, "Fetching a transaction");
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
      title: "Check a settle",
      description:
        "Whether a settle payload, a Pot.cook, a Portal publish or a transaction runs the " +
        "audited settle program, as `sauce verify` checks it: valid with its tokens, minOut " +
        "and recipient, or valid: false with the rejection code. A 32-byte hash is a " +
        "transaction, fetched through the server's endpoint for `chain`. On Solana (chain " +
        "solana): a cook's transaction signature, with the minOut and splCount the settle was " +
        "compiled for. A rejection is a result, not an error.",
      input: {
        hex: z
          .string()
          .max(LIMITS.hex)
          .optional()
          .describe(
            "A settle payload, Pot.cook or Portal calldata, or a transaction hash: 0x hex.",
          ),
        signature: z
          .string()
          .max(128)
          .optional()
          .describe("Solana: the cook transaction's signature."),
        chain: chainRef.optional().describe("The chain a transaction is on."),
        pins: z
          .array(z.string().max(100))
          .max(LIMITS.entries)
          .optional()
          .describe("Historical settle programs also accepted, each <keccak256>:<bytes>."),
        engines: z
          .array(z.string().max(64))
          .max(LIMITS.entries)
          .optional()
          .describe("Engines also accepted besides the released one, by address."),
        minOut: integer.optional().describe("Solana: the floor the settle enforces."),
        splCount: integer
          .optional()
          .describe("Solana: how many escrows the settle sweeps with its first token program."),
      },
      output: { valid: z.boolean() },
      annotations: READS_CHAIN,
    },
    async (args) => {
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
            rpcUrl: requireEndpoint(chain, endpoints, "Verifying a Solana cook"),
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
        fetched = { chain, rpcUrl: requireEndpoint(chain, endpoints, "Fetching a transaction") };
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
