/**
 * The `sauce` command: compile SauceScript exactly as the SDK does, build the transaction that runs
 * it, and set a project up to do both. `main.ts` is the executable; this is everything it does,
 * over an injected {@link CliIo} so the tests drive it without a child process.
 *
 * NODE-ONLY, and reached by nothing browser-facing: it is the package's `bin`, not an `exports`
 * entry, and no barrel imports it. It reads no environment — the network is reached only through
 * `--rpc-url`, and it never holds a key: the transaction it prints is signed by `cast` or a wallet.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { CANONICAL_CHAINS, type CanonicalChain } from "../chains/canonical.js";
import { SAUCE_INTENT_POT_SALT } from "../deployments/pot.js";
import {
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
import {
  CliError,
  compileCommand,
  potCommand,
  readInput,
  txCommand,
  type ArgsInput,
  type CliFiles,
  type CommandOutput,
  type PotInput,
  type ProgramInput,
} from "./commands.js";
import { initProject } from "./init.js";
import {
  checkSkills,
  describeInstall,
  installSkills,
  PACKAGED_SKILLS,
  type SkillsSource,
} from "./skills.js";

/** Where the command writes, what it reads, and how it runs a package manager. */
export interface CliIo extends CliFiles {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly writeText: (path: string, text: string) => void;
  /** Runs `command` in `cwd` with the terminal attached, returning its exit status. */
  readonly run: (command: string, args: readonly string[], cwd: string) => number;
}

/** The real process's streams, filesystem and children. */
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

const JSON_FLAG: FlagSpecs = {
  json: { type: "boolean", help: "Print one JSON object instead" },
};

const COMPILE_FLAGS: FlagSpecs = {
  ...PROGRAM,
  out: { type: "string", value: "<path>", help: "Write the output to a file, not stdout" },
  json: { type: "boolean", help: "Print JSON: size, main's parameters, compiler, engine" },
  ...HELP,
};

const TX_FLAGS: FlagSpecs = {
  ...PROGRAM,
  pot: { type: "string", value: "<address>", help: "The Pot to cook on" },
  owner: {
    type: "string",
    value: "<address>",
    help: "…or its owner, deriving the Pot from owner and --salt",
  },
  salt: {
    type: "string",
    value: "<hex>",
    help: "With --owner: the Pot's salt, up to 32 bytes (default 0)",
  },
  value: {
    type: "string",
    value: "<wei>",
    help: "Kitchen execution fee plus any native the program spends",
  },
  "rpc-url": {
    type: "string",
    value: "<url>",
    help: "Read the fee if --value is absent, and check the Pot",
  },
  "args-json": {
    type: "string",
    value: "<json|file>",
    help: "main's arguments as a JSON array, inline or in a file",
  },
  ...JSON_FLAG,
  ...HELP,
  // Never parsed as a flag: everything after it is main's arguments (see `runCli`).
  args: {
    type: "boolean",
    value: "<value>…",
    help: "Last: main's arguments in order (JSON for an array or tuple)",
  },
};

const POT_FLAGS: FlagSpecs = {
  owner: {
    type: "string",
    value: "<address>",
    help: "Who the Pot belongs to: cook() is onlyOwner",
  },
  chain: { type: "string", value: "<slug|id>", help: "The EVM chain the Pot is for" },
  salt: { type: "string", value: "<hex>", help: "Up to 32 bytes (default 0)" },
  ...JSON_FLAG,
  ...HELP,
};

const SKILLS_FLAGS: FlagSpecs = {
  dir: { type: "string", value: "<project>", help: "The project to install into (default .)" },
  force: { type: "boolean", help: "Overwrite installed files that were edited" },
  check: { type: "boolean", help: "Write nothing; exit 1 unless the installed copies match" },
  ...HELP,
};

const INIT_FLAGS: FlagSpecs = {
  force: { type: "boolean", help: "Overwrite files that already exist with other content" },
  install: { type: "boolean", help: "Run npm install in the project afterwards" },
  ...HELP,
};

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
function chainOf(args: ParsedArgs, file: string, text: string): CanonicalChain {
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
          : undefined;
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

function programInput(args: ParsedArgs, io: CliIo): ProgramInput {
  const file = fileOperand(args);
  const text = readInput(io, file);
  const definesFile = stringFlag(args, "defines");
  const deadline = stringFlag(args, "intent-deadline");
  const creator = stringFlag(args, "intent-creator");
  const fee = stringFlag(args, "intent-execution-fee");

  return {
    file,
    text,
    chain: chainOf(args, file, text),
    compactArgs: args.values["compact-args"] === true,
    defines: {
      ...(definesFile === undefined
        ? {}
        : parseDefinesFile(readInput(io, definesFile), definesFile)),
      ...parseDefines(repeatedFlag(args, "define")),
    },
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

function potInput(args: ParsedArgs): PotInput {
  const pot = stringFlag(args, "pot");
  const owner = stringFlag(args, "owner");
  const salt = stringFlag(args, "salt");
  if (pot !== undefined && owner !== undefined) {
    throw new UsageError("give --pot or --owner, not both");
  }
  if (pot !== undefined) {
    if (salt !== undefined) throw new UsageError("--salt goes with --owner: --pot names the Pot");

    return { pot: parseAddress("pot", pot) };
  }
  if (owner === undefined) {
    throw new UsageError("missing --pot <address> or --owner <address>: the Pot to cook on");
  }

  return {
    owner: parseAddress("owner", owner),
    salt: salt === undefined ? SAUCE_INTENT_POT_SALT : parseSalt(salt),
    saltGiven: salt !== undefined,
  };
}

const lines = (text: readonly string[]): CommandOutput => ({ text: text.join("\n"), json: {} });

const COMMANDS: Readonly<Record<string, Command>> = {
  compile: {
    usage: "sauce compile <file> --chain <slug|id> [options]",
    summary: "Compile a SauceScript program; print its bytecode",
    flags: COMPILE_FLAGS,
    details: [
      "Compiles the file as the SDK compiles a route body: the chain's token symbols (USDC),",
      "protocol namespaces (Uniswap.UniversalRouter), chainId, the zero-import @sauce/token",
      "functions, SafeERC20 token writes (USDC.transfer, Token(addr).approve) and intents opened",
      "inside the program all resolve against the chain. Relative imports are read from beside",
      "the file. A file may name its chain in its header: a leading `// @chain base` line.",
      "",
      "Example:",
      "  sauce compile pay.sauce.ts --chain base --define RECIPIENT=0x…",
    ].join("\n"),
    run: (args, io) => {
      const output = compileCommand(programInput(args, io), io);
      const out = stringFlag(args, "out");
      if (out === undefined) return output;
      io.writeText(out, `${render(output, args)}\n`);

      return undefined;
    },
  },
  tx: {
    usage: "sauce tx <file> --chain <slug|id> (--pot <address> | --owner <address>) [options]",
    summary: "Build the EVM transaction that runs a program on a Pot",
    flags: TX_FLAGS,
    details: [
      "Compiles the file as `sauce compile` does and prints the transaction that runs it:",
      "to = the Pot, data = Pot.cook(engine, program ++ arguments) on the released engine, and",
      "value. Also prints it as a `cast send` line; sign it with cast or any wallet. The Pot",
      "must exist and be funded, and the sender must be its owner. A main that declares",
      "parameters takes their values after --args, checked against the declared types.",
      "",
      "Examples:",
      "  sauce tx pay.sauce.ts --chain base --owner 0x… --value 0",
      "  sauce tx swap.sauce.ts --chain base --pot 0x… --value 0 --args 0x… 1000 true '[1,2]'",
    ].join("\n"),
    trailing: "args",
    run: (args, io, trailing) => {
      const value = stringFlag(args, "value");
      const rpcUrl = stringFlag(args, "rpc-url");

      return txCommand(
        {
          ...programInput(args, io),
          target: potInput(args),
          ...(value === undefined ? {} : { value: parseWei("value", value) }),
          ...(rpcUrl === undefined ? {} : { rpcUrl }),
          ...argsInput(args, io, trailing),
        },
        io,
      );
    },
  },
  pot: {
    usage: "sauce pot --owner <address> --chain <slug|id> [--salt <hex>]",
    summary: "Predict a Pot and build its Kitchen.deployPot transaction",
    flags: POT_FLAGS,
    details: [
      "The Pot's address is CREATE2 from the released Kitchen over (owner, salt), so it is known",
      "before it exists. Prints it, and the deployPot transaction that creates it.",
      "",
      "Example:",
      "  sauce pot --owner 0x… --chain base",
    ].join("\n"),
    run: (args) => {
      if (args.positionals.length > 0) {
        throw new UsageError(`unexpected argument ${args.positionals[0]}`);
      }
      const salt = stringFlag(args, "salt");

      return potCommand({
        chain: parseChain(requiredFlag(args, "chain", "<slug|id>")),
        owner: parseAddress("owner", requiredFlag(args, "owner", "<address>")),
        salt: salt === undefined ? SAUCE_INTENT_POT_SALT : parseSalt(salt),
      });
    },
  },
  skills: {
    usage: "sauce skills install [--dir <project>] [--force] [--check]",
    summary: "Install this package's agent skills into a project",
    flags: SKILLS_FLAGS,
    details: [
      "Copies the Claude Code agent skills that ship inside this package to",
      "<project>/.claude/skills/<name>/, and records what it wrote in .sauce-skills.json there.",
      "A later install replaces what it wrote but refuses a file somebody edited, unless --force.",
      "--check exits 1 when the installed copies differ from this version's, e.g. after an upgrade.",
    ].join("\n"),
    run: (args) => {
      const [sub, ...rest] = args.positionals;
      if (sub !== "install") {
        throw new UsageError(
          sub === undefined ? "missing subcommand: install" : `unknown subcommand '${sub}'`,
        );
      }
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
      const project = stringFlag(args, "dir") ?? ".";
      if (args.values.check === true) {
        if (args.values.force === true)
          throw new UsageError("--check writes nothing: drop --force");
        const differences = checkSkills(project, skillsSource());
        if (differences.length > 0) {
          throw new CliError(
            `the agent skills in ${project} are not this version's — run \`sauce skills install\`:\n` +
              differences.map((line) => `  ${line}`).join("\n"),
          );
        }

        return lines([`The agent skills in ${project} match this version.`]);
      }

      return lines(
        describeInstall(installSkills(project, skillsSource(), args.values.force === true)),
      );
    },
  },
  init: {
    usage: "sauce init [<dir>] [--force] [--install]",
    summary: "Scaffold a project that uses this package",
    flags: INIT_FLAGS,
    details: [
      "Writes package.json (pinning this exact version), CLAUDE.md, a .gitignore for local",
      "config, sauce.config.example.json (placeholders only), and the agent skills. It runs no",
      "package manager unless --install, which runs npm install.",
    ].join("\n"),
    run: (args, io) => {
      const [dir = ".", ...rest] = args.positionals;
      if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}: give one <dir>`);
      const result = initProject(dir, skillsSource(), args.values.force === true);
      io.stdout(
        [
          `Scaffolded ${dir}:`,
          ...result.files.map((file) => `  ${file.state.padEnd(10)} ${file.path}`),
          ...describeInstall(result.skills).map((line) => `  ${line}`),
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

/** What a command prints: its JSON object under `--json`, its lines otherwise. */
function render(output: CommandOutput, args: ParsedArgs): string {
  return args.values.json === true ? JSON.stringify(output.json, null, 2) : output.text;
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
    "sauce: compile SauceScript and build the transactions that run it.",
    "",
    "Usage: sauce <command> [options]",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(
      ([name, command]) => `  ${name.padEnd(width)}  ${command.summary}`,
    ),
    "",
    "Run `sauce <command> --help` for its options. Nothing here signs or sends a transaction,",
    "and nothing reaches a network unless you pass --rpc-url.",
    "",
  ].join("\n");
}

const commandNamed = (name: string | undefined): Command | undefined =>
  name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;

/** Runs `sauce <argv…>`, returning the exit code: 0, 1 for a failure, 2 for a usage error. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
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
    if (output !== undefined) io.stdout(`${render(output, args)}\n`);

    return 0;
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
