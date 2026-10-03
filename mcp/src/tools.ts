/**
 * The tools: the `sauce` command's read-only half, one tool per command, each calling the function
 * that command calls (`sdk.ts`) with the inputs it takes. No tool signs or sends anything, and
 * none takes a key: a transaction comes back unsigned, for a wallet the caller holds.
 *
 * A tool that reads a chain uses the call's own `rpcUrl`, else the server's endpoint for that chain
 * from `--config`, else a built-in public endpoint, saying so in its notes, else says plainly that
 * it has none (`reach.ts`). Every result and every error is scrubbed of the first two, so no
 * endpoint URL — which usually carries a provider key — leaves the server.
 *
 * A tool that returns a transaction builds it only on a chain the release supports: on a preview
 * chain it is refused by the command's own gate (`sdk/src/cli/support.ts`), before any endpoint is
 * reached, and the refusal comes back as the result's `refused` (`refusedResult`) — the supported
 * chains, and how to ask for that one — which the calling agent can act on.
 */
import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { formatUnits, type Address, type Hex } from "viem";
import * as z from "zod";

import type { Endpoints } from "./config.js";
import { callFiles, DEFAULT_FILE, diskProgram } from "./files.js";
import type { RpcGuard } from "./guard.js";
import { callReach, type Reach } from "./reach.js";
import { toolTerms } from "./terms.js";
import {
  actionsCommand,
  actionsProgram,
  addressDefinesOf,
  assumedBalances,
  CANONICAL_CHAINS,
  CHAIN_SUPPORT_NEW_ISSUE_URL,
  chainSupport,
  compileCommand,
  asPublished,
  compileProgram,
  connect,
  bindMainArguments,
  connectAt,
  definesReach,
  fillTargets,
  fundingFor,
  globalsCommand,
  inspectCommand,
  inspectFile,
  intentRecord,
  kitchenFee,
  parseAccounts,
  parseAddress,
  parseChain,
  parseDefineMap,
  parseLamports,
  MAX_V4_KEYS,
  parsePin,
  parsePubkey,
  parseIntentSalt,
  parseSalt,
  plannedTransactions,
  parseUnixSeconds,
  randomSalt,
  parseV4Key,
  parseVia,
  parseWei,
  poolsCommand,
  potCommand,
  potState,
  potTarget,
  priceCommand,
  pricedChain,
  priceGiven,
  previewRefusal,
  PreviewChainError,
  programChain,
  programChains,
  withoutShebang,
  publishCommand,
  readPoolAt,
  registeredBalances,
  requireSupported,
  resolvePriceTokens,
  tokenGiven,
  simulateCommand,
  svmPotCommand,
  svmPotExists,
  svmPotTokenAccounts,
  svmSimulateCommand,
  svmTxCommand,
  supportedChainNames,
  svmVerifyCommand,
  txCommand,
  UsageError,
  verifyCommand,
  type CanonicalChain,
  type CliFiles,
  type CommandOutput,
  type CompileInput,
  type CookInput,
  type IntentRecord,
  type PreviewChainRefusal,
  type ProgramInput,
  type ProgramSwaps,
  type SvmCookInput,
  type WalletStore,
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

export const chainRef = z
  .union([z.string().min(1).max(64), z.number().int().nonnegative()])
  .describe(
    "The chain: its slug (base, ethereum, solana), an alias, or its numeric id (8453). " +
      "sauce_chains lists every one, and which the release supports.",
  );

/** An integer as a JSON number (exact to 2^53) or as a decimal or 0x-hex string. */
const integer = z.union([z.string().min(1).max(80), z.number().int().nonnegative()]);

const RPC_URL = z
  .string()
  .min(1)
  .max(2048)
  .optional()
  .describe(
    "Optional: an RPC endpoint of your own for the chain, used for this call only. Without " +
      "it, the server's own endpoint for the chain, else a built-in public one, which can be " +
      "slow or rate-limited. It is never returned or logged. A server someone else runs sees " +
      "it, so pass only a key you would share with them, or run the server yourself. A server " +
      "served over HTTP reaches only public https endpoints.",
  );

/** A block to read at: a number (a JSON number, or decimal or 0x-hex text) or a tag. */
const BLOCK = z.union([z.string().min(1).max(80), z.number().int().nonnegative()]).optional();

/** A `block` input as the `--block` text the commands parse. */
const blockText = (block: string | number | undefined): string | undefined =>
  block === undefined ? undefined : integerText(block, "block");

export const PROGRAM = {
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
      "Low-level: compile-time values for names the program leaves undeclared. A program's " +
        "inputs are main's parameters, given as args; these are the compiler's own mechanism. " +
        "Each is an integer in base units (decimal or 0x hex; a string past 2^53), an EVM " +
        "address as 0x hex, a Solana key in base58 (Solana programs), true or false. A define " +
        "replaces the program's module-level const of that name.",
    ),
  compactArgs: z
    .boolean()
    .optional()
    .describe("Encode main's arguments compact-v1 instead of ABI-v1 (default false)."),
  intentDeadline: integer
    .optional()
    .describe("For intents the program opens: their deadline, as Unix seconds."),
  intentRefundee: z
    .string()
    .max(64)
    .optional()
    .describe(
      "For intents a wallet publishes itself (sauce_intent_publish, or inspecting such a file): " +
        "the refundee of each top-level one that names none, in place of that wallet (0x address). " +
        "An intent a program opens on a Pot names its own refundee with .refundee(<address>).",
    ),
  intentRewardDeadline: integer
    .optional()
    .describe(
      "For intents the program opens: from when an unproven intent's reward may be refunded, " +
        "as Unix seconds (default: the intent's deadline).",
    ),
  intentProver: z
    .string()
    .max(64)
    .optional()
    .describe(
      "For intents the program opens: the reward's prover (0x address; default the registry's " +
        "for the pair).",
    ),
  intentSalt: z
    .string()
    .max(66)
    .optional()
    .describe(
      "For intents the program opens: their route salt, 32 bytes of 0x hex (default random, " +
        "picked once per call; give the same one to build the same intent again).",
    ),
  intentExecutionFee: integer
    .optional()
    .describe(
      "For intents that run a program on their destination: that chain's Kitchen fee, in wei.",
    ),
  intentFundVia: z
    .enum(["transfer", "publishAndFund"])
    .optional()
    .describe(
      "For intents the program opens: how their reward reaches the intent's vault. transfer " +
        "(default) pays it into the vault, then Portal.publish; publishAndFund approves the " +
        "Portal, then Portal.publishAndFund, which emits IntentFunded (for an intent built from " +
        "a solver's quote).",
    ),
};

/** `path`, beside an optional `source`: on a server over stdio, whose caller is its own user. */
const PATH = z
  .string()
  .min(1)
  .max(1024)
  .describe(
    "Instead of source: the program's file on this machine, relative to the directory the " +
      "server runs in (or absolute), read when the call runs, with its relative imports read " +
      "beside it — as `sauce compile <file>` reads it. sourceSha256 in the result is that " +
      "file's sha256, to tie what was compiled or rehearsed to the file. Only a server over " +
      "stdio reads files; give source, or path, not both.",
  );

/** A compiling tool's program inputs: `source`, and over stdio `path` instead. Typed as both, with
 *  `source` optional, either way: over HTTP the schema holds `source` required and no `path`. */
function sourceInputs(local: boolean): {
  readonly source: z.ZodOptional<typeof PROGRAM.source>;
  readonly path: z.ZodOptional<typeof PATH>;
} {
  return (
    local
      ? { source: PROGRAM.source.optional(), path: PATH.optional() }
      : { source: PROGRAM.source }
  ) as { source: z.ZodOptional<typeof PROGRAM.source>; path: z.ZodOptional<typeof PATH> };
}

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

/** An intent file's `main` arguments, which a wallet's intents are built with (`bindMainArguments`). */
export const INTENT_ARGS = z
  .array(z.unknown())
  .max(LIMITS.entries)
  .optional()
  .describe(
    "main's arguments, in order, as JSON values: the values the intents are built with. " +
      "A wallet publishes what it knows before anything runs, so each is bound into the " +
      "intents as it is, and each is one word: an integer in base units as a decimal " +
      "string (or a number up to 2^53), an address as 0x hex, or a bool. Required " +
      "exactly when main declares parameters.",
  );

/** A program file's `main` arguments with `bindMainArguments`, which a wallet's intents use. */
export function boundProgram(
  args: ProgramArgs & { readonly args?: readonly unknown[] },
  swaps?: ProgramSwaps,
): Program {
  const given = programOf(args, undefined, swaps);

  return { ...given, input: bindMainArguments(given.input, argsOf(args).args) };
}

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
  via: z
    .enum(["kitchen", "engine"])
    .optional()
    .describe(
      "Solana only: how the cook reaches the engine. kitchen (the default) is the Kitchen's cook " +
        "on the owner's Pot: the program can hold and spend what the Pot owns. engine is the " +
        "engine's own paid cook, with no Kitchen and no Pot: the owner signs as the authority the " +
        "program acts with (accounts `owner` where it needs one; `pot` cannot sign there) and pays " +
        "the fee, and the program's own calls get one more level of CPI depth. Both pay the same " +
        "execution fee.",
    ),
  maxExecutionFee: integer
    .optional()
    .describe(
      "Solana only: the most the cook may pay in execution fee, in lamports. The fee is read from " +
        "the cluster and returned as `fee`; above this the call refuses before building anything. " +
        "Either way the cook signs the fee it read as its max_execution_fee.",
    ),
  rpcUrl: RPC_URL,
};

/** Endpoints by chain, for a call that reads more than one: each intent's destination. */
export const RPC_URLS = z.record(z.string().max(64), z.string().min(1).max(2048)).optional();

const TOKEN_AMOUNTS = z
  .array(z.string().min(3).max(200))
  .max(LIMITS.entries)
  .optional()
  .describe(
    "Each <TOKEN|address>:<amount>: a symbol the chain registers or a 0x token address, and " +
      "the amount in whole tokens (USDC:1.5 is 1.5 USDC, exact through the token's decimals; " +
      "USDC:1500000 is 1.5 million USDC, which notes point out), or in base units with a " +
      "trailing n as a bigint is written (USDC:1500000n is 1.5 USDC); ETH:<amount> is the " +
      "chain's native currency.",
  );

/** How many rehearsals one `sauce_simulate` call may hold. */
export const MAX_SCENARIOS = 16;

/** One of `sauce_simulate`'s scenarios: the call's program with other arguments, defines and
 *  balances. */
const SCENARIO = z.strictObject({
  args: ARGS,
  defines: PROGRAM.defines.describe(
    "Defines for this scenario, laid over the call's own (a define compiles into the program).",
  ),
  assumeBalance: TOKEN_AMOUNTS.describe(
    "EVM only: the Pot's balances for this scenario, instead of the call's assumeBalance.",
  ),
});
type Scenario = z.infer<typeof SCENARIO>;

/** What a summary of a rehearsal keeps: whether it worked or why not, what main returned, what
 *  moved, each transaction's gas, and the block. */
const SUMMARY_FIELDS = [
  "ok",
  "chain",
  "block",
  "stage",
  "reason",
  "returnType",
  "returned",
  "gas",
  "gasKind",
  "transactions",
  "computeUnits",
  "fee",
  "transfers",
  "nativeTransfers",
  "balanceChanges",
  "tokenChanges",
  "lamportChanges",
] as const;

/** A rehearsal's result as `summary` returns it: {@link SUMMARY_FIELDS}, and the raw return data
 *  only where main declares no type to decode it as. */
export function simulateSummary(json: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries([
    ...SUMMARY_FIELDS.filter((field) => field in json).map((field) => [field, json[field]]),
    ...("returns" in json && !("returnType" in json) ? [["returns", json.returns]] : []),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Reading a call's arguments into the commands' inputs
// ---------------------------------------------------------------------------------------------

export type ProgramArgs = z.infer<z.ZodObject<typeof PROGRAM>>;
type CookArgs = Omit<ProgramArgs, "source"> & z.infer<z.ZodObject<typeof COOK>>;

/** Where a program's `kyberSwap`/`ecoSwap` ask for routes: the server's services, never a caller's. */
const swapsOf = (endpoints: Endpoints): ProgramSwaps | undefined =>
  endpoints.swapApis === undefined
    ? undefined
    : {
        apis: endpoints.swapApis,
        ...(endpoints.swapFetch === undefined ? {} : { fetch: endpoints.swapFetch }),
      };

/** A program and the files it compiles from: what every compiling tool starts with. */
export interface Program {
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
  args: Pick<
    ProgramArgs,
    | "intentDeadline"
    | "intentRewardDeadline"
    | "intentRefundee"
    | "intentProver"
    | "intentSalt"
    | "intentExecutionFee"
    | "intentFundVia"
  >,
) {
  const { intentDeadline, intentRewardDeadline, intentRefundee, intentProver, intentSalt } = args;
  const { intentExecutionFee, intentFundVia } = args;

  return {
    // With no deadline, the intents open now: once, so every compile of the call builds the same.
    ...(intentDeadline === undefined
      ? { openedAt: BigInt(Math.floor(Date.now() / 1000)) }
      : {
          deadline: parseUnixSeconds(
            "intent-deadline",
            integerText(intentDeadline, "intentDeadline"),
          ),
        }),
    ...(intentRewardDeadline === undefined
      ? {}
      : {
          rewardDeadline: parseUnixSeconds(
            "intent-reward-deadline",
            integerText(intentRewardDeadline, "intentRewardDeadline"),
          ),
        }),
    ...(intentProver === undefined ? {} : { prover: parseAddress("intent-prover", intentProver) }),
    // Random unless given, and picked once, as the command picks it.
    salt: intentSalt === undefined ? randomSalt() : parseIntentSalt(intentSalt),
    ...(intentRefundee === undefined
      ? {}
      : { refundee: parseAddress("intent-refundee", intentRefundee) }),
    ...(intentExecutionFee === undefined
      ? {}
      : {
          executionFee: parseWei(
            "intent-execution-fee",
            integerText(intentExecutionFee, "intentExecutionFee"),
          ),
        }),
    ...(intentFundVia === undefined ? {} : { fundVia: intentFundVia }),
  };
}

export function programOf(
  given: ProgramArgs,
  fallback?: CanonicalChain,
  swaps?: ProgramSwaps,
): Program {
  // A `#!` line, as a program file may start with, is blanked as the command blanks it.
  const args = { ...given, source: withoutShebang(given.source) };

  return programWith(args, carried(args), fallback, swaps);
}

/** The program and the modules a call carries, served as the commands read files. */
function carried(args: ProgramArgs): { readonly file: string; readonly files: CliFiles } {
  const moduleText = Object.values(args.modules ?? {});
  if (moduleText.length > LIMITS.modules) {
    throw new UsageError(`modules: at most ${LIMITS.modules} files`);
  }
  if (moduleText.reduce((sum, text) => sum + text.length, 0) > LIMITS.modulesTotal) {
    throw new UsageError(`modules: at most ${LIMITS.modulesTotal} characters in all`);
  }

  return callFiles(args.file, args.source, args.modules);
}

/** The sha256 of a program's text as given or read, in hex: what `sha256sum <file>` prints. */
export const sourceSha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** A program as {@link programFrom} reads it: its text's sha256, and the same program compiled
 *  with other defines, from the same text (a scenario's). */
export interface ProgramFrom extends Program {
  readonly sourceSha256: string;
  withDefines(defines: ProgramArgs["defines"]): Program;
}

/** A program by `source`, or on a server over stdio (`local`) by `path`, read once. */
export function programFrom(
  given: Omit<ProgramArgs, "source"> & {
    readonly source?: string | undefined;
    readonly path?: string | undefined;
  },
  local: boolean,
  fallback?: CanonicalChain,
  swaps?: ProgramSwaps,
): ProgramFrom {
  const { path, source, ...rest } = given;
  let text: string;
  let args: ProgramArgs;
  let location: { readonly file: string; readonly files: CliFiles };
  if (path === undefined) {
    if (source === undefined) {
      throw new UsageError(
        local
          ? "missing source: the program's text, or path: its file"
          : "missing source: the program's text",
      );
    }
    text = source;
    args = { ...rest, source: withoutShebang(source) };
    location = carried(args);
  } else {
    if (!local) {
      throw new UsageError(
        "path names a file on the server's disk, which a server over HTTP never reads: give " +
          "the program's text as source",
      );
    }
    if (source !== undefined) throw new UsageError("give source or path, not both");
    if (rest.file !== undefined || rest.modules !== undefined) {
      throw new UsageError(
        "with path the program is that file and its imports are read beside it: give neither " +
          "file nor modules",
      );
    }
    const read = diskProgram(path, LIMITS.source);
    text = read.text;
    args = { ...rest, source: withoutShebang(read.text) };
    location = { file: read.file, files: read.files };
  }
  const withDefines = (defines: ProgramArgs["defines"]): Program =>
    programWith({ ...args, defines }, location, fallback, swaps);

  return { ...withDefines(args.defines), sourceSha256: sourceSha256(text), withDefines };
}

/** A program's inputs read into the commands' `ProgramInput`, its files given. */
function programWith(
  args: ProgramArgs,
  { file, files }: { readonly file: string; readonly files: CliFiles },
  fallback: CanonicalChain | undefined,
  swaps: ProgramSwaps | undefined,
): Program {
  if (Object.keys(args.defines ?? {}).length > LIMITS.entries) {
    throw new UsageError(`defines: at most ${LIMITS.entries}`);
  }
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
  // The defines written as addresses, which the compile report shows as one; any other value is the
  // integer it is.
  const addresses = addressDefinesOf(args.defines ?? {}, chain.kind);

  return {
    input: {
      file,
      text: args.source,
      chain,
      defines,
      ...(addresses.length === 0 ? {} : { addressDefines: addresses }),
      compactArgs: args.compactArgs === true,
      intents: intentsOf(args),
      // Where `kyberSwap`/`ecoSwap` ask for routes: the server's, never the caller's.
      ...(swaps === undefined ? {} : { swaps }),
    },
    files,
  };
}

const argsOf = (args: { readonly args?: readonly unknown[] | undefined }) =>
  args.args === undefined ? {} : { args: { from: "--args-json" as const, values: args.args } };

/** A call's `rpcUrls`, each reached as `reach` reaches a call's URL: by chain id. */
export async function endpointsByChain(
  urls: Readonly<Record<string, string>> | undefined,
  reach: Reach,
): Promise<ReadonlyMap<number, string>> {
  if (Object.keys(urls ?? {}).length > LIMITS.entries) {
    throw new UsageError(`rpcUrls: at most ${LIMITS.entries}`);
  }
  const byChain = new Map<number, string>();
  for (const [key, url] of Object.entries(urls ?? {})) {
    const chain = parseChain(key, "rpcUrls");
    byChain.set(chain.id, (await reach.endpoint(chain, url))!);
  }

  return byChain;
}

/** An EVM cook: the program on the Pot `owner`/`salt` or `pot` names. */
function evmCook(args: CookArgs, program: Program): CookInput {
  if (args.accounts !== undefined) {
    throw new UsageError(
      `accounts names a Solana program's accounts; a program on ${program.input.chain.slug} takes none`,
    );
  }
  for (const [name, given] of [
    ["via", args.via],
    ["maxExecutionFee", args.maxExecutionFee],
  ] as const) {
    if (given !== undefined) {
      throw new UsageError(
        `${name} is for a Solana cook, which can reach the engine through the Kitchen or ` +
          `directly; on ${program.input.chain.slug} a cook is the Pot's, and value carries the fee`,
      );
    }
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
    ...(args.via === undefined ? {} : { via: parseVia(args.via, "via") }),
    ...(args.maxExecutionFee === undefined
      ? {}
      : {
          maxExecutionFee: parseLamports(
            "maxExecutionFee",
            integerText(args.maxExecutionFee, "maxExecutionFee"),
          ),
        }),
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

/** `sauce compile --json`: the command's own report, its defines among it. */
async function compiled(program: {
  readonly input: CompileInput;
  readonly files: CliFiles;
}): Promise<ToolOutput> {
  return fromCommand(await compileCommand(program.input, program.files));
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
/** A rehearsal's approver: it sends nothing, so there is nothing to approve and no one to ask. */
const NO_APPROVER = { auto: false, canAsk: false, approve: async () => undefined } as const;
/** The name an actions document goes by in messages: it comes from the call, not a file. */
const ACTIONS_FILE = "actions.json";
/** An intent's claimant, as fulfill records it: an address, or 32 bytes. */
export const CLAIMANT = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
export const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function hexArg(raw: string, what: string): Hex {
  if (!HEX.test(raw)) throw new UsageError(`${what}: not 0x-prefixed hex bytes`);

  return raw as Hex;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

/** What a tool returns: the command's JSON, and its notes — what must be true for it to land. */
/**
 * `output`'s intents, each with its `record`: the intent in full, as the intent tools take it, so
 * what is published here is named there with no import. A file whose intents cannot be built
 * without running it (one the publish refuses anyway) gets none.
 */
function withRecords(program: Program, output: CommandOutput): ToolOutput {
  const intents = output.json.intents as Array<Record<string, unknown>> | undefined;
  let records: Map<string, IntentRecord>;
  try {
    records = new Map(
      fillTargets(program.input, program.files).map((target) => {
        const record = intentRecord(target.intent, { sourcePortal: target.sourcePortal });

        return [record.intentHash.toLowerCase(), record];
      }),
    );
  } catch {
    return fromCommand(output);
  }

  return {
    json: {
      ...output.json,
      ...(intents === undefined
        ? {}
        : {
            intents: intents.map((intent) => {
              const record = records.get(String(intent.intentHash).toLowerCase());

              return record === undefined ? intent : { ...intent, record };
            }),
          }),
    },
    notes: output.notes,
  };
}

export interface ToolOutput {
  readonly json: Record<string, unknown>;
  readonly notes?: readonly string[] | undefined;
}

export const fromCommand = (output: CommandOutput): ToolOutput => ({
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

/**
 * A tool refused on a preview chain: an error result whose structured content is the refusal, as
 * `refused` — the supported chains, and for each preview chain the GitHub search for an existing
 * request, the prefilled new one, and the title, body and comment to post.
 */
export const refusedResult = (
  refusal: PreviewChainRefusal,
  scrub: (text: string) => string,
): CallToolResult => {
  const structured = scrubbed({ refused: refusal }, scrub) as Record<string, unknown>;

  return {
    isError: true,
    structuredContent: structured,
    content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
  };
};

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
export const READS_CHAIN: ToolAnnotations = { ...PURE, openWorldHint: true };

const notesSchema = z.array(z.string()).optional();

/** A refusal on a preview chain, as `refused` holds it (`sdk/src/cli/support.ts`). */
const REFUSED = z.looseObject({
  code: z.literal("preview-chain"),
  action: z.string(),
  message: z.string(),
  supportedChains: z.array(z.looseObject({ slug: z.string(), id: z.number(), name: z.string() })),
  previewChains: z.array(
    z.looseObject({
      slug: z.string(),
      id: z.number(),
      name: z.string(),
      request: z.looseObject({}),
    }),
  ),
});

/**
 * The output of a tool a preview chain refuses: every field optional, beside `refused`. A client
 * validates an error result's structured content against the tool's output schema too (the MCP
 * SDK's `callTool` does, once it has listed the tools), so a refusal — `{ refused }`, with none of
 * the fields a built transaction has — has to satisfy it.
 */
export function refusable<Shape extends z.ZodRawShape>(
  shape: Shape,
): { [K in keyof Shape]: z.ZodOptional<Shape[K]> } & { refused: z.ZodOptional<typeof REFUSED> } {
  return {
    ...(Object.fromEntries(
      Object.entries(shape).map(([key, field]) => [key, (field as z.ZodType).optional()]),
    ) as unknown as { [K in keyof Shape]: z.ZodOptional<Shape[K]> }),
    refused: REFUSED.optional(),
  };
}

/** The sentence every tool that builds a transaction ends on. */
export const UNSIGNED =
  "Nothing is signed or sent: the caller signs and sends with its own wallet or signer.";

/** What every tool that builds a transaction says about where it builds one. */
export const SUPPORTED_ONLY =
  `It builds transactions only on ${supportedChainNames()}, the chains this release supports. On ` +
  "any other (a preview chain: sauce_chains marks each) it is refused before any endpoint is " +
  "reached, with `refused`: the supported chains, the search for an existing request for that " +
  "chain and a prefilled new one, and the title, body and comment to post. Offer the user that " +
  "request; compile and simulate work on every chain.";

/** That sentence on a server with wallets (`sauce mcp --wallets`). */
export const WALLET_UNSIGNED =
  "Nothing is signed or sent here: pass the result to sauce_wallet_send to send it from one of " +
  "this server's wallets, or sign it with any other wallet.";

// ---------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------

/** What every tool can reach: the operator's endpoints, and over HTTP the guard callers' go through. */
export interface ToolContext {
  readonly endpoints: Endpoints;
  readonly guard?: RpcGuard;
  /** Over stdio: the caller is the server's own user, so a program may be named by `path` and
   *  read from disk. Never over HTTP. */
  readonly local?: boolean;
  /** Over stdio with `--wallets`: the wallets the server signs with. Never over HTTP. */
  readonly wallets?: WalletContext;
}

/** The wallet directory a stdio server was started with, and the password its wallets open with. */
export interface WalletContext {
  readonly store: WalletStore;
  /** Read once at start from the source the server was given; never an input, never returned. */
  readonly password: string;
  /** That source, as the instructions name it. */
  readonly source: string;
}

/** How many tokens `sauce_globals` returns at a time. */
const TOKEN_PAGE = 200;

/** The names of the tools, in the order `tools/list` gives them. */
export const TOOL_NAMES = [
  "sauce_chains",
  "sauce_globals",
  "sauce_price",
  "sauce_pools",
  "sauce_compile",
  "sauce_actions",
  "sauce_tx",
  "sauce_pot",
  "sauce_simulate",
  "sauce_intent_publish",
  "sauce_inspect",
  "sauce_verify",
] as const;

/** One tool's registration: what `tools/list` says of it, and what a call runs. */
export type ToolRegistrar = <Input extends z.ZodRawShape, Output extends z.ZodRawShape>(
  name: string,
  config: {
    readonly title: string;
    readonly description: string;
    readonly input: Input;
    readonly output: Output;
    readonly annotations: ToolAnnotations;
  },
  run: (args: z.infer<z.ZodObject<Input>>, reach: Reach) => Promise<ToolOutput> | ToolOutput,
) => void;

/**
 * Registers tools on `server` whose handlers return a ToolOutput; a throw becomes an error
 * result. Each call gets its own reach: its rpcUrl, scrubbed from everything it returns, and
 * released after.
 */
/** Inputs a tool once took under another name, and the name each has now. */
const RENAMED_INPUTS: Readonly<Record<string, string>> = { intentCreator: "intentRefundee" };

/** A tool's input schema: every field it knows, and a refusal of any other, which names the input
 *  a renamed one is now. */
function inputSchemaOf(input: z.ZodRawShape) {
  return z.strictObject(input, {
    error: (issue) => {
      if (issue.code !== "unrecognized_keys") return undefined;
      const renamed = issue.keys.filter((key) => (RENAMED_INPUTS[key] ?? "") in input);

      return renamed.length === 0
        ? undefined
        : renamed.map((key) => `\`${key}\` is now \`${RENAMED_INPUTS[key]}\``).join("; ");
    },
  });
}

export function toolRegistrar(server: McpServer, context: ToolContext): ToolRegistrar {
  const { endpoints, guard } = context;

  return (name, config, run) => {
    // A tool that builds a transaction, on a server that can send it: the result says how.
    const sendable = context.wallets !== undefined && config.description.includes(UNSIGNED);
    server.registerTool(
      name,
      {
        title: config.title,
        description: sendable
          ? config.description.replace(UNSIGNED, WALLET_UNSIGNED)
          : config.description,
        // A tool that takes nothing declares no schema, so a call that sends no arguments is
        // still a call; every other refuses a field it does not know.
        inputSchema:
          Object.keys(config.input).length === 0 ? undefined : inputSchemaOf(config.input),
        outputSchema: z.looseObject({ ...config.output, notes: notesSchema }),
        annotations: { title: config.title, ...config.annotations },
      },
      async (args: unknown) => {
        const reach = callReach(endpoints, guard);
        try {
          const output = withPublicNotes(await run(args as never, reach), reach);

          return result(
            sendable && (args as { dryRun?: unknown }).dryRun !== true
              ? withSendNote(output)
              : output,
            reach.scrub,
          );
        } catch (error) {
          if (error instanceof PreviewChainError) return refusedResult(error.refusal, reach.scrub);
          // A public endpoint's failure (a rate limit) is the one an endpoint of your own fixes.
          const said = reach.publicNotes();

          return {
            isError: true,
            content: [{ type: "text", text: [errorText(error, reach.scrub), ...said].join("\n") }],
          };
        } finally {
          reach.release();
        }
      },
    );
  };
}

/** `output` with what the call says of the chains it read through a built-in public endpoint. */
function withPublicNotes(output: ToolOutput, reach: Reach): ToolOutput {
  const said = reach.publicNotes();

  return said.length === 0 ? output : { ...output, notes: [...(output.notes ?? []), ...said] };
}

/** `output` with a note on sending it from a wallet, when it carries transactions to send. */
function withSendNote(output: ToolOutput): ToolOutput {
  // A Pot that is there already: its deployment is not to be sent.
  if (output.json.deployed === true) return output;
  try {
    const count = plannedTransactions(output.json).length;

    return {
      ...output,
      notes: [
        ...(output.notes ?? []),
        `To send ${count === 1 ? "it" : `these ${count}`} from one of this server's wallets: ` +
          "sauce_wallet_send { wallet, transaction: <this result> }. It rehearses them first, " +
          "and holds them to the wallet's policy.",
      ],
    };
  } catch {
    return output;
  }
}

export function registerTools(server: McpServer, context: ToolContext): void {
  const { endpoints } = context;
  const local = context.local === true;
  const tool = toolRegistrar(server, context);

  tool(
    "sauce_chains",
    {
      title: "List the chains",
      description:
        "Lists every chain a Sauce program can run on, to choose the `chain` the other tools " +
        "take: each chain's slug, numeric id, name, kind (evm or svm) and aliases, `support`, " +
        `and \`endpoint\`. \`support\` is "supported" for ${supportedChainNames()}, where this ` +
        'release builds transactions, and "preview" for every other chain: programs compile ' +
        "and simulate there, but the tools that build a transaction refuse it (`refused` says " +
        "how to request the chain). `endpoint` is where this server reads the chain without the " +
        'call\'s rpcUrl: "config", its operator\'s endpoint; "public", a built-in public one, ' +
        'which can be slow or rate-limited; "none", only through the call\'s rpcUrl. Reads ' +
        "nothing.",
      input: {},
      output: {
        chains: z.array(
          z.looseObject({
            slug: z.string(),
            id: z.number(),
            kind: z.enum(["evm", "svm"]),
            support: z.enum(["supported", "preview"]),
            endpoint: z.enum(["config", "public", "none"]),
          }),
        ),
        supported: z.array(z.string()),
        requestChain: z.string(),
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
          support: chainSupport(chain),
          endpoint: endpoints.chainIds.includes(chain.id)
            ? "config"
            : endpoints.public?.chainIds.includes(chain.id) === true
              ? "public"
              : "none",
        })),
        supported: CANONICAL_CHAINS.filter((chain) => chainSupport(chain) === "supported").map(
          (chain) => chain.slug,
        ),
        requestChain: CHAIN_SUPPORT_NEW_ISSUE_URL,
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
        "defines, and the @sauce/token functions. With no filter, everything but the chain's " +
        "tokenized stocks (Ethereum and Solana have over a thousand each; Base's include " +
        "Coinbase's, such as SPCXc for SpaceX; Solana's are Token-2022 mints, such as TSLAx), " +
        "which a program names like any token: `stocks` lists them and " +
        "`search` finds one by symbol, company name or ticker, each with its issuer, the " +
        "underlying's ticker and the issuer's list it was copied from. Tokens come " +
        `${TOKEN_PAGE} at a time: \`offset\` pages on. Reads nothing.`,
      input: {
        chain: chainRef,
        tokens: z.boolean().optional().describe("Only the token symbols."),
        protocols: z.boolean().optional().describe("Only the protocol namespaces."),
        stocks: z.boolean().optional().describe("Only the chain's tokenized stocks."),
        search: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Only the tokens, stocks included, whose symbol, name, ticker or issuer contains " +
              "this text, without regard to case: spacex, SPCX, Tesla.",
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(`The first token to return, for the next page (${TOKEN_PAGE} a page).`),
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
          stocks: args.stocks === true,
          ...(args.protocol === undefined ? {} : { protocol: args.protocol }),
          ...(args.search === undefined ? {} : { search: args.search }),
        }),
      );
      const protocols = output.json.protocols as
        Array<{ contracts?: Array<Record<string, unknown>> }> | undefined;
      const tokens = output.json.tokens as unknown[] | undefined;
      // A page of tokens: `stocks` on Ethereum is over a thousand.
      const offset = args.offset ?? 0;
      const page =
        tokens === undefined
          ? {}
          : {
              tokens: tokens.slice(offset, offset + TOKEN_PAGE),
              ...(tokens.length > TOKEN_PAGE || offset > 0
                ? {
                    page: {
                      offset,
                      total: tokens.length,
                      ...(offset + TOKEN_PAGE < tokens.length ? { next: offset + TOKEN_PAGE } : {}),
                    },
                  }
                : {}),
            };
      // Every namespace's methods are tens of kilobytes: they come with `protocol`, for one.
      return {
        ...output,
        json: {
          ...output.json,
          ...page,
          ...(protocols === undefined
            ? {}
            : {
                protocols: protocols.map((namespace) => ({
                  ...namespace,
                  contracts: (namespace.contracts ?? []).map(
                    ({ methods: _methods, ...contract }) => contract,
                  ),
                })),
              }),
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
        "sqrtPriceLimitX96 — and, for selling (`sell`) and for buying (`buy`) the base token: " +
        "`maxPrice` and `maxAvgPrice`, input paid per output bought in base units times 1e18 " +
        "(the price times 10^(18 + tokenIn decimals - tokenOut decimals)), which are the " +
        "distributed swap's maxPrice and maxAvgPrice — `buy` for buying the base token with the " +
        "quote token; and `minAvgPrice`, the other way round (output received per input, a " +
        "floor for out * 1e18 >= minAvgPrice * spent), never to be passed as a maxAvgPrice. " +
        "`units` says each. Give the price one of three ways: `price` (a decimal), " +
        "`sqrtPriceX96` (to read it back), or `pool` with an endpoint, which reads that V3-style " +
        "pool (Uniswap V3, PancakeSwap V3, Aerodrome Slipstream) now and names its venue. With " +
        "slippageBps, `limits` gives each direction's sqrtPriceLimitX96 that far from the price, " +
        "and a maxPrice, maxAvgPrice and minAvgPrice that also pay the pool's fee (feePpm, or " +
        "the pool's own). Uniswap V3 and V4 and their forks share the arithmetic. Use it to set " +
        "a swap's limits, then pass them as defines or arguments.",
      input: {
        chain: chainRef,
        base: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "The token the price is per one of: a symbol the chain registers (WETH, or a " +
              "tokenized stock's such as SPCXc, in any case), or <0x address>:<decimals>, or with " +
              "an endpoint a 0x address alone (its decimals read from the token).",
          ),
        quote: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "The token the price is in: a symbol (USDC), or <0x address>:<decimals>, or with an " +
              "endpoint a 0x address alone.",
          ),
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
            "A V3-style pool of the pair (0x address: Uniswap V3, PancakeSwap V3 or Aerodrome " +
              "Slipstream, as sauce_pools lists them), read now through an endpoint: its price, " +
              "tick, liquidity, fee and tick spacing, and its venue when the registry's factory " +
              "made it. (A V4 pool has no address; sauce_pools reads it by its key.)",
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
      const given = [args.price, args.sqrtPriceX96, args.pool].filter((each) => each !== undefined);
      if (given.length !== 1) {
        throw new UsageError("give one of price, sqrtPriceX96, or pool (with an endpoint)");
      }
      // A pool is read now, and an address with no decimals given has them read from the token;
      // otherwise the call reaches no chain.
      const reads =
        args.pool !== undefined ||
        [args.base, args.quote].some((raw) => typeof tokenGiven(raw, chain) === "string");
      const rpcUrl = reads ? await reach.endpoint(chain, args.rpcUrl) : undefined;
      const client = rpcUrl === undefined ? undefined : await connect(rpcUrl, chain);
      const tokens = await resolvePriceTokens([args.base, args.quote], chain, client);
      const [base, quote] = [tokens[0]!, tokens[1]!];
      // The pool, read now through the command's own reader: `sauce price --pool`.
      if (args.pool !== undefined && client === undefined) {
        await reach.require(chain, args.rpcUrl, "Reading a pool");
      }
      const pool =
        args.pool === undefined
          ? undefined
          : await readPoolAt(client!, chain, parseAddress("pool", args.pool));
      const feePpm = args.feePpm ?? pool?.fee;
      const at = (price: { decimal: string } | { sqrtPriceX96: bigint }) =>
        priceCommand({ chain, base, quote, price });
      const now =
        pool === undefined
          ? at(priceGiven(args.price, args.sqrtPriceX96))
          : priceCommand({ chain, base, quote, price: { sqrtPriceX96: pool.sqrtPriceX96 }, pool });
      const json: Record<string, unknown> = { ...now.json };
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
        // maxPrice is fee-inclusive, as the distributed swap's: the floor's price, read as input
        // paid per output.
        json.limits = {
          slippageBps: args.slippageBps,
          feePpm: feePpm ?? 0,
          sell: {
            price: sellLimit.json.price,
            sqrtPriceLimitX96: side(sellLimit, "sell").sqrtPriceLimitX96,
            maxPrice: side(sellFloor, "sell").maxPrice,
            maxAvgPrice: side(sellFloor, "sell").maxAvgPrice,
            minAvgPrice: side(sellFloor, "sell").minAvgPrice,
          },
          buy: {
            price: buyLimit.json.price,
            sqrtPriceLimitX96: side(buyLimit, "buy").sqrtPriceLimitX96,
            maxPrice: side(buyFloor, "buy").maxPrice,
            maxAvgPrice: side(buyFloor, "buy").maxAvgPrice,
            minAvgPrice: side(buyFloor, "buy").minAvgPrice,
          },
        };
      }

      return { json, notes: now.notes };
    },
  );

  tool(
    "sauce_pools",
    {
      title: "List a pair's price-limit pools on a chain",
      description:
        "Every pool of a pair on an EVM chain at the price-limit venues the registry records " +
        "there — Uniswap V3 and PancakeSwap V3 at each fee tier their factory enables, Aerodrome " +
        "Slipstream at each tick spacing of each CLFactory, hookless Uniswap V4 pools at the " +
        "keys 100:1, 500:10, 3000:60 and 10000:200 and any in v4Pools — read now through an " +
        "endpoint. Use it before a distributed or limit swap, to know which pools exist, how " +
        "deep each is and what each charges. `pools` holds those with liquidity, deepest " +
        "first (by liquidity at the pool's price): each pool's venue, the contract a program " +
        "finds it through (UniswapV3.Factory), its address (a V4 pool's poolId and key), fee " +
        "in millionths read from the pool (a V4 pool's LP fee and protocolFee), tickSpacing, " +
        "liquidity, tick and sqrtPriceX96, and two `sides`, paying tokenA for tokenB then the " +
        "reverse: `mid` and `taker` (pay tokens per buy token, before and with the fee), " +
        "`maxPrice` (the taker price as the distributed swap's maxPrice argument: pay base " +
        "units per buy base unit times 1e18) and `depth1Pct` (pay tokens, fee included, that " +
        "move the price 1% against the taker, through its ticks). `empty` lists the pools with " +
        "no liquidity at their price, which a swap skips; `checked`, what was looked at. Every " +
        "read is at one block, `block` (the latest, or the one given): pass it to " +
        "sauce_simulate's block to rehearse on the prices a maxPrice was taken from.",
      input: {
        chain: chainRef,
        tokenA: z
          .string()
          .min(1)
          .max(64)
          .describe(
            "One token of the pair, paid in the first side: a symbol the chain registers " +
              "(USDC, or a tokenized stock's such as SPCXc, in any case), or a 0x address (its " +
              "decimals and symbol read from the token), or <0x address>:<decimals>.",
          ),
        tokenB: z.string().min(1).max(64).describe("The other token, written the same ways."),
        v4Pools: z
          .array(z.string().min(3).max(16))
          .max(MAX_V4_KEYS)
          .optional()
          .describe(
            "More hookless Uniswap V4 pools to try, each by its key's <fee>:<tickSpacing>, the " +
              "fee in millionths: 50:1.",
          ),
        block: BLOCK.describe(
          "The block to read the pools at: a number, or latest, safe, finalized (default: latest).",
        ),
        rpcUrl: RPC_URL,
      },
      output: {
        chain: z.string(),
        block: z.string(),
        tokens: z.array(
          z.looseObject({ symbol: z.string(), address: z.string(), decimals: z.number() }),
        ),
        sortedBy: z.string(),
        pools: z.array(
          z.looseObject({
            venue: z.string(),
            contract: z.string(),
            fee: z.number(),
            tickSpacing: z.number(),
            liquidity: z.string(),
            sqrtPriceX96: z.string(),
            sides: z.array(
              z.looseObject({
                pay: z.string(),
                buy: z.string(),
                mid: z.string(),
                taker: z.string(),
                maxPrice: z.string(),
              }),
            ),
          }),
        ),
        empty: z.array(z.looseObject({ venue: z.string(), why: z.string() })),
        checked: z.array(z.looseObject({ venue: z.string(), contract: z.string() })),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const chain = parseChain(String(args.chain), "chain");
      if (chain.kind !== "evm") {
        throw new UsageError(
          `sauce_pools lists Uniswap V3- and V4-style pools, on an EVM chain; ${chain.slug} has none`,
        );
      }
      const v4Keys = (args.v4Pools ?? []).map((raw) => parseV4Key(raw, "v4Pools"));
      const rpcUrl = await reach.require(chain, args.rpcUrl, "Listing a pair's pools");
      const { client, block } = await connectAt(rpcUrl, chain, blockText(args.block));

      return fromCommand(
        await poolsCommand({ chain, client, tokens: [args.tokenA, args.tokenB], v4Keys, block }),
      );
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
        "compile is an error naming its line. Also `contracts`, each protocol contract it calls " +
        "with its address, and with args the `payload` (the program with main's arguments " +
        "appended, what a cook carries) and its size; on Solana, with args and accounts, the " +
        "cook's transaction size against the one-transaction limit. For a program that opens " +
        "intents, the result is the program the source chain runs; sauce_inspect with the " +
        "source alone lists each intent's destination, route and reward. Reads no chain unless " +
        "rpcUrls is given: then each intent's destination is checked for the Pot its cook " +
        "needs (`intentPots`). `sourceSha256` is the sha256 of the program's text. To check " +
        "only that a program compiles, omitBytecode leaves the bytecode out.",
      input: {
        ...PROGRAM,
        ...sourceInputs(local),
        omitBytecode: z
          .boolean()
          .optional()
          .describe(
            "Leave the bytecode (the hex) out of the result, keeping its size: to check that a " +
              "program compiles, and what it takes, without the bytes.",
          ),
        args: COOK.args,
        accounts: COOK.accounts,
        via: COOK.via.describe(
          "Solana only: size the Kitchen's cook (the default) or the engine's own paid cook, " +
            "which carries no Kitchen, Pot or salt.",
        ),
        rpcUrls: RPC_URLS.describe(
          "For a program that opens intents: each destination's endpoint by chain (slug or " +
            'id), { "base": "<url>" }, to check the Pot its cook runs on is deployed there. ' +
            "Used for this call only, never returned or logged.",
        ),
      },
      output: {
        chain: z.string(),
        chainId: z.number(),
        target: z.enum(["evm", "svm"]),
        bytecode: z.string().optional(),
        size: z.number(),
        sourceSha256: z.string(),
        entryEncoding: z.string(),
        entryParams: z.array(z.looseObject({ name: z.string(), type: z.string() })),
        entrySchema: z.string().nullable(),
        defines: z.unknown(),
        manifest: z.unknown().optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programFrom(args, local, undefined, swapsOf(endpoints));
      if (args.accounts !== undefined && program.input.chain.kind !== "svm") {
        throw new UsageError(
          `accounts names a Solana program's accounts; a program on ${program.input.chain.slug} takes none`,
        );
      }
      if (args.via !== undefined && program.input.chain.kind !== "svm") {
        throw new UsageError(
          `via chooses how a Solana cook reaches the engine; a cook on ${program.input.chain.slug} ` +
            "is the Pot's",
        );
      }
      const byChain = await endpointsByChain(args.rpcUrls, reach);
      const output = await compiled({
        input: {
          ...program.input,
          ...argsOf(args),
          ...(args.accounts === undefined
            ? {}
            : {
                accounts: parseAccounts(
                  Object.entries(args.accounts).map(([name, value]) => `${name}=${value}`),
                ),
              }),
          ...(args.via === undefined ? {} : { via: parseVia(args.via, "via") }),
          ...(byChain.size === 0
            ? {}
            : { endpoints: (chain: CanonicalChain) => byChain.get(chain.id) }),
        },
        files: program.files,
      });
      const { bytecode: _bytecode, ...lean } = output.json;

      return {
        ...output,
        json: {
          ...(args.omitBytecode === true ? lean : output.json),
          sourceSha256: program.sourceSha256,
        },
      };
    },
  );

  tool(
    "sauce_actions",
    {
      title: "Compile an actions document, and build its cook",
      description:
        "Compiles an actions document — protocol operations written as JSON (swaps, bridges, " +
        "wraps, staking, lending, token moves), validated against its JSON Schema (resource " +
        "sauce://actions/schema.json; the sauce-actions skill lists every action) — into the " +
        "SauceScript program that runs them on a chain, as `sauce actions` does. Use it instead " +
        "of writing SauceScript when the task is a fixed sequence of protocol operations. Names " +
        "resolve on the chain it compiles for: tokens by registry symbol (USDC), contracts as " +
        "Namespace.Contract (AaveV3.Pool), pools by their factory's key; a document without a " +
        "chainId compiles on any chain that has its names, given `chain`. Returns sauce_compile's " +
        "report for the generated program (bytecode, size, entryParams, …) with `source` (the " +
        "generated SauceScript), `parameters` (the argument actions, in the order main takes " +
        "them as args) and the bindings it calls through; given owner or pot, also " +
        "`transaction`: the unsigned cook, exactly as sauce_tx returns it — on a preview chain " +
        "the report with `refused` instead of it. EVM chains only. " +
        `${UNSIGNED} ${SUPPORTED_ONLY}`,
      input: {
        program: z
          .union([z.string().min(2).max(LIMITS.source), z.looseObject({})])
          .describe(
            'The actions document: { "version": 1, "actions": [...] }, as an object or its JSON ' +
              'text. Amounts are base-unit integers as decimal strings; `recipient: "self"` is ' +
              "the Pot. Leave chainId out to compile it for `chain`.",
          ),
        chain: chainRef
          .optional()
          .describe(
            "The chain to compile for (slug, alias or id). Needed when the document has no " +
              "chainId; one with a chainId compiles for that chain only.",
          ),
        target: z.enum(["evm"]).optional().describe("Always evm: actions run on EVM chains."),
        compactArgs: PROGRAM.compactArgs,
        ...COOK,
      },
      output: {
        bytecode: z.string(),
        size: z.number(),
        source: z.string(),
        parameters: z.array(z.string()),
        transaction: z.looseObject({}).optional(),
        refused: REFUSED.optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const text = typeof args.program === "string" ? args.program : JSON.stringify(args.program);
      if (text.length > LIMITS.source) {
        throw new UsageError(`program: at most ${LIMITS.source} characters`);
      }
      const input = {
        file: ACTIONS_FILE,
        text,
        ...(args.chain === undefined ? {} : { chain: String(args.chain) }),
        compactArgs: args.compactArgs === true,
      };
      const report = await actionsCommand(input);
      const cook =
        args.owner !== undefined || args.pot !== undefined
          ? { input: await actionsProgram(input), files: callFiles(ACTIONS_FILE, text, {}).files }
          : undefined;
      // The report on every chain; its cook only on a supported one, before any endpoint.
      const refused =
        cook === undefined
          ? undefined
          : previewRefusal("building the cook transaction", programChains(cook.input, cook.files));
      const building =
        cook === undefined || refused !== undefined
          ? undefined
          : await cookTransaction(args, cook, reach);

      return {
        json: {
          ...report.json,
          ...(building === undefined ? {} : { transaction: building.json }),
          ...(refused === undefined ? {} : { refused }),
        },
        notes: [
          ...(report.notes ?? []),
          ...(building?.notes ?? []),
          ...(refused === undefined ? [] : [refused.message]),
        ],
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
        "which also says whether the Pot is deployed. On Solana it returns { chain, via, " +
        "feePayer, pot, fee, maxExecutionFee, transaction }: the Kitchen cook (or, via engine, " +
        "the engine's own paid cook, with no Pot) as a base64 transaction for the owner to sign, " +
        "which needs an endpoint (its blockhash and the fee). `notes` say what must be true for " +
        `it to land: a deployed, funded Pot (sauce_pot deploys it). \`sourceSha256\` is the ` +
        `sha256 of the program's text. ${UNSIGNED} ${SUPPORTED_ONLY}`,
      input: { ...PROGRAM, ...sourceInputs(local), ...COOK },
      output: refusable({
        chainId: z.number(),
        to: z.string(),
        data: z.string(),
        value: z.string(),
        transaction: z.string(),
        sourceSha256: z.string(),
      }),
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programFrom(args, local, undefined, swapsOf(endpoints));
      // Before any endpoint: the chain, and every chain an intent the program opens goes to.
      requireSupported(
        "building the cook transaction",
        programChains(program.input, program.files),
      );
      const output = await cookTransaction(args, program, reach);
      if (program.input.chain.kind === "svm") {
        return {
          json: { ...output.json, sourceSha256: program.sourceSha256 },
          notes: output.notes,
        };
      }
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
          sourceSha256: program.sourceSha256,
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
        "of every token the chain registers but its tokenized stocks; on Solana the Pot's " +
        "associated token account for each registered mint but the tokenized stocks, whether it " +
        "exists, and its balance. On a preview chain the Pot " +
        "is predicted and read, and the deployment is left out: `refused` says why, and how to " +
        `request the chain. ${UNSIGNED} ${SUPPORTED_ONLY}`,
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
        refused: REFUSED.optional(),
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
        "says which), on a Pot that need not be deployed yet — the rehearsal deploys it first, " +
        "and `transactions` gives each transaction's gas (Kitchen.deployPot, then the cook). " +
        "Returns ok, gas, what main returns, the ERC-20 transfers and approvals, native " +
        "transfers and each address's net balance change; or the `stage` and decoded `reason` " +
        "it reverts — a revert is a result (ok: false), not an error. assumeBalance gives the " +
        "Pot balances for the rehearsal only; fund rehearses pulling tokens from the owner into " +
        "the Pot in the cook, the Pot credited what they would bring. block pins the chain's " +
        "state (sauce_pools' block, to rehearse on the prices a limit was taken from). " +
        "`scenarios` rehearses one program several times — each its own args, defines and " +
        "balances, all at one block — with one result each. summary returns only what decides " +
        "a trade: ok or the reason, what main returns, balance changes, transfers, each " +
        "transaction's gas and the block. Solana: the Kitchen cook simulated from the owner (a " +
        "missing Pot created first), or via engine the engine's own paid cook with no Pot: " +
        "compute units, the fee, or the reason and the program logs. `sourceSha256` is the " +
        "sha256 of the program's text. Nothing is signed or sent.",
      input: {
        ...PROGRAM,
        ...sourceInputs(local),
        ...COOK,
        assumeBalance: TOKEN_AMOUNTS.describe(
          "EVM only: balances the Pot holds for this rehearsal only, by state override. Each " +
            "<TOKEN|address>:<amount>, the amount in whole tokens (USDC:2 is 2 USDC), or base " +
            "units ending in n (USDC:2000000n); ETH:<amount> for the native currency.",
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
        block: BLOCK.describe(
          "EVM only: the block to rehearse on, a number, or latest, safe, finalized (default: " +
            "latest).",
        ),
        scenarios: z
          .array(SCENARIO)
          .min(1)
          .max(MAX_SCENARIOS)
          .optional()
          .describe(
            `Up to ${MAX_SCENARIOS} rehearsals of the same program, in order, all at one block ` +
              "(block, or the latest when the call starts). Each scenario's args and " +
              "assumeBalance replace the call's own; its defines are laid over the call's. " +
              "The result is { ok: every scenario ok, block, scenarios: [one result each, or " +
              "its error] }.",
          ),
        summary: z
          .boolean()
          .optional()
          .describe(
            "Return only ok or the revert reason, what main returns (decoded), balance changes, " +
              "transfers, each transaction's gas and the block: none of the state overrides, " +
              "approvals or other logs.",
          ),
      },
      output: {
        ok: z.boolean(),
        sourceSha256: z.string(),
        scenarios: z.array(z.looseObject({ ok: z.boolean() })).optional(),
      },
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const program = programFrom(args, local, undefined, swapsOf(endpoints));
      const chain = program.input.chain;
      const rpcUrl = await reach.require(chain, args.rpcUrl, "Simulating");
      if (args.block !== undefined && chain.kind === "svm") {
        throw new UsageError(
          "block is for EVM chains: a Solana endpoint simulates on the cluster as it is",
        );
      }
      // One rehearsal, its scenario's args, defines and balances over the call's own.
      const rehearse = async (each: Scenario, block: string | undefined): Promise<ToolOutput> => {
        const scenario = {
          ...args,
          ...(each.args === undefined ? {} : { args: each.args }),
          ...(each.assumeBalance === undefined ? {} : { assumeBalance: each.assumeBalance }),
        };
        const built =
          each.defines === undefined
            ? program
            : program.withDefines({ ...(args.defines ?? {}), ...each.defines });
        const funding = {
          chain,
          rpcUrl,
          fund: scenario.fund ?? [],
          ...(scenario.fundMode === undefined ? {} : { mode: scenario.fundMode }),
          sweep: scenario.sweep === true,
          // A rehearsal: nothing sent, no key, so the pulls are credited rather than signed.
          send: false,
          approver: NO_APPROVER,
        };
        if (chain.kind === "svm") {
          if ((scenario.assumeBalance ?? []).length > 0) {
            throw new UsageError(
              "assumeBalance is for EVM chains: a Solana endpoint's simulateTransaction takes " +
                "no account overrides, so on solana the rehearsal runs on the accounts as they are",
            );
          }
          fundingFor(funding);

          return fromCommand(
            await svmSimulateCommand(svmCook(scenario, built, rpcUrl), built.files),
          );
        }
        const cook = evmCook(scenario, built);
        const assume = assumedBalances(scenario.assumeBalance ?? [], chain);
        const fund = fundingFor(funding);

        return fromCommand(
          await simulateCommand(
            {
              ...cook,
              rpcUrl,
              assume,
              ...(fund === undefined ? {} : { fund }),
              ...(block === undefined ? {} : { block }),
            },
            built.files,
          ),
        );
      };
      const shaped = (json: Record<string, unknown>) =>
        args.summary === true ? simulateSummary(json) : json;
      if (args.scenarios === undefined) {
        const output = await rehearse({}, blockText(args.block));

        return {
          json: { ...shaped(output.json), sourceSha256: program.sourceSha256 },
          notes: output.notes,
        };
      }
      // Every scenario on one block: the one given, or the latest now, read once.
      const block =
        chain.kind === "svm"
          ? undefined
          : (await connectAt(rpcUrl, chain, blockText(args.block))).block.toString();
      const results: Array<Record<string, unknown>> = [];
      for (const [index, each] of args.scenarios.entries()) {
        try {
          const output = await rehearse(each, block);
          const notes = output.notes ?? [];
          results.push({
            index,
            ...shaped(output.json),
            ...(notes.length === 0 ? {} : { notes }),
          });
        } catch (error) {
          // One scenario's mistake is its own result; the others still run.
          results.push({
            index,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        json: {
          ok: results.every((each) => each.ok === true),
          sourceSha256: program.sourceSha256,
          ...(block === undefined ? {} : { block }),
          scenarios: results,
        },
      };
    },
  );

  tool(
    "sauce_intent_publish",
    {
      title: "Build an intent's unsigned publish transactions",
      description:
        "For a program that only opens cross-chain intents whose amounts are fixed when it is " +
        "built (every amount a define or a literal): the source chain's transactions that fund " +
        "and publish each intent from a wallet — each reward token transferred to the intent's " +
        "vault (and a native reward sent to it), then Portal.publish, with no approval — with " +
        "each intent's hash, vault and `record`, the intent in full, which sauce_intent_status " +
        "and the other intent tools take. Send them in order from the wallet that funds the " +
        "reward, the transfers first, and publish once they have landed. The vault is the " +
        "package's own computation; with `from` and an endpoint it is also read from the Portal " +
        "and must agree, or the tool refuses, and only what the vault does not hold yet is " +
        "transferred. intentFundVia publishAndFund gives each reward token's approve to the " +
        "Portal (a USDT-style reset to 0 first where needed), then Portal.publishAndFund, " +
        "instead. dryRun rehearses them together through eth_simulateV1 from `from` and reports " +
        "each intent's isIntentFunded after them (intents[].funded), assumeBalance giving that " +
        "wallet balances for the rehearsal only. A program that measures an amount on chain, or " +
        "does anything besides open intents, is refused: run it on a Pot (sauce_tx) instead. " +
        "dryRun works on every chain; the transactions only where the source and every " +
        `destination are supported. ${UNSIGNED} ${SUPPORTED_ONLY}`,
      input: {
        ...PROGRAM,
        args: INTENT_ARGS,
        from: z
          .string()
          .max(64)
          .optional()
          .describe(
            "The 0x wallet that funds and publishes: with an endpoint, the vault is read and " +
              "only what it lacks is transferred (or, with intentFundVia publishAndFund, the " +
              "approvals are planned against its allowance); dryRun's sender.",
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
            "<TOKEN|address>:<amount>, the amount in whole tokens (USDC:2 is 2 USDC), or base " +
            "units ending in n (USDC:2000000n).",
        ),
        rpcUrl: RPC_URL,
      },
      output: refusable({ intents: z.array(z.looseObject({ intentHash: z.string() })) }),
      annotations: READS_CHAIN,
    },
    async (args, reach) => {
      const from = args.from === undefined ? undefined : parseAddress("from", args.from);
      const given = boundProgram(args, swapsOf(endpoints));
      // The wallet that publishes is the creator of each top-level intent that names none, unless
      // the call names another.
      const publisher = given.input.intents.refundee ?? from;
      const program =
        publisher === undefined
          ? given
          : {
              ...given,
              input: { ...given.input, intents: { ...given.input.intents, publisher } },
            };
      const chain = program.input.chain;
      const assume = chain.kind === "evm" ? assumedBalances(args.assumeBalance ?? [], chain) : [];
      if (assume.length > 0 && args.dryRun !== true) {
        throw new UsageError(
          "assumeBalance goes with dryRun: it gives the wallet a balance for a rehearsal, and " +
            "nothing to transactions that are sent",
        );
      }
      if (args.dryRun === true) {
        if (from === undefined) throw new UsageError("a dry run needs whose wallet: give from");

        return withRecords(
          program,
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
      // Before any endpoint: the source, and every chain the intents go to.
      requireSupported("publishing intents", programChains(program.input, program.files));
      const rpcUrl = from === undefined ? undefined : await reach.endpoint(chain, args.rpcUrl);

      return withRecords(
        program,
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
        args: INTENT_ARGS.describe(
          "With source and no hex: main's arguments, bound into the intents the program opens " +
            "as sauce_intent_publish binds them, so they are listed as published. A cook's " +
            "arguments are decoded from its hex instead.",
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
        const program =
          args.args === undefined
            ? programOf({ ...args, source: args.source })
            : boundProgram({ ...args, source: args.source });

        return fromCommand(
          inspectFile(
            program.input.file,
            compileProgram(asPublished(program.input), program.files),
          ),
        );
      }
      if (args.args !== undefined) {
        throw new UsageError(
          "args gives source's main its arguments; a cook's are decoded from its hex",
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
