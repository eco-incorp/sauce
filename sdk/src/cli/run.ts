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
  parseFundVia,
  parseHeader,
  parseSalt,
  parseTarget,
  parseUnixSeconds,
  parseWei,
  repeatedFlag,
  requiredFlag,
  stringFlag,
  UsageError,
  type FlagSpec,
  type FlagSpecs,
  type ParsedArgs,
} from "./args.js";
import { mainSignature } from "../routes/entry.js";
import { blankLiterals } from "../routes/rs-compile.js";
import { chainServedBy, endpointFor } from "./chain.js";
import {
  compileCommand,
  compileProgram,
  potCommand,
  potDeployCommand,
  readInput,
  runCommand,
  txCommand,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type Confirm,
  type CookInput,
  type PotInput,
  type ProgramInput,
} from "./commands.js";
import {
  FUND_MODES,
  parseFund,
  parseTokenAmount,
  permit2On,
  planFunding,
  type FundMode,
  type FundRequest,
} from "./funding.js";
import { globalsCommand } from "./globals.js";
import { initProject } from "./init.js";
import { inspectCommand, inspectFile } from "./inspect.js";
import { parsePriceToken, priceCommand, pricedChain } from "./price.js";
import { publishCommand } from "./publish.js";
import { simulateCommand } from "./simulate.js";
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
import type { PrivateKeyAccount } from "viem/accounts";
import { loadSigner, scrub, secret } from "./signer.js";
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
    help: "A value the program reads by name: integer, 0x hex, true, false; base58 on Solana",
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
  "intent-fund-via": {
    type: "string",
    value: "<transfer|publishAndFund>",
    help: "…how their reward is funded: paid into the vault (default), or publishAndFund",
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
    help: "An account main takes, by name: an address, pot or owner",
    only: "svm",
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
  keystore: {
    type: "string",
    value: "<path>",
    help: "Sign with a JSON keystore (v3)",
    only: "evm",
  },
  "password-file": {
    type: "string",
    value: "<path>",
    help: "Its password, read from a file (else asked for)",
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
    help: "Pull tokens into the Pot in the cook: USDC:1.5, USDC:1500000n, ETH:0.01",
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
  if (mainSignature(text) !== undefined) return;
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
  const chain = chainOf(args, file, text, fallback);
  const definesFile = stringFlag(args, "defines");
  const deadline = stringFlag(args, "intent-deadline");
  const creator = stringFlag(args, "intent-creator");
  const fee = stringFlag(args, "intent-execution-fee");
  const fundVia = stringFlag(args, "intent-fund-via");
  const defines = {
    ...(definesFile === undefined
      ? {}
      : parseDefinesFile(readInput(io, definesFile), definesFile, chain.kind)),
    ...parseDefines(repeatedFlag(args, "define"), chain.kind),
  };
  definesReach(file, text, Object.keys(defines));

  return {
    file,
    text,
    chain,
    compactArgs: args.values["compact-args"] === true,
    defines,
    intents: {
      ...(deadline === undefined
        ? {}
        : { deadline: parseUnixSeconds("intent-deadline", deadline) }),
      ...(creator === undefined ? {} : { creator: parseAddress("intent-creator", creator) }),
      ...(fee === undefined ? {} : { executionFee: parseWei("intent-execution-fee", fee) }),
      ...(fundVia === undefined ? {} : { fundVia: parseFundVia(fundVia) }),
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

  const url = endpointFor(
    chain,
    rpcUrl,
    config === undefined ? undefined : { path: config, text: readInput(io, config) },
  );
  // A provider URL often carries a key: whatever reports it — this CLI, viem, the Solana client —
  // it is scrubbed from everything printed.
  if (url !== undefined) secret(url);

  return url;
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

/** Whether `simulate` was given a key: it signs `--fund`'s pulls, and nothing else there. */
const hasSigner = (args: ParsedArgs): boolean =>
  stringFlag(args, "keystore") !== undefined || stringFlag(args, "private-key") !== undefined;

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
  const raw = repeatedFlag(args, "fund");
  const mode = stringFlag(args, "fund-mode");
  const sweep = args.values.sweep === true;
  if (raw.length === 0) {
    if (mode !== undefined) throw new UsageError("--fund-mode says how --fund pulls: give --fund");
    if (sweep) {
      throw new UsageError(
        "--sweep returns what is left of the tokens --fund pulls in: give --fund",
      );
    }

    return undefined;
  }
  if (chain.kind !== "evm") {
    throw new UsageError(
      `--fund is for EVM chains: on ${chain.slug} a program spends from the accounts it is given`,
    );
  }
  if (mode !== undefined && !(FUND_MODES as readonly string[]).includes(mode)) {
    throw new UsageError(`--fund-mode: '${mode}' is not ${FUND_MODES.join(", ")}`);
  }
  const requests = raw.map((value) => parseFund(value, chain));
  const seen = new Set<string>();
  for (const request of requests) {
    const key = request.token ?? "native";
    if (seen.has(key)) {
      throw new UsageError(`--fund names ${request.label} twice: give it once, with the total`);
    }
    seen.add(key);
  }
  // Before anything is sent — a Pot deployed — rather than once the run reaches the pulls.
  if (
    (mode ?? "permit2") === "permit2" &&
    requests.some((request) => request.token !== undefined)
  ) {
    permit2On(chain);
  }

  return async (client, pot, owner) => {
    if (account !== undefined && account.address !== owner) {
      throw new UsageError(
        `the signer ${account.address} is not the owner of Pot ${pot}, ${owner}: --fund pulls the ` +
          "owner's tokens on the owner's signature",
      );
    }

    return planFunding({
      chain,
      client,
      rpcUrl,
      owner,
      pot,
      mode: (mode ?? "permit2") as FundMode,
      requests,
      sweep,
      ...(account === undefined ? {} : { account }),
      send,
      yes: args.values.yes === true,
      confirm: io.confirm,
    });
  };
}

/** `--assume-balance`, each named once. */
function assumedBalances(args: ParsedArgs, chain: CanonicalChain): FundRequest[] {
  const requests = repeatedFlag(args, "assume-balance").map((raw) =>
    parseTokenAmount(raw, chain, "--assume-balance"),
  );
  const seen = new Set<string>();
  for (const request of requests) {
    if (seen.has(request.token ?? "native")) {
      throw new UsageError(`--assume-balance names ${request.label} twice: give it once`);
    }
    seen.add(request.token ?? "native");
  }

  return requests;
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
    usage: [
      "sauce simulate <file> --chain <slug|id> (--owner <address> | --pot <address>) --rpc-url <url> [options]",
      "sauce simulate <file> --chain solana --owner <pubkey> --rpc-url <url> [--account NAME=<value>]… [options]",
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
        help: "Give the Pot this balance, for the rehearsal only: USDC:2, ETH:0.1",
        only: "evm",
      },
      ...FUND,
      keystore: SIGNER.keystore!,
      "password-file": SIGNER["password-file"]!,
      "private-key": SIGNER["private-key"]!,
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
      "argument as a base58 public key. A Pot the Kitchen has not created is created first, in the",
      "same transaction. Prints the compute units, or the reason (a program's revert message",
      "decoded) and the program logs. Solana's simulateTransaction takes no account overrides, so",
      "the owner must hold the Pot's rent and the fees, and --assume-balance is refused there. A",
      "cook too large for one transaction is refused with the bytes to shrink: staging it writes",
      "a code buffer on chain, which only `sauce run` does.",
      "",
      "Examples:",
      "  sauce simulate pay.sauce.ts --chain base --owner 0x… --rpc-url <url> \\",
      "    --assume-balance USDC:2 --args 0x… 1000000",
      "  sauce simulate sweep.sauce.ts --chain solana --owner <pubkey> --rpc-url <url> \\",
      "    --account source=<token account> --account authority=pot",
    ].join("\n"),
    trailing: "args",
    run: async (args, io, trailing) => {
      const program = programInput(args, io);
      const funds = repeatedFlag(args, "fund").length > 0;
      if (hasSigner(args) && !funds) {
        throw new UsageError(
          "simulate signs nothing but --fund's pulls: give --fund, or drop the key (the rehearsal " +
            "runs from the Pot's owner without one)",
        );
      }
      const assume = repeatedFlag(args, "assume-balance");
      if (program.chain.kind === "svm") {
        fundingOf(args, io, program.chain, "", false, undefined);
        if (assume.length > 0) {
          throw new UsageError(
            "--assume-balance is for EVM chains: a Solana endpoint's simulateTransaction takes no " +
              "account overrides, so on solana the rehearsal runs on the accounts as they are",
          );
        }

        return svmSimulateCommand(svmCookInput(args, io, trailing, program), io);
      }
      const input = cookInput(args, io, trailing, undefined, program);
      const assumed = assumedBalances(args, input.chain);
      const rpcUrl = requiredEndpoint(args, io, input.chain);
      const account = funds && hasSigner(args) ? await signerOf(args, io) : undefined;
      const fund = fundingOf(args, io, input.chain, rpcUrl, false, account);

      return simulateCommand(
        { ...input, rpcUrl, assume: assumed, ...(fund === undefined ? {} : { fund }) },
        io,
      );
    },
  },
  run: {
    usage: [
      "sauce run <file> --chain <slug|id> --rpc-url <url> (--keystore <path> | --private-key <hex>) [options]",
      "sauce run <file> --chain solana --rpc-url <url> --keypair <path> [--account NAME=<value>]… [options]",
    ],
    summary: "Compile, sign, send and wait for the cook on your Pot",
    flags: {
      ...PROGRAM,
      ...COOK,
      ...ENDPOINT,
      ...SIGNER,
      ...FUND,
      yes: {
        type: "boolean",
        short: "y",
        help: "Deploy a missing Pot, or approve for --fund, without asking",
      },
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
      "--fund TOKEN:amount gets tokens into the Pot in the same cook: the program is wrapped so",
      "it first pulls each amount from you, then runs, then (--sweep) returns what is left. The",
      "amount is whole units (USDC:1.5) or base units ending in n (USDC:1500000n); ETH:<amount>",
      "rides as the cook's value. Every pull is a safeTransferFrom: @sauce/token's SafeERC20",
      "one, or Permit2's own (Solmate's SafeTransferLib). --fund-mode:",
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
        fundingOf(args, io, program.chain, "", true, undefined);
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
      const rpcUrl = requiredEndpoint(args, io, input.chain);
      const fund = fundingOf(args, io, input.chain, rpcUrl, true, account);

      return runCommand(
        {
          ...input,
          ...(fund === undefined ? {} : { fund }),
          rpcUrl,
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
      "assume-balance": {
        type: "string",
        multiple: true,
        value: "<TOKEN:amount>",
        help: "With --dry-run: give the wallet this balance, for the rehearsal only",
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
      "builds each intent off-chain (the SDK's own lowering) and sends the source chain's",
      "transactions from the signer's wallet: each reward token transferred to the intent's vault",
      "(and the native amount sent to it), then Portal.publish. No approval is asked for. The vault",
      "is the SDK's offline derivation, which the Portal's own intentVaultAddress must agree with",
      "or nothing is sent; only what the vault does not hold yet is transferred, and publish is",
      "sent only once the Portal counts the intent funded. Prints the intent hashes and the",
      "transactions. A file whose intent uses a value measured on chain, or that does anything",
      "besides open its intents, is refused: use `sauce run` on a Pot.",
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

      const assume = assumedBalances(args, program.chain);
      if (assume.length > 0 && args.values["dry-run"] !== true) {
        throw new UsageError(
          "--assume-balance goes with --dry-run: it gives the wallet a balance for a rehearsal, " +
            "and nothing to a transaction that is sent",
        );
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
        },
        io,
      );
    },
  },
  tx: {
    usage: [
      "sauce tx <file> --chain <slug|id> (--owner <address> | --pot <address>) [options]",
      "sauce tx <file> --chain solana --owner <pubkey> --rpc-url <url> [--account NAME=<value>]… [options]",
    ],
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
      yes: { type: "boolean", short: "y", help: "Accepted: --deploy sends without asking" },
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
      "zero: the one Pot an owner has by default.",
      "",
      "On Solana a Pot is the Kitchen's PDA over (owner, salt): this prints it and the create_pot",
      "instruction; --deploy (with --keypair) creates it. There the owner signs create_pot, so",
      "the signer is the owner.",
      "",
      "Examples:",
      "  sauce pot --owner 0x… --chain base",
      "  sauce pot --deploy --chain base --rpc-url <url> --keystore ~/.keys/me.json --salt treasury",
      "  sauce pot --deploy --chain base --owner 0x… --config sauce.config.json --keystore <keystore>",
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
        if (owner === undefined) throw new UsageError("missing --owner <address>: whose Pot");

        return potCommand({ chain, owner: parseAddress("owner", owner), ...saltOf(args) });
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
  price: {
    usage:
      "sauce price --chain <slug|id> <base> <quote> (<price> | --sqrt-price-x96 <value>) [--json]",
    summary: "Turn a price into a pool's sqrtPriceX96 and a swap's limit and average-price floor",
    flags: {
      chain: { type: "string", value: "<slug|id>", help: "The chain the pool is on" },
      "sqrt-price-x96": {
        type: "string",
        value: "<value>",
        help: "Read a pool's sqrtPriceX96 as a price instead",
      },
      ...JSON_FLAG,
      ...HELP,
    },
    details: [
      "<price> is how many <quote> tokens one <base> token is worth, in whole tokens: 2700 for",
      "2,700 USDC per WETH. A token is a symbol the chain registers (sauce globals --tokens), or",
      "an address with its decimals (0x…:18). Prints the pool's sqrtPriceX96 at that price, for",
      "the pair's order on the chain (token0 is the lower address), and for each direction:",
      "  sqrtPriceLimitX96  the same number as a swap's limit: a floor when selling token0, a",
      "                     ceiling when selling token1",
      "  minAvgPrice        output units per input unit times 1e18, rounded up, for a program's",
      "                     check out * 1e18 >= minAvgPrice * spent",
      "Uniswap V3 and V4 and their forks share this price. With --sqrt-price-x96, a pool's",
      "price is read back the other way. Nothing reaches a network.",
      "",
      "Examples:",
      "  sauce price --chain base WETH USDC 2700",
      "  sauce price --chain base WETH USDC --sqrt-price-x96 4116816085950893928074568",
    ].join("\n"),
    run: (args) => {
      const chain = pricedChain(parseChain(requiredFlag(args, "chain", "<slug|id>")));
      const sqrt = stringFlag(args, "sqrt-price-x96");
      const [base, quote, price, ...rest] = args.positionals;
      if (base === undefined || quote === undefined) {
        throw new UsageError("missing <base> <quote>: the pair, as WETH USDC");
      }
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      if ((price === undefined) === (sqrt === undefined)) {
        throw new UsageError(
          price === undefined
            ? "missing <price>: how many quote tokens one base token is worth (or --sqrt-price-x96)"
            : "give <price> or --sqrt-price-x96, not both",
        );
      }
      if (price !== undefined && !/^\d+(?:\.\d+)?$/.test(price)) {
        throw new UsageError(`'${price}' is not a price: a decimal number, as 2700 or 0.00037`);
      }
      if (sqrt !== undefined && !/^\d+$/.test(sqrt)) {
        throw new UsageError(`--sqrt-price-x96: '${sqrt}' is not a whole number`);
      }

      return priceCommand({
        chain,
        base: parsePriceToken(base, chain),
        quote: parsePriceToken(quote, chain),
        price: price !== undefined ? { decimal: price } : { sqrtPriceX96: BigInt(sqrt!) },
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
      "which coding agents read), CLAUDE.md and GEMINI.md importing it for those agents, a",
      ".gitignore for local config, sauce.config.example.json (placeholders only), and then",
      "installs the agent skills (`sauce skills install`), for every agent unless --agent names",
      "some. It runs no package manager unless --install, which runs npm install.",
    ].join("\n"),
    run: (args, io) => {
      const [dir = ".", ...rest] = args.positionals;
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <dir>`);
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

/** The flags of `command` that `only` names (`undefined`: those every chain takes). */
const flagsFor = (command: Command, only?: "evm" | "svm"): FlagSpecs =>
  Object.fromEntries(Object.entries(command.flags).filter(([, spec]) => spec.only === only));

function commandHelp(command: Command): string {
  const usage = typeof command.usage === "string" ? [command.usage] : command.usage;
  const sections = (
    [
      ["Options:", undefined],
      ["EVM chains only:", "evm"],
      ["Solana only:", "svm"],
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

/** Every flag any command takes: a flag given to the wrong command is named as that, never
 *  "unknown", and never swallowed as one of `main`'s arguments. */
const ANY_FLAG: FlagSpecs = Object.assign({}, ...Object.values(COMMANDS).map((c) => c.flags));

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

const SIGNING = new Set(["keystore", "password-file", "private-key", "keypair"]);
const REACHING = new Set(["rpc-url", "config"]);

/** Why `flag`, which another command takes, is not one of `name`'s. */
function notTaken(name: string, flag: string): string {
  const takers = Object.keys(COMMANDS).filter((other) => flag in COMMANDS[other]!.flags);
  const own = COMMANDS[name]!.flags;
  const why =
    name === "simulate" && flag === "keypair"
      ? "on Solana, simulate runs the cook from --owner and signs nothing"
      : name === "tx" && SIGNING.has(flag)
        ? "tx signs nothing: it prints the transaction unsigned, for a wallet (sauce run signs and sends it)"
        : SIGNING.has(flag) && !Object.keys(own).some((key) => SIGNING.has(key))
          ? `${name} signs nothing`
          : REACHING.has(flag) && !("config" in own)
            ? `${name} reads nothing from a chain`
            : flag === "yes"
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
    const { flags, trailing } = splitArgv(rest, command);
    const args = parseFlags(flags, ANY_FLAG);
    if (args.values.help === true) {
      io.stdout(commandHelp(command));

      return 0;
    }
    const foreign = Object.keys(args.values).find((flag) => !(flag in command.flags));
    if (foreign !== undefined) throw new UsageError(notTaken(name, foreign));
    const output = await command.run(args, io, trailing);
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
