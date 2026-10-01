/**
 * The `sauce` command: compile SauceScript exactly as the SDK does, and run it — simulate the cook,
 * sign and send it, deploy the Pot it runs on — or print the unsigned transaction for a wallet;
 * and set a project up to do all of that. `main.ts` is the executable; this is everything it does,
 * over an injected {@link CliIo} so the tests drive it without a child process.
 *
 * NODE-ONLY, and reached by nothing browser-facing: it is the package's `bin`, not an `exports`
 * entry, and no barrel imports it. It reads no environment. The network is reached only through
 * `--rpc-url` or a `--config` file named on the command line, and a key only through `--keystore`
 * or `--private-key` — and every byte printed passes through `signer.ts#scrub` on the way out.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import {
  CliError,
  describeFlags,
  parseAddress,
  parseChain,
  parseDefines,
  parseDefinesFile,
  parseFlags,
  parseHeader,
  parseSalt,
  parseTarget,
  parseUnixSeconds,
  parseWei,
  repeatedFlag,
  requiredFlag,
  stringFlag,
  UsageError,
  type FlagSpecs,
  type ParsedArgs,
} from "./args.js";
import { blankLiterals } from "../routes/rs-compile.js";
import { wrapSauceBody } from "../routes/sauce-route.js";
import { chainServedBy, endpointFor } from "./chain.js";
import {
  compileCommand,
  compileProgram,
  potCommand,
  potDeployCommand,
  readInput,
  runCommand,
  simulateCommand,
  txCommand,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type Confirm,
  type CookInput,
  type PotInput,
  type ProgramInput,
} from "./commands.js";
import { globalsCommand } from "./globals.js";
import { initProject } from "./init.js";
import { inspectCommand, inspectFile } from "./inspect.js";
import { publishCommand } from "./publish.js";
import { parsePin, verifyCommand } from "./verify.js";
import {
  loadKeypair,
  parseAccounts,
  parsePubkey,
  svmPotCommand,
  svmPotDeployCommand,
  svmRunCommand,
  svmSimulateCommand,
  svmTxCommand,
  svmVerifyCommand,
  type SvmCookInput,
} from "./solana.js";
import type { Address as SvmAddress, KeyPairSigner } from "@solana/kit";
import { loadSigner, scrub, secret } from "./signer.js";
import {
  AGENTS,
  describeStatus,
  detectAgents,
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
}

/** A yes/no answer typed at the terminal, or `undefined` with no terminal to type it at. */
function confirm(question: string): Promise<boolean | undefined> {
  if (!process.stdin.isTTY) return Promise.resolve(undefined);
  const prompt = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(/^\s*y(?:es)?\s*$/i.test(answer));
    });
  });
}

/** A password typed at the terminal, echoing nothing. */
function promptPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(
      new UsageError(
        "no terminal to ask for the keystore password on: pass --password-file <path>",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          finish();
          resolve(typed);

          return;
        }
        if (ch === "\u0003") {
          finish();
          reject(new CliError("cancelled"));

          return;
        }
        typed = ch === "\u007f" || ch === "\b" ? typed.slice(0, -1) : typed + ch;
      }
    };
    process.stderr.write(prompt);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** The real process's streams, filesystem, children and terminal. */
export function nodeIo(): CliIo {
  return {
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
    promptPassword,
    confirm,
  };
}

/** This package's name and version, from the manifest three levels above `sdk/{src,dist}/cli`. */
function packageInfo(): { name: string; version: string } {
  const manifest = new URL("../../../package.json", import.meta.url);

  return JSON.parse(readFileSync(manifest, "utf8")) as { name: string; version: string };
}

const skillsSource = (): SkillsSource => {
  const { name, version } = packageInfo();

  return { dir: PACKAGED_SKILLS, packageName: name, version };
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
    help: "A value the program reads by name: integer, 0x hex, true, false",
  },
  defines: {
    type: "string",
    value: "<file.json>",
    help: "Defines from a JSON object of NAME to value; --define wins",
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
  "intent-execution-fee": {
    type: "string",
    value: "<wei>",
    help: "…the destination Kitchen's fee, when one runs a program",
  },
  "compact-args": {
    type: "boolean",
    help: "Take main's arguments as compact-v1, not ABI-v1",
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
  pot: { type: "string", value: "<address>", help: "The Pot to cook on" },
  owner: {
    type: "string",
    value: "<address>",
    help: "…or its owner, deriving the Pot (default salt 0)",
  },
  ...SALT,
  value: {
    type: "string",
    value: "<wei>",
    help: "Kitchen fee plus native spent (default: read the fee)",
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
    help: "Solana: an account main takes, by name (an address, pot or owner)",
  },
};

const ENDPOINT: FlagSpecs = {
  "rpc-url": { type: "string", value: "<url>", help: "The chain's RPC endpoint" },
  config: {
    type: "string",
    value: "<file>",
    help: 'Or a file of { "rpcUrls": { "<chain id>": "<url>" } }',
  },
};

const SIGNER: FlagSpecs = {
  keystore: { type: "string", value: "<path>", help: "Sign with a JSON keystore (v3)" },
  "password-file": {
    type: "string",
    value: "<path>",
    help: "Its password, read from a file (else asked for)",
  },
  "private-key": {
    type: "string",
    value: "<hex>",
    help: "Or sign with a raw key (lands in shell history)",
  },
  keypair: {
    type: "string",
    value: "<path>",
    help: "Solana: sign with a keypair file (a JSON array of 64 bytes)",
  },
};

/** Never parsed as a flag: everything after it is main's arguments (see `runCli`). */
const ARGS: FlagSpecs = {
  args: {
    type: "boolean",
    value: "<value>…",
    help: "Last: main's arguments in order (JSON for an array or tuple)",
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
  if (file === undefined) throw new UsageError("missing <file>: the SauceScript program");
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <file>`);

  return file;
}

/** The one chain of kind svm, which `--target svm` alone names. */
const svmChain = (): CanonicalChain => CANONICAL_CHAINS.find((chain) => chain.kind === "svm")!;

/**
 * The chain a program runs on: `--chain`, else the file's `// @chain`, else — for `--target svm`
 * or `// @target svm` alone — the one SVM chain. A target that disagrees with the chain is an
 * error, wherever either came from.
 */
function chainOf(
  args: ParsedArgs,
  file: string,
  text: string,
  fallback?: CanonicalChain,
): CanonicalChain {
  const header = parseHeader(text, file);
  const chainFlag = stringFlag(args, "chain");
  const targetFlag = stringFlag(args, "target");
  const targetFrom = targetFlag !== undefined ? "--target" : `${file}'s // @target`;
  const targetRaw = targetFlag ?? header.target;
  const target = targetRaw === undefined ? undefined : parseTarget(targetRaw, targetFrom);
  const chain =
    chainFlag !== undefined
      ? parseChain(chainFlag)
      : header.chain !== undefined
        ? parseChain(header.chain, `${file}'s // @chain`)
        : target === "svm"
          ? svmChain()
          : fallback;
  if (chain === undefined) {
    throw new UsageError(
      "missing --chain <slug|id>: which chain the program runs on (or head the file with a " +
        "`// @chain <slug>` line)",
    );
  }
  if (target !== undefined && target !== chain.kind) {
    throw new UsageError(
      `${targetFrom} ${target} does not match ${chain.slug}, an ${chain.kind.toUpperCase()} chain`,
    );
  }

  return chain;
}

/**
 * Refuses a define the program would never see. A file with no `function main` is a script: its
 * top-level statements are the entry's body, so a `const` there is the script's own local, and a
 * define of the same name — which replaces a MODULE-level const — would be silently ignored.
 */
function definesReach(file: string, text: string, names: readonly string[]): void {
  if (wrapSauceBody(text) === text) return;
  const code = blankLiterals(text);
  for (const name of names) {
    if (new RegExp(`(^|[^.\\w$])(?:const|let)\\s+${name.replace(/\$/g, "\\$")}\\b`).test(code)) {
      throw new UsageError(
        `--define ${name} would not reach ${file}: with no \`function main\`, its top-level ` +
          `\`const ${name}\` is the script's own, which a define does not replace. Drop the ` +
          `declaration and read ${name} as a define, or declare function main() and keep the ` +
          "const beside it, where a define replaces it.",
      );
    }
  }
}

/** A program operand's input; `fallback` is its chain when neither `--chain` nor its header says. */
function programInput(
  args: ParsedArgs,
  io: CliIo,
  file = fileOperand(args),
  fallback?: CanonicalChain,
): ProgramInput {
  const text = readInput(io, file);
  const definesFile = stringFlag(args, "defines");
  const deadline = stringFlag(args, "intent-deadline");
  const creator = stringFlag(args, "intent-creator");
  const fee = stringFlag(args, "intent-execution-fee");
  const defines = {
    ...(definesFile === undefined ? {} : parseDefinesFile(readInput(io, definesFile), definesFile)),
    ...parseDefines(repeatedFlag(args, "define")),
  };
  definesReach(file, text, Object.keys(defines));

  return {
    file,
    text,
    chain: chainOf(args, file, text, fallback),
    compactArgs: args.values["compact-args"] === true,
    defines,
    intents: {
      ...(deadline === undefined
        ? {}
        : { deadline: parseUnixSeconds("intent-deadline", deadline) }),
      ...(creator === undefined ? {} : { creator: parseAddress("intent-creator", creator) }),
      ...(fee === undefined ? {} : { executionFee: parseWei("intent-execution-fee", fee) }),
    },
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

/** The salt `--salt`/`--salt-hex` choose (zero when neither). */
const saltOf = (args: ParsedArgs) =>
  parseSalt(stringFlag(args, "salt"), stringFlag(args, "salt-hex"));

/**
 * The Pot a cook runs on: `--pot`, or derived from `--owner` — or, when `signer` is given (a run),
 * from the signer, whose Pot it must be anyway.
 */
function potInput(args: ParsedArgs, signer?: `0x${string}`): PotInput {
  const pot = stringFlag(args, "pot");
  const owner = stringFlag(args, "owner");
  if (pot !== undefined && owner !== undefined) {
    throw new UsageError("give --pot or --owner, not both");
  }
  if (pot !== undefined) {
    if (stringFlag(args, "salt") !== undefined || stringFlag(args, "salt-hex") !== undefined) {
      throw new UsageError("--salt and --salt-hex go with --owner: --pot names the Pot itself");
    }

    return { pot: parseAddress("pot", pot) };
  }
  if (owner === undefined && signer === undefined) {
    throw new UsageError("missing --pot <address> or --owner <address>: the Pot to cook on");
  }

  return { owner: owner === undefined ? signer! : parseAddress("owner", owner), ...saltOf(args) };
}

/** Everything an EVM cook command takes from its flags. */
function cookInput(
  args: ParsedArgs,
  io: CliIo,
  trailing: readonly string[] | undefined,
  signer?: `0x${string}`,
  program: ProgramInput = programInput(args, io),
): CookInput {
  const value = stringFlag(args, "value");
  if (repeatedFlag(args, "account").length > 0) {
    throw new UsageError(
      `--account names a Solana program's accounts; a program on ${program.chain.slug} takes none`,
    );
  }

  return {
    ...program,
    target: potInput(args, signer),
    ...(value === undefined ? {} : { value: parseWei("value", value) }),
    ...argsInput(args, io, trailing),
  };
}

/** The RPC endpoint for `chain`, from `--rpc-url` or `--config`; `undefined` when neither. */
function endpoint(args: ParsedArgs, io: CliIo, chain: CanonicalChain): string | undefined {
  const rpcUrl = stringFlag(args, "rpc-url");
  const config = stringFlag(args, "config");
  if (rpcUrl !== undefined && config !== undefined) {
    throw new UsageError("give --rpc-url or --config, not both");
  }

  return endpointFor(
    chain,
    rpcUrl,
    config === undefined ? undefined : { path: config, text: readInput(io, config) },
  );
}

function requiredEndpoint(args: ParsedArgs, io: CliIo, chain: CanonicalChain): string {
  const url = endpoint(args, io, chain);
  if (url === undefined) {
    throw new UsageError(
      `missing --rpc-url <url> (or --config <file>): the ${chain.slug} endpoint`,
    );
  }

  return url;
}

const signerOf = (args: ParsedArgs, io: CliIo) => {
  if (stringFlag(args, "keypair") !== undefined) {
    throw new UsageError(
      "--keypair is a Solana keypair; an EVM transaction is signed with --keystore or --private-key",
    );
  }

  return loadSigner(
    {
      ...(stringFlag(args, "keystore") === undefined
        ? {}
        : { keystore: stringFlag(args, "keystore")! }),
      ...(stringFlag(args, "password-file") === undefined
        ? {}
        : { passwordFile: stringFlag(args, "password-file")! }),
      ...(stringFlag(args, "private-key") === undefined
        ? {}
        : { privateKey: stringFlag(args, "private-key")! }),
    },
    io,
  );
};

/**
 * The owner where a signer is given: the signer. `--owner` then only restates it, and one that
 * names someone else is refused rather than silently ignored.
 */
function signerIsOwner(signer: `0x${string}`, owner: string | undefined): `0x${string}` {
  if (owner !== undefined && parseAddress("owner", owner) !== signer) {
    throw new UsageError(
      `--owner ${owner} is not the signer, ${signer}: with a signer, the owner is the signer. ` +
        "Leave --owner out, or sign as its owner.",
    );
  }

  return signer;
}

// --- Solana ----------------------------------------------------------------------------------

/** A Solana command's signer: `--keypair`, never an EVM key. */
async function keypairOf(args: ParsedArgs, io: CliIo): Promise<KeyPairSigner> {
  if (stringFlag(args, "keystore") !== undefined || stringFlag(args, "private-key") !== undefined) {
    throw new UsageError(
      "--keystore and --private-key are EVM keys: on Solana, sign with --keypair <path>",
    );
  }

  return loadKeypair(requiredFlag(args, "keypair", "<path>"), io);
}

/** The Pot's owner on Solana: the signer when there is one (and `--owner` must agree), else
 *  `--owner`. */
function svmOwner(args: ParsedArgs, signer?: SvmAddress): SvmAddress {
  const owner = stringFlag(args, "owner");
  if (signer !== undefined) {
    if (owner !== undefined && parsePubkey("owner", owner) !== signer) {
      throw new UsageError(
        `--owner ${owner} is not the signer, ${signer}: with a signer, the owner is the signer. ` +
          "Leave --owner out, or sign as its owner.",
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

  return {
    ...program,
    owner: svmOwner(args, signer),
    ...saltOf(args),
    accounts: parseAccounts(repeatedFlag(args, "account")),
    ...argsInput(args, io, trailing),
    rpcUrl: requiredEndpoint(args, io, program.chain),
  };
}

/**
 * The endpoint and chain to fetch a transaction from: `--rpc-url` (its chain from `--chain`, else
 * from the endpoint itself) or `--config` with `--chain`; `undefined` when neither is given.
 */
async function transactionEndpoint(
  args: ParsedArgs,
  io: CliIo,
): Promise<{ readonly rpcUrl: string; readonly chain: CanonicalChain } | undefined> {
  const rpcUrl = stringFlag(args, "rpc-url");
  const chainFlag = stringFlag(args, "chain");
  if (rpcUrl === undefined && stringFlag(args, "config") === undefined) return undefined;
  if (rpcUrl === undefined) {
    const chain = parseChain(requiredFlag(args, "chain", "<slug|id>"));

    return { rpcUrl: requiredEndpoint(args, io, chain), chain };
  }
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
  readonly usage: string;
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

const COMMANDS: Readonly<Record<string, Command>> = {
  compile: {
    usage: "sauce compile <file> --chain <slug|id> [options]",
    summary: "Compile a SauceScript program; print its bytecode",
    flags: {
      ...PROGRAM,
      out: { type: "string", value: "<path>", help: "Write the output to a file, not stdout" },
      json: { type: "boolean", help: "Print JSON: size, main's parameters, compiler, engine" },
      ...HELP,
    },
    details: [
      "Compiles the file as a standalone program for the chain (routes.compileSauceProgram):",
      "its token symbols (USDC), protocol namespaces (Uniswap.UniversalRouter), chainId, the",
      "zero-import @sauce/token functions, SafeERC20 token writes (USDC.transfer,",
      "Token(addr).approve) and intents opened inside the program all resolve against it, so",
      "one file compiles for any chain whose names it uses. Relative imports are read from beside",
      "the file. A file may name its chain in a leading `// @chain base` line.",
      "",
      "Example:",
      "  sauce compile pay.sauce.ts --chain base --define RECIPIENT=0x…",
    ].join("\n"),
    run: (args, io) => {
      const output = compileCommand(programInput(args, io), io);
      const out = stringFlag(args, "out");
      if (out === undefined) return output;
      io.writeText(
        out,
        `${args.values.json === true ? JSON.stringify(output.json, null, 2) : output.text}\n`,
      );

      return undefined;
    },
  },
  simulate: {
    usage:
      "sauce simulate <file> --chain <slug|id> (--pot <address> | --owner <address>) --rpc-url <url> [options]",
    summary: "Dry-run the cook from the Pot's owner: result, gas, or why it reverts",
    flags: { ...PROGRAM, ...COOK, ...ENDPOINT, ...JSON_FLAG, ...HELP, ...ARGS },
    details: [
      "Compiles the file, builds the cook, and runs it through eth_call from the Pot's owner:",
      "no key, no transaction, no local node. Prints the gas it needs and what it returns, or",
      "the decoded reason it reverts (exit 1). The Pot must be deployed.",
      "",
      "On Solana: the Kitchen cook, simulated from --owner (no signature needed), with each",
      "account main takes given as --account NAME=<address | pot | owner>. Prints the compute",
      "units, or the reason and the program logs.",
      "",
      "Examples:",
      "  sauce simulate pay.sauce.ts --chain base --owner 0x… --rpc-url <url>",
      "  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> --rpc-url <url> \\",
      "    --account source=<token account> --account authority=pot",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = programInput(args, io);
      if (program.chain.kind === "svm") {
        return svmSimulateCommand(svmCookInput(args, io, trailing, program), io);
      }
      const input = cookInput(args, io, trailing, undefined, program);

      return simulateCommand({ ...input, rpcUrl: requiredEndpoint(args, io, input.chain) }, io);
    },
  },
  run: {
    usage:
      "sauce run <file> --chain <slug|id> --rpc-url <url> (--keystore <path> | --private-key <hex>) [options]",
    summary: "Compile, sign, send and wait for the cook on your Pot",
    flags: {
      ...PROGRAM,
      ...COOK,
      ...ENDPOINT,
      ...SIGNER,
      yes: { type: "boolean", short: "y", help: "Deploy a missing Pot without asking first" },
      ...JSON_FLAG,
      ...HELP,
      ...ARGS,
    },
    details: [
      "Compiles the file, builds the cook on the signer's Pot (or --pot), rehearses it, signs it,",
      "sends it and waits for the receipt: prints the hash, status and gas used, and the decoded",
      "reason when it reverts (exit 1). The signer is the owner. A Pot that is not deployed",
      "yet is deployed first, in a transaction of its own, once you agree at the prompt — or",
      "with --yes, which is also how to allow it with no terminal to ask on. The value",
      "defaults to the Kitchen's execution fee, read from the chain.",
      "",
      "On Solana: sign with --keypair; the Kitchen's fee is read from the cluster, a missing Pot",
      "is created the same way, and a program too large for one transaction is staged in a code",
      "buffer first (closed again after the cook). A failure prints the program logs.",
      "",
      "Examples:",
      "  sauce run pay.sauce.ts --chain base --rpc-url <url> --keystore ~/.keys/me.json",
      "  sauce run sweep.sauce.ts --chain solana --rpc-url <url> --keypair ~/.config/solana/id.json \\",
      "    --account source=<token account> --account authority=pot",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = programInput(args, io);
      if (program.chain.kind === "svm") {
        const signer = await keypairOf(args, io);

        return svmRunCommand(
          {
            ...svmCookInput(args, io, trailing, program, signer.address),
            signer,
            yes: args.values.yes === true,
            confirm: io.confirm,
          },
          io,
        );
      }
      const account = await signerOf(args, io);
      const input = cookInput(args, io, trailing, account.address, program);

      return runCommand(
        {
          ...input,
          rpcUrl: requiredEndpoint(args, io, input.chain),
          account,
          yes: args.values.yes === true,
          confirm: io.confirm,
        },
        io,
      );
    },
  },
  publish: {
    usage:
      "sauce publish <file> --chain <source> --rpc-url <url> (--keystore <path> | --private-key <hex>) [options]",
    summary: "Publish a file's fixed intents from a wallet, with no Pot",
    flags: {
      ...PROGRAM,
      ...ENDPOINT,
      ...SIGNER,
      from: {
        type: "string",
        value: "<address>",
        help: "With --dry-run or --format and no signer: whose wallet",
      },
      "dry-run": {
        type: "boolean",
        help: "Rehearse the transactions together (eth_simulateV1); send nothing",
      },
      format: {
        type: "string",
        value: "<json|cast>",
        help: "Print the unsigned transactions instead of sending them",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "For a file whose intents are fixed when it is built — every amount a define or a literal —",
      "builds each intent off-chain (the SDK's own lowering) and sends the source chain's Portal",
      "transactions from the signer's wallet: each reward token approved to the Portal (reset to",
      "zero first when a smaller allowance stands, as SafeERC20 does), then publishAndFund. Prints",
      "the intent hashes and the transactions. A file whose intent uses a value measured on",
      "chain, or that does anything besides open its intents, is refused: use `sauce run` on a",
      "Pot.",
      "",
      "Example:",
      "  sauce publish bridge.sauce.ts --chain arbitrum --rpc-url <url> --keystore ~/.keys/me.json \\",
      "    --intent-deadline 2000000000 --intent-creator 0x…",
    ].join("\n"),
    run: async (args, io) => {
      const program = programInput(args, io);
      if (program.chain.kind === "svm") {
        throw new UsageError(
          "sauce publish sends a source chain's Portal transactions from an EVM wallet. " +
            "Publishing from Solana is not supported: the SDK has no Kitchen-built path for an " +
            "intent that Solana's Portal runs (docs/guides/solana.md). Open the intent from an " +
            "EVM chain; its destination may be Solana.",
        );
      }
      const format = stringFlag(args, "format");
      if (format !== undefined && format !== "json" && format !== "cast") {
        throw new UsageError(`--format: '${format}' is not json or cast`);
      }
      const signing =
        stringFlag(args, "keystore") !== undefined || stringFlag(args, "private-key") !== undefined;
      const account = signing ? await signerOf(args, io) : undefined;
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

      return publishCommand(
        {
          ...program,
          ...(format === undefined ? {} : { format }),
          dryRun: args.values["dry-run"] === true,
          ...(rpcUrl === undefined ? {} : { rpcUrl }),
          ...(account === undefined ? {} : { account }),
          ...(from === undefined ? {} : { from: parseAddress("from", from) }),
        },
        io,
      );
    },
  },
  tx: {
    usage: "sauce tx <file> --chain <slug|id> (--pot <address> | --owner <address>) [options]",
    summary: "Print the unsigned cook transaction, for a wallet to sign",
    flags: { ...PROGRAM, ...COOK, ...ENDPOINT, ...FORMAT, ...HELP, ...ARGS },
    details: [
      "Compiles the file and prints the transaction that runs it, unsigned, as JSON:",
      "{ chainId, to: the Pot, data: Pot.cook(engine, program ++ arguments), value }. Give the",
      "value, or an endpoint to read the Kitchen's fee (it also checks the Pot). `--format cast`",
      "prints the same transaction as a `cast send` line instead. What must be true for it to",
      "land goes to stderr: the Pot deployed and funded, and sent from its owner.",
      "",
      "On Solana: { chain, feePayer, pot, fee, transaction }, the Kitchen cook as a base64",
      "transaction signed by no one, for --owner to sign. It needs an endpoint (for the",
      "blockhash and the fee), and the --account flags simulate takes.",
      "",
      "Example:",
      "  sauce tx pay.sauce.ts --chain base --owner 0x… --value 0",
    ].join("\n"),
    trailing: "args",
    run: (args, io, trailing) => {
      const program = programInput(args, io);
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
      ...FORMAT,
      ...HELP,
    },
    details: [
      "A Pot's address is CREATE2 from the released Kitchen over (owner, salt), so it is known",
      "before it exists. Prints it and the unsigned Kitchen.deployPot transaction as JSON; with",
      "--deploy, sends it (the owner defaults to the signer) unless the Pot is already there.",
      "The default salt is zero: the one Pot an owner has by default.",
      "",
      "On Solana a Pot is the Kitchen's PDA over (owner, salt): this prints it and the create_pot",
      "instruction; --deploy (with --keypair) creates it.",
      "",
      "Examples:",
      "  sauce pot --owner 0x… --chain base",
      "  sauce pot --deploy --chain base --rpc-url <url> --keystore ~/.keys/me.json --salt treasury",
      "  sauce pot --deploy --chain solana --rpc-url <url> --keypair ~/.config/solana/id.json",
    ].join("\n"),
    run: async (args, io) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const chain = potChain(args);
      const owner = stringFlag(args, "owner");
      if (chain.kind === "svm") {
        if (stringFlag(args, "format") === "cast") {
          throw new UsageError("--format cast prints an EVM transaction; a Solana Pot has none");
        }
        if (args.values.deploy !== true) {
          return svmPotCommand({ owner: svmOwner(args), ...saltOf(args) });
        }
        const signer = await keypairOf(args, io);

        return svmPotDeployCommand({
          owner: svmOwner(args, signer.address),
          ...saltOf(args),
          rpcUrl: requiredEndpoint(args, io, chain),
          signer,
        });
      }
      if (args.values.deploy !== true) {
        if (owner === undefined) throw new UsageError("missing --owner <address>: whose Pot");

        return potCommand({ chain, owner: parseAddress("owner", owner), ...saltOf(args) });
      }
      if (stringFlag(args, "format") === "cast") {
        throw new UsageError("--format cast prints the unsigned transaction; --deploy sends it");
      }
      const account = await signerOf(args, io);

      return potDeployCommand({
        chain,
        owner: signerIsOwner(account.address, owner),
        ...saltOf(args),
        rpcUrl: requiredEndpoint(args, io, chain),
        account,
      });
    },
  },
  globals: {
    usage: "sauce globals --chain <slug|id> [--tokens] [--protocols] [--protocol <name>] [--json]",
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
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "Every name a program compiled for the chain may use without declaring it, from the SDK's",
      "registries (routes.sourceGlobals) — the ones the compile resolves: token symbols with",
      "their addresses and decimals, protocol namespaces with each contract's address (and,",
      "with --protocol, its methods), the chain names that open intents, the defines, and the",
      "zero-import @sauce/token functions. With no filter it lists everything.",
      "",
      "Examples:",
      "  sauce globals --chain base",
      "  sauce globals --chain base --protocol UniswapV3 --json",
    ].join("\n"),
    run: (args) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const protocol = stringFlag(args, "protocol");

      return globalsCommand({
        chain: parseChain(requiredFlag(args, "chain", "<slug|id>")),
        tokens: args.values.tokens === true,
        protocols: args.values.protocols === true,
        ...(protocol === undefined ? {} : { protocol }),
      });
    },
  },
  inspect: {
    usage: "sauce inspect <hex | tx-hash | file> [--chain <slug|id>] [--source <file>] [options]",
    summary: "Take a cook, a Portal or Kitchen call, a program or a file apart",
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
      "Reads what a SauceScript author wrote back out of bytes: a Pot.cook (its engine, its",
      "program, the intents the program opens), a Kitchen.deployPot (the Pot it makes), a Portal",
      "publish or publishAndFund (the route and the reward), an ERC-20 call, or a bare program.",
      "A 32-byte hash with --rpc-url (or --config and --chain) is a transaction, fetched first.",
      "With --source, a cook's program is checked against that file's and the arguments after it",
      "are decoded against its main. A file operand is compiled and its intents listed, with",
      "each value it measures at run time named. No opcode listing: programs are reported by",
      "size, hash and what they open.",
      "",
      "Examples:",
      "  sauce inspect 0x… --chain base --source split.sauce.ts",
      "  sauce inspect 0x<tx hash> --rpc-url <url>",
      "  sauce inspect bridge.sauce.ts --chain arbitrum --intent-deadline 2000000000 --intent-creator 0x…",
    ].join("\n"),
    run: async (args, io) => {
      const [operand] = args.positionals;
      if (operand === undefined || !operand.startsWith("0x")) {
        if (stringFlag(args, "source") !== undefined) {
          throw new UsageError("--source goes with hex: a file operand is its own source");
        }
        const input = programInput(args, io);

        return inspectFile(input.file, compileProgram(input, io));
      }
      const hex = hexOperand(args, "<hex | tx-hash | file>");
      const sourceFile = stringFlag(args, "source");
      const fetched = TX_HASH.test(hex) ? await transactionEndpoint(args, io) : undefined;
      if (TX_HASH.test(hex) && fetched === undefined) {
        throw new UsageError(
          "32 bytes of hex is a transaction hash: give --rpc-url <url> (or --config <file> with " +
            "--chain) to fetch it",
        );
      }
      const source =
        sourceFile === undefined ? undefined : programInput(args, io, sourceFile, fetched?.chain);
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
      "sauce verify <payload | calldata | tx-hash> [--pin <hash:bytes>]… [--engine <address>]… [--rpc-url <url>]",
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
      "endpoint — a transaction hash, and checks the settle it carries with the SDK's",
      "validateSettleProgram: the program must hash to the current pin (or a --pin), and its",
      "arguments must be the one canonical encoding. Prints tokens, minOut and recipient. A cook",
      "must name the released engine (or an --engine); an intent must carry a settle cook. A",
      "rejection exits 1 with its code: the SDK's SettleFailureCode, or UNKNOWN_ENGINE or",
      "NO_SETTLE.",
      "",
      "On Solana (--chain solana, a transaction signature and an endpoint): an SVM settle's",
      "floor and split are compiled into it, so give them, --min-out and --spl-count. The",
      "engine invocation the cook made is checked by the SDK's verifySvmSettleExecution against",
      "the settle recompiled for those values; a rejection is NO_SETTLE or NOT_GENUINE.",
      "",
      "Examples:",
      "  sauce verify 0x<payload>",
      "  sauce verify 0x<tx hash> --rpc-url <url> --pin 0x…:435",
      "  sauce verify <signature> --chain solana --rpc-url <url> --min-out 0 --spl-count 1",
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
        help: `${AGENTS.join(", ")} or all (default: detected)`,
      },
      dir: { type: "string", value: "<project>", help: "The project (default .)" },
      force: { type: "boolean", help: "update: overwrite files edited since they were installed" },
      ...HELP,
    },
    details: [
      "The skills ship once, as Agent Skills directories, and are written where each agent",
      "reads them: .claude/skills/ for claude; .agents/skills/ for codex, cursor, copilot and",
      "gemini, which all read it; and for agents-md, .agents/skills/ plus an index block in",
      "AGENTS.md. Without --agent: install detects the agents a project shows signs of (or",
      "claude and agents-md); update and status take the targets installed.",
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
            ? targetsFor(detectAgents(project))
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
  init: {
    usage: "sauce init [<dir>] [--agent <agent>,…] [--force] [--install]",
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
      ...HELP,
    },
    details: [
      "Writes package.json (pinning this exact version), AGENTS.md (the project's instructions,",
      "which coding agents read), CLAUDE.md or GEMINI.md importing it for those agents, a",
      ".gitignore for local config, sauce.config.example.json (placeholders only), and then",
      "installs the agent skills (`sauce skills install`). The agents default to those the",
      "directory shows signs of, else claude and agents-md. It runs no package manager unless",
      "--install, which runs npm install.",
    ].join("\n"),
    run: (args, io) => {
      const [dir = ".", ...rest] = args.positionals;
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <dir>`);
      const agents = parseAgents(repeatedFlag(args, "agent")) ?? detectAgents(dir);
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
        "  npx sauce --help",
      ]);
    },
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

function commandHelp(command: Command): string {
  return [
    `${command.summary}.`,
    "",
    `Usage: ${command.usage}`,
    "",
    "Options:",
    describeFlags(command.flags),
    "",
    command.details,
    "",
  ].join("\n");
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
    "Run `sauce <command> --help` for its options. Nothing reaches a network without --rpc-url",
    "or --config, and nothing is signed without --keystore or --private-key (on Solana,",
    "--keypair).",
    "",
  ].join("\n");
}

const commandNamed = (name: string | undefined): Command | undefined =>
  name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;

/** Registers a `--private-key` value as a secret before anything can fail and print it. */
function rememberSecrets(argv: readonly string[]): void {
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
  const command = commandNamed(name === "help" ? rest[0] : name);
  if (name === "help" && (rest[0] === undefined || command !== undefined)) {
    io.stdout(command === undefined ? mainHelp() : commandHelp(command));

    return 0;
  }
  if (command === undefined) {
    const unknown = name === "help" ? rest[0] : name;
    io.stderr(
      `sauce: unknown command '${unknown}'. Commands: ${Object.keys(COMMANDS).join(", ")}\n`,
    );

    return 2;
  }

  try {
    // A trailing flag ends the options, so its words are never read as flags: a program's
    // arguments may look like anything.
    const at = command.trailing === undefined ? -1 : rest.indexOf(`--${command.trailing}`);
    const args = parseFlags(at < 0 ? rest : rest.slice(0, at), command.flags);
    if (args.values.help === true) {
      io.stdout(commandHelp(command));

      return 0;
    }
    const output = await command.run(args, io, at < 0 ? undefined : rest.slice(at + 1));
    if (output === undefined) return 0;
    for (const note of output.notes ?? []) io.stderr(`${note}\n`);
    io.stdout(`${render(command, output, args)}\n`);

    return output.exitCode ?? 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`sauce ${name}: ${error.message}\nRun \`sauce ${name} --help\` for usage.\n`);

      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sauce ${name}: ${message}\n`);

    return 1;
  }
}
