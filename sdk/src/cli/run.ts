/**
 * The `sauce` command: compile SauceScript exactly as the SDK does, and run it — simulate the cook,
 * sign and send it, deploy the Pot it runs on — or print the unsigned transaction for a wallet;
 * and set a project up to do all of that. `main.ts` is the executable; this is everything it does,
 * over an injected {@link CliIo} so the tests drive it without a child process.
 *
 * NODE-ONLY, and reached by nothing browser-facing: it is the package's `bin`, not an `exports`
 * entry, and no barrel imports it. It reads the environment once, deliberately, and only the
 * variable `--password-env <NAME>` names (`nodeIo().readEnv`). The network is reached only through
 * `--rpc-url` or a `--config` file named on the command line, or else through the built-in public
 * endpoints the process is given (`CliIo.publicRpcs`; none with `--offline`), and a key only through
 * `--wallet`, `--keystore`, `--private-key` or `--keypair` — and every byte printed passes through
 * `signer.ts#scrub` on the way out.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import type { LoweredIntent } from "../routes/intent-sugar.js";
import {
  addressDefines,
  CliError,
  describeFlags,
  parseAddress,
  parseChain,
  parseDefines,
  parseDefinesFile,
  parseFlags,
  parseFundVia,
  parseLamports,
  parseSalt,
  parseTarget,
  parseUnixSeconds,
  parseVia,
  parseWei,
  repeatedFlag,
  requiredFlag,
  stringFlag,
  UsageError,
  type FlagSpec,
  type FlagSpecs,
  type ParsedArgs,
} from "./args.js";
import { actionsCommand, actionsProgram, isActionsDocument, type ActionsInput } from "./actions.js";
import { chainServedBy, connect, connectAt, endpointFor, type Sent } from "./chain.js";
import {
  type Approver,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  compileCommand,
  compileProgram,
  type Confirm,
  type CookInput,
  expectingRevert,
  pastDeadline,
  potCommand,
  potDeployCommand,
  type PotInput,
  potStatusCommand,
  programChains,
  type ProgramInput,
  readInput,
  runCommand,
  txCommand,
  unapproved,
} from "./commands.js";
import { createIntent } from "./create.js";
import { defineLabels, fillCommand, fillTargets, type FillTarget } from "./fill.js";
import type { FundRequest } from "./funding.js";
import {
  cancelCommand,
  claimCommand,
  fileTargets,
  importCommand,
  isIntentHash,
  listCommand,
  proveCommand,
  refundCommand,
  rememberPublished,
  showCommand,
  storedTargets,
  type LifecycleContext,
  type Target,
} from "./intent-commands.js";
import { svmFillCommand } from "./intent-svm.js";
import { interactiveIntents } from "./interactive.js";
import { intentOf, intentRecord } from "./lifecycle.js";
import type { Ask } from "./prompt.js";
import { defaultStoreDir, IntentStore } from "./store.js";
import { globalsCommand } from "./globals.js";
import { initProject, installedViem, writeSauceScriptTsconfig } from "./init.js";
import {
  assumedBalances,
  bindMainArguments,
  definesReach,
  fundingFor,
  potTarget,
  programChain,
  withoutShebang,
} from "./inputs.js";
import { inspectCommand, inspectFile } from "./inspect.js";
import {
  checkIntentPots,
  destinationFee,
  intentCooks,
  missingPotNote,
  uncheckedPotNote,
  type Endpoints,
} from "./intents.js";
import { MCP_FLAGS, mcpCommand } from "./mcp.js";
import { livePrice, priceCommand, pricedChain, priceGiven, resolvePriceTokens } from "./price.js";
import { parseV4Key, poolsCommand, readPoolAt } from "./pools.js";
import { svmPoolsCommand } from "./pools-svm.js";
import { publishCommand } from "./publish.js";
import { simulateCommand } from "./simulate.js";
import {
  intentDestinations,
  previewChainsNote,
  requireSupported,
  supportedChainNames,
} from "./support.js";
import { parsePin, verifyCommand } from "./verify.js";
import {
  loadKeypair,
  parseAccounts,
  parsePubkey,
  svmAssumedBalances,
  svmPotCommand,
  svmPotDeployCommand,
  svmPotStatusCommand,
  svmRunCommand,
  svmSimulateCommand,
  svmTxCommand,
  svmVerifyCommand,
  type SvmCookInput,
} from "./solana.js";
import type { Address as SvmAddress, KeyPairSigner } from "@solana/kit";
import type { PrivateKeyAccount } from "viem/accounts";
import { passwordSource, type CapturedCommand, type PasswordSource } from "./password.js";
import type { PublicEndpoints } from "./public-endpoints.js";
import { keystoreAddress, loadSigner, scrub, secret } from "./signer.js";
import {
  PASSWORD,
  unlockWallet,
  WALLETS,
  walletAddressCommand,
  walletExportCommand,
  walletImportCommand,
  walletListCommand,
  walletNewCommand,
} from "./wallet-commands.js";
import {
  defaultWalletsDir,
  evmAddressOf,
  walletName,
  WalletStore,
  type Unlocked,
  type WalletInfo,
} from "./wallets.js";
import {
  askOn,
  chooseTerminal,
  confirmOn,
  controllingTerminal,
  passwordOn,
  writeToTerminal,
} from "./terminal.js";
import { updateCommand, type Updater } from "./update.js";
import {
  AGENTS,
  describeStatus,
  DEFAULT_AGENTS,
  installedTargets,
  installTarget,
  PACKAGED_SKILLS,
  parseAgents,
  statusOf,
  targetsFor,
  updateTarget,
  type SkillsSource,
} from "./skills.js";

/** Where the command writes, what it reads, and how it runs a package manager or asks a question. */
export interface CliIo extends CliFiles {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly writeText: (path: string, text: string) => void;
  /** Runs `command` in `cwd` with the terminal attached, returning its exit status. */
  readonly run: (command: string, args: readonly string[], cwd: string) => number;
  /** Asks for a password without echoing it. Throws where there is no terminal to ask on. */
  readonly promptPassword: (prompt: string) => Promise<string>;
  /** Asks a yes/no question; `undefined` where there is no terminal to ask on. */
  readonly confirm: Confirm;
  /** Whether a question can reach a terminal (`terminal.ts`). */
  readonly canAsk: () => boolean;
  /** All of stdin, to its end: a program given as `-`. Questions go elsewhere after it. */
  readonly readStdin: () => string;
  /** Asks for a line of text; `undefined` where there is no terminal to ask on. */
  readonly ask?: Ask;
  /** Where the intent store is when `--store` does not say: `~/.sauce/intents` by default. */
  readonly storeDir?: string;
  /** Where the wallets are when `--wallets` does not say: `~/.sauce/wallets` by default. */
  readonly walletsDir?: string;
  /** The variable `--password-env` names: the command's one read of the environment. */
  readonly readEnv: (name: string) => string | undefined;
  /** A file's permission bits, for `--password-file`; `undefined` where there are none (Windows). */
  readonly fileMode: (path: string) => number | undefined;
  /** Runs `--password-command`'s command through the shell, no stdin, capturing what it prints. */
  readonly capture: (command: string) => CapturedCommand;
  /** Writes to the terminal itself, past stdout and the scrubbing: `sauce wallet export` only. */
  readonly writeTerminal?: (text: string) => boolean;
  /**
   * The built-in public endpoints, which a chain is read through when neither `--rpc-url` nor the
   * `--config` file gives its endpoint (`public-endpoints.ts`). The executable gives them
   * (`main.ts`); without them, as in a test, such a chain is not read.
   */
  readonly publicRpcs?: PublicEndpoints | undefined;
  /**
   * What `sauce update` reaches: this package's directory, the npm registry and the package
   * managers (`update.ts`). The executable gives it (`main.ts`); without it, as in a test, nothing
   * is updated.
   */
  readonly updater?: Updater | undefined;
}

/** The real process's streams, filesystem, children and terminal. */
export function nodeIo(): CliIo {
  let stdinRead = false;
  const terminal = () =>
    chooseTerminal({
      stdinRead,
      stdin: process.stdin,
      stderr: process.stderr,
      controlling: controllingTerminal,
    });

  return {
    readStdin: () => {
      stdinRead = true;

      return readFileSync(0, "utf8");
    },
    canAsk: () => {
      const found = terminal();
      found?.close();

      return found !== undefined;
    },
    confirm: async (question) => {
      const found = terminal();
      if (found === undefined) return undefined;
      try {
        return await confirmOn(found, question);
      } finally {
        found.close();
      }
    },
    ask: async (question) => {
      const found = terminal();
      if (found === undefined) return undefined;
      try {
        return await askOn(found, question);
      } finally {
        found.close();
      }
    },
    promptPassword: async (prompt) => {
      const found = terminal();
      if (found === undefined) {
        throw new UsageError(
          `${stdinRead ? "stdin carried the program, and there is " : ""}no terminal to ask for ` +
            "the password on: pass --password-env <NAME>, --password-file <path> or " +
            "--password-command <command>",
        );
      }
      try {
        return await passwordOn(found, prompt);
      } finally {
        found.close();
      }
    },
    // The one read of the environment: the variable the user named, and nothing else.
    readEnv: (name) => process.env[name],
    fileMode: (path) => (process.platform === "win32" ? undefined : statSync(path).mode),
    capture: (command) => {
      const ran = spawnSync(command, {
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024,
      });
      const code = (ran.error as { code?: string } | undefined)?.code;

      return {
        status: ran.error === undefined ? ran.status : null,
        stdout: ran.stdout ?? "",
        ...(code === undefined ? {} : { error: code }),
      };
    },
    writeTerminal: writeToTerminal,
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    readText: (path) => readFileSync(path, "utf8"),
    readModule: (path) => {
      try {
        return readFileSync(path);
      } catch (error) {
        const code = (error as { code?: string }).code;
        // Absent is `undefined` — how the compiler probes a target arm before its fallback. Any
        // other failure means something IS there and could not be read, so it propagates.
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
        throw error;
      }
    },
    writeText: (path, text) => writeFileSync(path, text),
    run: (command, args, cwd) =>
      spawnSync(command, [...args], {
        cwd,
        stdio: "inherit",
        // npm is `npm.cmd` on Windows, which only a shell resolves.
        shell: process.platform === "win32",
      }).status ?? 1,
  };
}

/** This package's name and version, from the manifest three levels above `sdk/{src,dist}/cli`. */
function packageInfo(): {
  name: string;
  version: string;
  devDependencies?: Record<string, string>;
} {
  const manifest = new URL("../../../package.json", import.meta.url);

  return JSON.parse(readFileSync(manifest, "utf8")) as {
    name: string;
    version: string;
    devDependencies?: Record<string, string>;
  };
}

const skillsSource = (): SkillsSource => {
  const { name, version, devDependencies } = packageInfo();
  // The TypeScript the package is built and checked with: it needs none at run time.
  const typescript = devDependencies?.typescript;
  const viem = installedViem();

  return {
    dir: PACKAGED_SKILLS,
    packageName: name,
    version,
    ...(typescript === undefined ? {} : { typescript }),
    ...(viem === undefined ? {} : { viem }),
  };
};

// ---------------------------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------------------------

const HELP: FlagSpecs = { help: { type: "boolean", short: "h", help: "Show this help" } };

const PROGRAM: FlagSpecs = {
  chain: {
    type: "string",
    value: "<slug|id>",
    help: "Chain the program runs on (base, 8453, solana)",
  },
  target: {
    type: "string",
    value: "<evm|svm>",
    help: "Checked against the chain; svm alone means solana",
  },
  define: {
    type: "string",
    multiple: true,
    value: "NAME=VALUE",
    help: "A compile-time value for a name the program leaves undeclared: integer, 0x hex, true, false; base58 on Solana",
    lowLevel: true,
  },
  defines: {
    type: "string",
    value: "<file.json>",
    help: "Compile-time values from a JSON object of NAME to value; --define wins",
    lowLevel: true,
  },
  "intent-deadline": {
    type: "string",
    value: "<unix seconds>",
    help: "For intents the program opens: their deadline",
  },
  "intent-creator": {
    type: "string",
    value: "<address>",
    help: "…their creator, who may reclaim an unearned reward",
  },
  "intent-reward-deadline": {
    type: "string",
    value: "<unix seconds>",
    help: "…from when an unproven one's reward is refundable (default: the deadline)",
  },
  "intent-prover": {
    type: "string",
    value: "<address>",
    help: "…their prover (default: the registry's for the pair)",
  },
  "intent-execution-fee": {
    type: "string",
    value: "<wei|auto>",
    help: "…the destination Kitchen's fee, when one runs a program; auto reads it",
  },
  "intent-fund-via": {
    type: "string",
    value: "<transfer|publishAndFund>",
    help: "…how their reward is funded: paid into the vault (default), or publishAndFund",
  },
  "compact-args": {
    type: "boolean",
    help: "Take main's arguments as compact-v1, not ABI-v1",
  },
  "source-dir": {
    type: "string",
    value: "<dir>",
    help: "Resolve the program's relative imports here (default: beside it; from stdin, .)",
  },
};

const SALT: FlagSpecs = {
  salt: {
    type: "string",
    value: "<label>",
    help: "Name one of the owner's Pots: salt = keccak256(label)",
  },
  "salt-hex": { type: "string", value: "<bytes32>", help: "…or give its salt exactly" },
};

const COOK: FlagSpecs = {
  owner: {
    type: "string",
    value: "<address>",
    help: "The Pot's owner, which derives the Pot with the salt (default 0)",
  },
  pot: { type: "string", value: "<address>", help: "Or the Pot itself, by address", only: "evm" },
  ...SALT,
  value: {
    type: "string",
    value: "<wei>",
    help: "Kitchen fee plus native spent (default: read the fee)",
    only: "evm",
  },
  "args-json": {
    type: "string",
    value: "<json|file>",
    help: "main's arguments as a JSON array, inline or in a file",
  },
  account: {
    type: "string",
    multiple: true,
    value: "NAME=<address>",
    help: "An account main takes, by name: an address, pot, owner, pot:USDC (the Pot's USDC account), mint:USDC or program:USDC (its token program)",
    only: "svm",
  },
  accounts: {
    type: "string",
    value: "<json|file>",
    help: "The accounts main takes as one JSON object of NAME to value, as --account takes them, inline or in a file",
    only: "svm",
  },
  via: {
    type: "string",
    value: "<kitchen|engine>",
    help: "The Kitchen's cook on the Pot (default), or the engine's own, with no Pot",
    only: "svm",
  },
  "max-execution-fee": {
    type: "string",
    value: "<lamports>",
    help: "Refuse a cook whose execution fee is above this",
    only: "svm",
  },
  "lookup-table": {
    type: "string",
    multiple: true,
    value: "<address>",
    help: "An address lookup table holding the cook's accounts (sauce run creates one when they do not fit)",
    only: "svm",
  },
};

const ENDPOINT: FlagSpecs = {
  "rpc-url": {
    type: "string",
    value: "<url>",
    help: "Your own RPC endpoint for the chain (default: a built-in public one)",
  },
  config: {
    type: "string",
    value: "<file>",
    help: 'Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }',
  },
  offline: { type: "boolean", help: "Read no chain: no endpoint, not even a built-in one" },
};

const SIGNER: FlagSpecs = {
  wallet: {
    type: "string",
    value: "<name>",
    help: "Sign with a wallet of the wallet directory (sauce wallet), EVM or Solana",
  },
  ...WALLETS,
  ...PASSWORD,
  keystore: {
    type: "string",
    value: "<path>",
    help: "Sign with a JSON keystore (v3), with a password source",
    only: "evm",
  },
  "private-key": {
    type: "string",
    value: "<hex>",
    help: "Or sign with a raw key (lands in shell history)",
    only: "evm",
  },
  keypair: {
    type: "string",
    value: "<path>",
    help: "Sign with a keypair file (a JSON array of 64 bytes)",
    only: "svm",
  },
};

const FUND: FlagSpecs = {
  fund: {
    type: "string",
    multiple: true,
    value: "<TOKEN:amount>",
    help: "Pull tokens into the Pot in the cook: USDC:1.5 (whole tokens), ETH:0.01",
    only: "evm",
  },
  "fund-mode": {
    type: "string",
    value: "<mode>",
    help: "permit2 (default), permit, allowance or transfer",
    only: "evm",
  },
  sweep: {
    type: "boolean",
    help: "Return what is left of each funded token afterwards",
    only: "evm",
  },
};

/** Never parsed as a flag: the words after it that are not flags are main's arguments
 *  (`splitArgv`). */
const ARGS: FlagSpecs = {
  args: {
    type: "boolean",
    value: "<value>…",
    help: "main's arguments in order (JSON for an array or tuple); -- before one like a flag",
  },
};

const JSON_FLAG: FlagSpecs = { json: { type: "boolean", help: "Print one JSON object instead" } };
const FORMAT: FlagSpecs = {
  format: {
    type: "string",
    value: "<json|cast>",
    help: "json (default), or a `cast send` line with placeholders",
  },
};

// ---------------------------------------------------------------------------------------------
// Reading the flags into command inputs
// ---------------------------------------------------------------------------------------------

/** The one `<file>` operand a compiling command takes. */
function fileOperand(args: ParsedArgs): string {
  const [file, ...rest] = args.positionals;
  if (file === undefined) {
    throw new UsageError("missing <file>: the SauceScript program, or - to read it from stdin");
  }
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <file>`);

  return file;
}

/**
 * The chain a program runs on: `--chain`, else the file's `// @chain`, else — for `--target svm`
 * or `// @target svm` alone — the one SVM chain (`inputs.ts#programChain`).
 */
function chainOf(
  args: ParsedArgs,
  file: string,
  text: string,
  fallback?: CanonicalChain,
): CanonicalChain {
  const chain = stringFlag(args, "chain");
  const target = stringFlag(args, "target");

  return programChain(
    { ...(chain === undefined ? {} : { chain }), ...(target === undefined ? {} : { target }) },
    file,
    text,
    fallback,
  );
}

/**
 * The endpoints the command reaches the chains a program's intents go to with: `--rpc-url` for the
 * program's own `source` chain, and every other chain as {@link sharedEndpoint} finds it.
 */
function endpointsOf(args: ParsedArgs, io: CliIo, source: CanonicalChain): Endpoints {
  const rpcUrl = stringFlag(args, "rpc-url");

  return (chain) =>
    rpcUrl !== undefined && chain.id !== source.id
      ? sharedEndpoint(args, io, chain)
      : endpoint(args, io, chain);
}

/**
 * `--intent-execution-fee auto`: the fee the program's intents' destination Kitchens charge, read
 * from each through `endpoints`. The program is compiled once with a fee of zero to find which
 * intents run a program there; one with none pays no fee.
 */
async function autoExecutionFee(
  input: ProgramInput,
  io: CliIo,
  endpoints: Endpoints,
  gate: Gate | undefined,
): Promise<bigint | undefined> {
  const probe = compileProgram({ ...input, intents: { ...input.intents, executionFee: 0n } }, io);
  // Before the fee is read: a command refused on these chains reads nothing for them.
  if (gate !== undefined) gated(gate, input.chain, probe.intents);
  const cooks = intentCooks(probe.intents);
  if (cooks.length === 0) {
    io.stderr("--intent-execution-fee auto: no intent here runs a program, so none pays a fee\n");

    return undefined;
  }
  const fee = await destinationFee(cooks, endpoints);
  const chains = [...new Set(cooks.map((cook) => cook.destination.slug))].join(" and ");
  io.stderr(`--intent-execution-fee auto: the Kitchen on ${chains} charges ${fee} wei\n`);

  return fee;
}

/**
 * A command that builds or sends transactions, refused on a preview chain (`support.ts`) before it
 * reaches a network or a key: its name, as the refusal says it, and the chains it is refused by —
 * every chain a program and its intents involve (a cook, publishing), the intents' destinations (a
 * fill, a proof, a cancellation) or their source (a claim, a refund).
 */
interface Gate {
  readonly action: string;
  readonly by: "all" | "destinations" | "source";
}

/** Refuses `gate`'s command on a preview chain among `source` and the `intents` it opens. */
function gated(gate: Gate, source: CanonicalChain, intents: readonly LoweredIntent[] = []): void {
  requireSupported(
    gate.action,
    gate.by === "destinations"
      ? intents.map((intent) => intent.destination)
      : gate.by === "source"
        ? [source]
        : [source, ...intentDestinations(intents)],
  );
}

/** What stdin carried, named in messages. */
export const STDIN = "<stdin>";

/** A program's text, and where it came from. */
interface ProgramText {
  readonly file: string;
  readonly text: string;
  readonly stdin: boolean;
}

/** The program's text: a file's, or stdin's for `-`, read once — or one already read. */
function programText(io: CliIo, operand: string | ProgramText): ProgramText {
  if (typeof operand !== "string") return operand;

  // A `#!` line, which makes the file a command, is blanked: the compile never sees it.
  return operand === "-"
    ? { file: STDIN, text: withoutShebang(io.readStdin()), stdin: true }
    : { file: operand, text: withoutShebang(readInput(io, operand)), stdin: false };
}

/**
 * A program operand's input — a file, or `-` for stdin — and `fallback` its chain when neither
 * `--chain` nor its header says.
 */
async function programInput(
  args: ParsedArgs,
  io: CliIo,
  operand: string | ProgramText = fileOperand(args),
  fallback?: CanonicalChain,
  gate?: Gate,
  /** For a wallet's intents: `main`'s arguments, bound into them (`bindMainArguments`), after
   *  `before` has refused what no arguments could fix. */
  bind?: { readonly args?: ArgsInput; readonly before?: (input: ProgramInput) => void },
): Promise<ProgramInput> {
  const { file, text, stdin } = programText(io, operand);
  const sourceDir = stringFlag(args, "source-dir");
  const chain = chainOf(args, file, text, fallback);
  if (gate !== undefined && gate.by !== "destinations") gated(gate, chain);
  const definesFile = stringFlag(args, "defines");
  const deadline = stringFlag(args, "intent-deadline");
  const rewardDeadline = stringFlag(args, "intent-reward-deadline");
  const creator = stringFlag(args, "intent-creator");
  const prover = stringFlag(args, "intent-prover");
  const fee = stringFlag(args, "intent-execution-fee");
  const fundVia = stringFlag(args, "intent-fund-via");
  const defines = {
    ...(definesFile === undefined
      ? {}
      : parseDefinesFile(readInput(io, definesFile), definesFile, chain.kind)),
    ...parseDefines(repeatedFlag(args, "define"), chain.kind),
  };
  definesReach(file, text, Object.keys(defines));
  const addresses = addressDefines(
    repeatedFlag(args, "define"),
    definesFile === undefined ? undefined : readInput(io, definesFile),
    chain.kind,
  );
  const given: ProgramInput = {
    file,
    text,
    ...(addresses.length === 0 ? {} : { addressDefines: addresses }),
    ...(stdin ? { stdin } : {}),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    chain,
    compactArgs: args.values["compact-args"] === true,
    defines,
    intents: {
      ...(deadline === undefined
        ? {}
        : { deadline: parseUnixSeconds("intent-deadline", deadline) }),
      ...(rewardDeadline === undefined
        ? {}
        : { rewardDeadline: parseUnixSeconds("intent-reward-deadline", rewardDeadline) }),
      ...(creator === undefined ? {} : { creator: parseAddress("intent-creator", creator) }),
      ...(prover === undefined ? {} : { prover: parseAddress("intent-prover", prover) }),
      ...(fee === undefined || fee === "auto"
        ? {}
        : { executionFee: parseWei("intent-execution-fee", fee) }),
      ...(fundVia === undefined ? {} : { fundVia: parseFundVia(fundVia) }),
    },
  };
  bind?.before?.(given);
  const input = bind === undefined ? given : bindMainArguments(given, bind.args);
  if (fee !== "auto") return input;
  const executionFee = await autoExecutionFee(input, io, endpointsOf(args, io, chain), gate);

  return executionFee === undefined
    ? input
    : { ...input, intents: { ...input.intents, executionFee } };
}

/**
 * A compiling command's operand: a SauceScript file, or an actions document (a JSON object with
 * `actions`), which `actions.ts` lowers into the same `ProgramInput` — so its compile, cook, Pot,
 * arguments and funding are every program's.
 */
async function programOperand(args: ParsedArgs, io: CliIo, gate?: Gate): Promise<ProgramInput> {
  // Read once, from the file or stdin (`-`), then told apart.
  const operand = programText(io, fileOperand(args));
  if (!isActionsDocument(operand.text)) return programInput(args, io, operand, undefined, gate);
  const program = await actionsProgram(actionsOperand(args, operand.file, operand.text));
  if (gate !== undefined) gated(gate, program.chain);

  return program;
}

/** An actions document's input, from the flags a program command takes. */
function actionsOperand(args: ParsedArgs, file: string, text: string): ActionsInput {
  if (repeatedFlag(args, "define").length > 0 || stringFlag(args, "defines") !== undefined) {
    throw new UsageError(
      "--define and --defines give a SauceScript program its defines; an actions document's " +
        "values are its own fields",
    );
  }
  const target = stringFlag(args, "target");
  if (target !== undefined && parseTarget(target) !== "evm") {
    throw new UsageError(`${file} is an actions document, and actions run on EVM chains`);
  }
  const chain = stringFlag(args, "chain");

  return {
    file,
    text,
    ...(chain === undefined ? {} : { chain }),
    compactArgs: args.values["compact-args"] === true,
  };
}

/** `main`'s arguments: the words after `--args`, or `--args-json`'s array — never both. */
function argsInput(
  args: ParsedArgs,
  io: CliIo,
  trailing: readonly string[] | undefined,
): { args?: ArgsInput } {
  const json = stringFlag(args, "args-json");
  if (json !== undefined && trailing !== undefined) {
    throw new UsageError("give --args or --args-json, not both");
  }
  if (trailing !== undefined) return { args: { from: "--args", values: trailing } };
  if (json === undefined) return {};
  // Inline when it reads as JSON (an array, or the object someone meant as one); a path otherwise.
  const text = /^\s*[[{]/.test(json) ? json : readInput(io, json);
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`--args-json: not JSON (${(error as Error).message})`);
  }
  if (!Array.isArray(values)) {
    throw new UsageError("--args-json: expected a JSON array of main's arguments, in order");
  }

  return { args: { from: "--args-json", values } };
}

/**
 * A Solana cook's accounts: `--accounts`' object (inline, or a file) and each `--account`, every name
 * once.
 */
function accountsOf(args: ParsedArgs, io: CliIo): Record<string, string> {
  const json = stringFlag(args, "accounts");
  const given = repeatedFlag(args, "account");
  if (json === undefined) return parseAccounts(given);
  const text = /^\s*\{/.test(json) ? json : readInput(io, json);
  let object: unknown;
  try {
    object = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`--accounts: not JSON (${(error as Error).message})`);
  }
  if (typeof object !== "object" || object === null || Array.isArray(object)) {
    throw new UsageError("--accounts: expected a JSON object of each account's name to its value");
  }
  const entries = Object.entries(object as Record<string, unknown>).map(([name, value]) => {
    if (typeof value !== "string") throw new UsageError(`--accounts: ${name} is not a string`);
    return `${name}=${value}`;
  });

  return parseAccounts([...entries, ...given]);
}

/** The salt `--salt`/`--salt-hex` choose (zero when neither). */
const saltOf = (args: ParsedArgs) =>
  parseSalt(stringFlag(args, "salt"), stringFlag(args, "salt-hex"));

/**
 * The Pot a cook runs on: `--pot`, or derived from `--owner` — or, when `signer` is given (a run),
 * from the signer, whose Pot it must be anyway (`inputs.ts#potTarget`).
 */
function potInput(args: ParsedArgs, signer?: `0x${string}`): PotInput {
  return potTarget(
    {
      pot: stringFlag(args, "pot"),
      owner: stringFlag(args, "owner"),
      salt: stringFlag(args, "salt"),
      saltHex: stringFlag(args, "salt-hex"),
    },
    signer,
  );
}

/** Everything an EVM cook command takes from its flags. */
function cookInput(
  args: ParsedArgs,
  io: CliIo,
  trailing: readonly string[] | undefined,
  signer: `0x${string}` | undefined,
  program: ProgramInput,
): CookInput {
  const value = stringFlag(args, "value");
  if (repeatedFlag(args, "account").length > 0 || stringFlag(args, "accounts") !== undefined) {
    throw new UsageError(
      `--account names a Solana program's accounts; a program on ${program.chain.slug} takes none`,
    );
  }
  if (repeatedFlag(args, "lookup-table").length > 0) {
    throw new UsageError(
      `--lookup-table takes a Solana cook's accounts through a lookup table; a cook on ` +
        `${program.chain.slug} has none`,
    );
  }
  for (const flag of ["via", "max-execution-fee"]) {
    if (stringFlag(args, flag) !== undefined) {
      throw new UsageError(
        `--${flag} is for a Solana cook, which can reach the engine through the Kitchen or ` +
          `directly; on ${program.chain.slug} a cook is the Pot's, and --value carries the fee`,
      );
    }
  }

  return {
    ...program,
    target: potInput(args, signer),
    ...(value === undefined ? {} : { value: parseWei("value", value) }),
    ...argsInput(args, io, trailing),
  };
}

/** The chains each command run has said it reads through a public endpoint. */
const notedPublic = new WeakMap<CliIo, Set<number>>();

/**
 * `chain`'s built-in public endpoint, if the process has one for it — said on stderr the first
 * time a command reads the chain through it, with how to give one's own instead.
 */
function publicEndpoint(io: CliIo, chain: CanonicalChain): string | undefined {
  const url = io.publicRpcs?.url(chain);
  if (url === undefined) return undefined;
  const noted = notedPublic.get(io) ?? new Set<number>();
  notedPublic.set(io, noted);
  if (!noted.has(chain.id)) {
    noted.add(chain.id);
    io.stderr(
      `${chain.slug}: read through a built-in public endpoint, which can be slow or ` +
        "rate-limited; give your own with --rpc-url <url> or --config <file>\n",
    );
  }

  return url;
}

/**
 * `chain`'s endpoint, where `--rpc-url` does not name it: the `--config` file's entry for the
 * chain, else a built-in public endpoint; `undefined` with `--offline`, or when neither has one.
 */
function sharedEndpoint(args: ParsedArgs, io: CliIo, chain: CanonicalChain): string | undefined {
  if (args.values.offline === true) return undefined;
  const config = stringFlag(args, "config");
  const url =
    config === undefined
      ? undefined
      : endpointFor(chain, undefined, { path: config, text: readInput(io, config) });
  // A provider URL often carries a key: whatever reports it — this CLI, viem, the Solana client —
  // it is scrubbed from everything printed.
  if (url !== undefined) secret(url);

  return url ?? publicEndpoint(io, chain);
}

/**
 * The RPC endpoint for `chain`: `--rpc-url`, else {@link sharedEndpoint} — the `--config` file's
 * entry for it, else a built-in public endpoint. `undefined` when none reaches it.
 */
function endpoint(args: ParsedArgs, io: CliIo, chain: CanonicalChain): string | undefined {
  const rpcUrl = stringFlag(args, "rpc-url");
  if (rpcUrl !== undefined && stringFlag(args, "config") !== undefined) {
    throw new UsageError("give --rpc-url or --config, not both");
  }
  if (rpcUrl === undefined) return sharedEndpoint(args, io, chain);
  secret(rpcUrl);

  return rpcUrl;
}

function requiredEndpoint(args: ParsedArgs, io: CliIo, chain: CanonicalChain): string {
  const url = endpoint(args, io, chain);
  if (url === undefined) {
    throw new UsageError(
      args.values.offline === true
        ? `--offline reads no chain, and this reads ${chain.slug}`
        : `missing --rpc-url <url> (or --config <file>): the ${chain.slug} endpoint` +
            (io.publicRpcs === undefined ? "" : ", which has no built-in public one"),
    );
  }

  return url;
}

/** The password source the flags name: `--password-env`, `--password-file`, `--password-command`,
 *  or else the prompt. */
const passwordOf = (args: ParsedArgs): PasswordSource =>
  passwordSource({
    env: stringFlag(args, "password-env"),
    file: stringFlag(args, "password-file"),
    command: stringFlag(args, "password-command"),
  });

/** The wallet directory: `--wallets` (bare, the default), else the one `io` names, else
 *  `~/.sauce/wallets`. */
const walletsOf = (args: ParsedArgs, io: CliIo): WalletStore =>
  new WalletStore(stringFlag(args, "wallets") || io.walletsDir || defaultWalletsDir());

/** `--wallet`'s wallet as its file names it, read with no password: its kind and address. */
const walletGiven = (args: ParsedArgs, io: CliIo): WalletInfo | undefined => {
  const name = stringFlag(args, "wallet");

  return name === undefined ? undefined : walletsOf(args, io).info(name);
};

/** `--wallet`, unlocked with the password source given. */
const unlockGiven = (args: ParsedArgs, io: CliIo, info: WalletInfo): Promise<Unlocked> =>
  unlockWallet(walletsOf(args, io), info.name, passwordOf(args), io);

/** Refuses two signers for one kind of chain. */
function oneSigner(args: ParsedArgs, flags: readonly string[]): void {
  const given = flags.filter((flag) => stringFlag(args, flag) !== undefined);
  if (given.length > 1) {
    throw new UsageError(`give one signer, not ${given.map((flag) => `--${flag}`).join(" and ")}`);
  }
}

/** The EVM signer the flags give — an EVM `--wallet`, `--keystore` or `--private-key` — if any. */
async function evmSigner(args: ParsedArgs, io: CliIo): Promise<PrivateKeyAccount | undefined> {
  const wallet = walletGiven(args, io);
  if (wallet?.kind === "evm") {
    oneSigner(args, ["wallet", "keystore", "private-key"]);
    const unlocked = await unlockGiven(args, io, wallet);

    return unlocked.kind === "evm" ? unlocked.account : undefined;
  }
  if (stringFlag(args, "keystore") === undefined && stringFlag(args, "private-key") === undefined) {
    return undefined;
  }
  const keystore = stringFlag(args, "keystore");
  const privateKey = stringFlag(args, "private-key");

  return loadSigner(
    {
      ...(keystore === undefined ? {} : { keystore }),
      ...(privateKey === undefined ? {} : { privateKey }),
      password: passwordOf(args),
    },
    io,
  );
}

/** The Solana signer the flags give — a Solana `--wallet`, or `--keypair` — if any. */
async function svmSigner(args: ParsedArgs, io: CliIo): Promise<KeyPairSigner | undefined> {
  const wallet = walletGiven(args, io);
  if (wallet?.kind === "solana") {
    oneSigner(args, ["wallet", "keypair"]);
    const unlocked = await unlockGiven(args, io, wallet);

    return unlocked.kind === "solana" ? unlocked.signer : undefined;
  }
  const keypair = stringFlag(args, "keypair");

  return keypair === undefined ? undefined : loadKeypair(keypair, io);
}

/** An EVM command's signer, required: never a Solana key. */
const signerOf = async (args: ParsedArgs, io: CliIo): Promise<PrivateKeyAccount> => {
  if (stringFlag(args, "keypair") !== undefined) {
    throw new UsageError(
      "--keypair is a Solana keypair; an EVM transaction is signed with --wallet, --keystore or " +
        "--private-key",
    );
  }
  const wallet = walletGiven(args, io);
  if (wallet !== undefined) evmAddressOf(wallet);
  const account = await evmSigner(args, io);
  if (account !== undefined) return account;

  return loadSigner({ password: passwordOf(args) }, io);
};

/**
 * The EVM signer's address, read with no more than it needs: a wallet's or a keystore's `address`
 * field (no password), a raw key's own, and only for a keystore without one, the keystore unlocked.
 */
async function signerAddress(args: ParsedArgs, io: CliIo): Promise<`0x${string}`> {
  const wallet = walletGiven(args, io);
  if (wallet !== undefined) {
    oneSigner(args, ["wallet", "keystore", "private-key"]);

    return evmAddressOf(wallet);
  }
  const keystore = stringFlag(args, "keystore");
  if (keystore !== undefined && stringFlag(args, "private-key") === undefined) {
    const named = keystoreAddress(readInput(io, keystore));
    if (named !== undefined) return named;
  }

  return (await signerOf(args, io)).address;
}

/**
 * Who approves what a run sends before its cook: `--auto-approve`, which says so for each action it
 * approves, or the person at the terminal (`io.confirm`).
 */
function approverOf(args: ParsedArgs, io: CliIo): Approver {
  const auto = args.values["auto-approve"] === true;

  return {
    auto,
    canAsk: auto || io.canAsk(),
    approve: async (action, question) => {
      if (!auto) return io.confirm(question);
      io.stderr(`auto-approved: ${action}\n`);

      return true;
    },
  };
}

/** Whether the flags give an EVM signer: an EVM `--wallet`, `--keystore` or `--private-key`. */
const hasSigner = (args: ParsedArgs, io: CliIo): boolean =>
  walletGiven(args, io)?.kind === "evm" ||
  stringFlag(args, "keystore") !== undefined ||
  stringFlag(args, "private-key") !== undefined;

/** Whether the flags give a Solana signer: a Solana `--wallet`, or `--keypair`. */
const hasSvmSigner = (args: ParsedArgs, io: CliIo): boolean =>
  walletGiven(args, io)?.kind === "solana" || stringFlag(args, "keypair") !== undefined;

// --- The intent lifecycle -------------------------------------------------------------------

/** The intent store: `--store`, else the one `io` names, else `~/.sauce/intents`. */
const storeOf = (args: ParsedArgs, io: CliIo): IntentStore =>
  new IntentStore(stringFlag(args, "store") ?? io.storeDir ?? defaultStoreDir());

/**
 * The endpoint of each chain a lifecycle command reads, when it has one: `--rpc-url` for the one
 * chain that URL serves (asked once), and every chain as {@link sharedEndpoint} finds it. Unlike
 * `endpoint`, a chain with none is `undefined`, not an error: a command reads what it can, and
 * says what it could not.
 */
async function endpointLookup(
  args: ParsedArgs,
  io: CliIo,
): Promise<(chain: CanonicalChain) => string | undefined> {
  const rpcUrl = stringFlag(args, "rpc-url");
  if (rpcUrl !== undefined && stringFlag(args, "config") !== undefined) {
    throw new UsageError("give --rpc-url or --config, not both");
  }
  if (rpcUrl === undefined) return (chain) => sharedEndpoint(args, io, chain);
  secret(rpcUrl);
  const served = await chainServedBy(rpcUrl);

  return (chain) => (chain.id === served.id ? rpcUrl : sharedEndpoint(args, io, chain));
}

/** Records what a sent transaction published in the store, with a note per intent stored. */
const storing =
  (args: ParsedArgs, io: CliIo, chain: CanonicalChain, rpcUrl: string) =>
  async (sent: Sent): Promise<readonly string[]> => {
    const store = storeOf(args, io);
    try {
      const records = await rememberPublished(store, chain, rpcUrl, sent);

      return records.map((record) => `stored intent ${record.intentHash} in ${store.dir}`);
    } catch (error) {
      return [
        `warning: ${sent.hash} was sent, but what it published was not stored in ${store.dir}: ` +
          (error instanceof Error ? error.message : String(error)),
      ];
    }
  };

/** What every lifecycle command shares: the store, the endpoints, the signer and the approvals. */
async function lifecycleContext(args: ParsedArgs, io: CliIo): Promise<LifecycleContext> {
  const endpoint = await endpointLookup(args, io);
  const account = await evmSigner(args, io);
  const solanaSigner = await svmSigner(args, io);
  const api = stringFlag(args, "api");
  const keyFile = stringFlag(args, "api-key-file");
  if (keyFile !== undefined && api === undefined) {
    throw new UsageError("--api-key-file goes with --api");
  }
  const key = keyFile === undefined ? undefined : readInput(io, keyFile).trim();
  if (key !== undefined) secret(key);
  if (api !== undefined) secret(api);

  return {
    store: storeOf(args, io),
    endpoint,
    ...(account === undefined ? {} : { account }),
    ...(solanaSigner === undefined ? {} : { svmSigner: solanaSigner }),
    approver: approverOf(args, io),
    ...(api === undefined ? {} : { api: { url: api, ...(key === undefined ? {} : { key }) } }),
  };
}

/**
 * The intents a lifecycle command acts on: the store's, named by hash (one or several), or the
 * file's, built as `publish` builds them (`--chain` its source). `--chain` with hashes must be
 * their source.
 */
async function lifecycleTargets(
  args: ParsedArgs,
  io: CliIo,
  store: IntentStore,
  gate?: Gate,
): Promise<Target[]> {
  const operands = args.positionals;
  if (operands.length === 0) {
    throw new UsageError("missing <file | intent-hash>: the intent, by its file or its hash");
  }
  if (operands.every(isIntentHash)) {
    const targets = operands.flatMap((hash) => storedTargets(store, hash as `0x${string}`));
    const chainFlag = stringFlag(args, "chain");
    if (chainFlag !== undefined) {
      const chain = parseChain(chainFlag);
      const other = targets.find((target) => target.record.source.chainId !== chain.id);
      if (other !== undefined) {
        throw new UsageError(
          `--chain ${chain.slug} is not the source of ${other.record.intentHash}, which ` +
            `${other.record.source.chain} published`,
        );
      }
    }

    return targets;
  }
  if (operands.length > 1) {
    throw new UsageError("give one <file>, or one or more intent hashes");
  }

  return fileTargets(await programInput(args, io, operands[0]!, undefined, gate), io, store);
}

/**
 * What a lifecycle command that sends (or prints) a transaction acts on: its intents, refused on a
 * preview chain by `gate` before the context reaches an endpoint or unlocks a key — then the
 * context.
 */
async function lifecycleOf(
  args: ParsedArgs,
  io: CliIo,
  gate: Gate,
): Promise<{ readonly targets: Target[]; readonly context: LifecycleContext }> {
  const targets = await lifecycleTargets(args, io, storeOf(args, io), gate);
  requireSupported(
    gate.action,
    targets.map(({ record }) =>
      requireChain(gate.by === "source" ? record.source.chainId : record.destination.chainId),
    ),
  );

  return { targets, context: await lifecycleContext(args, io) };
}

/** The questions `sauce intent publish` asks with no file, as flags. */
const CREATE: FlagSpecs = {
  source: { type: "string", value: "<chain>", help: "No file: the source chain (the reward's)" },
  destination: { type: "string", value: "<chain>", help: "…the destination chain" },
  token: { type: "string", value: "<symbol|address>", help: "…the token delivered there" },
  amount: { type: "string", value: "<n>", help: "…how much, in whole units" },
  recipient: { type: "string", value: "<address>", help: "…to whom (default: the signer)" },
  "reward-token": { type: "string", value: "<symbol|address>", help: "…the reward's token" },
  reward: { type: "string", value: "<n>", help: "…the reward, in whole units" },
  prover: { type: "string", value: "<role|address>", help: "…the prover (HyperProver)" },
  "fill-deadline": {
    type: "string",
    value: "<when>",
    help: "…the last second to fill: unix seconds, or +30m, +2h, +1d",
  },
  "reward-deadline": {
    type: "string",
    value: "<when>",
    help: "…from when it is refundable, if no fill is proven",
  },
  out: { type: "string", value: "<path>", help: "…the .sauce.ts file to write" },
};

/**
 * `sauce intent publish` with no file: the intent made step by step (`create.ts`), written as a
 * file, rehearsed on both chains, then — with a signer, once approved — published and stored, as
 * `sauce intent publish <file>` with the same flags would.
 */
async function createAndPublish(args: ParsedArgs, io: CliIo): Promise<CommandOutput> {
  // The chains the flags name are refused here, before an endpoint or a key; one asked for is
  // refused as soon as it is chosen (`create.ts`), and only supported ones are offered.
  const named = [
    stringFlag(args, "source") ?? stringFlag(args, "chain"),
    stringFlag(args, "destination"),
  ];
  requireSupported(
    "publishing intents",
    named.flatMap((chain) => (chain === undefined ? [] : [parseChain(chain)])),
  );
  const lookup = await endpointLookup(args, io);
  const account = hasSigner(args, io) ? await signerOf(args, io) : undefined;
  const flag = (name: string) => stringFlag(args, name);
  const given = {
    ...((flag("source") ?? flag("chain")) ? { source: (flag("source") ?? flag("chain"))! } : {}),
    ...(flag("destination") === undefined ? {} : { destination: flag("destination")! }),
    ...(flag("token") === undefined ? {} : { token: flag("token")! }),
    ...(flag("amount") === undefined ? {} : { amount: flag("amount")! }),
    ...(flag("recipient") === undefined ? {} : { recipient: flag("recipient")! }),
    ...(flag("reward-token") === undefined ? {} : { rewardToken: flag("reward-token")! }),
    ...(flag("reward") === undefined ? {} : { reward: flag("reward")! }),
    ...(flag("prover") === undefined ? {} : { prover: flag("prover")! }),
    ...(flag("fill-deadline") === undefined ? {} : { fillDeadline: flag("fill-deadline")! }),
    ...(flag("reward-deadline") === undefined ? {} : { rewardDeadline: flag("reward-deadline")! }),
    ...(flag("intent-fund-via") === undefined ? {} : { fundVia: flag("intent-fund-via")! }),
    ...(flag("out") === undefined ? {} : { out: flag("out")! }),
  };
  const created = await createIntent({
    given,
    ...(io.ask === undefined ? {} : { ask: io.ask }),
    endpoint: lookup,
    ...(account === undefined ? {} : { signer: account.address }),
    now: BigInt(Math.floor(Date.now() / 1000)),
    writeText: io.writeText,
    exists: (path) => io.readModule(path) !== undefined,
  });
  io.stderr(`${created.summary.join("\n")}\n\n`);
  const creator = account?.address ?? (flag("intent-creator") as `0x${string}` | undefined);
  if (creator === undefined) {
    throw new UsageError(
      `${created.file} is written; publishing it needs a signer (the creator), or ` +
        "--intent-creator with --format json to print the transactions unsigned",
    );
  }
  const program: ProgramInput = {
    file: created.file,
    text: created.text,
    chain: created.source,
    compactArgs: false,
    defines: {},
    intents: {
      deadline: created.deadline,
      rewardDeadline: created.rewardDeadline,
      creator,
      prover: created.prover,
      fundVia: created.fundVia,
    },
  };
  const rpcUrl = lookup(created.source);
  if (rpcUrl === undefined) {
    throw new UsageError(`publishing needs ${created.source.slug}'s endpoint: --config with it`);
  }
  // Rehearsed on the source, then on the destination, before anything is sent.
  const dry = await publishCommand({ ...program, dryRun: true, rpcUrl, from: creator }, io);
  io.stderr(`Publishing, rehearsed on ${created.source.slug}:\n${dry.text}\n\n`);
  if (dry.exitCode !== undefined && dry.exitCode !== 0) {
    return {
      ...dry,
      notes: [`${created.file} is written, and not published: the rehearsal reverts`],
    };
  }
  if (lookup(created.destination) !== undefined) {
    const fill = await fillCommand({
      intents: fillTargets(program, io),
      from: created.file,
      labels: [],
      endpointOf: (chain) => lookup(chain) ?? requiredEndpoint(args, io, chain),
      sourceEndpointOf: lookup,
      endpointFlag: "--config",
    });
    io.stderr(
      `Filling, rehearsed on ${created.destination.slug} (as a solver will):\n${fill.text}\n\n`,
    );
  }
  if (account === undefined) {
    return publishCommand({ ...program, dryRun: false, format: "json", rpcUrl, from: creator }, io);
  }
  const action = `publish ${created.file} from ${account.address}`;
  const answer = await approverOf(args, io).approve(
    action,
    `Publish ${created.file} from ${account.address}? [y/N] `,
  );
  if (answer === undefined) {
    throw new CliError(
      `${created.file} is written, and not published: ${unapproved([action]).message}`,
    );
  }
  if (!answer) throw new CliError(`${created.file} is written, and not published: you declined`);

  return publishCommand(
    {
      ...program,
      dryRun: false,
      rpcUrl,
      account,
      onSent: storing(args, io, created.source, rpcUrl),
    },
    io,
  );
}

/** The Eco API gateway, an optional second source of an intent's status. */
const API: FlagSpecs = {
  api: {
    type: "string",
    value: "<url>",
    help: "Also ask the Eco API gateway at this URL (none is built in)",
  },
  "api-key-file": { type: "string", value: "<path>", help: "…and send the key in this file" },
};

/** The flags every lifecycle command takes. */
/** An intent command's signer: an EVM one, since the Portal it drives is an EVM contract. */
const EVM_SIGNER: FlagSpecs = Object.fromEntries(
  Object.entries(SIGNER).filter(([name]) => name !== "keypair"),
);

const LIFECYCLE: FlagSpecs = {
  ...PROGRAM,
  ...ENDPOINT,
  ...EVM_SIGNER,
  keypair: {
    type: "string",
    value: "<path>",
    help: "Sign a step on Solana (an intent's fill, proof or cancellation there) with a keypair file",
    only: "svm",
  },
  "auto-approve": {
    type: "boolean",
    help: "Approve what it spends beyond gas (a fee, tokens) without asking",
  },
  store: {
    type: "string",
    value: "<dir>",
    help: "The intent store (default: ~/.sauce/intents)",
  },
};

/**
 * `--fund`, `--fund-mode` and `--sweep`, read into the callback `runCommand`/`simulateCommand` call
 * once the Pot is there; `undefined` with no `--fund`. `send` is whether the run may approve and
 * transfer first (`run`) or only say it would (`simulate`).
 */
function fundingOf(
  args: ParsedArgs,
  io: CliIo,
  chain: CanonicalChain,
  rpcUrl: string,
  send: boolean,
  account: PrivateKeyAccount | undefined,
): CookInput["fund"] {
  const mode = stringFlag(args, "fund-mode");

  return fundingFor({
    chain,
    rpcUrl,
    fund: repeatedFlag(args, "fund"),
    ...(mode === undefined ? {} : { mode }),
    sweep: args.values.sweep === true,
    send,
    ...(account === undefined ? {} : { account }),
    approver: approverOf(args, io),
  });
}

/** `--assume-balance`, each named once. */
function assumedBalancesOf(args: ParsedArgs, chain: CanonicalChain): FundRequest[] {
  return assumedBalances(repeatedFlag(args, "assume-balance"), chain);
}

// --- Solana ----------------------------------------------------------------------------------

/** A Solana command's signer, required: a Solana `--wallet` or `--keypair`, never an EVM key. */
async function keypairOf(args: ParsedArgs, io: CliIo): Promise<KeyPairSigner> {
  if (stringFlag(args, "keystore") !== undefined || stringFlag(args, "private-key") !== undefined) {
    throw new UsageError(
      "--keystore and --private-key are EVM keys: on Solana, sign with --wallet <name> (a " +
        "Solana wallet) or --keypair <path>",
    );
  }
  const wallet = walletGiven(args, io);
  if (wallet?.kind === "evm") {
    throw new UsageError(
      `wallet ${wallet.name} is an EVM wallet: on Solana, sign with a Solana wallet ` +
        "(sauce wallet new <name> --solana) or --keypair <path>",
    );
  }
  const signer = await svmSigner(args, io);
  if (signer !== undefined) return signer;
  throw new UsageError("missing a signer: --wallet <name> (a Solana wallet) or --keypair <path>");
}

/** The Solana signer's address, read with no password where a wallet names it. */
async function keypairAddress(args: ParsedArgs, io: CliIo): Promise<SvmAddress> {
  const wallet = walletGiven(args, io);
  if (wallet?.kind === "solana") {
    oneSigner(args, ["wallet", "keypair"]);

    return wallet.address as SvmAddress;
  }

  return (await keypairOf(args, io)).address;
}

/** The Pot's owner on Solana: the signer when there is one (and `--owner` must agree), else
 *  `--owner`. */
function svmOwner(
  args: ParsedArgs,
  signer?: SvmAddress,
  why = "with a signer, the owner is the signer",
): SvmAddress {
  const owner = stringFlag(args, "owner");
  if (signer !== undefined) {
    if (owner !== undefined && parsePubkey("owner", owner) !== signer) {
      throw new UsageError(
        `--owner ${owner} is not the signer, ${signer}: ${why}. Leave --owner out, or sign as ` +
          "its owner.",
      );
    }

    return signer;
  }
  if (owner === undefined) {
    throw new UsageError("missing --owner <address>: whose Pot (a base58 public key)");
  }

  return parsePubkey("owner", owner);
}

/** Everything a Solana cook command takes from its flags. */
function svmCookInput(
  args: ParsedArgs,
  io: CliIo,
  trailing: readonly string[] | undefined,
  program: ProgramInput,
  signer?: SvmAddress,
): SvmCookInput {
  if (stringFlag(args, "pot") !== undefined) {
    throw new UsageError(
      "on Solana a cook names its Pot by owner and salt, which the Kitchen derives it from: give " +
        "--owner (and --salt), not --pot",
    );
  }
  if (stringFlag(args, "value") !== undefined) {
    throw new UsageError(
      "--value is for EVM: on Solana the Kitchen's fee is read from the cluster, and lamports a " +
        "program spends come from its accounts",
    );
  }
  if (stringFlag(args, "format") === "cast") {
    throw new UsageError("--format cast prints an EVM transaction; a Solana one is base64 JSON");
  }

  const via = stringFlag(args, "via");
  const maxFee = stringFlag(args, "max-execution-fee");
  const lookupTables = repeatedFlag(args, "lookup-table").map((table) =>
    parsePubkey("lookup-table", table),
  );

  return {
    ...program,
    owner: svmOwner(args, signer),
    ...saltOf(args),
    accounts: accountsOf(args, io),
    ...argsInput(args, io, trailing),
    rpcUrl: requiredEndpoint(args, io, program.chain),
    ...(via === undefined ? {} : { via: parseVia(via) }),
    ...(maxFee === undefined
      ? {}
      : { maxExecutionFee: parseLamports("max-execution-fee", maxFee) }),
    ...(lookupTables.length === 0 ? {} : { lookupTables }),
  };
}

/**
 * The endpoint and chain to fetch a transaction from: `--rpc-url` (its chain from `--chain`, else
 * from the endpoint itself), or `--chain`'s endpoint from `--config` or the built-in ones;
 * `undefined` with neither `--rpc-url` nor `--chain`, or with `--offline`.
 */
async function transactionEndpoint(
  args: ParsedArgs,
  io: CliIo,
): Promise<{ readonly rpcUrl: string; readonly chain: CanonicalChain } | undefined> {
  const rpcUrl = stringFlag(args, "rpc-url");
  const chainFlag = stringFlag(args, "chain");
  if (args.values.offline === true) return undefined;
  if (rpcUrl === undefined) {
    if (chainFlag === undefined) return undefined;
    const chain = parseChain(chainFlag);

    return { rpcUrl: requiredEndpoint(args, io, chain), chain };
  }
  secret(rpcUrl);
  const chain = chainFlag === undefined ? await chainServedBy(rpcUrl) : parseChain(chainFlag);

  return { rpcUrl: requiredEndpoint(args, io, chain), chain };
}

/** A `0x…` operand: calldata, a payload, or (32 bytes, with an endpoint) a transaction hash. */
function hexOperand(args: ParsedArgs, what: string): `0x${string}` {
  const [operand, ...rest] = args.positionals;
  if (operand === undefined) throw new UsageError(`missing ${what}`);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(operand)) {
    throw new UsageError(`'${operand.slice(0, 20)}…' is not 0x-prefixed hex bytes`);
  }

  return operand as `0x${string}`;
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The chain `sauce pot` is for: `--chain`, required — it has no program to say. */
const potChain = (args: ParsedArgs): CanonicalChain =>
  parseChain(requiredFlag(args, "chain", "<slug|id>"));

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

interface Command {
  /** One line, or one per kind of chain where they take different flags. */
  readonly usage: string | readonly string[];
  readonly summary: string;
  readonly flags: FlagSpecs;
  readonly details: string;
  /** A flag that ends the options: every word after it is passed to `run` as `trailing`. */
  readonly trailing?: string;
  /** The output to print, or `undefined` when the command already wrote it (`--out`). */
  readonly run: (
    args: ParsedArgs,
    io: CliIo,
    trailing: readonly string[] | undefined,
  ) => Promise<CommandOutput | undefined> | CommandOutput | undefined;
}

const lines = (text: readonly string[]): CommandOutput => ({ text: text.join("\n"), json: {} });

/** The paragraph every command that builds or sends a transaction ends its details on. */
const SUPPORTED_ONLY = (what: string): string[] => [
  "",
  ...wrapped(
    `${what} only on a supported chain: ${supportedChainNames()}, for the initial release. On ` +
      "any other (a preview chain) it is refused before anything is read or signed, with the " +
      "supported chains and the GitHub issue to ask for that chain with; compile and simulate " +
      "work there.",
  ),
];

const INTENT_VERBS: Readonly<Record<string, Command>> = {
  publish: {
    usage: [
      "sauce intent publish <file | -> --chain <source> (--keystore <path> | --private-key <hex>) [options] [--args <value>…]",
      "sauce intent publish [--source <chain>] [--destination <chain>] [--token <token>] [--amount <n>] …",
    ],
    summary: "Publish a file's fixed intents from a wallet (or make one, step by step)",
    trailing: "args",
    flags: {
      ...PROGRAM,
      "args-json": COOK["args-json"]!,
      ...ENDPOINT,
      ...SIGNER,
      ...CREATE,
      "auto-approve": LIFECYCLE["auto-approve"]!,
      from: {
        type: "string",
        value: "<address>",
        help: "With --dry-run or --format and no signer: whose wallet",
      },
      "dry-run": {
        type: "boolean",
        help: "Rehearse the transactions together (eth_simulateV1); send nothing",
      },
      "assume-balance": {
        type: "string",
        multiple: true,
        value: "<TOKEN:amount>",
        help: "With --dry-run: give the wallet this balance, in whole tokens, for the rehearsal only",
      },
      format: {
        type: "string",
        value: "<json|cast>",
        help: "Print the unsigned transactions instead of sending them",
      },
      store: LIFECYCLE.store!,
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "For a file whose intents are fixed when it is built — every amount a literal, one of main's",
      "arguments or a top-level `const` of a literal — builds each intent off-chain (the SDK's own",
      "lowering) and sends the source chain's transactions from the signer's wallet: each reward token",
      "transferred to the intent's vault (and the native amount sent to it), then Portal.publish.",
      "No approval is asked for. The vault is the SDK's offline derivation, which the Portal's own",
      "intentVaultAddress must agree with or nothing is sent; only what the vault does not hold",
      "yet is transferred, and publish is sent only once the Portal counts the intent funded.",
      "Prints the intent hashes and the transactions. A file whose intent uses a value the program",
      "measures or computes while it runs, or that does anything besides open its intents, is",
      "refused: use `sauce run` on a Pot.",
      "",
      "main's arguments (--args, in order, or --args-json) are the values the intents are built",
      "with: a wallet publishes what it knows before anything runs, so each is bound into the",
      "intents as it is. Each is one word: an integer, an address or a bool.",
      "",
      "--intent-fund-via publishAndFund funds it through the Portal instead: each reward token",
      "approved to the Portal (reset to zero first when a smaller allowance stands, as SafeERC20",
      "does), then publishAndFund, which records the intent Funded and emits IntentFunded.",
      "",
      "--dry-run rehearses the transactions together through eth_simulateV1 from the signer's",
      "wallet, or --from's with no key, then asks the Portal whether each intent is funded, and",
      "sends nothing. --assume-balance TOKEN:amount gives that wallet a balance for the rehearsal",
      "only, by state override (repeatable; the amount as `sauce run --fund` takes it;",
      "ETH:<amount> for the native currency), so a wallet that does not hold the reward yet can",
      "rehearse publishing it.",
      "",
      "With no <file>, it makes one: which chains, what is delivered and to whom, the reward",
      "(suggested: what is delivered plus a margin over the solver's destination costs — gas, the",
      "proof's fee, a Kitchen fee where one runs — priced through a Uniswap V3 pool there, and",
      "doubled so a fill is worth a solver's while), the fill and reward deadlines, the prover",
      "and how the reward is funded (--intent-fund-via, a transfer to the vault by default), each",
      "asked at a terminal unless its flag gives it (with no terminal, every flag still needed is",
      "named). It writes the intent as a .sauce.ts file (--out, default",
      "intent-<source>-to-<destination>-<time>.sauce.ts) to keep and publish again, rehearses",
      "publishing it (--dry-run) and filling it on the destination (`sauce intent fill`), and",
      "with a signer publishes it once you approve (or with --auto-approve), storing it. It reads",
      "both chains.",
      ...SUPPORTED_ONLY("Publishes (or prints the transactions)"),
      "",
      "Examples:",
      "  sauce intent publish bridge.sauce.ts --chain ethereum --keystore ~/.keys/me.json \\",
      "    --intent-deadline 2000000000 --intent-creator 0x… --args 1000000 0x…",
      "  sauce intent publish --keystore ~/.keys/me.json",
      "  sauce intent publish --source ethereum --destination base --token USDC --amount 1 \\",
      "    --recipient 0x… --reward-token USDC --reward 1.01 --prover HyperProver \\",
      "    --fill-deadline +1h --reward-deadline +1d --keystore <path>",
    ].join("\n"),
    run: async (args, io, trailing) => {
      if (args.positionals.length === 0) return createAndPublish(args, io);
      const created = Object.keys(CREATE).find((flag) => args.values[flag] !== undefined);
      if (created !== undefined) {
        throw new UsageError(`--${created} makes a new intent: give it with no <file>`);
      }
      const format = stringFlag(args, "format");
      // A dry run rehearses on every chain; transactions, printed or sent, need supported ones.
      const gate: Gate | undefined =
        args.values["dry-run"] === true && format === undefined
          ? undefined
          : { action: "publishing intents", by: "all" };
      const program = await programInput(args, io, undefined, undefined, gate, {
        ...argsInput(args, io, trailing),
        // Before main's arguments: no argument makes a Solana file publishable.
        before: ({ chain }) => {
          if (chain.kind !== "svm") return;
          throw new UsageError(
            "sauce intent publish sends a source chain's Portal transactions from an EVM wallet. " +
              "Publishing from Solana is not supported: the SDK has no Kitchen-built path for an " +
              "intent that Solana's Portal runs (docs/guides/solana.md). Open the intent from an " +
              "EVM chain; its destination may be Solana.",
          );
        },
      });
      if (format !== undefined && format !== "json" && format !== "cast") {
        throw new UsageError(`--format: '${format}' is not json or cast`);
      }
      // Compiled once: refused before the signer or any endpoint, then the Pots checked.
      const compiled = compileProgram(program, io);
      if (gate !== undefined) gated(gate, program.chain, compiled.intents);
      const account = hasSigner(args, io) ? await signerOf(args, io) : undefined;
      const from = stringFlag(args, "from");
      if (from !== undefined && account !== undefined) {
        throw new UsageError(
          "--from is for when there is no signer: the signer's wallet publishes",
        );
      }
      const rpcUrl =
        format === undefined && args.values["dry-run"] !== true
          ? requiredEndpoint(args, io, program.chain)
          : endpoint(args, io, program.chain);

      const assume = assumedBalancesOf(args, program.chain);
      if (assume.length > 0 && args.values["dry-run"] !== true) {
        throw new UsageError(
          "--assume-balance goes with --dry-run: it gives the wallet a balance for a rehearsal, " +
            "and nothing to a transaction that is sent",
        );
      }

      // Before anything is sent: an intent whose Pot is not deployed is one no solver can fill.
      const pots = await checkIntentPots(
        intentCooks(compiled.intents),
        endpointsOf(args, io, program.chain),
      );
      for (const check of pots) {
        if (check.deployed !== true) {
          io.stderr(
            `${check.deployed === false ? missingPotNote(check) : uncheckedPotNote(check)}\n`,
          );
        }
      }

      return publishCommand(
        {
          ...program,
          ...(format === undefined ? {} : { format }),
          dryRun: args.values["dry-run"] === true,
          ...(assume.length === 0 ? {} : { assume }),
          ...(rpcUrl === undefined ? {} : { rpcUrl }),
          ...(account === undefined ? {} : { account }),
          ...(from === undefined ? {} : { from: parseAddress("from", from) }),
          ...(rpcUrl === undefined ? {} : { onSent: storing(args, io, program.chain, rpcUrl) }),
        },
        io,
      );
    },
  },
  fill: {
    usage: [
      "sauce intent fill <file | -> --chain <source> [options] [--args <value>…]",
      "sauce intent fill <intent-hash> [options]",
      "sauce intent fill <file | intent-hash> … --send (--keystore <path> | --private-key <hex>) [--auto-approve]",
      "sauce intent fill <intent-hash> --claimant <address> --send --keypair <path>   (to Solana)",
    ],
    summary: "Fill a file's (or a stored) intents on their destination: rehearsed, or --send",
    trailing: "args",
    flags: {
      ...PROGRAM,
      "args-json": COOK["args-json"]!,
      "rpc-url": {
        type: "string",
        value: "<url>",
        help: "Your own endpoint for the destination chain (one destination only)",
      },
      config: {
        type: "string",
        value: "<file>",
        help: 'Or a file of your own: { "rpcUrls": { "<chain id>": "<url>" } }',
      },
      offline: ENDPOINT.offline!,
      solver: {
        type: "string",
        value: "<address|key>",
        help: "Rehearse as this account (default: one nobody holds the key of; on Solana, required)",
      },
      claimant: {
        type: "string",
        value: "<address|bytes32>",
        help: "Who claims the reward, as fulfill records it (default: the solver; for Solana, required)",
      },
      "no-prove": {
        type: "boolean",
        help: "fulfill only: send no proof with the fill (prove later: sauce intent prove)",
      },
      send: {
        type: "boolean",
        help: "Send the fill, from the signer, after rehearsing it",
      },
      ...EVM_SIGNER,
      keypair: LIFECYCLE.keypair!,
      "auto-approve": LIFECYCLE["auto-approve"]!,
      store: LIFECYCLE.store!,
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Builds each intent the file opens, as `sauce intent publish` does (or takes the intent the store",
      "holds under that hash), and fills it on its destination chain as a solver does: one",
      "eth_simulateV1 block, every call from the solver — Kitchen.deployPot for the destination's",
      "shared intent Pot when the route cooks on it and it is not deployed yet (any account may",
      "send it), the solver's approval of the Portal for each token the route delivers (reset to",
      "zero first where a smaller allowance stands, as USDT requires), then the fill:",
      "  Portal.fulfillAndProve(intentHash, route, rewardHash, claimant, prover, domain, data)",
      "             when the reward's prover is a Hyperlane prover, with the route's native amount",
      "             (the Kitchen's fee for a cook) plus the Hyperlane fee, quoted from the prover's",
      "             fetchFee, as the value: the proof leaves with the fill;",
      "  Portal.fulfill(intentHash, route, rewardHash, claimant)",
      "             otherwise, or with --no-prove, with the route's native amount: prove it later.",
      "",
      "With no --send, nothing is signed or sent: the solver is given the route's tokens and the",
      "value by state override, where a token keeps the balance found as simulate's",
      "--assume-balance finds it. With --send the signer is the solver and nothing is assumed: the",
      "rehearsal runs on its real balances, a fill that would revert is not sent, and what it",
      "spends (each token, the value and what it is for) is shown for you to approve at the",
      "terminal, or with --auto-approve. Then the transactions are sent in order, and the intent and its",
      "fill go into the store (--store, default ~/.sauce/intents).",
      "",
      "Prints the gas and what the fill moved — the transfers, each address's net change, labelled",
      "with the defines that name it (RECIPIENT, REFUND_TO) — what it left in the shared Pot and the",
      "Portal's Executor, which every intent through that Portal shares, the Portal's",
      "IntentFulfilled record, and, sent, the Hyperlane message the proof travels as; or the",
      "decoded reason it reverts (exit 1), a failed route call unwrapped to the program's own",
      "message.",
      "",
      "It runs on the DESTINATION, and reads the source to check the source prover trusts the",
      "destination's; --rpc-url is the destination's endpoint, for intents that all go to one",
      "chain. The intent must be fixed when it is built, as for publish: one using a value the",
      "program measures on chain has no route until it runs (name it by the hash `sauce run`",
      "stored). Needs an endpoint that serves eth_simulateV1.",
      "",
      "An intent to Solana (one `sauce intent import` stored from its publishing transaction) is",
      "filled through Solana's Portal program: Portal.fulfill, the solver's token accounts paying",
      "the route's tokens, rehearsed by simulateTransaction on the accounts as they are (Solana's",
      "simulation takes no overrides: --solver names a Solana key, whose accounts pay). --claimant,",
      "an address on the source chain, is required: the reward pays it, and a Solana key is none.",
      "With --send and --keypair it is sent, then its proof through the HyperProver, the IGP's gas",
      "paid in the same transaction, each spend approved.",
      ...SUPPORTED_ONLY("--send sends a fill"),
      "",
      "Examples:",
      "  sauce intent fill swap-on-base.sauce.ts --chain ethereum \\",
      "    --intent-deadline 2000000000 --intent-creator 0x… --intent-execution-fee 1000000000000 \\",
      "    --args <amountIn> <reward> <sqrtPriceLimitX96> <minOut> <recipient> <refundTo>",
      "  sauce intent fill 0x<intent hash> --send --keystore ~/.keys/me.json",
    ].join("\n"),
    run: async (args, io, trailing) => {
      const store = storeOf(args, io);
      const rpcUrl = stringFlag(args, "rpc-url");
      const solver = stringFlag(args, "solver");
      const claimant = stringFlag(args, "claimant");
      if (claimant !== undefined && !/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(claimant)) {
        throw new UsageError(
          `--claimant: '${claimant}' is neither an address (20 bytes) nor 32 bytes of hex`,
        );
      }
      const sending = args.values.send === true;
      if (!sending && (hasSigner(args, io) || hasSvmSigner(args, io))) {
        throw new UsageError(
          "a signer goes with --send: without it, fill rehearses and signs nothing (--solver " +
            "names who it rehearses as)",
        );
      }
      if (sending && solver !== undefined) {
        throw new UsageError("--solver is for a rehearsal: with --send, the signer is the solver");
      }
      if (args.values["auto-approve"] === true && !sending) {
        throw new UsageError("--auto-approve approves what --send spends: give --send");
      }
      const operands = args.positionals;
      let targets: readonly FillTarget[];
      let labels: ReadonlyArray<readonly [`0x${string}`, string]> = [];
      let from: string;
      const gate: Gate | undefined = sending
        ? { action: "sending a fill", by: "destinations" }
        : undefined;
      if (operands.length > 0 && operands.every(isIntentHash)) {
        if (argsInput(args, io, trailing).args !== undefined) {
          throw new UsageError(
            "--args gives a file's main its arguments; a stored intent is built already",
          );
        }
        targets = operands.flatMap((hash) =>
          storedTargets(store, hash as `0x${string}`).map(({ record }) => ({
            intent: intentOf(record),
            source: parseChain(String(record.source.chainId)),
            destination: parseChain(String(record.destination.chainId)),
            sourcePortal: record.source.portal,
          })),
        );
        from = operands.length === 1 ? operands[0]! : "the intents named";
      } else {
        const program = await programInput(
          args,
          io,
          undefined,
          undefined,
          gate,
          argsInput(args, io, trailing),
        );
        // A deadline that has passed is rehearsed anyway, so the Portal's own refusal shows.
        const past = pastDeadline(program);
        if (past !== undefined) io.stderr(`${past}: the rehearsal shows the Portal refusing it\n`);
        targets = fillTargets(program, io);
        labels = defineLabels(program);
        from = program.file;
      }
      // A rehearsal runs on every chain; a fill is sent only to a supported destination.
      if (gate !== undefined) {
        requireSupported(
          gate.action,
          targets.map((target) => target.destination),
        );
      }
      const onSolana = targets.filter((target) => target.destination.kind === "svm");
      if (onSolana.length > 0) {
        if (onSolana.length !== targets.length) {
          throw new UsageError(
            "fill the intents to Solana apart from the others: they are filled through another " +
              "Portal, with another signer",
          );
        }
        const context = await lifecycleContext(args, io);
        if (sending && context.svmSigner === undefined) {
          throw new UsageError("sending a fill on Solana needs its signer: --keypair <path>");
        }

        return svmFillCommand(
          {
            targets: targets.map((target) => {
              const record = intentRecord(target.intent, { sourcePortal: target.sourcePortal });

              return store.has(record.intentHash)
                ? { record, stored: store.load(record.intentHash) }
                : { record };
            }),
            ...(solver === undefined ? {} : { solver: parsePubkey("solver", solver) }),
            ...(claimant === undefined ? {} : { claimant: claimant as `0x${string}` }),
            ...(args.values["no-prove"] === true ? { prove: false } : {}),
            send: sending,
          },
          context,
        );
      }
      const account = sending ? await signerOf(args, io) : undefined;
      // --rpc-url is the destination's alone: the source is read only through the others.
      const lookup = rpcUrl === undefined ? await endpointLookup(args, io) : undefined;

      return fillCommand({
        intents: targets,
        from,
        labels,
        endpointOf: (chain) => requiredEndpoint(args, io, chain),
        ...(lookup === undefined ? {} : { sourceEndpointOf: lookup }),
        endpointFlag: rpcUrl === undefined ? "--config" : "--rpc-url",
        ...(solver === undefined ? {} : { solver: parseAddress("solver", solver) }),
        ...(claimant === undefined ? {} : { claimant: claimant as `0x${string}` }),
        ...(args.values["no-prove"] === true ? { prove: false } : {}),
        ...(account === undefined
          ? {}
          : { send: { account, approver: approverOf(args, io), store } }),
      });
    },
  },
  prove: {
    usage: "sauce intent prove <file | intent-hash…> [--keystore <path> | --private-key <hex>]",
    summary: "Send the proof of filled (or cancelled) intents, paying the prover's fee",
    flags: { ...LIFECYCLE, ...JSON_FLAG, ...HELP },
    details: [
      "For intents fulfilled (or cancelled) on their destination whose proof has not reached the",
      "source: Portal.prove(prover, sourceDomain, intentHashes, data) on the destination, from",
      "the signer, with the prover's fee — quoted from its fetchFee — as the value, which you",
      "approve at the terminal or with --auto-approve. Several hashes share one proof when they have one",
      "destination, source and prover. An intent the source has proven already is left out.",
      "Prints the transaction and the Hyperlane message the proof travels as. With no signer,",
      "prints the unsigned transaction instead.",
      "",
      "The intent is a hash the store holds (`sauce intent publish`, `run`, `fill` and `intents import`",
      "store them), or the file that opens it (with --chain, its source, and the flags it was",
      "built with). It reads the destination, and the source to skip what is proven already.",
      ...SUPPORTED_ONLY("Proves (or prints the transaction)"),
      "",
      "Example:",
      "  sauce intent prove 0x<intent hash> --keystore ~/.keys/me.json",
    ].join("\n"),
    run: async (args, io) => {
      const { targets, context } = await lifecycleOf(args, io, {
        action: "proving",
        by: "destinations",
      });

      return proveCommand(targets, context);
    },
  },
  claim: {
    usage: "sauce intent claim <file | intent-hash…> --chain <source> [signer]",
    summary: "Withdraw proven intents' rewards to their claimants, on the source",
    flags: { ...LIFECYCLE, ...JSON_FLAG, ...HELP },
    details: [
      "Checks the reward's prover on the source chain has the intent proven, for this",
      "destination, and the reward is not withdrawn or refunded; then sends Portal.withdraw",
      "(Portal.batchWithdraw for several, one transaction) from the signer — anyone may — which",
      "pays each reward to the claimant its proof records. Prints what moved out of the vault,",
      "and stores the claim. With no signer, prints the unsigned transaction.",
      "",
      "While the proof has not arrived it says so (exit 1), with when the store saw the intent",
      "filled and the Hyperlane message its proof travels as, which the Hyperlane explorer shows by",
      "id. A proven CANCELLATION pays no claimant: refund it instead.",
      ...SUPPORTED_ONLY("Claims (or prints the transaction)"),
      "",
      "Example:",
      "  sauce intent claim 0x<intent hash> --chain ethereum --keystore ~/.keys/me.json",
    ].join("\n"),
    run: async (args, io) => {
      const { targets, context } = await lifecycleOf(args, io, {
        action: "claiming",
        by: "source",
      });

      return claimCommand(targets, context);
    },
  },
  refund: {
    usage: "sauce intent refund <file | intent-hash…> --chain <source> [signer]",
    summary: "Return unearned rewards from their vaults to their creators, on the source",
    flags: { ...LIFECYCLE, ...JSON_FLAG, ...HELP },
    details: [
      "Sends Portal.refund from the signer — anyone may — which returns everything the intent's",
      "vault holds to the reward's creator, once the Portal allows it:",
      "  a proven cancellation    at once (eco-routes 2.12: `sauce intent cancel`, then `sauce intent prove`);",
      "  no proof                 from the reward's deadline on;",
      "  a proof of a fill        only after the claimant has withdrawn: the leftovers.",
      "It reads the status first and says why not, with the time left (exit 1). There is no batch",
      "refund: several intents are refunded one transaction each. With no signer, prints the",
      "unsigned transactions.",
      ...SUPPORTED_ONLY("Refunds (or prints the transactions)"),
      "",
      "Example:",
      "  sauce intent refund 0x<intent hash> --chain ethereum --keystore ~/.keys/me.json",
    ].join("\n"),
    run: async (args, io) => {
      const { targets, context } = await lifecycleOf(args, io, {
        action: "refunding",
        by: "source",
      });

      return refundCommand(targets, context);
    },
  },
  cancel: {
    usage: "sauce intent cancel <file | intent-hash…> [--and-prove] [signer]",
    summary: "Cancel unfilled intents after their route's deadline, for an early refund",
    flags: {
      ...LIFECYCLE,
      "and-prove": {
        type: "boolean",
        help: "cancelAndProve: prove in the same transaction (before finality)",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "eco-routes 2.12 lets anyone cancel an intent on its DESTINATION once the route's deadline",
      "has passed and no solver filled it: Portal.cancel records it cancelled, so no fill can",
      "land after, and proving the cancellation (`sauce intent prove`) lets the creator refund at once,",
      "without waiting for the reward's deadline (`sauce intent refund`). It is refused, saying why:",
      "  where the destination Portal has no cancel (it predates 2.12): refund after the reward's",
      "  deadline instead;",
      "  where the SOURCE Portal predates 2.12, which would pay a proven cancellation to an",
      "  address nobody controls, burning the reward: it is checked for the CancelledIntent",
      "  refusal 2.12 added, so it reads both chains;",
      "  before the route's deadline, after a fill, and when cancelled already.",
      "",
      "eco-routes asks for the proof to wait until the cancel is final on the destination: a",
      "reorg past the deadline that re-includes a fill would leave that solver unpaid. So cancel",
      "sends only the cancel; --and-prove sends cancelAndProve, proving at once, with the fee",
      "approved as for prove. With no signer, prints the unsigned transaction.",
      ...SUPPORTED_ONLY("Cancels (or prints the transaction)"),
      "",
      "Example:",
      "  sauce intent cancel 0x<intent hash> --keystore ~/.keys/me.json",
    ].join("\n"),
    run: async (args, io) => {
      const { targets, context } = await lifecycleOf(args, io, {
        action: "cancelling",
        by: "destinations",
      });

      return cancelCommand(targets, context, { prove: args.values["and-prove"] === true });
    },
  },
  status: {
    usage: "sauce intent status <file | intent-hash…>",
    summary: "Where intents stand on both chains, and what can be done next",
    flags: { ...PROGRAM, ...ENDPOINT, ...API, store: LIFECYCLE.store!, ...JSON_FLAG, ...HELP },
    details: [
      "Reads each intent on its source chain (the reward's status, what its vault holds, the",
      "proof its prover records) and its destination (whether the Portal recorded a fill or a",
      "cancellation, and whether it can cancel), wherever an endpoint reaches, and prints",
      "its state — unfunded, funded, filled, cancelled, proven, cancelProven, claimed or refunded",
      "— its deadlines, and whether it can be filled, proven, claimed, refunded or cancelled now,",
      "with why not and from when. Nothing is sent. --api <url> also asks the Eco API gateway",
      "there (GET /v1/intents/status) and prints its word beside the chains' state, which stays",
      "the truth; --api-key-file sends a key with it. No URL is built in.",
      "",
      "Example:",
      "  sauce intent status 0x<intent hash>",
    ].join("\n"),
    run: async (args, io) => {
      const context = await lifecycleContext(args, io);
      const targets = await lifecycleTargets(args, io, context.store);
      const shown = await Promise.all(targets.map((target) => showCommand(target, context)));

      return {
        text: shown.map((output) => output.text).join("\n\n"),
        json: { intents: shown.map((output) => output.json) },
        notes: shown.flatMap((output) => output.notes ?? []),
      };
    },
  },
  list: {
    usage: "sauce intent list [--store <dir>]",
    summary: "Every intent the store keeps, and where each stands",
    flags: { ...ENDPOINT, store: LIFECYCLE.store!, ...JSON_FLAG, ...HELP },
    details: [
      "The store (--store, default ~/.sauce/intents) keeps every intent `sauce intent publish`,",
      "`sauce run`, and the intent commands touch, and those `sauce intent import` brings in:",
      "one directory per intent hash, its intent.json written once and never changed, and",
      "events.jsonl, one line appended per thing that happened (published, funded, filled,",
      "proving, claimed, refunded, cancelled) with its chain, transaction, block and time. Where",
      "an intent stands is never stored: it is read from the chains, each time (--offline: not).",
    ].join("\n"),
    run: async (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }

      return listCommand(await lifecycleContext(args, io));
    },
  },
  show: {
    usage: "sauce intent show <intent-hash> [--store <dir>]",
    summary: "One stored intent: its route, reward, deadlines and events, and where it stands",
    flags: { ...ENDPOINT, ...API, store: LIFECYCLE.store!, ...JSON_FLAG, ...HELP },
    details: [
      "Prints the intent the store keeps under that hash — its route and reward, its deadlines,",
      "its creator and prover, and every event recorded for it — and, read from the chains, its state on",
      "both chains and what can be done next, as `sauce intent status` reads it.",
    ].join("\n"),
    run: async (args, io) => {
      const [hash, ...more] = args.positionals;
      if (hash === undefined || !isIntentHash(hash) || more.length > 0) {
        throw new UsageError("show takes one <intent-hash>");
      }
      const context = await lifecycleContext(args, io);
      const [target] = storedTargets(context.store, hash as `0x${string}`);

      return showCommand(target!, context);
    },
  },
  import: {
    usage: "sauce intent import <tx-hash> --chain <source> [--index <n>]",
    summary: "Store the intents a transaction published, rebuilt from its logs",
    flags: {
      chain: PROGRAM.chain!,
      ...ENDPOINT,
      store: LIFECYCLE.store!,
      index: {
        type: "string",
        value: "<n>",
        help: "Only the n-th intent the transaction published (from 0)",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Reads the transaction's receipt on the source chain and rebuilds every intent its",
      "IntentPublished logs announce — the destination, the route (the bytes the Portal hashed)",
      "and the whole reward — checking each one hashes to the hash its log names, and stores it",
      "with the Portal that emitted it and the vault that Portal derives. Then every intent",
      "command takes it by hash. For an intent someone else published, or one published before",
      "the store kept it.",
      "",
      "Example:",
      "  sauce intent import 0x<tx hash> --chain ethereum",
    ].join("\n"),
    run: async (args, io) => {
      const [hash, ...more] = args.positionals;
      if (hash === undefined || !TX_HASH.test(hash) || more.length > 0) {
        throw new UsageError("import takes one <tx-hash>: the transaction that published");
      }
      const chain = parseChain(requiredFlag(args, "chain", "<source>"));
      const index = stringFlag(args, "index");
      if (index !== undefined && !/^\d+$/.test(index)) {
        throw new UsageError(`--index: '${index}' is not a whole number`);
      }

      return importCommand(
        {
          txHash: hash as `0x${string}`,
          chain,
          ...(index === undefined ? {} : { index: Number(index) }),
        },
        await lifecycleContext(args, io),
      );
    },
  },
};

/** The flags every wallet verb that reads or writes a key takes: the directory, and the password. */
const WALLET_KEY: FlagSpecs = { ...WALLETS, ...PASSWORD };

/** A wallet verb's one `<name>` operand, and any operand after it. */
function walletOperand(args: ParsedArgs, more = 0): readonly [string, ...string[]] {
  const [name, ...rest] = args.positionals;
  if (name === undefined) throw new UsageError("missing <name>: the wallet");
  if (rest.length > more) throw new UsageError(`unexpected argument ${rest[more]}`);

  return [walletName(name), ...rest];
}

const WALLET_VERBS: Readonly<Record<string, Command>> = {
  new: {
    usage:
      "sauce wallet new <name> [--solana] [--password-env <NAME> | --password-file <path> | --password-command <command>]",
    summary: "Create a wallet with a fresh key, encrypted under its password",
    flags: {
      solana: { type: "boolean", help: "A Solana keypair (default: an EVM key)" },
      ...WALLET_KEY,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Generates a key and keeps it in the wallet directory (--wallets, default ~/.sauce/wallets,",
      "created 0700) as <name>.json, written once, 0600, never overwritten. An EVM wallet is a",
      "Web3 Secret Storage keystore (scrypt, AES-128-CTR) that --keystore, cast wallet and geth",
      'read; a Solana one is the same envelope around its keypair, marked "kind": "solana". Its',
      "address is in the clear, so list and address need no password. Prints the name, kind,",
      "address and file.",
      "",
      "The password comes from one source: --password-env NAME (that variable, the one the",
      "command reads from the environment), --password-file (a file only you can read: one",
      "others can read is refused), --password-command (what the command prints, its output",
      "never shown), or else a prompt, asked twice. At least 8 characters. An agent keeps it in",
      "its .env or its secret store and names the source; the password itself is never an",
      "argument.",
      "",
      "Sign with it anywhere a key signs: --wallet <name> with the same password source. Beside",
      "it, <name>.policy.json limits what it sends (sauce wallet --help). It is a hot wallet:",
      "keep small balances in it.",
      "",
      "Examples:",
      "  sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD",
      "  sauce wallet new agent-sol --solana --password-file ~/.config/sauce/password",
    ].join("\n"),
    run: async (args, io) => {
      const [name] = walletOperand(args);

      return walletNewCommand(
        walletsOf(args, io),
        { name, kind: args.values.solana === true ? "solana" : "evm", password: passwordOf(args) },
        io,
      );
    },
  },
  list: {
    usage: "sauce wallet list [--wallets <dir>] [--json]",
    summary: "Every wallet: its name, kind and address",
    flags: { ...WALLETS, ...JSON_FLAG, ...HELP },
    details: [
      "Lists the wallet directory (--wallets, default ~/.sauce/wallets): each wallet's name, kind",
      "(evm or solana), address, and whether a policy limits it. No password is needed: each",
      "file names its address in the clear.",
    ].join("\n"),
    run: (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }

      return walletListCommand(walletsOf(args, io));
    },
  },
  address: {
    usage: "sauce wallet address <name> [--wallets <dir>] [--json]",
    summary: "A wallet's address, with no password",
    flags: { ...WALLETS, ...JSON_FLAG, ...HELP },
    details: "Prints the wallet's address: a 0x address, or for a Solana wallet a base58 key.",
    run: (args, io) => walletAddressCommand(walletsOf(args, io), walletOperand(args)[0]),
  },
  import: {
    usage: "sauce wallet import <name> <file | -> [--solana] [password source]",
    summary: "Keep a key you have as a wallet: a private key, keystore or Solana keypair",
    flags: {
      solana: { type: "boolean", help: "Refuse anything but a Solana keypair" },
      ...WALLET_KEY,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Reads the key from <file>, or from stdin with -, never from the command line: an EVM",
      "private key (32 bytes of hex), a Web3 Secret Storage keystore (opened with the password,",
      "which the wallet keeps), or a Solana keypair (a JSON array of 64 bytes, as solana-keygen",
      "writes, or its base58). It is stored as `sauce wallet new` stores a fresh one, encrypted",
      "under the password the source gives.",
      "",
      "Example:",
      "  sauce wallet import treasury key.txt --password-env SAUCE_WALLET_PASSWORD",
    ].join("\n"),
    run: (args, io) => {
      const [name, from] = walletOperand(args, 1);
      if (from === undefined) {
        throw new UsageError("missing <file | ->: where the key is (- reads it from stdin)");
      }

      return walletImportCommand(
        walletsOf(args, io),
        { name, from, solana: args.values.solana === true, password: passwordOf(args) },
        io,
      );
    },
  },
  export: {
    usage: "sauce wallet export <name> [password source]",
    summary: "Show a wallet's key at your terminal, once you confirm",
    flags: { ...WALLET_KEY, ...HELP },
    details: [
      "Shows the wallet's private key (a Solana wallet's keypair, as the JSON array a keypair",
      "file holds) on the terminal itself, never on stdout, after you type the wallet's name to",
      "confirm. With no terminal it refuses. It is for moving a key to another wallet: anyone",
      "who sees it controls the wallet. The MCP server has no tool for it.",
    ].join("\n"),
    run: (args, io) =>
      walletExportCommand(
        walletsOf(args, io),
        { name: walletOperand(args)[0], password: passwordOf(args) },
        io,
      ),
  },
};

/** `sauce simulate`'s rehearsal, on either kind of chain, before --expect-revert holds it. */
async function simulateOf(
  args: ParsedArgs,
  io: CliIo,
  trailing: readonly string[] | undefined,
): Promise<CommandOutput> {
  const program = await programOperand(args, io);
  const funds = repeatedFlag(args, "fund").length > 0;
  const assume = repeatedFlag(args, "assume-balance");
  if (program.chain.kind === "svm") {
    fundingOf(args, io, program.chain, "", false, undefined);
    if (stringFlag(args, "block") !== undefined) {
      throw new UsageError(
        "--block is for EVM chains: Solana's simulateTransaction runs on the cluster's " +
          "current state, at no slot it can be given",
      );
    }

    // A keypair or a wallet names the owner; the rehearsal signs nothing with it.
    const owner = hasSvmSigner(args, io) ? await keypairAddress(args, io) : undefined;

    const assumed = svmAssumedBalances(assume, program.chain);

    return svmSimulateCommand(
      {
        ...svmCookInput(args, io, trailing, program, owner),
        ...(assumed.length === 0 ? {} : { assume: assumed }),
      },
      io,
    );
  }
  if (hasSvmSigner(args, io)) {
    throw new UsageError(
      "a Solana keypair or wallet names no owner on an EVM chain: name the owner with an EVM " +
        "--wallet, --keystore or --private-key, or --owner",
    );
  }
  // A key names the owner, whose Pot the rehearsal runs on, and signs --fund's pulls if any.
  const account = funds && hasSigner(args, io) ? await signerOf(args, io) : undefined;
  const owner =
    account?.address ?? (hasSigner(args, io) ? await signerAddress(args, io) : undefined);
  if (owner !== undefined && stringFlag(args, "owner") !== undefined) {
    if (parseAddress("owner", stringFlag(args, "owner")!) !== owner) {
      throw new UsageError(
        `--owner ${stringFlag(args, "owner")} is not the signer, ${owner}: with a key, the ` +
          "owner is the key's. Leave --owner out, or give its key.",
      );
    }
  }
  const input = cookInput(args, io, trailing, owner, program);
  const assumed = assumedBalancesOf(args, input.chain);
  const rpcUrl = requiredEndpoint(args, io, input.chain);
  const fund = fundingOf(args, io, input.chain, rpcUrl, false, account);

  const block = stringFlag(args, "block");

  return simulateCommand(
    {
      ...input,
      rpcUrl,
      assume: assumed,
      ...(fund === undefined ? {} : { fund }),
      ...(block === undefined ? {} : { block }),
    },
    io,
  );
}

const COMMANDS: Readonly<Record<string, Command>> = {
  compile: {
    usage: "sauce compile <file | -> --chain <slug|id> [options]",
    summary: "Compile a SauceScript program; print its bytecode",
    flags: {
      ...PROGRAM,
      "args-json": COOK["args-json"]!,
      account: {
        type: "string",
        multiple: true,
        value: "NAME=<address>",
        help: "Solana: an account main takes (an address, pot, owner, pot:USDC, mint:USDC, program:USDC), to size the cook",
      },
      via: {
        type: "string",
        value: "<kitchen|engine>",
        help: "Solana: size the Kitchen's cook (default) or the engine's direct one",
      },
      ...ENDPOINT,
      out: { type: "string", value: "<path>", help: "Write the output to a file, not stdout" },
      json: {
        type: "boolean",
        help: "Print JSON: sizes, defines and contracts applied, main's parameters, engine",
      },
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file as a standalone program for the chain (routes.compileSauceProgram):",
      "its token symbols (USDC), protocol namespaces (Uniswap.UniversalRouter), chainId, the",
      "zero-import @sauce/token functions, SafeERC20 token writes (USDC.transfer,",
      "Token(addr).approve) and intents opened inside the program all resolve against it, so",
      "one file compiles for any chain whose names it uses. Relative imports are read from beside",
      "the file. A file may name its chain in a leading `// @chain base` line. An actions",
      "document compiles too (`sauce actions`).",
      "",
      "--json also says what the compile applied and how large the result is:",
      "  defines    each name the chain gave the file (a token symbol, a protocol contract, the",
      "             chain id) and each low-level --define it read, with its value and source",
      "  contracts  each protocol contract it calls or reads (UniswapV3.Factory), resolved on its",
      "             chain: an intent body's on the intent's own",
      "  size       the program's bytes; payload: the program with main's arguments (--args)",
      "  cook       on Solana, the cook's transaction against the 1232-byte limit, measured",
      "             with --account where given and a distinct account for each other slot, as",
      "             the Kitchen's cook or, --via engine, the engine's direct one",
      "  intentPots each intent that runs a program on its destination: the Pot it cooks on (the",
      "             one the destination Portal's Executor owns, salt 0) and, read from that",
      "             chain, whether it is deployed; a missing one is warned",
      "             about, since no solver can fill the intent until it is",
      "A --define the file never reads is named on stderr: it changes nothing.",
      "",
      "Examples:",
      "  sauce compile pay.sauce.ts --chain base",
      "  sauce compile split.sauce.ts --chain base --json --args 0x… 1000000",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = await programOperand(args, io);
      const accounts = repeatedFlag(args, "account");
      if (accounts.length > 0 && program.chain.kind !== "svm") {
        throw new UsageError(
          `--account names a Solana program's accounts; a program on ${program.chain.slug} takes none`,
        );
      }
      const via = stringFlag(args, "via");
      if (via !== undefined && program.chain.kind !== "svm") {
        throw new UsageError(
          `--via chooses how a Solana cook reaches the engine; a cook on ${program.chain.slug} is ` +
            "the Pot's",
        );
      }
      const output = await compileCommand(
        {
          ...program,
          ...argsInput(args, io, trailing),
          ...(accounts.length === 0 ? {} : { accounts: parseAccounts(accounts) }),
          ...(via === undefined ? {} : { via: parseVia(via) }),
          endpoints: endpointsOf(args, io, program.chain),
        },
        io,
      );
      const out = stringFlag(args, "out");
      if (out === undefined) return output;
      for (const note of output.notes ?? []) io.stderr(`${note}\n`);
      io.writeText(
        out,
        `${args.values.json === true ? JSON.stringify(output.json, null, 2) : output.text}\n`,
      );

      return undefined;
    },
  },
  actions: {
    usage: "sauce actions <file | -> [--chain <slug|id>] [--compact-args] [--json]",
    summary: "Lower an actions document to SauceScript for a chain; print the source and bytecode",
    flags: {
      chain: {
        type: "string",
        value: "<slug|id>",
        help: "The chain to compile for (default: the document's chainId)",
      },
      "compact-args": PROGRAM["compact-args"]!,
      json: {
        type: "boolean",
        help: "Print JSON: the document, source, bytecode and main's parameters",
      },
      ...HELP,
    },
    details: [
      'An actions document is JSON: { "version": 1, "actions": [ … ] }, each action one',
      "protocol operation (actions/action-program.schema.json lists them). Tokens are registry",
      "symbols (USDC) and contracts namespace references (UniswapV3.Factory), or addresses; a pool",
      "may be given by its factory's key (factory and fee). Lowered for the chain, every name is",
      "the program's global of that name, so a document with no chainId compiles for any chain",
      "where its names exist, and a name the chain lacks is refused with its path.",
      "",
      "Prints the SauceScript the document lowers to, then main's parameters and the bytecode.",
      "compile, tx, simulate and run take an actions document wherever they take a .sauce.ts",
      "file, with the same flags: its argument actions are main's parameters (--args), and its",
      "cook runs on the Pot --owner or --pot names.",
      "",
      "Examples:",
      "  sauce actions swap.json --chain base",
      "  sauce simulate swap.json --chain base --owner 0x… --args 1000000",
    ].join("\n"),
    run: (args, io) => {
      const { file, text } = programText(io, fileOperand(args));
      if (!isActionsDocument(text)) {
        throw new UsageError(
          `${file} is not an actions document (a JSON object with "actions"); compile a ` +
            "SauceScript file with `sauce compile`",
        );
      }

      return actionsCommand(actionsOperand(args, file, text), io);
    },
  },
  simulate: {
    usage: [
      "sauce simulate <file | -> --chain <slug|id> (--owner <address> | --pot <address>) [options]",
      "sauce simulate <file | -> --chain solana --owner <pubkey> [--account NAME=<value>]… [options]",
    ],
    summary: "Rehearse the cook from the Pot's owner, with no key: what it did, or why it reverts",
    flags: {
      ...PROGRAM,
      ...COOK,
      ...ENDPOINT,
      "assume-balance": {
        type: "string",
        multiple: true,
        value: "<TOKEN:amount>",
        help: "Give the Pot this balance, in whole tokens, for the rehearsal only: USDC:2, ETH:0.1",
      },
      block: {
        type: "string",
        value: "<number|tag>",
        help: "Rehearse on this block: a number, or latest, safe, finalized (default: latest)",
        only: "evm",
      },
      "expect-revert": {
        type: "string",
        value: "<text>",
        help: "Expect the cook to revert with a reason containing this text: exit 0 only if it does",
      },
      ...FUND,
      wallet: {
        type: "string",
        value: "<name>",
        help: "The owner's wallet: names the owner (and on EVM signs --fund's pulls)",
      },
      ...WALLETS,
      ...PASSWORD,
      keystore: {
        type: "string",
        value: "<path>",
        help: "The owner's keystore: names the owner (and signs --fund's pulls)",
        only: "evm",
      },
      "private-key": { ...SIGNER["private-key"]!, only: "evm" },
      keypair: {
        type: "string",
        value: "<path>",
        help: "The owner's keypair, naming the owner; nothing is signed",
        only: "svm",
      },
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file, builds the cook and rehearses it from the Pot's owner: no key, no",
      "transaction, no local node. Prints the gas, what the program returns and what the cook",
      "did, or the decoded reason it reverts (exit 1).",
      "",
      "It rehearses through eth_simulateV1, which returns the cook's logs: the output lists the",
      "ERC-20 transfers and approvals (registry symbols, whole units), the native transfers the",
      "node traces, and each address's net change. An endpoint without eth_simulateV1 falls back",
      "to eth_call with state overrides, which gives the result and the gas but no logs. The",
      "output names the route it took.",
      "",
      "A Pot that is not deployed yet is deployed in the rehearsal first, from --owner (and",
      "--salt): any account may send Kitchen.deployPot, and the Pot is the owner's either way.",
      "An owner holding less than the cook's value is given it for the rehearsal.",
      "",
      "--assume-balance TOKEN:amount gives the Pot that balance for this rehearsal only, by state",
      "override: repeatable, the amount as --fund takes it, ETH:<amount> for the native currency.",
      "Where a token keeps the balance is found by asking it, with eth_call; a token that stores",
      "no balance it reports (rebasing, shares) is refused.",
      "",
      "With --fund and the owner's key (--keystore or --private-key), the rehearsal includes the",
      "pulls `sauce run --fund` would make, signed and not sent; an approval the run would ask for",
      "is reported, not made. With no key the pulls cannot be signed, so the Pot is credited what",
      "they would bring, by state override, and --sweep still runs.",
      "",
      "On Solana: the Kitchen cook, simulated from --owner with signatures unchecked, with each",
      "account main takes given as --account NAME=<address | pot | owner> and an Address",
      "argument as a base58 public key. `pot:USDC` (or pot:<mint>) is the Pot's own token account",
      "for that mint, its associated token account under the mint's token program; owner:USDC the",
      "owner's; mint:USDC the mint and program:USDC its token program (SPL Token or Token-2022),",
      "the accounts a checked write takes. An account the cluster does not have is named in a",
      "note. Where main declares a return type, what it",
      "returned is read as that type. A Pot the Kitchen has not created is created first, in the",
      "same transaction. --via engine rehearses the engine's own paid cook instead: no Kitchen and",
      "no Pot (so no pot or pot:<token> account), --owner signing as the program's authority and",
      "paying the fee. Either way the cook pays the Kitchen's execution fee, read from the cluster",
      "and printed; --max-execution-fee refuses one above it. Prints the compute units and what the",
      "cook moved — each token account's balance change and each account's lamports, read from the",
      "accounts the transaction writes before it and as the simulation leaves them — or the reason",
      "(a program's revert message decoded) and the program logs. Solana's simulateTransaction",
      "takes no account overrides, so the owner must hold the Pot's rent and the fees there.",
      "A cook too large for one transaction, or one given --assume-balance, is rehearsed in a",
      "local copy instead (LiteSVM, which the package brings): every account it names read from",
      "the cluster with its rent, the released engine and Kitchen, the owner given the lamports",
      "the staging and the fees take (any address can rehearse), the Pot created",
      "if missing, the program staged into a code buffer as `sauce run` stages it, then the cook,",
      "its accounts through a lookup table. There --assume-balance TOKEN:amount gives the account",
      "the cook spends that token from (the Pot's, or the owner's with --via engine) that balance,",
      "and a pot:<token> or owner:<token> account the cluster does not have yet is made empty,",
      "which `sauce run` creates before the cook. An --owner that is not a wallet is refused.",
      "",
      "A cook that reverts exits 1, and the first line says so: The cook reverts: <reason>. In",
      "--json, reverted: true and error lead the JSON, and the same line leads stderr.",
      "--expect-revert <text> holds a rehearsal of a guard to its revert: it exits 0 only when the",
      "cook reverts with a reason containing the text, and 1 when it succeeds or reverts otherwise.",
      "",
      "Examples:",
      "  sauce simulate pay.sauce.ts --chain base --owner 0x… \\",
      "    --assume-balance USDC:2 --args 0x… 1000000",
      "  sauce simulate pay.sauce.ts --chain base --owner 0x… \\",
      '    --args 0x… 1000000 --expect-revert "too much"',
      "  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> \\",
      "    --account source=<token account> --account authority=pot",
      "  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> \\",
      "    --via engine --account source=<token account> --account authority=owner",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const output = await simulateOf(args, io, trailing);
      const expected = stringFlag(args, "expect-revert");
      const held = expected === undefined ? output : expectingRevert(output, expected);
      // In JSON, stdout is the JSON: a revert nobody expected leads stderr too.
      return args.values.json === true &&
        held.json.reverted === true &&
        held.json.asExpected !== true
        ? {
            ...held,
            notes: [`the cook reverts: ${String(held.json.error)}`, ...(held.notes ?? [])],
          }
        : held;
    },
  },
  run: {
    usage: [
      "sauce run <file | -> --chain <slug|id> (--keystore <path> | --private-key <hex>) [options]",
      "sauce run <file | -> --chain solana --keypair <path> [--account NAME=<value>]… [options]",
    ],
    summary: "Compile, sign, send and wait for the cook on your Pot",
    flags: {
      ...PROGRAM,
      ...COOK,
      ...ENDPOINT,
      ...SIGNER,
      ...FUND,
      "auto-approve": {
        type: "boolean",
        help: "Approve, without asking, what the run sends first: see below",
      },
      store: LIFECYCLE.store!,
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file, builds the cook on the signer's Pot (or --pot), rehearses it, signs it,",
      "sends it and waits for the receipt: prints the hash, status and gas used, and the decoded",
      "reason when it reverts (exit 1). The signer is the owner. The value defaults to the",
      "Kitchen's execution fee, read from the chain.",
      "",
      "What the run sends before its cook, each in a transaction of its own, it asks you to",
      "approve at the terminal first; --auto-approve approves every one without asking, and says",
      "`auto-approved: <action>` for each. They are:",
      "  deploying the Pot, when it is not deployed yet (on Solana, creating it)",
      "  approving Permit2 for a token --fund pulls, the first time (--fund-mode permit2)",
      "  approving the Pot for the amount --fund pulls (--fund-mode allowance)",
      "With no terminal to ask on (CI, a pipe, a program read from stdin with no terminal),",
      "nothing is sent until they are approved: the run names every one it needs and stops.",
      "",
      "--fund TOKEN:amount gets tokens into the Pot in the same cook: the program is wrapped so",
      "it first pulls each amount from you, then runs, then (--sweep) returns what is left. The",
      "amount is in whole tokens: USDC:1.5 is 1.5 USDC, and USDC:1500000 is 1.5 million (said",
      "on stderr); base units end in n, as a bigint is written (USDC:1500000n is 1.5 USDC).",
      "ETH:<amount> rides as the cook's value. Every pull is a safeTransferFrom: @sauce/token's",
      "SafeERC20 one, or Permit2's own (Solmate's SafeTransferLib). --fund-mode:",
      "  permit2    (default) you sign a Permit2 transfer of exactly this amount to this Pot, once;",
      "             works for every ERC-20, USDT included, and leaves the Pot no allowance. The",
      "             first time, Permit2 needs your approval for the token: asked for, like the Pot.",
      "  permit     the token's own EIP-2612 permit, signed for the Pot (tokens that have one)",
      "  allowance  an approval of the Pot for the amount (asked for), sent first: it stands",
      "             until a cook spends it",
      "  transfer   a plain transfer to the Pot first, in a transaction of its own",
      "--sweep sends the Pot's whole balance of each funded token back to you (and of the",
      "native currency, when ETH is funded), not only what this run brought.",
      "",
      "On Solana: sign with --keypair; the Kitchen's fee is read from the cluster, a missing Pot",
      "is created the same way, and so is a pot:<token> or owner:<token> account the cook names that",
      "the cluster does not have yet (the owner paying its rent); a program too large for one",
      "transaction is staged in a code buffer first (closed again after the cook). A failure prints",
      "the program logs.",
      "",
      "--via kitchen|engine (Solana) is how the cook reaches the engine:",
      "  kitchen  (default) the Kitchen's cook, which signs the owner's Pot: the program can hold",
      "           and spend what the Pot owns, and write its storage",
      "  engine   the engine's own paid cook (cookAndPay), with no Kitchen and no Pot: the program",
      "           acts with the signer's authority (--account NAME=owner), and its own calls get",
      "           one more level of CPI depth. A staged program is pinned to the staged bytes",
      "Both pay the same execution fee into the Kitchen's treasury. The cook signs the fee it read",
      "as its max_execution_fee, so it pays that or fails; --max-execution-fee <lamports> refuses",
      "a fee above it before anything is sent.",
      ...SUPPORTED_ONLY("Runs"),
      "",
      "Examples:",
      "  sauce run pay.sauce.ts --chain base --keystore ~/.keys/me.json",
      "  sauce run sweep.sauce.ts --chain solana --keypair ~/.config/solana/id.json \\",
      "    --account source=<token account> --account authority=pot",
      "  sauce run sweep.sauce.ts --chain solana --keypair ~/.config/solana/id.json \\",
      "    --via engine --max-execution-fee 10000 --account authority=owner …",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = await programOperand(args, io, { action: "sending the cook", by: "all" });
      if (program.chain.kind === "svm") {
        fundingOf(args, io, program.chain, "", true, undefined);
        const signer = await keypairOf(args, io);

        return svmRunCommand(
          {
            ...svmCookInput(args, io, trailing, program, signer.address),
            signer,
            approver: approverOf(args, io),
          },
          io,
        );
      }
      // Every chain the cook involves, its intents' too, before the key is unlocked.
      requireSupported("sending the cook", programChains(program, io));
      const account = await signerOf(args, io);
      const input = cookInput(args, io, trailing, account.address, program);
      const rpcUrl = requiredEndpoint(args, io, input.chain);
      const fund = fundingOf(args, io, input.chain, rpcUrl, true, account);

      return runCommand(
        {
          ...input,
          ...(fund === undefined ? {} : { fund }),
          rpcUrl,
          account,
          approver: approverOf(args, io),
          onSent: storing(args, io, input.chain, rpcUrl),
        },
        io,
      );
    },
  },
  intent: {
    usage: [
      "sauce intent <verb> [options]",
      "sauce intent [--keystore <path> | --private-key <hex>]",
    ],
    summary: "Publish, fill, prove, claim, refund and cancel cross-chain intents",
    flags: {
      ...ENDPOINT,
      ...EVM_SIGNER,
      "auto-approve": LIFECYCLE["auto-approve"]!,
      store: LIFECYCLE.store!,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Verbs (`sauce intent <verb> --help` for each):",
      ...Object.entries(INTENT_VERBS).map(
        ([verb, command]) => `  ${verb.padEnd(8)}  ${command.summary}`,
      ),
      "",
      "An intent is a file that opens one (`Base(() => { … }).reward({ … })`), named with the",
      "flags it is built with, or its hash once the store keeps it: `publish`, `fill` and",
      "`import` store every intent they touch (--store, default ~/.sauce/intents), and every verb",
      "takes the hash. With no verb, at a terminal: a list of the stored intents, read live from",
      "the chains, to pick one from, then a menu that runs these verbs on it, with the same",
      "approvals (with a signer, they send). With no terminal, the plain list.",
      "",
      "Examples:",
      "  sauce intent publish                          (guided, at a terminal)",
      "  sauce intent fill 0x<intent hash> --send --keystore <path>",
      "  sauce intent claim 0x<intent hash> --keystore <path>",
    ].join("\n"),
    run: async (args, io) => {
      const [verb] = args.positionals;
      if (verb !== undefined) {
        throw new UsageError(`unknown verb '${verb}': ${Object.keys(INTENT_VERBS).join(", ")}`);
      }
      const context = await lifecycleContext(args, io);
      if (io.ask !== undefined && process.stdin.isTTY && args.values.json !== true) {
        const code = await interactiveIntents(
          { ask: io.ask, stdout: io.stdout, stderr: io.stderr },
          context,
        );

        return code === 0 ? undefined : { text: "", json: {}, exitCode: code };
      }

      return listCommand(context);
    },
  },
  wallet: {
    usage: "sauce wallet <verb> [options]",
    summary: "Create, list and import the wallets --wallet signs with",
    flags: { ...WALLETS, ...JSON_FLAG, ...HELP },
    details: [
      "Verbs (`sauce wallet <verb> --help` for each):",
      ...Object.entries(WALLET_VERBS).map(
        ([verb, command]) => `  ${verb.padEnd(8)}  ${command.summary}`,
      ),
      "",
      "A wallet is a key the sauce command keeps in the wallet directory (--wallets, default",
      "~/.sauce/wallets), encrypted under a password from the source you name: --password-env",
      "NAME, --password-file <path>, --password-command <command>, or a prompt. Every command",
      "that signs takes --wallet <name> with that source, on EVM chains and Solana; so does the",
      "local MCP server (sauce mcp --wallets). It is a hot wallet: keep small balances in it.",
      "",
      "A policy limits what a wallet sends: <name>.policy.json beside it, every field optional and",
      'every amount a string in whole tokens ("100" is 100 USDC), or base units ending in n:',
      '  { "chains": ["base"], "to": ["0x…"],',
      '    "native": { "perTransaction": "0.01", "perDay": "0.05" },',
      '    "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } } }',
      "What a transaction moves out of the wallet (and the Pot it cooks on) is measured by",
      "rehearsing it, and a send that breaks a limit is refused, naming it; the last 24 hours are",
      "counted from <name>.ledger.jsonl. With no policy, sends work, and say no limits are set.",
      "",
      "Examples:",
      "  sauce wallet new agent --password-env SAUCE_WALLET_PASSWORD",
      "  sauce run pay.sauce.ts --chain base --wallet agent \\",
      "    --password-env SAUCE_WALLET_PASSWORD --args 0x… 1000000",
    ].join("\n"),
    run: (args, io) => {
      const [verb] = args.positionals;
      if (verb !== undefined) {
        throw new UsageError(`unknown verb '${verb}': ${Object.keys(WALLET_VERBS).join(", ")}`);
      }

      return walletListCommand(walletsOf(args, io));
    },
  },
  tx: {
    usage: [
      "sauce tx <file | -> --chain <slug|id> (--owner <address> | --pot <address>) [options]",
      "sauce tx <file | -> --chain solana --owner <pubkey> [--account NAME=<value>]… [options]",
    ],
    summary: "Print the unsigned cook transaction, for a wallet to sign",
    flags: { ...PROGRAM, ...COOK, ...ENDPOINT, ...FORMAT, ...HELP, ...ARGS },
    details: [
      "Compiles the file and prints the transaction that runs it, unsigned, as JSON:",
      "{ chainId, to: the Pot, data: Pot.cook(engine, program ++ arguments), value }. The value",
      "is --value, or else the Kitchen's fee, read from the chain, which also checks the Pot.",
      "`--format cast` prints the same transaction as a `cast send` line instead. What must be",
      "true for it to land goes to stderr: the Pot deployed and funded, and sent from its owner.",
      "",
      "On Solana: { chain, via, feePayer, pot, fee, maxExecutionFee, transaction }, the Kitchen",
      "cook as a base64 transaction signed by no one, for --owner to sign — or, --via engine, the",
      "engine's own paid cook, with no Pot. It reads the cluster (for the blockhash and the fee),",
      "and the --account flags simulate takes; --max-execution-fee refuses a fee above it.",
      ...SUPPORTED_ONLY("Prints the transaction"),
      "",
      "Example:",
      "  sauce tx pay.sauce.ts --chain base --owner 0x…",
      "  sauce tx pay.sauce.ts --chain base --owner 0x… --value 0 --offline",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = await programOperand(args, io, {
        action: "building the cook transaction",
        by: "all",
      });
      if (program.chain.kind === "svm") {
        return svmTxCommand(svmCookInput(args, io, trailing, program), io);
      }
      const input = cookInput(args, io, trailing, undefined, program);
      const rpcUrl = endpoint(args, io, input.chain);

      return txCommand({ ...input, ...(rpcUrl === undefined ? {} : { rpcUrl }) }, io);
    },
  },
  pot: {
    usage:
      "sauce pot --chain <slug|id> --owner <address> [--salt <label> | --salt-hex <bytes32>] [--deploy …]",
    summary: "Predict a Pot's address, and deploy it or print the transaction that does",
    flags: {
      owner: { type: "string", value: "<address>", help: "Whose Pot: cook() is onlyOwner" },
      chain: { type: "string", value: "<slug|id>", help: "The chain the Pot is for" },
      ...SALT,
      deploy: { type: "boolean", help: "Send the deployment (needs an endpoint and a signer)" },
      ...ENDPOINT,
      ...SIGNER,
      "auto-approve": {
        type: "boolean",
        help: "Accepted, approving nothing: --deploy itself is the approval",
      },
      ...FORMAT,
      ...HELP,
    },
    details: [
      "A Pot's address is CREATE2 from the released Kitchen over (owner, salt), so it is known",
      "before it exists. Prints it and the unsigned Kitchen.deployPot transaction as JSON; with",
      "--deploy, sends it unless the Pot is already there, and waits until the endpoint shows its",
      "code. The owner defaults to the signer. Deploying is permissionless: with --owner, the",
      "signer sends and pays for another owner's Pot, which is that owner's alone — how the Pot",
      "intents share on a chain (owner: its Portal's Executor) is deployed. The default salt is",
      "zero: the one Pot an owner has by default. With a signer and no --owner, it is the",
      "signer's own Pot, so `sauce pot --chain base --keystore <keystore>` prints your address and",
      "your Pot (the keystore's own address field is read, with no password, where it has one).",
      "Without --deploy it also reads",
      "the chain: whether the released engine and Kitchen are there, the Kitchen's fee, and",
      "whether the Pot is deployed and whose it is (under `deployment`, and on stderr).",
      "",
      "On Solana a Pot is the Kitchen's PDA over (owner, salt): this prints it and the create_pot",
      "instruction; --deploy (with --keypair) creates it. There the owner signs create_pot, so",
      "the signer is the owner.",
      ...SUPPORTED_ONLY("Deploys (or prints the deployment)"),
      "",
      "Examples:",
      "  sauce pot --owner 0x… --chain base",
      "  sauce pot --deploy --chain base --keystore ~/.keys/me.json --salt treasury",
      "  sauce pot --deploy --chain base --owner 0x… --keystore <keystore>",
      "  sauce pot --deploy --chain solana --keypair ~/.config/solana/id.json",
    ].join("\n"),
    run: async (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const chain = potChain(args);
      const owner = stringFlag(args, "owner");
      // A Pot is predicted on every chain; deployed, or its deployment printed as a cast line,
      // only on a supported one. (Its JSON on a preview chain leaves the deployment out.)
      if (args.values.deploy === true) requireSupported("deploying a Pot", [chain]);
      if (stringFlag(args, "format") === "cast") {
        requireSupported("building the Pot's deployment", [chain]);
      }
      if (chain.kind === "svm") {
        if (stringFlag(args, "format") === "cast") {
          throw new UsageError("--format cast prints an EVM transaction; a Solana Pot has none");
        }
        if (args.values.deploy !== true) {
          const rpcUrl = endpoint(args, io, chain);
          const keyed = hasSvmSigner(args, io) ? await keypairAddress(args, io) : undefined;
          const target = { owner: svmOwner(args, keyed), ...saltOf(args) };

          return rpcUrl === undefined
            ? svmPotCommand(target)
            : svmPotStatusCommand({ ...target, rpcUrl });
        }
        const signer = await keypairOf(args, io);

        return svmPotDeployCommand({
          owner: svmOwner(
            args,
            signer.address,
            "on Solana the owner signs create_pot, so the signer creates its own Pot",
          ),
          ...saltOf(args),
          rpcUrl: requiredEndpoint(args, io, chain),
          signer,
        });
      }
      if (args.values.deploy !== true) {
        // A signer, with no --owner, is asking for its own Pot: its address, without unlocking it
        // where the keystore names it.
        if (hasSvmSigner(args, io)) {
          throw new UsageError(
            "a Solana keypair or wallet names no owner on an EVM chain: an EVM --wallet, " +
              "--keystore or --private-key",
          );
        }
        if (owner === undefined && !hasSigner(args, io)) {
          throw new UsageError(
            "missing --owner <address>: whose Pot (or a signer, --wallet, --keystore or " +
              "--private-key, for yours)",
          );
        }
        const rpcUrl = endpoint(args, io, chain);
        const target = {
          chain,
          owner: owner === undefined ? await signerAddress(args, io) : parseAddress("owner", owner),
          ...saltOf(args),
        };

        return rpcUrl === undefined ? potCommand(target) : potStatusCommand({ ...target, rpcUrl });
      }
      if (stringFlag(args, "format") === "cast") {
        throw new UsageError("--format cast prints the unsigned transaction; --deploy sends it");
      }
      const account = await signerOf(args, io);

      return potDeployCommand({
        chain,
        // Kitchen.deployPot is permissionless: the signer may send another owner's.
        owner: owner === undefined ? account.address : parseAddress("owner", owner),
        ...saltOf(args),
        rpcUrl: requiredEndpoint(args, io, chain),
        account,
      });
    },
  },
  globals: {
    usage:
      "sauce globals --chain <slug|id> [--tokens] [--protocols] [--protocol <name>] [--stocks] " +
      "[--search <text>] [--json]",
    summary: "List the tokens, protocols and other names a program on a chain can use",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain whose names to list" },
      tokens: { type: "boolean", help: "Only the token symbols" },
      protocols: { type: "boolean", help: "Only the protocol namespaces" },
      protocol: {
        type: "string",
        value: "<name>",
        help: "One namespace (UniswapV4, or its slug) with its methods",
      },
      stocks: { type: "boolean", help: "Only the chain's tokenized stocks" },
      search: {
        type: "string",
        value: "<text>",
        help: "Only the tokens, stocks included, whose symbol, name or ticker contains the text",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Every name a program compiled for the chain may use without declaring it, from the SDK's",
      "registries (routes.sourceGlobals) — the ones the compile resolves: token symbols with",
      "their addresses and decimals, protocol namespaces with each contract's address (and,",
      "with --protocol, its methods), the chain names that open intents, the defines, and the",
      "zero-import @sauce/token functions. With no filter it lists everything but the chain's",
      "tokenized stocks, which it counts: Ethereum and Solana have over a thousand each. A stock",
      "token is named like any other (SPCXc.balanceOf(...), balanceOf(TSLAx, account) on",
      "Solana); --stocks lists them with what each one is, and --search finds one by symbol,",
      "company name or ticker.",
      "",
      "Examples:",
      "  sauce globals --chain base",
      "  sauce globals --chain base --protocol UniswapV3 --json",
      "  sauce globals --chain base --search spacex",
    ].join("\n"),
    run: (args) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const protocol = stringFlag(args, "protocol");
      const search = stringFlag(args, "search");

      return globalsCommand({
        chain: parseChain(requiredFlag(args, "chain", "<slug|id>")),
        tokens: args.values.tokens === true,
        protocols: args.values.protocols === true,
        stocks: args.values.stocks === true,
        ...(protocol === undefined ? {} : { protocol }),
        ...(search === undefined ? {} : { search }),
      });
    },
  },
  price: {
    usage: [
      "sauce price --chain <slug|id> <price> <quote> per <base> [--offline] [--json]",
      "sauce price --chain <slug|id> <base> <quote> (<price> | --sqrt-price-x96 <value>) [--json]",
      "sauce price --chain <slug|id> <base> <quote> --pool <address> [--json]",
    ],
    summary: "Turn a price into a pool's sqrtPriceX96 and a swap's limits, maxPrice included",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain the pool is on" },
      "sqrt-price-x96": {
        type: "string",
        value: "<value>",
        help: "Read a pool's sqrtPriceX96 as a price instead",
      },
      pool: {
        type: "string",
        value: "<address>",
        help: "Read the price from this V3-style pool of the pair now (needs an endpoint)",
      },
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "`2700 USDC per WETH` says it in words: 2,700 USDC for one WETH. The same price is",
      "`WETH USDC 2700`: <base> <quote> <price>, the price how many <quote> tokens one <base> is",
      "worth. A token is a symbol the chain registers (sauce globals --tokens), or an address with",
      "its decimals (0x…:18); with an endpoint, an address alone, its decimals read from the",
      "token. The first line says what the price means, both ways round",
      "(1 WETH = 2700 USDC, 1 USDC = 0.00037… WETH). Then the pool's sqrtPriceX96 at that price,",
      "for the pair's order on the chain (token0 is the lower address), and for each direction",
      "(selling the base token, then buying it):",
      "  sqrtPriceLimitX96  the same number as a swap's limit: a floor when selling token0, a",
      "                     ceiling when selling token1",
      "  maxPrice           input units paid per output unit bought, times 1e18, rounded down:",
      "                     the price times 10^(18 + input decimals - output decimals), the",
      "                     distributed swap's maxPrice, as sauce pools prints it",
      "  maxAvgPrice        the same number, as the distributed swap's maxAvgPrice",
      "  minAvgPrice        the other way round, output units received per input unit times",
      "                     1e18, rounded up, for a check out * 1e18 >= minAvgPrice * spent",
      "Uniswap V3 and V4 and their forks share this price. With --sqrt-price-x96, a pool's",
      "price is read back the other way. With --pool, it is read from that pool of the pair now:",
      "a Uniswap V3, PancakeSwap V3 or Aerodrome Slipstream pool (sauce pools lists them), named",
      "by its venue when the registry's factory made it.",
      "",
      "It also reads the pair's price now, from its deepest Uniswap V3 pool on the chain, and",
      "warns when the price given is 10x or more away from it, saying so when the price looks",
      "written the wrong way round. With --offline, nothing reaches a network.",
      "",
      "Examples:",
      "  sauce price --chain base 2700 USDC per WETH",
      "  sauce price --chain base 2700 USDC per WETH --offline",
      "  sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568",
      "  sauce price --chain base SPCXc USDC --pool 0x0bf58fe0FAc935Ac69595c19B12Ba0d75E3F8c0E",
    ].join("\n"),
    run: async (args, io) => {
      const chain = pricedChain(parseChain(requiredFlag(args, "chain", "<slug|id>")));
      const sqrt = stringFlag(args, "sqrt-price-x96");
      // `<price> <quote> per <base>`, or `<base> <quote> <price>`.
      const worded = args.positionals.length === 4 && args.positionals[2]?.toLowerCase() === "per";
      const [base, quote, price, ...rest] = worded
        ? [args.positionals[3], args.positionals[1], args.positionals[0]]
        : args.positionals;
      if (base === undefined || quote === undefined) {
        throw new UsageError(
          "missing the pair: <price> <quote> per <base>, as 2700 USDC per WETH (or WETH USDC 2700)",
        );
      }
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      const poolGiven = stringFlag(args, "pool");
      if (poolGiven !== undefined && (price !== undefined || sqrt !== undefined)) {
        throw new UsageError("give <price>, --sqrt-price-x96 or --pool: one of them");
      }
      const poolAddress = poolGiven === undefined ? undefined : parseAddress("pool", poolGiven);
      const given = poolAddress === undefined ? priceGiven(price, sqrt) : undefined;

      // A pool is read now, so --pool needs an endpoint; a price reads the pair's now with one.
      const url =
        poolAddress === undefined ? endpoint(args, io, chain) : requiredEndpoint(args, io, chain);
      const reach = url !== undefined;
      const client = url === undefined ? undefined : await connect(url, chain);
      // A token the chain registers no decimals for has them read from it, with an endpoint.
      const [baseToken, quoteToken] = await resolvePriceTokens([base, quote], chain, client);
      const pair = { base: baseToken!, quote: quoteToken! };
      if (poolAddress !== undefined) {
        const pool = await readPoolAt(client!, chain, poolAddress);

        return priceCommand({ chain, ...pair, price: { sqrtPriceX96: pool.sqrtPriceX96 }, pool });
      }
      const live =
        client === undefined ? undefined : await livePrice(client, chain, pair.base, pair.quote);
      const output = priceCommand({
        chain,
        ...pair,
        price: given!,
        ...(live === undefined ? {} : { live }),
      });

      return reach && live === undefined
        ? {
            ...output,
            notes: [
              ...(output.notes ?? []),
              `no Uniswap V3 pool for ${pair.base.symbol}/${pair.quote.symbol} on ${chain.slug} ` +
                "to read the price now from",
            ],
          }
        : output;
    },
  },
  pools: {
    usage: [
      "sauce pools --chain <slug|id> <token> <token> [--v4-key <fee:spacing>]… [--block <number|tag>] [--json]",
      "sauce pools --chain solana <pay token> <buy token> [--pay <token> [--max-price <n>] [--per-venue] [--slots <n>]] [--json]",
    ],
    summary: "List a pair's price-limit pools on a chain, deepest first, with their prices",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain the pools are on" },
      "v4-key": {
        type: "string",
        multiple: true,
        value: "<fee:spacing>",
        help: "Also try this hookless Uniswap V4 pool key (3000:60)",
        only: "evm",
      },
      block: {
        type: "string",
        value: "<number|tag>",
        help: "Read the pools at this block: a number, or latest, safe, finalized (default: latest)",
        only: "evm",
      },
      pay: {
        type: "string",
        value: "<token>",
        help: "Choose the pools a distributed swap paying this token takes, and print their slots' accounts",
        only: "svm",
      },
      "max-price": {
        type: "string",
        value: "<n>",
        help: "With --pay: only pools whose price with the fee is within this maxPrice",
        only: "svm",
      },
      "per-venue": {
        type: "boolean",
        help: "With --pay: the deepest pool of each venue only",
        only: "svm",
      },
      slots: {
        type: "string",
        value: "<n>",
        help: "With --pay: how many slots the program has (default 4)",
        only: "svm",
      },
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Every pool of the pair at the price-limit venues the registry records on the chain:",
      "Uniswap V3 and PancakeSwap V3 at each fee tier their factory enables, Aerodrome Slipstream",
      "at each tick spacing of each of its CLFactories, and hookless Uniswap V4 pools at the keys",
      "100:1, 500:10, 3000:60 and 10000:200, and any --v4-key. A token is a symbol the chain",
      "registers (sauce globals --tokens), or an address: its decimals and symbol are read from",
      "the token (or give them, 0x…:8).",
      "",
      "Pools with liquidity come first, deepest first: by the liquidity at each pool's price,",
      "which is in the same units at every venue for one pair. For each: the venue and the",
      "contract a program finds it through, its address (a V4 pool's id and key), its fee read",
      "from the pool (a V4 pool's LP fee and protocol fee, from StateView), tick spacing,",
      "liquidity, tick and sqrtPriceX96, and both ways round: what one token costs in the other",
      "before and with the fee, the distributed swap's maxPrice at that price (pay base units per",
      "buy base unit times 1e18: the price times 10^(18 + pay decimals - buy decimals)), and about",
      "how much of the paid token, fee included, moves the price 1% against the taker, walked",
      "through the pool's ticks. Pools with no liquidity at their price are listed after them, as",
      "skipped. Then what was looked at.",
      "",
      "It reads the chain in five requests, each one eth_call for every read in it, all at one",
      "block, which it names: --block, or the latest when it starts. Pass that block to sauce",
      "simulate --block to rehearse on the prices maxPrice was taken from.",
      "",
      "On Solana: every pool of the pair at each venue whose swap takes a price limit that stops",
      "it (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper,",
      "DefiTuna, Crema, and Phoenix's markets), found with getProgramAccounts on each venue's",
      "program. For each: its fee, liquidity and price both ways with the fee and as maxPrice, and",
      "its slot paying each token: the nine accounts the distributed swap takes for it (program,",
      "pool, config, the two vaults, one more account its swap takes, three tick arrays), each",
      "unused one the System program. A pool the distributed swap skips is listed as skipped with",
      "why. A token is a symbol the chain registers (SOL for WSOL), or a base58 mint. --pay chooses",
      "the slots a swap paying that token takes (within --max-price, one a venue with --per-venue,",
      "--slots of them) and prints them as accounts. A venue it could not read leaves the listing",
      "partial: a note says which, and the command exits 1.",
      "",
      "Examples:",
      "  sauce pools --chain base USDC WETH",
      "  sauce pools --chain base USDC 0x… --json",
      "  sauce pools --chain base WETH USDC --v4-key 50:1",
      "  sauce pools --chain solana USDC WSOL --json",
      "  sauce pools --chain solana USDC WSOL --pay USDC --max-price 119047619047619047 --per-venue --slots 5 --json",
    ].join("\n"),
    run: async (args, io) => {
      const chain = parseChain(requiredFlag(args, "chain", "<slug|id>"));
      const [first, second, ...rest] = args.positionals;
      if (first === undefined || second === undefined) {
        throw new UsageError("missing the pair: <token> <token>, as USDC WETH");
      }
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      if (chain.kind !== "evm") {
        for (const flag of ["v4-key", "block"])
          if (repeatedFlag(args, flag).length > 0 || stringFlag(args, flag) !== undefined)
            throw new UsageError(`--${flag} is for an EVM chain's pools`);
        const url = requiredEndpoint(args, io, chain);
        const pay = stringFlag(args, "pay");
        const maxPrice = stringFlag(args, "max-price");
        const slots = stringFlag(args, "slots");
        if (
          pay === undefined &&
          (maxPrice !== undefined || slots !== undefined || args.values["per-venue"])
        )
          throw new UsageError(
            "--max-price, --per-venue and --slots choose pools for --pay <token>",
          );
        if (maxPrice !== undefined && !/^\d+$/.test(maxPrice))
          throw new UsageError(`--max-price ${maxPrice}: a whole number, maxPrice's units`);
        if (slots !== undefined && !/^[1-9]$/.test(slots))
          throw new UsageError(`--slots ${slots}: a number from 1 to 9`);

        return svmPoolsCommand({
          chain,
          rpcUrl: url,
          tokens: [first, second],
          ...(pay === undefined
            ? {}
            : {
                choose: {
                  pay,
                  ...(maxPrice === undefined ? {} : { maxPrice: BigInt(maxPrice) }),
                  perVenue: args.values["per-venue"] === true,
                  ...(slots === undefined ? {} : { slots: Number(slots) }),
                },
              }),
        });
      }
      const v4Keys = repeatedFlag(args, "v4-key").map((raw) => parseV4Key(raw));
      // Every read at one block, which the report names.
      const { client, block } = await connectAt(
        requiredEndpoint(args, io, chain),
        chain,
        stringFlag(args, "block"),
      );

      return poolsCommand({ chain, client, tokens: [first, second], v4Keys, block });
    },
  },
  inspect: {
    usage:
      "sauce inspect <hex | tx-hash | file | -> [--chain <slug|id>] [--source <file | ->] [options] [--args <value>…]",
    summary: "Take a cook, a Portal or Kitchen call, a program or a file apart",
    trailing: "args",
    flags: {
      ...PROGRAM,
      "args-json": COOK["args-json"]!,
      source: {
        type: "string",
        value: "<file>",
        help: "The program a cook was compiled from: decode its arguments",
      },
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Reads what a SauceScript author wrote back out of bytes: a Pot.cook (its engine, its",
      "program, the intents the program opens), a Kitchen.deployPot (the Pot it makes), a Portal",
      "publish or publishAndFund (the route and the reward), an ERC-20 call, or a bare program.",
      "A 32-byte hash with --chain (or --rpc-url) is a transaction, fetched first.",
      "With --source, a cook's program is checked against that file's and the arguments after it",
      "are decoded against its main. A file operand is compiled and its intents listed, with",
      "each value it measures at run time named; with --args, main's arguments are bound into",
      "them, as `sauce intent publish` binds them. No opcode listing: programs are reported by",
      "size, hash and what they open.",
      "",
      "Examples:",
      "  sauce inspect 0x… --chain base --source split.sauce.ts",
      "  sauce inspect 0x<tx hash> --chain base",
      "  sauce inspect bridge.sauce.ts --chain arbitrum --intent-deadline 2000000000 --intent-creator 0x… \\",
      "    --args 1000000 0x…",
    ].join("\n"),
    run: async (args, io, trailing) => {
      const [operand, ...extra] = args.positionals;
      // `-`: stdin carries the hex, the hash or the program — whichever it reads as.
      const piped = operand === "-" ? io.readStdin().trim() : undefined;
      if (piped !== undefined && extra.length > 0) {
        throw new UsageError(`unexpected argument ${extra[0]}`);
      }
      const word = piped ?? operand;
      if (word === undefined || !/^0x[0-9a-fA-F]*$/.test(word)) {
        if (stringFlag(args, "source") !== undefined) {
          throw new UsageError("--source goes with hex: a file operand is its own source");
        }
        const given = argsInput(args, io, trailing);
        const input = await programInput(
          args,
          io,
          piped === undefined ? fileOperand(args) : { file: STDIN, text: piped, stdin: true },
          undefined,
          undefined,
          given.args === undefined ? undefined : given,
        );

        return inspectFile(input.file, compileProgram(input, io));
      }
      if (argsInput(args, io, trailing).args !== undefined) {
        throw new UsageError(
          "--args gives a file's main its arguments; a cook's are decoded from its bytes",
        );
      }
      const hex =
        piped === undefined
          ? hexOperand(args, "<hex | tx-hash | file>")
          : hexOperand({ ...args, positionals: [piped] }, "<hex | tx-hash | file>");
      const sourceFile = stringFlag(args, "source");
      if (piped !== undefined && sourceFile === "-") {
        throw new UsageError("stdin carries one thing: the hex, or --source's program, not both");
      }
      const fetched = TX_HASH.test(hex) ? await transactionEndpoint(args, io) : undefined;
      if (TX_HASH.test(hex) && fetched === undefined) {
        throw new UsageError(
          args.values.offline === true
            ? "32 bytes of hex is a transaction hash, to fetch, and --offline reads no chain"
            : "32 bytes of hex is a transaction hash: give --chain <slug|id> (or --rpc-url " +
                "<url>) to fetch it",
        );
      }
      const source =
        sourceFile === undefined
          ? undefined
          : await programInput(args, io, sourceFile, fetched?.chain);
      const chainFlag = stringFlag(args, "chain");
      const chain =
        fetched?.chain ??
        source?.chain ??
        (chainFlag === undefined ? undefined : parseChain(chainFlag));

      return inspectCommand({
        hex,
        ...(chain === undefined ? {} : { chain }),
        ...(fetched === undefined ? {} : { rpcUrl: fetched.rpcUrl }),
        ...(source === undefined
          ? {}
          : { source: { file: source.file, program: compileProgram(source, io) } }),
      });
    },
  },
  verify: {
    usage:
      "sauce verify <payload | calldata | tx-hash> [--pin <hash:bytes>]… [--engine <address>]… [--chain <slug|id>]",
    summary: "Check that a payload, cook or intent runs the audited settle program",
    flags: {
      pin: {
        type: "string",
        multiple: true,
        value: "<hash:bytes>",
        help: "Also accept this historical settle program (keccak256:length)",
      },
      engine: {
        type: "string",
        multiple: true,
        value: "<address>",
        help: "Also accept a cook on this engine, besides the released one",
      },
      chain: { type: "string", value: "<slug|id>", help: "The chain a transaction hash is on" },
      "min-out": {
        type: "string",
        value: "<amount>",
        help: "Solana: the floor the settle must enforce on its first escrow",
      },
      "spl-count": {
        type: "string",
        value: "<n>",
        help: "Solana: how many escrows the settle sweeps with its first token program",
      },
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Takes a settle payload, Pot.cook calldata, Portal.publish[AndFund] calldata, or — with an",
      "--chain — a transaction hash, and checks the settle it carries with the SDK's",
      "validateSettleProgram: the program must hash to the current pin (or a --pin), and its",
      "arguments must be the one canonical encoding. Prints tokens, minOut and recipient. A cook",
      "must name the released engine (or an --engine); an intent must carry a settle cook. A",
      "rejection exits 1 with its code: the SDK's SettleFailureCode, or UNKNOWN_ENGINE or",
      "NO_SETTLE.",
      "",
      "On Solana (--chain solana and a transaction signature): an SVM settle's",
      "floor and split are compiled into it, so give them, --min-out and --spl-count. The",
      "engine invocation the cook made is checked by the SDK's verifySvmSettleExecution against",
      "the settle recompiled for those values; a rejection is NO_SETTLE or NOT_GENUINE.",
      "",
      "Examples:",
      "  sauce verify 0x<payload>",
      "  sauce verify 0x<tx hash> --chain base --pin 0x…:435",
      "  sauce verify <signature> --chain solana --min-out 0 --spl-count 1",
    ].join("\n"),
    run: async (args, io) => {
      const chainFlag = stringFlag(args, "chain");
      if (chainFlag !== undefined && parseChain(chainFlag).kind === "svm") {
        const [signature, ...rest] = args.positionals;
        if (signature === undefined)
          throw new UsageError("missing <signature>: the cook's transaction");
        if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
        const amount = (flag: string): bigint => {
          const raw = requiredFlag(args, flag, flag === "min-out" ? "<amount>" : "<n>");
          if (!/^\d+$/.test(raw)) throw new UsageError(`--${flag}: '${raw}' is not a whole number`);

          return BigInt(raw);
        };

        return svmVerifyCommand({
          signature,
          rpcUrl: requiredEndpoint(args, io, parseChain(chainFlag)),
          minOut: amount("min-out"),
          splCount: amount("spl-count"),
        });
      }
      const hex = hexOperand(args, "<payload | calldata | tx-hash>");
      const fetched = TX_HASH.test(hex) ? await transactionEndpoint(args, io) : undefined;

      return verifyCommand({
        hex,
        pins: repeatedFlag(args, "pin").map(parsePin),
        engines: repeatedFlag(args, "engine").map((engine) => parseAddress("engine", engine)),
        ...(fetched === undefined ? {} : fetched),
      });
    },
  },
  skills: {
    usage:
      "sauce skills <install | update | status> [--agent <agent>,…] [--dir <project>] [--force]",
    summary: "Install, update or check this package's agent skills in a project",
    flags: {
      agent: {
        type: "string",
        multiple: true,
        value: "<agent>",
        help: `${AGENTS.join(", ")} or all (default: all)`,
      },
      dir: { type: "string", value: "<project>", help: "The project (default .)" },
      force: { type: "boolean", help: "update: overwrite files edited since they were installed" },
      ...HELP,
    },
    details: [
      "The skills ship once, as Agent Skills directories, and are written where agents read",
      "them: .claude/skills/ (claude) and .agents/skills/ (codex, cursor, copilot, gemini), which",
      "between them reach all five. That is the default, and what --agent all means; an agent",
      "named alone gets the one it reads. --agent agents-md, only when asked for, also writes an",
      "index of the skills into a block of AGENTS.md, for a tool that reads that file but no",
      "skills directory. update and status take the targets installed.",
      "",
      "Each skills directory also gets tsconfig.json, the SauceScript project sauce init",
      "<dir> --tsconfig writes, so an editor types the skills' example programs. It is installed,",
      "updated and reported like a skill file.",
      "",
      "  install  The first install. Never overwrites: on a project already installed it says",
      "           whether the skills are current, and to run update if not.",
      "  update   Adds new skill files, replaces changed ones, removes retired ones. A file edited",
      "           since it was installed is kept and shown, unless --force.",
      "  status   Each target: up to date, outdated or modified, with its files. Exits 1 while",
      "           any is outdated or not installed.",
    ].join("\n"),
    run: (args) => {
      const [sub, ...rest] = args.positionals;
      if (sub !== "install" && sub !== "update" && sub !== "status") {
        throw new UsageError(
          sub === undefined
            ? "missing subcommand: install, update or status"
            : `unknown subcommand '${sub}': install, update or status`,
        );
      }
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      if (args.values.force === true && sub !== "update") {
        throw new UsageError(`--force goes with update; ${sub} never overwrites`);
      }
      const project = stringFlag(args, "dir") ?? ".";
      const source = skillsSource();
      const asked = parseAgents(repeatedFlag(args, "agent"));
      const targets =
        asked !== undefined
          ? targetsFor(asked)
          : sub === "install"
            ? targetsFor(DEFAULT_AGENTS)
            : installedTargets(project);
      if (targets.length === 0) {
        throw new CliError(
          `no agent skills are installed in ${project}: run \`sauce skills install\``,
        );
      }
      if (sub === "status") {
        const statuses = targets.map((target) => statusOf(project, source, target));
        const failing = statuses.some(
          (status) => status.state === "outdated" || status.state === "not installed",
        );

        return {
          ...lines(statuses.flatMap((status) => describeStatus(status, source))),
          ...(failing ? { exitCode: 1 } : {}),
        };
      }

      return lines(
        targets.flatMap(
          (target) =>
            (sub === "install"
              ? installTarget(project, source, target)
              : updateTarget(project, source, target, args.values.force === true)
            ).lines,
        ),
      );
    },
  },
  update: {
    usage: "sauce update [--check] [--version <version|tag>] [--json]",
    summary: "Update this sauce command, the way it was installed",
    flags: {
      check: {
        type: "boolean",
        help: "Say which version is installed and which an update installs; install nothing",
      },
      version: {
        type: "string",
        value: "<version|tag>",
        help: "The version or dist-tag to install (default: latest)",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Updates the copy of the package this sauce runs from, the way it was installed, which its",
      "own path says:",
      "  a global install    npm, pnpm, yarn or bun installs the version globally again, run with",
      "                      no shell (npm with the prefix this copy is under), and the command",
      "                      prints the version before and after",
      "  a project's copy    the project updates it: the command its package manager takes is",
      "                      printed, pinned exactly, and nothing runs",
      "  npx's cache         the npx -y command that runs the latest is printed",
      "  anything else       refused, with npm's global install of it",
      "After a global update, skills installed in the current directory (sauce skills status) are",
      "updated by the NEW sauce, and what changed is printed.",
      "",
      "The version comes from the npm registry, read when this command runs and at no other time:",
      "sauce never checks for updates by itself. --check reads it and installs nothing.",
      "",
      "Examples:",
      "  sauce update --check",
      "  sauce update",
      "  sauce update --version 1.2.0",
    ].join("\n"),
    run: async (args, io) => {
      const version = stringFlag(args, "version");

      return updateCommand(
        { check: args.values.check === true, ...(version === undefined ? {} : { version }) },
        io.updater,
      );
    },
  },
  init: {
    usage: [
      "sauce init [<dir>] [--agent <agent>,…] [--force] [--install]",
      "sauce init <dir> --tsconfig [--force]",
    ],
    summary: "Scaffold a project that uses this package",
    flags: {
      agent: {
        type: "string",
        multiple: true,
        value: "<agent>",
        help: `Whose skills to install: ${AGENTS.join(", ")} or all`,
      },
      force: { type: "boolean", help: "Overwrite files that already exist with other content" },
      install: { type: "boolean", help: "Run npm install in the project afterwards" },
      tsconfig: {
        type: "boolean",
        help: "Write only <dir>/tsconfig.json: an editor's SauceScript project for programs there",
      },
      ...HELP,
    },
    details: [
      "Writes package.json (pinning this exact version), AGENTS.md (the project's instructions,",
      "which coding agents read), CLAUDE.md and GEMINI.md importing it for those agents, a",
      ".gitignore for local config, sauce.config.example.json (placeholders only),",
      "programs/tsconfig.json (SauceScript's names, and a plugin, for an editor checking the",
      "programs there: kept apart from the project's other TypeScript), and then",
      "installs the agent skills (`sauce skills install`), for every agent unless --agent names",
      "some. It runs no package manager unless --install, which runs npm install.",
      "",
      "--tsconfig writes only <dir>/tsconfig.json, the same SauceScript project as",
      "programs/tsconfig.json, for programs in a project init did not write, or in another",
      "directory: an editor takes a file's nearest tsconfig.json, so every *.sauce.ts under <dir>",
      "gets SauceScript's names and the plugin. Where the project's own tsconfig.json also covers",
      'them, add "exclude": ["**/*.sauce.ts"] there, so its TypeScript does not check them too.',
      "",
      "Examples:",
      "  sauce init my-project",
      "  sauce init programs --tsconfig",
    ].join("\n"),
    run: (args, io) => {
      const [dir = ".", ...rest] = args.positionals;
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <dir>`);
      if (args.values.tsconfig === true) {
        for (const flag of ["agent", "install"]) {
          if (args.values[flag] !== undefined) {
            throw new UsageError(`--${flag} goes with a whole project: --tsconfig writes one file`);
          }
        }
        const written = writeSauceScriptTsconfig(
          dir,
          skillsSource().packageName,
          args.values.force === true,
        );

        return lines([
          `${written.state.padEnd(10)} ${written.path}`,
          "Every *.sauce.ts under it now has SauceScript's names in an editor. If the project's",
          'own tsconfig.json covers these files too, add "exclude": ["**/*.sauce.ts"] to it.',
        ]);
      }
      const agents = parseAgents(repeatedFlag(args, "agent")) ?? DEFAULT_AGENTS;
      const result = initProject(dir, skillsSource(), agents, args.values.force === true);
      io.stdout(
        [
          `Scaffolded ${dir}:`,
          ...result.files.map((file) => `  ${file.state.padEnd(10)} ${file.path}`),
          ...result.skills.flatMap((report) => report.lines.map((line) => `  ${line}`)),
          "",
        ].join("\n"),
      );
      if (args.values.install === true) {
        io.stdout(`Running npm install in ${dir}\n`);
        const status = io.run("npm", ["install"], dir);
        if (status !== 0) throw new CliError(`npm install exited with ${status}`);
      }

      return lines([
        "Next:",
        ...(dir === "." ? [] : [`  cd ${dir}`]),
        ...(args.values.install === true ? [] : ["  npm install"]),
        "  sauce --help",
      ]);
    },
  },
  mcp: {
    usage: [
      "sauce mcp [--config <file>]",
      "sauce mcp --wallets [<dir>] (--password-env <NAME> | --password-file <path> | --password-command <command>) [--config <file>]",
      "sauce mcp --http <port> [--host <address>] [--allowed-host <name>]… [--config <file>]",
      "sauce mcp setup [--agent <agent>,…] [--dir <project>] [--config <file>] [--force]",
    ],
    summary: "Serve the commands and the agent skills to coding agents over MCP",
    flags: { ...MCP_FLAGS, ...HELP },
    details: [
      "The Sauce MCP server. Its tools are this command's building half — sauce_compile,",
      "sauce_actions, sauce_tx, sauce_pot, sauce_simulate, sauce_intent_publish,",
      "sauce_intent_fill, sauce_inspect, sauce_verify, sauce_globals, sauce_price, sauce_pools",
      "and sauce_chains — with the agent skills as tools (sauce_skills, sauce_skill, sauce_dev,",
      "sauce_install_skills) and as resources, at sauce://skills/<path>. It takes no key: every",
      "transaction comes back unsigned, for the user's own wallet.",
      "",
      "A coding agent starts the server itself, from its MCP configuration. Add it once:",
      "  claude mcp add sauce -- sauce mcp    # Claude Code",
      "  codex mcp add sauce -- sauce mcp     # OpenAI Codex",
      "  gemini mcp add sauce sauce mcp       # Gemini CLI",
      "  sauce mcp setup                      # every project file at once",
      "Claude Desktop (claude_desktop_config.json) and Cursor (.cursor/mcp.json) take the entry",
      '  "sauce": { "command": "sauce", "args": ["mcp"] }',
      "under mcpServers, and VS Code (.vscode/mcp.json) under servers. A desktop client that does",
      "not find `sauce` on its PATH takes the absolute path `which sauce` prints as the command.",
      "",
      "Over stdio, --wallets (the wallet directory, default ~/.sauce/wallets) and a password",
      "source add sauce_wallet_create, sauce_wallet_list and sauce_wallet_send: the server then",
      "signs with the wallets of that directory alone, unlocked by that password, which it reads",
      "once at start (from the variable an MCP client's config passes from the agent's .env, a",
      "file, or a command) and which no tool takes or returns. sauce_wallet_send rehearses what it",
      "is given and holds it to the wallet's policy (sauce wallet --help) before it sends.",
      "The HTTP server never signs: --wallets is refused there, and it has no wallet tools.",
      "",
      "Over stdio by default, what a coding agent launches. With --http, Streamable HTTP at /mcp,",
      "stateless: on 127.0.0.1 unless --host says otherwise, answering only a loopback Host or an",
      "--allowed-host one. It authenticates no one, so off loopback it needs --allowed-host, and",
      "goes behind your own authentication. It reads a chain through a caller's rpcUrl, else",
      "--config's entry for it, else a built-in public endpoint; it reads no environment, and never",
      "shows a URL from the file.",
      "",
      "setup adds the server to a project for each agent, in the file its vendor documents:",
      ".mcp.json (claude), .codex/config.toml (codex), .cursor/mcp.json (cursor),",
      ".vscode/mcp.json (copilot) and .gemini/settings.json (gemini), keeping what else each holds.",
      "",
      "Examples:",
      "  sauce mcp",
      "  sauce mcp --wallets --password-env SAUCE_WALLET_PASSWORD",
      "  sauce mcp --http 3000",
      "  sauce mcp setup --agent claude,cursor",
    ].join("\n"),
    run: (args, io) => mcpCommand(args, io),
  },
};

/** What a command prints on stdout: tx and pot their JSON (or `--format cast`), the rest their
 *  text (or `--json`). */
function render(command: Command, output: CommandOutput, args: ParsedArgs): string {
  const format = stringFlag(args, "format");
  if (format === "cast") return output.cast ?? JSON.stringify(output.json, null, 2);
  if (format !== undefined && format !== "json") {
    throw new UsageError(`--format: '${format}' is not json or cast`);
  }
  // `tx` and `pot` print a transaction, so JSON is their default; every other command a report.
  const jsonByDefault = "format" in command.flags && !("json" in command.flags);

  return format === "json" || jsonByDefault || args.values.json === true
    ? JSON.stringify(output.json, null, 2)
    : output.text;
}

/** The flags of `command` that `only` names (`undefined`: those every chain takes), the low-level
 *  ones apart. */
const flagsFor = (command: Command, only?: "evm" | "svm" | "low-level"): FlagSpecs =>
  Object.fromEntries(
    Object.entries(command.flags).filter(([, spec]) =>
      only === "low-level" ? spec.lowLevel === true : spec.only === only && spec.lowLevel !== true,
    ),
  );

function commandHelp(command: Command): string {
  const usage = typeof command.usage === "string" ? [command.usage] : command.usage;
  const sections = (
    [
      ["Options:", undefined],
      ["EVM chains only:", "evm"],
      ["Solana only:", "svm"],
      ["Low-level (a program's inputs are main's parameters, given with --args):", "low-level"],
    ] as const
  ).flatMap(([heading, only]) => {
    const flags = flagsFor(command, only);

    return Object.keys(flags).length === 0 ? [] : [heading, describeFlags(flags), ""];
  });

  return [
    `${command.summary}.`,
    "",
    `Usage: ${usage.join("\n       ")}`,
    "",
    ...sections,
    command.details,
    "",
  ].join("\n");
}

/** `text` in lines of at most 96 characters, as the help is written. */
function wrapped(text: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + 1 + word.length > 96) {
      out.push(line);
      line = word;
    } else line = line === "" ? word : `${line} ${word}`;
  }

  return line === "" ? out : [...out, line];
}

function mainHelp(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => name.length));

  return [
    "sauce: compile SauceScript, and run it on a chain.",
    "",
    "Usage: sauce <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(
      ([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`,
    ),
    "",
    "Run `sauce <command> --help` for its options. A command reads a chain through a built-in",
    "public endpoint, which can be slow or rate-limited, unless --rpc-url or --config gives your",
    "own (--offline reads none). Nothing is signed without --wallet, --keystore or --private-key",
    "(on Solana, --wallet or --keypair). A password is read only from the source named:",
    "--password-env NAME (that variable, the one read of the environment), --password-file or",
    "--password-command; else it is asked for.",
    "",
    ...wrapped(previewChainsNote()),
    "",
    "A program file may be `-`, read from stdin (`cat pay.sauce.ts | sauce compile - --chain",
    "base`); it is never read without one. Its relative imports then resolve against the",
    "current directory, or --source-dir. Questions go to the terminal (/dev/tty) instead of",
    "stdin; with no terminal, a run names what it needs approved and sends nothing until",
    "--auto-approve (and a password source for a wallet or keystore) is given.",
    "",
  ].join("\n");
}

/** Every command by the words that name it: `compile`, `run`, …, and `intent <verb>` for each of
 *  the intent verbs. */
const ALL_COMMANDS: ReadonlyArray<readonly [string, Command]> = [
  ...Object.entries(COMMANDS),
  ...Object.entries(INTENT_VERBS).map(([verb, command]) => [`intent ${verb}`, command] as const),
  ...Object.entries(WALLET_VERBS).map(([verb, command]) => [`wallet ${verb}`, command] as const),
];

/** The commands that take verbs, and their verbs. */
const VERBS: Readonly<Record<string, Readonly<Record<string, Command>>>> = {
  intent: INTENT_VERBS,
  wallet: WALLET_VERBS,
};

/** The command `words` name — `intent fill` for `intent fill …` — with the words after it. */
function commandOf(
  words: readonly string[],
):
  | { readonly label: string; readonly command: Command; readonly rest: readonly string[] }
  | undefined {
  const [name, verb, ...more] = words;
  const verbs = name === undefined || !Object.hasOwn(VERBS, name) ? undefined : VERBS[name]!;
  if (verbs !== undefined && verb !== undefined && Object.hasOwn(verbs, verb)) {
    return { label: `${name} ${verb}`, command: verbs[verb]!, rest: more };
  }
  if (name !== undefined && Object.hasOwn(COMMANDS, name)) {
    return { label: name, command: COMMANDS[name]!, rest: words.slice(1) };
  }

  return undefined;
}

/** Every flag any command takes: a flag given to the wrong command is named as that, never
 *  "unknown", and never swallowed as one of `main`'s arguments. */
const ANY_FLAG: FlagSpecs = Object.assign({}, ...ALL_COMMANDS.map(([, c]) => c.flags));

/** The flag `word` spells (`--name`, `--name=value`, `-x`), if it is one any command takes. */
function flagOf(word: string): FlagSpec | undefined {
  const long = /^--([\w-]+)(?:=|$)/.exec(word)?.[1];
  if (long !== undefined) return Object.hasOwn(ANY_FLAG, long) ? ANY_FLAG[long] : undefined;
  const short = /^-(\w)$/.exec(word)?.[1];

  return short === undefined ? undefined : Object.values(ANY_FLAG).find((f) => f.short === short);
}

/**
 * The command's flag words and its trailing words (`--args …`). Flags may come in any order, and
 * after the trailing ones too: past `--args`, a word that is a flag is read as one, with its value;
 * every other word is an argument, in order. After a `--` there, every word is an argument, so one
 * that looks like a flag can still be passed.
 */
function splitArgv(
  rest: readonly string[],
  command: Command,
): { flags: string[]; trailing?: string[] } {
  const at = command.trailing === undefined ? -1 : rest.indexOf(`--${command.trailing}`);
  if (at < 0) return { flags: [...rest] };
  const flags = rest.slice(0, at);
  const trailing: string[] = [];
  for (let i = at + 1; i < rest.length; i++) {
    const word = rest[i]!;
    if (word === "--") {
      trailing.push(...rest.slice(i + 1));
      break;
    }
    const flag = flagOf(word);
    if (flag === undefined) {
      trailing.push(word);
      continue;
    }
    flags.push(word);
    if (flag.type === "string" && !word.includes("=") && i + 1 < rest.length)
      flags.push(rest[++i]!);
  }

  return { flags, trailing };
}

const SIGNING = new Set([
  "wallet",
  "keystore",
  "password-env",
  "password-file",
  "password-command",
  "private-key",
  "keypair",
]);
const REACHING = new Set(["rpc-url", "config", "offline"]);

/** Why `flag`, which another command takes, is not one of `name`'s (`intent fill`, say). */
function notTaken(name: string, flag: string): string {
  const takers = ALL_COMMANDS.filter(([, command]) => flag in command.flags).map(
    ([other]) => other,
  );
  const own = commandOf(name.split(" "))!.command.flags;
  const why =
    name === "tx" && SIGNING.has(flag)
      ? "tx signs nothing: it prints the transaction unsigned, for a wallet (sauce run signs and sends it)"
      : SIGNING.has(flag) && !Object.keys(own).some((key) => SIGNING.has(key))
        ? `${name} signs nothing`
        : REACHING.has(flag) && !("config" in own)
          ? `${name} reads nothing from a chain`
          : flag === "auto-approve"
            ? `${name} has nothing to ask`
            : undefined;

  return (
    `--${flag} is not an option of sauce ${name}` +
    (why === undefined ? "" : `: ${why}`) +
    ` (${takers.map((taker) => `sauce ${taker}`).join(", ")} ${takers.length === 1 ? "takes" : "take"} it)`
  );
}

/** Registers a `--private-key` value as a secret before anything can fail and print it. */
function rememberSecrets(given: readonly string[]): void {
  // A word may hold several, from a shell that did not split a variable: split them here too.
  const argv = given.flatMap((word) => (/^-\S*\s/.test(word) ? word.split(/\s+/) : [word]));
  argv.forEach((word, index) => {
    if (word === "--private-key" && argv[index + 1] !== undefined) secret(argv[index + 1]!);
    if (word.startsWith("--private-key=")) secret(word.slice("--private-key=".length));
  });
}

/** Runs `sauce <argv…>`, returning the exit code: 0, 1 for a failure, 2 for a usage error. */
export async function runCli(argv: readonly string[], rawIo: CliIo): Promise<number> {
  rememberSecrets(argv);
  // Everything printed goes through `scrub`, so no key or password can reach a terminal or a log.
  const io: CliIo = {
    ...rawIo,
    stdout: (text) => rawIo.stdout(scrub(text)),
    stderr: (text) => rawIo.stderr(scrub(text)),
  };
  const [name, ...rest] = argv;
  if (name === undefined) {
    io.stderr(mainHelp());

    return 2;
  }
  if (name === "--help" || name === "-h") {
    io.stdout(mainHelp());

    return 0;
  }
  if (name === "--version") {
    const { name: pkg, version } = packageInfo();
    io.stdout(`${pkg} ${version}\n`);

    return 0;
  }
  const named = commandOf(name === "help" ? rest : argv);
  if (name === "help" && (rest[0] === undefined || named !== undefined)) {
    io.stdout(named === undefined ? mainHelp() : commandHelp(named.command));

    return 0;
  }
  if (named === undefined) {
    const unknown = name === "help" ? rest[0] : name;
    io.stderr(
      `sauce: unknown command '${unknown}'. Commands: ${Object.keys(COMMANDS).join(", ")}\n`,
    );

    return 2;
  }
  const { label, command } = named;

  try {
    const { flags, trailing } = splitArgv(named.rest, command);
    const args = parseFlags(flags, ANY_FLAG);
    if (args.values.help === true) {
      io.stdout(commandHelp(command));

      return 0;
    }
    const foreign = Object.keys(args.values).find((flag) => !(flag in command.flags));
    if (foreign !== undefined) throw new UsageError(notTaken(label, foreign));
    // A command that reads a chain reads it, with no endpoint of the user's, through the built-in
    // public ones: their forwarder starts before the command asks for one.
    if ("config" in command.flags) {
      const own = ["rpc-url", "config"].find((flag) => args.values[flag] !== undefined);
      if (args.values.offline === true && own !== undefined) {
        throw new UsageError(`--offline reads no chain: give it without --${own}`);
      }
      if (args.values.offline !== true) await io.publicRpcs?.ready();
    }
    const output = await command.run(args, io, trailing);
    if (output === undefined) return 0;
    for (const note of output.notes ?? []) io.stderr(`${note}\n`);
    io.stdout(`${render(command, output, args)}\n`);

    return output.exitCode ?? 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`sauce ${label}: ${error.message}\nRun \`sauce ${label} --help\` for usage.\n`);

      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sauce ${label}: ${message}\n`);

    return 1;
  }
}
