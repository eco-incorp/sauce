/**
 * The `sauce` command: compile SauceScript exactly as the SDK does, and run it — simulate the cook,
 * sign and send it, deploy the Pot it runs on — or print the unsigned transaction for a wallet;
 * and set a project up to do all of that. `main.ts` is the executable; this is everything it does,
 * over an injected {@link CliIo} so the tests drive it without a child process.
 *
 * NODE-ONLY, and reached by nothing browser-facing: it is the package's `bin`, not an `exports`
 * entry, and no barrel imports it. It reads the environment in one place, deliberately, and only the
 * variable it is told to (`nodeIo().readEnv`): the one `--password-env <NAME>` names, and in `sauce
 * mcp` over stdio the one an agent names with `sauce_wallet_enable { env }`. The network is reached
 * only through `--rpc-url` or a `--config` file named on the command line, or else through the
 * built-in public endpoints the process is given (`CliIo.publicRpcs`; none with `--offline`);
 * besides a chain, only the npm registry is read, by `sauce update` and by the update check's
 * refresh, in a process of its own (`CliIo.updateCheck`; none with `--offline` or
 * `--no-update-check`). A key is reached only through `--wallet`, `--keystore`, `--private-key` or
 * `--keypair` (a policy guards `--wallet` alone) — and every byte printed passes through
 * `signer.ts#scrub` on the way out.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";

import type { CanonicalChain } from "../chains/canonical.js";
import {
  addressDefines,
  CliError,
  describeFlags,
  parseAddress,
  parseChain,
  parseDefines,
  parseDefinesFile,
  parseFlags,
  parseLamports,
  parseSalt,
  parseTarget,
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
import { chainServedBy, connect, connectAt, endpointFor } from "./chain.js";
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
  potCommand,
  potDeployCommand,
  type PotInput,
  potStatusCommand,
  type ProgramInput,
  readInput,
  runCommand,
  txCommand,
  unapproved,
} from "./commands.js";
import type { FundRequest } from "./funding.js";
import type { Ask } from "./prompt.js";
import { potImportCommand, potListCommand } from "./pot-commands.js";
import { PotStore } from "./pot-store.js";
import { keeping, keepsAny, type LocalStores } from "./keep.js";
import { globalsCommand } from "./globals.js";
import { handoff } from "./handoff.js";
import { initProject, installedViem, writeSauceScriptTsconfig } from "./init.js";
import {
  assumedBalances,
  definesReach,
  fundingFor,
  fundTransfers,
  potImportTarget,
  potOwner,
  potTarget,
  programChain,
  withoutShebang,
} from "./inputs.js";
import { inspectCommand, inspectFile } from "./inspect.js";
import { MCP_FLAGS, mcpCommand } from "./mcp.js";
import { runtimeCommand } from "./optional.js";
import { livePrice, priceCommand, pricedChain, priceGiven, resolvePriceTokens } from "./price.js";
import { parseV4Key, poolsCommand, readPoolAt } from "./pools.js";
import { svmPoolsCommand } from "./pools-svm.js";
import { reclaimCommand } from "./reclaim.js";
import { sendCommand, signedChain } from "./send.js";
import {
  cancelCommand,
  parseUint256,
  refuseSignInput,
  signCommand,
  SIGNED_COOKS_ARE_EVM,
} from "./sign.js";
import { simulateCommand } from "./simulate.js";
import { previewChainsNote, requireSupported, supportedChainNames } from "./support.js";
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
import { updateCheckOff, updateNotice, type UpdateCheck } from "./update-check.js";
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
  /** Where the wallets are when `--wallets` does not say: `~/.sauce/wallets` by default. */
  readonly walletsDir?: string;
  /**
   * Where the Pot store is when `--pots` does not say: every Pot a command deploys is recorded there
   * (`pots.ts`). The executable gives `~/.sauce/pots` (`main.ts`); without it, as in a test, a Pot
   * is recorded only where `--pots` names a store.
   */
  readonly potsDir?: string;
  /** The variable `--password-env`, or `sauce_wallet_enable`'s `env`, names: the one read of the
   *  environment. */
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
  /**
   * The update check (`update-check.ts`): a newer version, from its cache, noticed on stderr after a
   * command. The executable gives it (`main.ts`); without it, as in a test, nothing is checked.
   */
  readonly updateCheck?: UpdateCheck | undefined;
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
    // The one read of the environment: the variable named by --password-env or by
    // sauce_wallet_enable's env, and nothing else.
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

/** Every command's: its help, and the update check's opt-out (`update-check.ts`). */
/** `-y`: what a command would ask before it sends — deploying the Pot it cooks on first, an approval
 *  a run's funding needs — approved without asking. `--auto-approve` is its older name. */
const YES: FlagSpec = {
  type: "boolean",
  short: "y",
  help: "Approve, without asking, what it sends first (deploying your Pot, an approval)",
};

const HELP: FlagSpecs = {
  help: { type: "boolean", short: "h", help: "Show this help" },
  "no-update-check": {
    type: "boolean",
    help: "No notice of a newer sauce, and no registry read for one",
  },
};

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
  "source-dir": {
    type: "string",
    value: "<dir>",
    help: "Resolve the program's relative imports here (default: beside it; from stdin, .)",
  },
};

/** Where the Pots a command deploys are recorded (`pot-store.ts`). */
const POTS: FlagSpecs = {
  pots: {
    type: "string",
    value: "<dir>",
    help: "The Pot store, where the Pots you deploy are recorded (default: ~/.sauce/pots)",
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
    help: "An account main takes, by name: an address, pot, owner, self, system (the System Program), pot:USDC (the Pot's USDC account), @to:USDC (main's argument to's), mint:USDC, program:USDC (its token program), slot:@pool:USDC.vaultA (a pool's account) or pda:<program>:<seeds>. The accounts the token methods and venue namespaces add, and those a program writes where it uses them (Solana.pda(…)), are derived without it",
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

/** `sauce tx --fund`: what the owner moves into the Pot, as the plan's own transactions. */
const TX_FUND: FlagSpecs = {
  fund: {
    type: "string",
    multiple: true,
    value: "<TOKEN:amount>",
    help: "Transfer tokens from the owner into the Pot before the cook: USDC:1.5 (whole tokens); ETH:0.01 rides as its value",
    only: "evm",
  },
};

/** Never parsed as a flag: the words after it that are not flags are main's arguments
 *  (`splitArgv`). */
const ARGS: FlagSpecs = {
  args: {
    type: "boolean",
    value: "<value>…",
    help: "main's arguments in order: an integer as digits, negative too (-5), JSON for an array or tuple; -- before a word like a flag",
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

/** `sauce sign`'s own: what the owner signs beside the program, and `--cancel`. */
const SIGN: FlagSpecs = {
  value: {
    type: "string",
    value: "<wei>",
    help: "What the submitter sends with the cook, signed exactly (default 0)",
  },
  "max-fee": {
    type: "string",
    value: "<wei>",
    help: "The most of the Kitchen's fee the Pot pays, signed (default: the fee read now)",
  },
  nonce: { type: "string", value: "<n>", help: "The nonce it runs once under (default: random)" },
  within: {
    type: "string",
    value: "<seconds>",
    help: "How long it can be submitted, from now: the chain's latest block (default 3600)",
  },
  deadline: {
    type: "string",
    value: "<unix seconds>",
    help: "Or the last second it can be submitted, exactly (inclusive)",
  },
  submitter: {
    type: "string",
    value: "<address>",
    help: "The only account that may submit it (default: anyone)",
  },
  signature: {
    type: "string",
    multiple: true,
    value: "<hex>",
    help: "The owner's signature of the typed data, made elsewhere: checked, then the cook built",
  },
  cancel: {
    type: "string",
    multiple: true,
    value: "<nonce>",
    help: "Instead, cancel this nonce (repeatable): invalidateNonces on the Pot, from its owner",
  },
};

/** The EVM signers, which `sauce sign` signs as the Pot's owner with. */
const EVM_SIGNER: FlagSpecs = {
  wallet: {
    type: "string",
    value: "<name>",
    help: "Sign as the Pot's owner with an EVM wallet of the wallet directory (sauce wallet)",
  },
  ...WALLETS,
  ...PASSWORD,
  keystore: {
    type: "string",
    value: "<path>",
    help: "Or with a JSON keystore (v3), with a password source",
  },
  "private-key": {
    type: "string",
    value: "<hex>",
    help: "Or with a raw key (lands in shell history)",
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
 * `--chain` nor its header says. `gate` names a command that builds or sends a transaction, refused
 * on a preview chain (`support.ts`) before it reaches a network or a key.
 */
async function programInput(
  args: ParsedArgs,
  io: CliIo,
  operand: string | ProgramText = fileOperand(args),
  fallback?: CanonicalChain,
  gate?: string,
): Promise<ProgramInput> {
  const { file, text, stdin } = programText(io, operand);
  const sourceDir = stringFlag(args, "source-dir");
  const chain = chainOf(args, file, text, fallback);
  if (gate !== undefined) requireSupported(gate, [chain]);
  const definesFile = stringFlag(args, "defines");
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

  return {
    file,
    text,
    ...(addresses.length === 0 ? {} : { addressDefines: addresses }),
    ...(stdin ? { stdin } : {}),
    ...(sourceDir === undefined ? {} : { sourceDir }),
    chain,
    defines,
  };
}

/**
 * A compiling command's operand: a SauceScript file, or an actions document (a JSON object with
 * `actions`), which `actions.ts` lowers into the same `ProgramInput` — so its compile, cook, Pot,
 * arguments and funding are every program's.
 */
async function programOperand(args: ParsedArgs, io: CliIo, gate?: string): Promise<ProgramInput> {
  // Read once, from the file or stdin (`-`), then told apart.
  const operand = programText(io, fileOperand(args));
  if (!isActionsDocument(operand.text)) return programInput(args, io, operand, undefined, gate);
  const program = await actionsProgram(actionsOperand(args, operand.file, operand.text));
  if (gate !== undefined) requireSupported(gate, [program.chain]);

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
 * Who approves what a run sends before its cook: `--yes` (or its older name, `--auto-approve`),
 * which says so for each action it approves, or the person at the terminal (`io.confirm`). With
 * `--json` nothing is asked: its output is for a program, which no question reaches.
 */
function approverOf(args: ParsedArgs, io: CliIo): Approver {
  const auto = args.values.yes === true || args.values["auto-approve"] === true;
  const json = args.values.json === true;

  return {
    auto,
    canAsk: auto || (!json && io.canAsk()),
    ...(json ? { why: "--json asks nothing" } : {}),
    approve: async (action, question) => {
      if (auto) {
        io.stderr(`auto-approved: ${action}\n`);

        return true;
      }

      return json ? undefined : io.confirm(question);
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

/** A cursor from a file: the cursor itself, or the JSON a step was printed as (its `cursor`, or its
 *  `next.cursor`). */
function cursorOf(text: string, flag = "--cursor"): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  let json: { cursor?: unknown; next?: { cursor?: unknown } | null } | null;
  try {
    json = JSON.parse(trimmed) as typeof json;
  } catch {
    throw new UsageError(
      `${flag} @file: the file holds no JSON that parses: give the cursor alone, or the JSON a ` +
        "step was printed as",
    );
  }
  const found = json?.next?.cursor ?? json?.cursor;
  if (typeof found === "string") return found;
  throw new UsageError(`${flag} @file: the file holds JSON with no cursor (nor next.cursor)`);
}

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
  /** It prints transactions unsigned: its JSON carries what a wallet's own tool takes
   *  (`handoff.ts`). */
  readonly unsigned?: true;
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
    `${what} only on a supported chain: ${supportedChainNames()}. On ` +
      "any other (a preview chain) it is refused before anything is read or signed, with the " +
      "supported chains and the GitHub issue to ask for that chain with; compile and the reads " +
      "work there, and simulate runs wherever the release is deployed on the chain.",
  ),
];

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

/** The Pot store: `--pots`, else the one `io` names (the executable's `~/.sauce/pots`). */
function potStoreOf(args: ParsedArgs, io: CliIo): PotStore {
  const dir = stringFlag(args, "pots") ?? io.potsDir;
  if (dir === undefined) throw new UsageError("missing --pots <dir>: the Pot store");

  return new PotStore(dir);
}

const POT_VERBS: Readonly<Record<string, Command>> = {
  list: {
    usage: "sauce pot list [--chain <slug|id>] [--owner <address>] [--pots <dir>] [--json]",
    summary: "List the Pots you deployed or imported, each with the release it was minted under",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "Only the Pots on this chain" },
      owner: { type: "string", value: "<address>", help: "Only this owner's Pots" },
      ...POTS,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Lists the Pot store (--pots, default ~/.sauce/pots): every Pot a command on this machine",
      "deployed, and every Pot `sauce pot import` recorded. Each with its chain, address, kind",
      "(private, private-fixed-router or shared), owner and salt; the Kitchen and the release it",
      "was minted under: the compiler whose programs it runs, and the engine and Kitchen",
      "versions, with the engine's address; and the transaction that deployed it. It reads no",
      "chain: what a Pot holds, and whether it is still there, `sauce pot --rpc-url` reads.",
      "",
      "Examples:",
      "  sauce pot list",
      "  sauce pot list --chain base --owner 0x… --json",
    ].join("\n"),
    run: (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const chainFlag = stringFlag(args, "chain");
      const chain = chainFlag === undefined ? undefined : parseChain(chainFlag);
      const owner = stringFlag(args, "owner");

      return potListCommand(potStoreOf(args, io), {
        ...(chain === undefined ? {} : { chain }),
        ...(owner === undefined ? {} : { owner: potOwner(chain, owner) }),
      });
    },
  },
  import: {
    usage: [
      "sauce pot import --chain <slug|id> --pot <address> [options]",
      "sauce pot import --chain <slug|id> --owner <address> [--salt <label> | --salt-hex <bytes32>] [options]",
    ],
    summary: "Record a Pot deployed elsewhere, read from the chain with the release that minted it",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain the Pot is on" },
      pot: { type: "string", value: "<address>", help: "The Pot, by address", only: "evm" },
      owner: {
        type: "string",
        value: "<address>",
        help: "Or its owner, with the salt (default 0): every release's Pot of theirs there",
      },
      ...SALT,
      ...ENDPOINT,
      ...POTS,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Records in the Pot store (--pots, default ~/.sauce/pots) a Pot this machine did not",
      "deploy: one deployed from another machine, through another wallet, or before the store",
      "existed. It reads the chain, and records only what it finds there.",
      "",
      "With --pot, the Pot is read for its owner, salt and Kitchen, and its release told from its",
      "address: the one whose Kitchen and Pot init-code hash give that address for that owner and",
      "salt, for each kind of Pot. An address no release this sauce knows mints is refused. With",
      "--owner (and --salt or --salt-hex; default zero), every release's Pot of that owner and",
      "salt that has code is recorded. A Solana Pot holds nothing that names its owner, so there",
      "it is found by --owner and its salt: the Kitchen's account for them, and its engine the",
      "program that owns it. A Pot already recorded keeps its record.",
      "",
      "Examples:",
      "  sauce pot import --chain base --pot 0x…",
      "  sauce pot import --chain base --owner 0x… --salt treasury",
      "  sauce pot import --chain solana --owner <pubkey>",
    ].join("\n"),
    run: (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const chain = potChain(args);
      const target = potImportTarget(chain, {
        pot: stringFlag(args, "pot"),
        owner: stringFlag(args, "owner"),
        salt: stringFlag(args, "salt"),
        saltHex: stringFlag(args, "salt-hex"),
      });

      return potImportCommand({
        store: potStoreOf(args, io),
        chain,
        rpcUrl: requiredEndpoint(args, io, chain),
        ...target,
      });
    },
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
        help: "Solana: an account main takes (an address, pot, owner, self, pot:USDC, @to:USDC, mint:USDC, program:USDC), to size the cook",
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
      "zero-import @sauce/token functions and SafeERC20 token writes (USDC.transfer,",
      "Token(addr).approve) all resolve against it, so one file compiles for any chain whose",
      "names it uses. Relative imports are read from beside",
      "the file. A file may name its chain in a leading `// @chain base` line. An actions",
      "document compiles too (`sauce actions`).",
      "",
      "--json also says what the compile applied and how large the result is:",
      "  defines    each name the chain gave the file (a token symbol, a protocol contract, the",
      "             chain id) and each low-level --define it read, with its value and source",
      "  contracts  each protocol contract it calls or reads (UniswapV3.Factory), resolved on its",
      "             chain",
      "  size       the program's bytes; payload: the program with main's arguments (--args)",
      "  cook       on Solana, the cook's transaction against the 1232-byte limit, measured",
      "             with --account where given and a distinct account for each other slot, as",
      "             the Kitchen's cook or, --via engine, the engine's direct one",
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
    usage: "sauce actions <file | -> [--chain <slug|id>] [--json]",
    summary: "Lower an actions document to SauceScript for a chain; print the source and bytecode",
    flags: {
      chain: {
        type: "string",
        value: "<slug|id>",
        help: "The chain to compile for (default: the document's chainId)",
      },
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
    summary: "Simulate the cook from the Pot's owner, with no key: what it did, or why it reverts",
    flags: {
      ...PROGRAM,
      ...COOK,
      ...ENDPOINT,
      "assume-balance": {
        type: "string",
        multiple: true,
        value: "<TOKEN:amount>",
        help: "Give the Pot this balance, in whole tokens, for the simulation only: USDC:2, ETH:0.1",
      },
      block: {
        type: "string",
        value: "<number|tag>",
        help: "Simulate on this block: a number, or latest, safe, finalized (default: latest)",
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
      "Compiles the file, builds the cook and simulates it from the Pot's owner: no key, no",
      "transaction, no local node. Prints the gas, what the program returns and what the cook",
      "did, or the decoded reason it reverts (exit 1).",
      "",
      "It simulates through eth_simulateV1, which returns the cook's logs: the output lists the",
      "ERC-20 transfers and approvals (registry symbols, whole units), the native transfers the",
      "node traces, and each address's net change. An endpoint without eth_simulateV1 falls back",
      "to eth_call with state overrides, which gives the result and the gas but no logs. The",
      "output names the route it took.",
      "",
      "It runs where the release's engine and Kitchen are deployed on the chain, preview chain",
      "or not; where they are not, it stops with exit 1, naming the contract that is missing.",
      "",
      "A Pot that is not deployed yet is deployed in the simulation first, from --owner (and",
      "--salt): any account may send Kitchen.deployPot, and the Pot is the owner's either way.",
      "An owner holding less than the cook's value is given it for the simulation.",
      "",
      "--assume-balance TOKEN:amount gives the Pot that balance for this simulation only, by state",
      "override: repeatable, the amount as --fund takes it, ETH:<amount> for the native currency.",
      "Where a token keeps the balance is found by asking it, with eth_call; a token that stores",
      "no balance it reports (rebasing, shares) is refused.",
      "",
      "With --fund and the owner's key (--keystore or --private-key), the simulation includes the",
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
      "same transaction. --via engine simulates the engine's own paid cook instead: no Kitchen and",
      "no Pot (so no pot or pot:<token> account), --owner signing as the program's authority and",
      "paying the fee. Either way the cook pays the Kitchen's execution fee, read from the cluster",
      "and printed; --max-execution-fee refuses one above it. Prints the compute units and what the",
      "cook moved — each token account's balance change and each account's lamports, read from the",
      "accounts the transaction writes before it and as the simulation leaves them — or the reason",
      "(a program's revert message decoded) and the program logs. Solana's simulateTransaction",
      "takes no account overrides, so the owner must hold the Pot's rent and the fees there.",
      "A cook too large for one transaction, or one given --assume-balance, is simulated in a",
      "local copy instead, with LiteSVM, which the package does not bundle: your own copy at the",
      "version it pins, else the runtime folder its first use installs (sauce runtime). Every",
      "account the cook names is read from the cluster with its rent, the released engine and",
      "Kitchen loaded, the owner given the lamports the staging and the fees take (any address",
      "can simulate), the Pot created if missing, the program staged into a code buffer as",
      "`sauce run` stages it, then the cook, its accounts through a lookup table. There",
      "--assume-balance TOKEN:amount gives the account the cook spends that token from (the",
      "Pot's, or the owner's with --via engine) that balance, and a pot:<token> or owner:<token>",
      "account the cluster does not have yet is made empty, which `sauce run` creates before the",
      "cook. An --owner that is not a wallet is refused.",
      "",
      "A cook that reverts exits 1, and the first line says so: The cook reverts: <reason>. In",
      "--json, reverted: true and error lead the JSON, and the same line leads stderr.",
      "--expect-revert <text> holds a simulation of a guard to its revert: it exits 0 only when the",
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
      yes: YES,
      "auto-approve": {
        type: "boolean",
        help: "The same as --yes, its older name",
      },
      ...POTS,
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file, builds the cook on the signer's Pot (or --pot), simulates it, signs it,",
      "sends it and waits for the receipt: prints the hash, status and gas used, and the decoded",
      "reason when it reverts (exit 1). The signer is the owner. The value defaults to the",
      "Kitchen's execution fee, read from the chain.",
      "",
      "You never deploy the Pot as a step of your own: a run deploys it when it first needs it.",
      "What the run sends before its cook, each in a transaction of its own, it asks you to",
      "approve at the terminal first; -y (--yes, or --auto-approve) approves every one without",
      "asking, and says `auto-approved: <action>` for each. They are:",
      "  deploying your Pot, when it has no code yet (asked as `[deploy/cancel]`, with its gas)",
      "  approving Permit2 for a token --fund pulls, the first time (--fund-mode permit2)",
      "  approving the Pot for the amount --fund pulls (--fund-mode allowance)",
      "On Solana a missing Pot is created in the cook's own transaction, with nothing asked, when",
      "the two fit in one; else it is asked for like the rest. With no terminal to ask on (CI, a",
      "pipe, a program read from stdin with no terminal), or with --json, nothing is sent until",
      "they are approved: the run names every one it needs, and --yes, and stops.",
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
      const program = await programOperand(args, io, "sending the cook");
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
      const account = await signerOf(args, io);
      const input = cookInput(args, io, trailing, account.address, program);
      const rpcUrl = requiredEndpoint(args, io, input.chain);
      const fund = fundingOf(args, io, input.chain, rpcUrl, true, account);

      return runCommand(
        {
          ...input,
          ...(fund === undefined ? {} : { fund }),
          rpcUrl,
          endpointOf: (chain) => sharedEndpoint(args, io, chain),
          account,
          approver: approverOf(args, io),
        },
        io,
      );
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
      "local MCP server (sauce mcp) over stdio. It is a hot wallet: keep small balances in it.",
      "",
      "A policy limits what a wallet sends: <name>.policy.json beside it, every field optional and",
      'every amount a string in whole tokens ("100" is 100 USDC), or base units ending in n:',
      '  { "chains": ["base"], "to": ["0x…"],',
      '    "native": { "perTransaction": "0.01", "perDay": "0.05" },',
      '    "tokens": { "USDC": { "perTransaction": "100", "perDay": "500" } } }',
      "What a transaction moves out of the wallet (and the Pot it cooks on) is measured by",
      "simulating it, and a send that breaks a limit is refused, naming it; the last 24 hours are",
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
    unsigned: true,
    usage: [
      "sauce tx <file | -> --chain <slug|id> (--owner <address> | --pot <address>) [options]",
      "sauce tx <file | -> --chain solana --owner <pubkey> [--account NAME=<value>]… [options]",
    ],
    summary: "Print the unsigned cook transaction, for a wallet to sign",
    flags: { ...PROGRAM, ...COOK, ...TX_FUND, ...ENDPOINT, ...FORMAT, ...HELP, ...ARGS },
    details: [
      "Compiles the file and prints the transaction that runs it, unsigned, as JSON:",
      "{ chainId, to: the Pot, data: Pot.cook(engine, program ++ arguments), value }. The value",
      "is --value, or else the Kitchen's fee, read from the chain, which also checks the Pot.",
      "When the chain shows the Pot has no code yet, it prints the plan instead: { chainId, pot,",
      "transactions }, Kitchen.deployPot first (marked deploysPot; any account may send it), then",
      "the cook, to send in that order. `--format cast` prints each as a `cast send` line. What",
      "must be true for it to land goes to stderr: the Pot funded, and sent from its owner.",
      "Each transaction is what a wallet's send tool takes (value and gas hex), and sendCalls",
      "is all of them as one batch, for a wallet that sends a batch.",
      "",
      "--fund TOKEN:amount (whole tokens, or base units ending in n) plans the owner's transfer",
      "of each token into the Pot after its deployment and before the cook; ETH:<amount> rides",
      "as the cook's value. Sent as one batch, a smart wallet deploys, funds and cooks with one",
      "approval, or nothing happens.",
      "",
      "On Solana: { chain, via, feePayer, pot, fee, maxExecutionFee, createsPot, transaction },",
      "the Kitchen cook as a base64 transaction signed by no one, for --owner to sign — or, --via",
      "engine, the engine's own paid cook, with no Pot. A Pot not created yet is created by the",
      "same transaction, ahead of the cook (createsPot). It reads the cluster (for the blockhash",
      "and the fee), and the --account flags simulate takes; --max-execution-fee refuses a fee",
      "above it.",
      ...SUPPORTED_ONLY("Prints the transaction"),
      "",
      "Example:",
      "  sauce tx pay.sauce.ts --chain base --owner 0x…",
      "  sauce tx pay.sauce.ts --chain base --owner 0x… --value 0 --offline",
      "  sauce tx pay.sauce.ts --chain base --owner 0x… --fund USDC:100",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = await programOperand(args, io, "building the cook transaction");
      if (program.chain.kind === "svm") {
        return svmTxCommand(svmCookInput(args, io, trailing, program), io);
      }
      const input = cookInput(args, io, trailing, undefined, program);
      const rpcUrl = endpoint(args, io, input.chain);

      const fund = repeatedFlag(args, "fund");

      return txCommand(
        {
          ...input,
          ...(rpcUrl === undefined ? {} : { rpcUrl }),
          ...(fund.length === 0 ? {} : { transfers: fundTransfers(fund, input.chain) }),
          endpointOf: (chain) => sharedEndpoint(args, io, chain),
        },
        io,
      );
    },
  },
  sign: {
    unsigned: true,
    usage: [
      "sauce sign <file | -> --chain <slug|id> (--wallet <name> | --keystore <path> | --private-key <hex> | --owner <address> | --pot <address>) [--salt <label> | --salt-hex <bytes32>] [--within <seconds> | --deadline <unix seconds>] [--submitter <address>] [--max-fee <wei>] [--value <wei>] [--nonce <n>] [--signature <hex>] [--rpc-url <url> | --config <file> | --offline] [--json] [--args …]",
      "sauce sign --cancel <nonce> [--cancel <nonce>]… --chain <slug|id> (--wallet <name> | --keystore <path> | --private-key <hex> | --owner <address> | --pot <address>) [--rpc-url <url> | --config <file> | --offline] [--json]",
    ],
    summary: "Sign a cook on your Pot that anyone (or one account) may submit",
    flags: {
      ...PROGRAM,
      owner: {
        type: "string",
        value: "<address>",
        help: "The Pot's owner, which derives the Pot with the salt (default: the signer)",
      },
      pot: { type: "string", value: "<address>", help: "Or the Pot itself, by address" },
      ...SALT,
      "args-json": COOK["args-json"]!,
      ...SIGN,
      ...EVM_SIGNER,
      ...ENDPOINT,
      json: {
        type: "boolean",
        help: "Signing a cook prints its JSON either way; a sent --cancel prints JSON, not its receipt",
      },
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file with main's arguments, as tx does, and prints what the Pot's owner signs",
      "so that another account can submit the cook, with the Pot's own cookSigned: { chainId, pot,",
      "owner, engine, program, value, maxExecutionFee, nonce, deadline, submitter, typedData,",
      "digest, signature, cook, deployPot }. typedData is EIP-712 (eth_signTypedData_v4): Cook",
      "{ engine, program, value, maxExecutionFee, nonce, deadline, submitter } under the Pot's",
      "domain, for this chain alone. program is the bytecode with the arguments appended, all of",
      "it signed. Numbers are decimal strings.",
      "",
      "With a signer (the Pot's owner: --wallet, --keystore or --private-key) it signs, and cook",
      "is the transaction to submit, { chainId, to: the Pot, data: cookSigned(…), value }, as tx",
      "spells one. Without one it prints the typed data for any wallet to sign; given that",
      "signature with --signature, it checks it is the owner's (a contract wallet's through",
      "ERC-1271, with an endpoint) and builds cook. The submitter sends cook with exactly the",
      "signed value, and pays gas, nothing else: sign it with any wallet, or sauce send it signed.",
      "",
      "What is signed: --value (default 0); --max-fee, the most of the Kitchen's fee the Pot pays",
      "(default: the fee read now; with --offline, required); --nonce (default random, so two",
      "outstanding signatures never collide; one you allocate densely costs less gas); the",
      "deadline, --deadline or now plus --within (default 3600 seconds), now being the chain's",
      "latest block (else this clock); --submitter, the only account that may submit it (default",
      "anyone). The Pot pays the Kitchen's fee itself, from its balance and the cook's value: keep",
      "native coin in it. Whoever holds the signature may submit it until the deadline, once; a",
      "cook that reverts leaves its nonce unused, to be submitted again.",
      "",
      "With an endpoint it reads the Pot first. One with no code that --owner (or the signer) and",
      "the salt name still signs, and the result carries deployPot, Kitchen.deployPot, which any",
      "account sends first. A Pot minted before signed cooks (it has no cookSigned), a Shared Pot",
      "and a contract that is not a Pot are refused. It also reads the Kitchen's fee and the",
      "Pot's balance, and warns when they do not cover the fee. --offline reads nothing.",
      "",
      "--cancel <nonce> (repeatable) cancels instead: one invalidateNonces(word, mask) per nonce",
      "word, to the Pot, from its owner. With a signer and an endpoint they are sent; without a",
      "signer they are printed unsigned, for the owner to sign and sauce send.",
      "",
      "From a wallet with a policy (sauce wallet --help), the policy's chains and to (the Pot)",
      "apply, and a native or tokens limit refuses the signature: what a signed cook moves is",
      "known only when it is submitted, which a limit cannot measure now. On Solana there is no",
      "signed cook: the owner signs the cook transaction, and any fee payer may sponsor it.",
      ...SUPPORTED_ONLY("Signs and cancels"),
      "",
      "Examples:",
      "  sauce sign pay.sauce.ts --chain base --wallet agent --password-env SAUCE_WALLET_PASSWORD \\",
      "    --within 600 --args <recipient> 1000000",
      "  sauce sign pay.sauce.ts --chain base --owner <owner> --submitter <relayer> --args <recipient> 5",
      "  sauce sign pay.sauce.ts --chain base --owner <owner> --signature <hex> --args <recipient> 5",
      "  sauce sign --cancel <nonce> --chain base --keystore ~/.keys/me.json",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const cancel = repeatedFlag(args, "cancel");
      const signatures = repeatedFlag(args, "signature");
      if (signatures.length > 1) throw new UsageError("give one --signature");
      // A Solana wallet signs no EVM cook: refused by name, never read as no signer.
      const wallet = walletGiven(args, io);
      if (wallet !== undefined) evmAddressOf(wallet);
      if (cancel.length > 0) {
        if (args.positionals.length > 0) {
          throw new UsageError(
            `--cancel cancels nonces, and signs no program: leave out ${args.positionals[0]}`,
          );
        }
        const signing = [
          ...["args-json", "value", "max-fee", "nonce", "within", "deadline", "submitter"],
          ...["define", "defines", "source-dir", "target"],
        ].find((flag) => args.values[flag] !== undefined);
        if (signing !== undefined || signatures.length > 0 || trailing !== undefined) {
          throw new UsageError(
            `--${signing ?? (trailing === undefined ? "signature" : "args")} signs a cook, and ` +
              "--cancel signs none",
          );
        }
        const chain = parseChain(requiredFlag(args, "chain", "<slug|id>"));
        if (chain.kind !== "evm") throw new UsageError(SIGNED_COOKS_ARE_EVM);
        // Before any endpoint or key.
        requireSupported("cancelling signed cooks", [chain]);
        const signer = hasSigner(args, io) ? await signerOf(args, io) : undefined;
        const rpcUrl = endpoint(args, io, chain);

        return cancelCommand(
          {
            chain,
            target: potInput(args, signer?.address),
            nonces: cancel.map((nonce) => parseUint256("cancel", nonce)),
            ...(rpcUrl === undefined ? {} : { rpcUrl }),
          },
          signer,
        );
      }
      const program = await programOperand(args, io, "signing a cook");
      const [signature] = signatures;
      if (signature !== undefined && !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature)) {
        throw new UsageError(`--signature: '${signature.slice(0, 20)}…' is not 0x-prefixed hex`);
      }
      const submitter = stringFlag(args, "submitter");
      const rpcUrl = endpoint(args, io, program.chain);
      const signed = Object.fromEntries(
        (
          [
            ["max-fee", "maxExecutionFee"],
            ["nonce", "nonce"],
            ["deadline", "deadline"],
            ["within", "within"],
          ] as const
        ).flatMap(([flag, field]) => {
          const raw = stringFlag(args, flag);

          return raw === undefined ? [] : [[field, parseUint256(flag, raw)]];
        }),
      ) as { maxExecutionFee?: bigint; nonce?: bigint; deadline?: bigint; within?: bigint };
      const given = {
        chain: program.chain,
        ...signed,
        ...(submitter === undefined ? {} : { submitter: parseAddress("submitter", submitter) }),
        ...(signature === undefined ? {} : { signature: signature as `0x${string}` }),
        ...(rpcUrl === undefined ? {} : { rpcUrl }),
      };
      // Before any key is unlocked.
      refuseSignInput(given, hasSigner(args, io));
      const signer = hasSigner(args, io) ? await signerOf(args, io) : undefined;
      const input = cookInput(args, io, trailing, signer?.address, program);

      return signCommand({ ...input, ...given }, io, signer);
    },
  },
  send: {
    usage: [
      "sauce send <signed transaction>… [--chain <slug|id>] [options]",
      "sauce send [<signed transaction>…] --cursor <cursor | @file> [--signature <signature>]… [--close]",
    ],
    summary: "Broadcast transactions signed elsewhere, wait for them, and report what they did",
    flags: {
      chain: {
        type: "string",
        value: "<slug|id>",
        help: "The chain they are for (default: the transactions say)",
      },
      cursor: {
        type: "string",
        value: "<cursor | @file>",
        help: "Solana: the plan's cursor sauce tx (or the last send) gave; prints its next step",
      },
      signature: {
        type: "string",
        multiple: true,
        value: "<signature>",
        help: "Solana: a transaction of the plan you broadcast another way, to confirm",
      },
      close: {
        type: "boolean",
        help: "Solana, with --cursor: give up on the cook, and close the code buffer it staged",
      },
      ...ENDPOINT,
      ...POTS,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Sends transactions you signed with any signer — a hardware wallet, a KMS, another wallet's",
      "tool — and never takes a key. Each operand is one SIGNED transaction: on an EVM chain the",
      "raw 0x… hex a signer returns (its chain and sender are read from it); on Solana the base64",
      "wire transaction, every signature checked against its message. `-` reads them from stdin,",
      "separated by whitespace.",
      "",
      "They go out in the order given. Each is simulated as it was signed first — on an EVM chain",
      "an eth_call from its sender, its gas limit held to what that used; on Solana a simulation",
      "that checks the signatures — and one that would fail is not sent: the reason is printed",
      "(exit 1), and nothing after it is sent. Each is confirmed before the next is simulated, so",
      "a cook after its Pot's deployment runs on the Pot. Prints, for each, the hash (a Solana",
      "signature), status and what it cost, the explorer and trace pages, the decoded reason a",
      "failure gives, and for a cook what moved and what it left in the Pot; on Solana what main",
      "returned. A Solana transaction lands within about a minute of being built, or never: one",
      "whose blockhash has expired is refused, to build and sign again. One the chain already",
      "has is read back, not sent again; one it had, pending, then lost (dropped or reorged out)",
      "is reported gone, to sign anew. A Solana transaction missing a signature (its fee payer's,",
      "or any its message names) is refused by name.",
      "",
      "A Solana cook too large for one transaction is a plan of steps (sauce tx prints the first,",
      "and its cursor): the setup (the Pot, token accounts, the program staged in a code buffer, a",
      "lookup table), the cook, then closing the code buffer. With --cursor, after sending it",
      "prints the next step, built fresh from what the cluster shows, with the cursor for the one",
      "after: sign its transactions and send them with that cursor, until the step is done.",
      "Whatever did not land is built again, so a step whose blockhash expired comes back with",
      "only what is left. --cursor alone builds the next step without sending anything; a",
      "transaction you broadcast another way is confirmed with --signature, so the plan knows",
      "how its cook went. A step with nothing to sign says why in its wait (a cook handed out",
      "that can still land, or a lookup table in use only from the next slot): send the cursor",
      "alone again for it. A cook its simulation says would fail is not built: the step says",
      "why, with the logs, and the cursor alone, once what it needs is there, simulates it again.",
      "--close gives up on the cook and closes the code buffer. A cursor",
      "carries no key and no endpoint; @file reads it from a file, or from the JSON a step was",
      "printed as.",
      "",
      "What landed is kept as the other commands keep it: a Pot one deployed in the Pot store.",
      ...SUPPORTED_ONLY("Sends"),
      "",
      "Examples:",
      "  sauce send 0x02f8… 0x02f8…              (sauce tx's plan: the deployment, then the cook)",
      "  sauce send AQAB… --chain solana",
      "  sauce send AQAB… AQAB… --cursor @step.json --json > next.json",
    ].join("\n"),
    run: async (args, io) => {
      const given = args.positionals;
      const transactions =
        given.length === 1 && given[0] === "-"
          ? io
              .readStdin()
              .split(/\s+/)
              .filter((word) => word !== "")
          : given;
      if (transactions.includes("-")) {
        throw new UsageError("`-` reads every transaction from stdin, and comes alone");
      }
      const cursorFlag = stringFlag(args, "cursor");
      const cursor =
        cursorFlag === undefined
          ? undefined
          : cursorFlag.startsWith("@")
            ? cursorOf(readInput(io, cursorFlag.slice(1)))
            : cursorFlag;
      const signatures = repeatedFlag(args, "signature");
      const chainFlag = stringFlag(args, "chain");
      const input = { transactions, signatures, ...(cursor === undefined ? {} : { cursor }) };
      const chain = signedChain(input, chainFlag === undefined ? undefined : parseChain(chainFlag));
      // Before any endpoint is reached.
      requireSupported("sending", [chain]);

      return sendCommand({
        ...input,
        chain,
        rpcUrl: requiredEndpoint(args, io, chain),
        ...(args.values.close === true ? { close: true } : {}),
      });
    },
  },
  reclaim: {
    usage:
      "sauce reclaim --chain solana (--owner <pubkey> | --keypair <path> | --wallet <name>) [--lookup-table <address>]… [--keep <cursor | @file>]… [--keep-tables] [--yes]",
    summary: "List the code buffers and lookup tables a Solana owner left open, and close them",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain: solana" },
      owner: {
        type: "string",
        value: "<pubkey>",
        help: "Whose: with no key, the closing transactions come back unsigned",
      },
      "lookup-table": {
        type: "string",
        multiple: true,
        value: "<address>",
        help: "A lookup table to close (default: the owner's Sauce tables, scanned for)",
      },
      keep: {
        type: "string",
        multiple: true,
        value: "<cursor | @file>",
        help: "A plan still under way, by its cursor: its code buffer and lookup table stay open",
      },
      "keep-tables": {
        type: "boolean",
        help: "Close the code buffers only, and leave the lookup tables for later cooks",
      },
      wallet: SIGNER.wallet!,
      ...WALLETS,
      ...PASSWORD,
      keypair: SIGNER.keypair!,
      yes: YES,
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Lists what a Solana owner has open from its cooks, and the rent it holds: the Kitchen code",
      "buffers a staged program ran from (a run closes its own, unless closing it failed; a plan",
      "given up on, or never finished, leaves one), and the address lookup tables its accounts",
      "went through (a run keeps each for the next cook naming the same accounts). The tables are",
      "the owner's that hold the Kitchen's execution-fee config, which every Sauce cook's table",
      "holds; a table the owner made otherwise is left alone, and --lookup-table names tables",
      "outright, as some endpoints refuse to scan for them.",
      "",
      "A buffer closes in one transaction, its rent back at once. A table closes in two: it is",
      "deactivated now, and closed once its deactivation slot has left the cluster's recent slot",
      "hashes, 512 slots (about three and a half minutes) later: run the command again then. It",
      "serves cooks until then, and none after, so --keep-tables leaves them.",
      "",
      "Nothing in use is closed: a buffer or an active table a transaction named in the last 300",
      "slots (about two minutes) is left open, as a cook built for it may still land, and the",
      "listing says from which slot it can close. A plan you mean to carry on with, whose cook",
      "may be handed out later, is kept whole with --keep and its cursor.",
      "",
      "A run takes 32 code buffers and 24 lookup tables at most (the tables it can close or",
      "deactivate first), and says how many more are open: run it again once these are closed.",
      "",
      "With the owner's key (--keypair, or --wallet), it asks, then sends each transaction and",
      "prints it; --yes sends without asking. With --owner alone it prints the transactions",
      "unsigned, as JSON, for the owner to sign anywhere and send with sauce send.",
      ...SUPPORTED_ONLY("Closes"),
      "",
      "Examples:",
      "  sauce reclaim --chain solana --owner <pubkey>",
      "  sauce reclaim --chain solana --keypair ~/.config/solana/id.json --yes",
    ].join("\n"),
    run: async (args, io) => {
      const chain = parseChain(requiredFlag(args, "chain", "<slug|id>"));
      if (chain.kind !== "svm") {
        throw new UsageError(
          `sauce reclaim is Solana's: a cook on ${chain.slug} leaves no code buffer or lookup ` +
            "table open",
        );
      }
      const signer = hasSvmSigner(args, io) ? await keypairOf(args, io) : undefined;
      const ownerFlag = stringFlag(args, "owner");
      if (signer === undefined && ownerFlag === undefined) {
        throw new UsageError("missing --owner <pubkey>, or the owner's --keypair or --wallet");
      }
      const owner = svmOwner(args, signer?.address);
      // Before any endpoint is reached, when there is something to send.
      if (signer !== undefined) requireSupported("closing what Sauce left open", [chain]);
      const approver = approverOf(args, io);

      return reclaimCommand({
        owner,
        rpcUrl: requiredEndpoint(args, io, chain),
        lookupTables: repeatedFlag(args, "lookup-table").map((at) =>
          parsePubkey("lookup-table", at),
        ),
        ...(args.values["keep-tables"] === true ? { keepTables: true } : {}),
        keep: repeatedFlag(args, "keep").map((given) =>
          given.startsWith("@") ? cursorOf(readInput(io, given.slice(1)), "--keep") : given,
        ),
        ...(signer === undefined
          ? {}
          : {
              signer,
              approve: async (actions) => {
                if (!approver.auto && !approver.canAsk) throw unapproved(actions, approver.why);
                const agreed = await approver.approve(
                  actions.join("; "),
                  `${actions.join("; ")}: the rent comes back to ${owner}. Send? [y/N] `,
                );
                if (agreed !== true) {
                  throw new CliError(
                    "nothing was sent: run again and answer y, or pass --yes (-y)",
                  );
                }
              },
            }),
      });
    },
  },
  pot: {
    unsigned: true,
    usage: [
      "sauce pot --chain <slug|id> --owner <address> [--salt <label> | --salt-hex <bytes32>] [--deploy …]",
      "sauce pot <list | import> [options]",
    ],
    summary: "Predict a Pot's address, deploy it, and list the Pots you deployed",
    flags: {
      owner: { type: "string", value: "<address>", help: "Whose Pot: cook() is onlyOwner" },
      chain: { type: "string", value: "<slug|id>", help: "The chain the Pot is for" },
      ...SALT,
      deploy: { type: "boolean", help: "Send the deployment (needs an endpoint and a signer)" },
      ...ENDPOINT,
      ...SIGNER,
      ...POTS,
      yes: { ...YES, help: "Accepted, approving nothing: --deploy itself is the approval" },
      "auto-approve": {
        type: "boolean",
        help: "Accepted, approving nothing: --deploy itself is the approval",
      },
      ...FORMAT,
      ...HELP,
    },
    details: [
      "A Pot's address is CREATE2 from the released Kitchen over (owner, salt), so it is known",
      "before it exists. You need not deploy it yourself: sauce run deploys it when it first",
      "needs it (asking, or with -y), and sauce tx plans its deployment first. This does it by",
      "hand. Prints the address and the unsigned Kitchen.deployPot transaction as JSON; with",
      "--deploy, sends it unless the Pot is already there, and waits until the endpoint shows its",
      "code. The owner defaults to the signer. Deploying is permissionless: with --owner, the",
      "signer sends and pays for another owner's Pot, which is that owner's alone. The default",
      "salt is zero: the one Pot an owner has by default. With a signer and no --owner, it is the",
      "signer's own Pot, so `sauce pot --chain base --keystore <keystore>` prints your address and",
      "your Pot (the keystore's own address field is read, with no password, where it has one).",
      "Without --deploy it also reads",
      "the chain: whether the released engine and Kitchen are there, the Kitchen's fee, and",
      "whether the Pot is deployed and whose it is (under `deployment`, and on stderr).",
      "",
      "On Solana a Pot is the Kitchen's PDA over (owner, salt): this prints it and the create_pot",
      "instruction; --deploy (with --keypair) creates it. There the owner signs create_pot, so",
      "the signer is the owner.",
      "",
      "Every Pot a command deploys (this, a run that deploys its Pot first, sauce send) is",
      "recorded in the Pot store (--pots, default",
      "~/.sauce/pots) once the chain shows it deployed: its chain, owner, salt and kind, the",
      "Kitchen and the release it was minted under (the engine, and the compiler whose programs",
      "it runs), and the transaction that deployed it. sauce tx sends nothing, so it records",
      "nothing.",
      "",
      "Verbs (`sauce pot <verb> --help` for each):",
      ...Object.entries(POT_VERBS).map(
        ([verb, command]) => `  ${verb.padEnd(8)}  ${command.summary}`,
      ),
      ...SUPPORTED_ONLY("Deploys (or prints the deployment)"),
      "",
      "Examples:",
      "  sauce pot --owner 0x… --chain base",
      "  sauce pot --deploy --chain base --keystore ~/.keys/me.json --salt treasury",
      "  sauce pot --deploy --chain base --owner 0x… --keystore <keystore>",
      "  sauce pot --deploy --chain solana --keypair ~/.config/solana/id.json",
      "  sauce pot list --chain base",
    ].join("\n"),
    run: async (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(
          `unknown verb '${args.positionals[0]}': ${Object.keys(POT_VERBS).join(", ")}`,
        );
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
      "with --protocol, its methods), the chain names, the defines, and the",
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
    summary: "Turn a price into a pool's sqrtPriceX96 and a swap's limits, priceLimit included",
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
      "  priceLimit         input units paid per output unit bought, times 1e18, rounded down:",
      "                     the price times 10^(18 + input decimals - output decimals), the",
      "                     distributed swap's priceLimit, as sauce pools prints it",
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
      "sauce pools --chain solana <pay token> <buy token> [--pay <token> [--price-limit <n>] [--per-venue] [--slots <n>]] [--json]",
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
      "price-limit": {
        type: "string",
        value: "<n>",
        help: "With --pay: only pools whose price with the fee is within this priceLimit",
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
      "before and with the fee, the distributed swap's priceLimit at that price (pay base units per",
      "buy base unit times 1e18: the price times 10^(18 + pay decimals - buy decimals)), and about",
      "how much of the paid token, fee included, moves the price 1% against the taker, walked",
      "through the pool's ticks. Pools with no liquidity at their price are listed after them, as",
      "skipped. Then what was looked at.",
      "",
      "It reads the chain in five requests, each one eth_call for every read in it, all at one",
      "block, which it names: --block, or the latest when it starts. Pass that block to sauce",
      "simulate --block to run on the prices priceLimit was taken from.",
      "",
      "On Solana: every pool of the pair at each venue whose swap takes a price limit that stops",
      "it (Raydium CLMM, PancakeSwap CLMM, Byreal, Stabble CLMM, Orca Whirlpools, Cropper,",
      "DefiTuna, Crema, and Phoenix's markets), found with getProgramAccounts on each venue's",
      "program. For each: its fee, liquidity and price both ways with the fee and as a swap's",
      "priceLimit, how a program finds it by key (Orca.Whirlpool.pool(USDC, WSOL, 4)) where its",
      "venue finds pools by key, and its slot paying each token: the nine accounts a swap at it",
      "takes (program, pool, config, the two vaults, one more account its swap takes, three tick",
      "arrays), each unused one the System program. A pool the distributed swap skips is listed as",
      "skipped with why. A token is a symbol the chain registers (SOL for WSOL), or a mint. --pay",
      "chooses the pools a swap paying that token takes (within --price-limit, one a venue with",
      "--per-venue, --slots of them) and prints them in slot order for main's --args (the System",
      "program for a slot with none), and their slots as accounts. A venue it could not read leaves",
      "the listing partial: a note says which, and the command exits 1.",
      "",
      "Examples:",
      "  sauce pools --chain base USDC WETH",
      "  sauce pools --chain base USDC 0x… --json",
      "  sauce pools --chain base WETH USDC --v4-key 50:1",
      "  sauce pools --chain solana USDC WSOL --json",
      "  sauce pools --chain solana USDC WSOL --pay USDC --price-limit 119047619047619047 --per-venue --slots 5 --json",
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
        const priceLimit = stringFlag(args, "price-limit");
        const slots = stringFlag(args, "slots");
        if (
          pay === undefined &&
          (priceLimit !== undefined || slots !== undefined || args.values["per-venue"])
        )
          throw new UsageError(
            "--price-limit, --per-venue and --slots choose pools for --pay <token>",
          );
        if (priceLimit !== undefined && !/^\d+$/.test(priceLimit))
          throw new UsageError(
            `--price-limit ${priceLimit}: a whole number, a swap's priceLimit's units`,
          );
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
                  ...(priceLimit === undefined ? {} : { priceLimit: BigInt(priceLimit) }),
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
      "sauce inspect <hex | tx-hash | file | -> [--chain <slug|id>] [--source <file | ->] [options]",
    summary: "Take a cook, a Kitchen call, a program or a file apart",
    flags: {
      ...PROGRAM,
      source: {
        type: "string",
        value: "<file>",
        help: "The program a cook was compiled from: decode its arguments",
      },
      ...ENDPOINT,
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Reads what a SauceScript author wrote back out of bytes: a Pot.cook (its engine and its",
      "program), a Kitchen.deployPot (the Pot it makes), an ERC-20 call, or a bare program. A",
      "32-byte hash with --chain (or --rpc-url) is a transaction, fetched first. With --source, a",
      "cook's program is checked against that file's and the arguments after it are decoded",
      "against its main. A file operand is compiled and reported. No opcode listing: programs are",
      "reported by size and hash.",
      "",
      "Examples:",
      "  sauce inspect 0x… --chain base --source split.sauce.ts",
      "  sauce inspect 0x<tx hash> --chain base",
      "  sauce inspect buy.sauce.ts --chain base",
    ].join("\n"),
    run: async (args, io) => {
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
        const input = await programInput(
          args,
          io,
          piped === undefined ? fileOperand(args) : { file: STDIN, text: piped, stdin: true },
        );

        return inspectFile(input.file, compileProgram(input, io));
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
    summary: "Check that a payload or cook runs the audited settle program",
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
      "Takes a settle payload, Pot.cook calldata, or — with an --chain — a transaction hash, and",
      "checks the settle it carries with the SDK's validateSettleProgram: the program must hash",
      "to the current pin (or a --pin), and its arguments must be the one canonical encoding.",
      "Prints tokens, minOut and recipient. A cook must name the released engine (or an",
      "--engine). A rejection exits 1 with its code: the SDK's SettleFailureCode, or",
      "UNKNOWN_ENGINE.",
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
      "updated by the NEW sauce, and what changed is printed; and where the version replaced had",
      "its runtime packages installed (sauce runtime), the NEW sauce installs its own.",
      "",
      "The version comes from the npm registry, read when this command runs. --check reads it and",
      "installs nothing. Every other command says, on stderr, when its update check has seen a",
      "newer version (sauce --help says how), and suggests this command.",
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
  runtime: {
    usage: ["sauce runtime [status] [--json]", "sauce runtime install [--json]"],
    summary: "Install or check the packages sauce mcp and Solana simulations load",
    flags: { ...JSON_FLAG, ...HELP },
    details: [
      "Two commands load packages a library install of this package leaves out, being its",
      "optional peer dependencies: sauce mcp (the MCP SDK and zod) and a Solana simulation in a",
      "local copy (LiteSVM). Each takes your own copies, where the package resolves them at",
      "exactly the versions it pins; else this version's runtime folder, ~/.sauce/runtime/<version>,",
      "which the first use installs with npm ci from the lockfile the package ships (every package",
      "pinned with its integrity hash), into a temporary directory renamed into place. Other",
      "versions' folders go then, but the newest older one. sauce mcp setup and sauce update",
      "install it ahead of the first use.",
      "",
      "  status   Where each command's packages come from, and whether the folder is installed.",
      "  install  Installs the folder now, if it is not; npm reaches the registry your npm",
      "           configuration names.",
      "",
      "Examples:",
      "  sauce runtime",
      "  sauce runtime install",
    ].join("\n"),
    run: async (args, io) => {
      const [sub, ...rest] = args.positionals;
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);

      return runtimeCommand(sub, io.stderr);
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
      "sauce mcp [--config <file> | --offline] [--wallets <dir> | --no-wallets] [--pots <dir>] [--no-stores]",
      "sauce mcp (--password-env <NAME> | --password-file <path> | --password-command <command>) [--wallets <dir>] [--config <file>]",
      "sauce mcp --http <port> [--host <address>] [--allowed-host <name>]… [--config <file>]",
      "sauce mcp setup [--agent <agent>,…] [--dir <project>] [--config <file>] [--force]",
    ],
    summary: "Serve the commands and the agent skills to coding agents over MCP",
    flags: { ...MCP_FLAGS, ...HELP },
    details: [
      "The Sauce MCP server. Every server, over stdio or HTTP, has this command's building half",
      "as tools: sauce_chains, sauce_globals, sauce_price, sauce_pools, sauce_compile,",
      "sauce_actions, sauce_tx, sauce_signed_cook, sauce_pot, sauce_reclaim, sauce_simulate,",
      "sauce_inspect and sauce_verify; sauce_send, which broadcasts what the caller signed; the",
      "agent skills as tools (sauce_skills, sauce_skill, sauce_dev, sauce_install_skills) and as",
      "resources, at sauce://skills/<path>; and a prompt, sauce_write_program. Over stdio it also",
      "has the wallet tools and the",
      "store tools (below). No tool takes a key or a password: a transaction comes back unsigned,",
      "for the user's own wallet, or is sent from one of the server's own wallets.",
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
      "Over stdio it serves the wallets of the wallet directory (--wallets, default",
      "~/.sauce/wallets, the one sauce wallet uses; --no-wallets serves none): sauce_wallet_list",
      "and sauce_wallet_address read them with no password, and sauce_wallet_create,",
      "sauce_wallet_import, sauce_wallet_send and sauce_sign work once the wallets are enabled. A",
      "password source given here enables them, read once at start: the variable an MCP client's",
      "config passes from the agent's .env, a file, or a command. Without one, the agent enables",
      "them with sauce_wallet_enable, naming where the password comes from (a variable of the",
      "server's environment, which the server then reads, a file only you can read, an entry of",
      "such a .env file, or a new random one it writes to a file), never the password itself and",
      "never a command. No tool takes or returns a password or a key. sauce_wallet_send simulates",
      "what it is given and holds it to the wallet's policy (sauce wallet --help) before it sends,",
      "and sauce_sign holds a signed cook to it as sauce sign does.",
      "The HTTP server never signs: --wallets and the password flags are refused there, and it",
      "has no wallet tools.",
      "",
      "Over stdio it keeps this command's stores as the command does, in the same directories,",
      "for an agent that reaches Sauce only through it: every Pot a tool's transaction deploys",
      "(sauce_send, sauce_wallet_send) is recorded in the Pot store (--pots, default",
      "~/.sauce/pots), which sauce_pot_list and sauce_pot_import read and write, as sauce pot list",
      "and sauce pot import do. The wallet directory",
      "is one of those stores: --no-stores keeps none, and serves no wallet tool. Over HTTP it",
      "keeps nothing, and has none of those tools.",
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
      "The server's packages, the MCP SDK and zod, are the package's optional peer dependencies:",
      "your own copies at the versions pinned, else this version's runtime folder (sauce runtime),",
      "which the first start installs, and setup ahead of it. --offline installs nothing, and",
      "reads a chain only through a caller's rpcUrl.",
      "",
      "Examples:",
      "  sauce mcp",
      "  sauce mcp --password-env SAUCE_WALLET_PASSWORD",
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
    ? JSON.stringify(command.unsigned === true ? handoff(output.json) : output.json, null, 2)
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
    "       sauce --version (-v)",
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
    "After a command, one line on stderr says when a newer sauce is published, suggesting `sauce",
    "update`. It comes from a cache (~/.sauce/update-check.json) that is refreshed from the npm",
    "registry once a day, in the background, never delaying a command. It is off with --offline,",
    "with --no-update-check (any command takes it, before the command too), and for a command",
    'whose --config file says "updateCheck": false.',
    "",
    ...wrapped(previewChainsNote()),
    "",
    "A program file may be `-`, read from stdin (`cat pay.sauce.ts | sauce compile - --chain",
    "base`); it is never read without one. Its relative imports then resolve against the",
    "current directory, or --source-dir. Questions go to the terminal (/dev/tty) instead of",
    "stdin; with no terminal, or with --json, a run names what it needs approved (deploying your",
    "Pot first, say) and sends nothing until -y (--yes) and a password source for a wallet or",
    "keystore are given.",
    "",
  ].join("\n");
}

/** Every command by the words that name it: `compile`, `run`, …, and `wallet <verb>` for each of
 *  the wallet verbs. */
const ALL_COMMANDS: ReadonlyArray<readonly [string, Command]> = [
  ...Object.entries(COMMANDS),
  ...Object.entries(WALLET_VERBS).map(([verb, command]) => [`wallet ${verb}`, command] as const),
  ...Object.entries(POT_VERBS).map(([verb, command]) => [`pot ${verb}`, command] as const),
];

/** The commands that take verbs, and their verbs. */
const VERBS: Readonly<Record<string, Readonly<Record<string, Command>>>> = {
  wallet: WALLET_VERBS,
  pot: POT_VERBS,
};

/** The command `words` name — `wallet new` for `wallet new …` — with the words after it. */
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

/** Why `flag`, which another command takes, is not one of `name`'s (`wallet new`, say). */
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
          : flag === "auto-approve" || flag === "yes"
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

/** The commands that print no update notice: `sauce update` is the update, and `sauce mcp` puts it
 *  in its first tool result instead (`mcp.ts`), its stdout being the protocol's over stdio. */
const NO_NOTICE = new Set(["update", "mcp"]);

/** What asks for the package's version in place of a command: the spellings other CLIs teach. */
const VERSION_WORDS = new Set(["--version", "-v", "-V", "version"]);

/** The update check's notice, on stderr after what the command printed (`update-check.ts`). */
function printNotice(io: CliIo, check: UpdateCheck | undefined): void {
  const latest = check?.latest();
  if (latest !== undefined) io.stderr(`${updateNotice(check!.version, latest)}\n`);
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
  // `--no-update-check` may come before the command too, so a shell alias can carry it.
  let lead = 0;
  while (argv[lead] === "--no-update-check") lead++;
  const words = argv.slice(lead);
  const [name, ...rest] = words;
  if (name === undefined) {
    io.stderr(mainHelp());

    return 2;
  }
  if (name === "--help" || name === "-h") {
    io.stdout(mainHelp());

    return 0;
  }
  if (VERSION_WORDS.has(name)) {
    const { name: pkg, version } = packageInfo();
    io.stdout(`${pkg} ${version}\n`);
    printNotice(io, lead === 0 && !rest.includes("--no-update-check") ? io.updateCheck : undefined);

    return 0;
  }
  const named = commandOf(name === "help" ? rest : words);
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
  let check: UpdateCheck | undefined;

  try {
    const { flags, trailing } = splitArgv(named.rest, command);
    const args = parseFlags(flags, ANY_FLAG);
    if (lead === 0 && !NO_NOTICE.has(label) && !updateCheckOff(args.values, io.readText)) {
      check = io.updateCheck;
    }
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
    // What the command's transactions do is kept as each lands (`keep.ts`): every Pot one
    // deploys. `sauce mcp` keeps its own, a tool call at a time, over stdio only.
    const potsDir = label === "mcp" ? undefined : (stringFlag(args, "pots") ?? io.potsDir);
    const stores: LocalStores = potsDir === undefined ? {} : { pots: new PotStore(potsDir) };
    const run = async () => command.run(args, io, trailing);
    const output = await (keepsAny(stores)
      ? keeping({ stores, say: (line) => io.stderr(`${line}\n`) }, run)
      : run());
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
  } finally {
    // Whatever the command's exit: from the cache, and never waiting on its refresh.
    printNotice(io, check);
  }
}
