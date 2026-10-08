/**
 * What `sauce compile`, `tx`, `simulate`, `run` and `pot` compute. Each returns its result as the
 * lines a person reads and as the JSON a program reads; `run.ts` picks which to print.
 *
 * Every piece is the SDK's own: `compileSauceProgram` compiles the file as a standalone program with
 * the chain's ambient names, `encodeEntryArguments` encodes `main`'s arguments, `buildSauceEvmCall`
 * (`v12Pot.encodeCook`) is the cook, `v12PredictPot`, `potSalt` and `sauceEvmDeployPotCall` are the
 * Pot, and `destinationExecutionFee` is the Kitchen's fee. Nothing is reimplemented here; `chain.ts`
 * reads and sends, and `signer.ts` holds the key.
 */
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import {
  bytesToHex,
  getAddress,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import type { CanonicalChain } from "../chains/canonical.js";
import {
  v12DeployedAddresses,
  v12EngineAddress,
  v12KitchenAddress,
  v12SvmEngineProgramId,
} from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";

/** The released Kitchen, which deploys every Pot (`V12Deployments.json`). */
export const kitchenAddress = (): Address => getAddress(v12KitchenAddress());
import { encodeEntryArguments, type EntryParam, type EntryValue } from "../routes/entry.js";
import { MAX_SQRT_PRICE_X96, MIN_SQRT_PRICE_X96 } from "../price.js";
import { buildSauceEvmCall, sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceCompileOptions,
} from "../routes/sauce-route.js";
import { CliError, UsageError, type DefineValue, type SaltChoice } from "./args.js";
import {
  awaitPot,
  connect,
  kitchenFee,
  potState,
  releasedContracts,
  sendAndWait,
  type Released,
  type Sent,
  type TxRequest,
} from "./chain.js";
import { describeCompileError } from "./diagnostics.js";
import { linkLines, txLinks } from "./links.js";
import { cookReport, costJson, costLine, costOf } from "./receipt.js";
import { appliedDefines, usedContracts } from "./report.js";
import { entryReturnType } from "../routes/entry.js";
import type { CookVia } from "../svm/client.js";
import { svmCookSize } from "./solana.js";
import type { Funding } from "./funding.js";
import { previewRefusal, requireSupported, type PreviewChainRefusal } from "./support.js";

/** The filesystem the commands read, injected so the tests can drive them without a process. */
export interface CliFiles {
  /** A file's text. Throws when it cannot be read. */
  readonly readText: (path: string) => string;
  /** A file's bytes, or `undefined` when nothing is there — the compiler's resolver contract. */
  readonly readModule: (path: string) => Uint8Array | undefined;
}

export interface CommandOutput {
  /** For a person. */
  readonly text: string;
  /** For a program. Amounts are decimal strings. */
  readonly json: Record<string, unknown>;
  /** The same transaction as a `cast send` line, for a command that prints one. */
  readonly cast?: string;
  /** Advice about the result, printed to stderr so stdout stays the result alone. */
  readonly notes?: readonly string[];
  /** Nonzero when the result is a failure worth printing in full: a revert. */
  readonly exitCode?: number;
}

/**
 * A rehearsal's output with a failure that cannot be missed: `reverted: true` and `error`, the
 * reason, first in its JSON (an MCP client gets it as an error result), and the exit code 1. A
 * rehearsal that succeeded is returned as it is.
 */
export function revertedFirst(output: CommandOutput): CommandOutput {
  if (output.json.ok !== false) return output;
  const error =
    typeof output.json.reason === "string" ? output.json.reason : "the rehearsal failed";

  return {
    ...output,
    json: { reverted: true, error, ...output.json },
    exitCode: output.exitCode ?? 1,
  };
}

/**
 * `output`, a rehearsal's, held to an expected revert: one whose reason contains `expected` is the
 * result asked for (`ok` and `asExpected`, exit 0), still `reverted`; a success, or a revert for
 * another reason, is not (exit 1). The first line says which.
 */
export function expectingRevert(output: CommandOutput, expected: string): CommandOutput {
  const reverted = output.json.reverted === true;
  const error = String(output.json.error ?? "");
  const asExpected = reverted && error.includes(expected);
  const first = asExpected
    ? `As expected, the cook reverts: ${error}`
    : reverted
      ? `Expected a revert with "${expected}", but the cook reverts: ${error}`
      : `Expected a revert with "${expected}", but the cook succeeds`;

  return {
    ...output,
    text: `${first}\n${output.text}`,
    json: { ...output.json, ok: asExpected, expectRevert: expected, asExpected },
    exitCode: asExpected ? 0 : 1,
  };
}

/** What every compiling command takes. */
export interface ProgramInput {
  /** The program's file, or `<stdin>` for a program read from stdin. */
  readonly file: string;
  /** The file's text, already read: its header chose `chain`. */
  readonly text: string;
  /** The program came from stdin (`-`): it has no directory of its own. */
  readonly stdin?: boolean;
  /** Where its relative imports resolve: `--source-dir`, else beside the file (stdin: `.`). */
  readonly sourceDir?: string;
  readonly chain: CanonicalChain;
  readonly defines: Record<string, DefineValue>;
  /** The defines whose value was written as an address (`args.ts#addressDefines`), which a
   *  report shows as one. */
  readonly addressDefines?: readonly string[];
  /** Compile `main`'s parameters for compact-v1 arguments instead of ABI-v1. */
  readonly compactArgs: boolean;
  /**
   * ABI bindings the program calls through without declaring them — an actions document's
   * (`actions.ts`), whose generated source names `IErc20` and the like. Absent for a file.
   */
  readonly contracts?: SauceCompileOptions["contracts"];
}

/** An input file's text — the program, a defines file — or a precise reason it has none. */
export function readInput(files: CliFiles, file: string): string {
  try {
    return files.readText(file);
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliError(
      code === "ENOENT" ? `${file}: no such file` : `${file}: ${(error as Error).message}`,
    );
  }
}

/** A `cast send` of exactly `to`/`data`/`value`, with the endpoint and key left to the reader —
 *  never filled in from `--rpc-url`, whose URL often carries a provider key. */
export function castSend(to: Address, data: Hex, value?: bigint): string {
  return [
    "cast send",
    to,
    data,
    ...(value === undefined ? [] : ["--value", value.toString()]),
    "--rpc-url",
    "<RPC_URL>",
    "--private-key",
    "<PRIVATE_KEY>",
  ].join(" ");
}

/**
 * The options every compile here runs with, on top of the chain's ambient names that
 * `compileSauceProgram` adds itself: the defines, the argument encoding, and a resolver that serves
 * the program's own relative imports from beside the file.
 */
function compileOptions(input: ProgramInput, files: CliFiles): SauceCompileOptions {
  const dir = sourceDirOf(input);

  return {
    defines: input.defines,
    ...(input.compactArgs ? { compactArgs: true } : {}),
    ...(input.contracts === undefined ? {} : { contracts: input.contracts }),
    resolve: (path) => files.readModule(resolvePath(dir, path)),
  };
}

/** The directory a program's relative imports resolve against. */
export const sourceDirOf = (input: ProgramInput): string =>
  resolvePath(input.sourceDir ?? (input.stdin === true ? "." : dirname(resolvePath(input.file))));

/** Compiles the file as a standalone program, turning a failure into one message about the file. */
export function compileProgram(input: ProgramInput, files: CliFiles): CompiledSauceProgram {
  try {
    return compileSauceProgram(input.chain, input.text, compileOptions(input, files));
  } catch (error) {
    const described = describeCompileError(error, input.file, input.text, input.chain);
    // A relative import that did not resolve, from a program with no directory of its own.
    const imports = input.stdin === true && /import|resolv|\.\//i.test(String(error));
    throw new CliError(
      `${input.file} does not compile for ${input.chain.slug}\n${described}` +
        (imports
          ? `\nhint: the program came from stdin, so its relative imports resolve against ` +
            `${sourceDirOf(input)}: pass --source-dir <dir> to resolve them elsewhere`
          : ""),
    );
  }
}

/** The chains a cook of `input` is refused by — what {@link requireSupported} is asked about
 *  before anything that sends it: its own. */
export function programChains(input: ProgramInput): CanonicalChain[] {
  return [input.chain];
}

/** The installed compiler's package name and version, read from its own manifest. */
function compilerPackage(): { name: string; version: string } {
  const require = createRequire(import.meta.url);
  // The entry (`node/sauce_wasm.js`) sits one level under the package root, and the package's
  // `exports` does not list `package.json` itself.
  const manifest = resolvePath(dirname(require.resolve("sauce-compiler")), "..", "package.json");
  const { name, version } = require(manifest) as { name: string; version: string };

  return { name, version };
}

/** The released engine a program for `chain` runs on, from the release record the SDK ships. */
function pairedEngine(chain: CanonicalChain): Record<string, string> {
  const releases = v12DeployedAddresses().releases;
  if (chain.kind === "svm") {
    const { version, commit } = releases["v12-svm"];

    return { release: "v12-svm", version, commit, programId: v12SvmEngineProgramId() };
  }
  const { version, commit } = releases["v12-evm"];

  return { release: "v12-evm", version, commit, address: getAddress(v12EngineAddress()) };
}

/** `main(name: Type, …)`, as the program declares its runtime parameters. */
const signatureOf = (params: readonly EntryParam[]): string =>
  `main(${params.map((param) => `${param.name}: ${param.type}`).join(", ")})`;

export interface CompileInput extends ProgramInput {
  /** `main`'s arguments, when given: they size the payload a cook carries. */
  readonly args?: ArgsInput;
  /** Solana: accounts by slot name, as `--account` gives them, for sizing the cook. */
  readonly accounts?: Readonly<Record<string, string>>;
  /** Solana: size the Kitchen's cook (the default) or the engine's direct one. */
  readonly via?: CookVia;
}

/**
 * `sauce compile`: the program's bytecode, and with `--json` what it pairs with and takes, what it
 * was compiled with — the defines it reads and the protocol contracts it calls, each with where it
 * came from — and how large it is: the program, the payload with `main`'s arguments, and on Solana
 * the cook's transaction against the one-transaction limit.
 */
export async function compileCommand(input: CompileInput, files: CliFiles): Promise<CommandOutput> {
  const program = compileProgram(input, files);
  const bytecode = bytesToHex(program.bytecode);
  const { defines, unread } = appliedDefines(
    input.text,
    input.chain,
    input.defines,
    new Set(input.addressDefines ?? []),
  );
  // The payload is the program with its arguments appended: known once the arguments are.
  const payload =
    input.args === undefined && program.entryParams.length > 0
      ? undefined
      : hexToBytes(payloadOf(program, input.args));
  const cook =
    input.chain.kind === "svm" && payload !== undefined
      ? await svmCookSize(
          payload,
          program.manifest ?? { accounts: [] },
          input.accounts ?? {},
          input.via,
        )
      : undefined;
  const notes = [
    ...priceLimitNotes(input, program.entryParams, input.args),
    ...unread.map(
      (name) =>
        `--define ${name}: ${input.file} never reads ${name}, so the define changes nothing`,
    ),
    ...(cook === undefined || cook.fits
      ? []
      : [
          `the cook is a ${cook.size}-byte transaction, past Solana's ${cook.limit}: \`sauce run\` ` +
            "stages the program in a code buffer first; `sauce simulate` and `sauce tx` cannot",
        ]),
  ];

  return {
    text: bytecode,
    json: {
      chain: input.chain.slug,
      chainId: input.chain.id,
      target: input.chain.kind,
      bytecode,
      size: program.bytecode.length,
      payload:
        payload === undefined
          ? null
          : { size: payload.length, argumentsSize: payload.length - program.bytecode.length },
      ...(cook === undefined ? {} : { cook }),
      entryEncoding: program.entryEncoding,
      entryParams: program.entryParams,
      entrySchema: program.entrySchema === undefined ? null : bytesToHex(program.entrySchema),
      // What main returns, as it declares it: `simulate` reads the cook's return data as this.
      returnType: entryReturnType(program.entrySignature) ?? null,
      defines,
      contracts: usedContracts(input.text, input.chain),
      compiler: compilerPackage(),
      engine: pairedEngine(input.chain),
      ...(program.manifest === undefined ? {} : { manifest: program.manifest }),
    },
    ...(notes.length === 0 ? {} : { notes }),
  };
}

// ---------------------------------------------------------------------------------------------
// The cook: the program, its arguments, and the Pot it runs on
// ---------------------------------------------------------------------------------------------

/** `main`'s arguments as given: `--args` strings, or `--args-json` values. */
export type ArgsInput =
  | { readonly from: "--args"; readonly values: readonly string[] }
  | { readonly from: "--args-json"; readonly values: readonly unknown[] };

/**
 * The values to encode for `params`. A `--args` string is the value itself, except for an array or
 * tuple parameter, which takes JSON (`[1, 2]`, `{"amount": 1}`); `--args-json` values are taken as
 * parsed. `encodeEntryArguments` then checks every one against its declared type.
 */
function argumentValues(params: readonly EntryParam[], args: ArgsInput): EntryValue[] {
  if (args.from === "--args-json") return args.values as EntryValue[];

  return args.values.map((raw, index) => {
    const param = params[index];
    if (param === undefined || !/^\{|\[\]$/.test(param.type.trim())) return raw;
    try {
      return JSON.parse(raw) as EntryValue;
    } catch {
      throw new UsageError(
        `--args: argument ${index + 1} (${param.name}: ${param.type}) takes JSON, such as ` +
          `${param.type.trim().startsWith("{") ? '{"field": 1}' : "[1, 2]"}; got '${raw}'`,
      );
    }
  });
}

/** A define or parameter whose name says it is a pool's price limit. */
const LIMIT_NAME = /sqrt.*price|price.*limit|sqrt.*limit/i;

/**
 * A note for each price limit — a define or one of `main`'s arguments named like one
 * (`SQRT_PRICE_LIMIT_X96`, `sqrtPriceLimitX96`) — at or past the bounds a V3-style pool takes. A
 * pool takes a limit strictly between MIN_SQRT_RATIO and MAX_SQRT_RATIO and reverts "SPL" at
 * either, so such a limit cannot fill; `0` is the library's "no limit", and is left alone.
 */
export function priceLimitNotes(
  input: Pick<ProgramInput, "defines">,
  params: readonly EntryParam[],
  args: ArgsInput | undefined,
): string[] {
  const values: Array<[string, bigint]> = Object.entries(input.defines).flatMap(
    ([name, value]): Array<[string, bigint]> =>
      LIMIT_NAME.test(name) && typeof value === "bigint" ? [[name, value]] : [],
  );
  if (args !== undefined) {
    params.forEach((param, index) => {
      const raw = args.values[index];
      if (!LIMIT_NAME.test(param.name) || param.type.trim() !== "Uint256") return;
      if (typeof raw === "string" && /^(\d+|0x[0-9a-fA-F]+)n?$/.test(raw)) {
        values.push([param.name, BigInt(raw.replace(/n$/, ""))]);
      } else if (typeof raw === "number" && Number.isSafeInteger(raw)) {
        values.push([param.name, BigInt(raw)]);
      }
    });
  }

  return values.flatMap(([name, value]) => {
    if (value === 0n || (value > MIN_SQRT_PRICE_X96 && value < MAX_SQRT_PRICE_X96)) return [];
    const where =
      value === MIN_SQRT_PRICE_X96
        ? "is MIN_SQRT_RATIO"
        : value === MAX_SQRT_PRICE_X96
          ? "is MAX_SQRT_RATIO"
          : value < MIN_SQRT_PRICE_X96
            ? "is below MIN_SQRT_RATIO"
            : "is past MAX_SQRT_RATIO";

    return [
      `${name} = ${value} ${where}: a V3-style pool takes a price limit strictly between ` +
        `${MIN_SQRT_PRICE_X96} and ${MAX_SQRT_PRICE_X96}, and reverts "SPL" at or past either. ` +
        "0 is no limit; `sauce price` gives the limit for a price",
    ];
  });
}

/** Rewrites `main`'s values, and the parameters they are encoded for, before they are encoded. */
export type AdaptArguments = (
  program: CompiledSauceProgram,
  values: EntryValue[],
) => { readonly program: CompiledSauceProgram; readonly values: EntryValue[] };

/**
 * The program with its encoded arguments appended: the `program` a cook runs. `adapt` sees the
 * values first (on Solana it turns a public key into the word the engine reads).
 */
export function payloadOf(
  program: CompiledSauceProgram,
  args: ArgsInput | undefined,
  adapt?: AdaptArguments,
): Hex {
  const params = program.entryParams;
  if (args === undefined) {
    if (params.length > 0) {
      throw new UsageError(
        `${signatureOf(params)} takes ${params.length} argument${params.length === 1 ? "" : "s"}: ` +
          "pass them after --args, in order, or as --args-json",
      );
    }

    return bytesToHex(program.bytecode);
  }
  let encoded: Uint8Array;
  try {
    const values = argumentValues(params, args);
    const adapted = adapt === undefined ? { program, values } : adapt(program, values);
    encoded = encodeEntryArguments(adapted.program, adapted.values);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`${args.from}: ${(error as Error).message}`);
  }

  return `${bytesToHex(program.bytecode)}${bytesToHex(encoded).slice(2)}` as Hex;
}

/** Where a cook runs: a Pot named outright, or derived from its owner and salt. */
export type PotInput = { readonly pot: Address } | ({ readonly owner: Address } & SaltChoice);

export interface CookInput extends ProgramInput {
  readonly target: PotInput;
  /** Values for `main`'s parameters; required exactly when it declares some. */
  readonly args?: ArgsInput;
  /** The cook's value; the Kitchen's fee is read when it is absent and an endpoint is given. */
  readonly value?: bigint;
  /**
   * `--fund`: called once the Pot is known to be there, with its owner, it makes what funding the
   * cook needs and returns how to wrap the program (`funding.ts`).
   */
  readonly fund?: (
    client: PublicClient,
    pot: Address,
    owner: Address,
    /** Only plan: say what it would need approved (`Funding.needs`), and send nothing. */
    plan?: boolean,
  ) => Promise<Funding>;
}

export interface Cook {
  readonly pot: Address;
  readonly engine: Address;
  readonly data: Hex;
  readonly program: CompiledSauceProgram;
}

/** Compiles the file and builds the cook on its Pot — what `tx`, `simulate` and `run` all send. */
export function cookOf(input: CookInput, files: CliFiles): Cook {
  if (input.chain.kind !== "evm") {
    throw new Error(`internal: ${input.chain.slug}'s cook is built by solana.ts`);
  }
  const target = input.target;
  const pot = "pot" in target ? target.pot : (v12PredictPot(target.owner, target.salt) as Address);
  const engine = getAddress(v12EngineAddress());
  const program = compileProgram(input, files);
  // The cook `compileSauceRoute` would build, over the program with its arguments appended — the
  // way the SDK's own intent children carry theirs.
  const data = buildSauceEvmCall({ pot, engine, program: payloadOf(program, input.args) }).data;

  return { pot, engine, data, program };
}

/** The `sauce pot` that deploys `target`'s Pot. */
function deployHint(chain: CanonicalChain, target: PotInput): string {
  // Any account may send the deployment; the hint names the owner, whose Pot it is.
  return "owner" in target
    ? `sauce pot --deploy --owner ${target.owner} --chain ${chain.slug}${target.flag === undefined ? "" : ` ${target.flag}`} --keystore <keystore>`
    : `sauce pot --deploy --chain ${chain.slug} --keystore <its owner's keystore>`;
}

/** The cook's value: as given, or the Kitchen's fee — refusing a given one below the fee. */
export function valueOf(
  given: bigint | undefined,
  fee: bigint | undefined,
  chain: CanonicalChain,
): bigint {
  if (given !== undefined && fee !== undefined && given < fee) {
    throw new CliError(
      `--value ${given} is below the Kitchen's execution fee on ${chain.slug}, ${fee} wei: the ` +
        "cook would revert with FeeNotPaid",
    );
  }
  const value = given ?? fee;
  if (value === undefined) {
    throw new UsageError(
      "missing --value <wei>: the cook pays the Kitchen's execution fee plus any native the " +
        "program spends. Pass it, or an RPC endpoint (--rpc-url or --config) to read the fee.",
    );
  }

  return value;
}

export interface TxInput extends CookInput {
  /** An endpoint, when given: it reads the fee and checks the Pot. */
  readonly rpcUrl?: string;
}

/** `sauce tx`: the unsigned cook transaction, for any wallet to sign. */
export async function txCommand(input: TxInput, files: CliFiles): Promise<CommandOutput> {
  if (input.value === undefined && input.rpcUrl === undefined)
    valueOf(undefined, undefined, input.chain);
  const cook = cookOf(input, files);
  requireSupported("building the cook transaction", [input.chain]);
  const client = input.rpcUrl === undefined ? undefined : await connect(input.rpcUrl, input.chain);
  const fee = client === undefined ? undefined : await kitchenFee(client, input.chain);
  const state = client === undefined ? undefined : await potState(client, cook.pot);
  const value = valueOf(input.value, fee, input.chain);
  const target = input.target;
  const owner = state?.owner ?? ("owner" in target ? target.owner : undefined);
  const notes = [
    "owner" in target
      ? `Pot ${cook.pot} belongs to ${target.owner} (salt ${target.salt}).`
      : `Pot ${cook.pot}.`,
    state === undefined
      ? `It must be deployed (${deployHint(input.chain, target)}) and funded with what the ` +
        "program spends; pass an RPC endpoint to check."
      : state.deployed
        ? "It is deployed. Fund it with what the program spends."
        : `It is NOT deployed. Deploy it first (${deployHint(input.chain, target)}), then fund it.`,
    `Send from ${owner ?? "the Pot's owner"}: cook() is onlyOwner.`,
  ];
  const json = { chainId: input.chain.id, to: cook.pot, data: cook.data, value: value.toString() };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    cast: castSend(cook.pot, cook.data, value),
    notes,
  };
}

/** How `simulate` and `run` reach the chain. */
export interface ChainAccess {
  readonly rpcUrl: string;
}

const sentText = (what: string, sent: Sent): string =>
  `${what} ${sent.hash}: ${sent.status}, gas used ${sent.gasUsed}, block ${sent.blockNumber}` +
  (sent.reason === undefined ? "" : `, reverted: ${sent.reason}`);

/** A sent transaction's line, then where a person opens it: its explorer page and its trace. */
const sentLines = (what: string, sent: Sent, chain: CanonicalChain): string[] => [
  sentText(what, sent),
  ...linkLines(txLinks(chain, sent.hash)),
];

const sentJson = (sent: Sent, chain: CanonicalChain): Record<string, unknown> => ({
  hash: sent.hash,
  ...txLinks(chain, sent.hash),
  status: sent.status,
  gasUsed: sent.gasUsed.toString(),
  blockNumber: sent.blockNumber.toString(),
  ...(sent.reason === undefined ? {} : { reason: sent.reason }),
});

/** Asks a yes/no question at the terminal; `undefined` when there is no terminal to ask on. */
export type Confirm = (question: string) => Promise<boolean | undefined>;

/**
 * Who approves what a run does before its cook, each a transaction of its own: deploying a missing
 * Pot, approving Permit2 for a token, approving the Pot for an amount. The person at the terminal,
 * asked each in turn — or `--auto-approve`, which approves them all and says so for each.
 */
export interface Approver {
  /** `--auto-approve`. */
  readonly auto: boolean;
  /** Whether a question can reach anyone: false with no terminal to ask on. */
  readonly canAsk: boolean;
  /**
   * Approves `action` (`deploy Pot 0x…`): with `--auto-approve`, says `auto-approved: <action>` and
   * goes ahead; else asks `question`. `undefined` when there is no one to ask.
   */
  readonly approve: (action: string, question: string) => Promise<boolean | undefined>;
}

/**
 * Refuses a run that needs approvals with no terminal to ask on, before anything is sent: naming
 * every action it would need approved, and how to approve them.
 */
export function unapproved(actions: readonly string[]): CliError {
  return new CliError(
    `nothing was sent: this run needs ${actions.length === 1 ? "an approval" : "approvals"}, and ` +
      "there is no terminal to ask on:\n" +
      actions.map((action) => `  ${action}\n`).join("") +
      "Pass --auto-approve to approve them (and --password-file with a keystore).",
  );
}

export interface RunInput extends CookInput, ChainAccess {
  readonly account: PrivateKeyAccount;
  readonly approver: Approver;
  /** Called with the cook once it is sent, for what it published (the store); returns notes. */
  readonly onSent?: (sent: Sent) => Promise<readonly string[]>;
}

/** `sauce run`: compile, sign, send and wait — deploying the Pot first once it is agreed to. */
export async function runCommand(input: RunInput, files: CliFiles): Promise<CommandOutput> {
  const signer = input.account.address;
  const target = input.target;
  if ("owner" in target && getAddress(target.owner) !== signer) {
    throw new UsageError(
      `--owner ${target.owner} is not the signer, ${signer}: cook() is onlyOwner, so the Pot a ` +
        "run cooks on must be the signer's. Leave --owner out to use the signer's own.",
    );
  }
  const cook = cookOf(input, files);
  requireSupported("sending the cook", [input.chain]);
  const client = await connect(input.rpcUrl, input.chain);
  const state = await potState(client, cook.pot);
  const deployAction = `deploy Pot ${cook.pot}`;
  // With no one to ask, every approval the run would need is named before anything is sent.
  if (!input.approver.auto && !input.approver.canAsk) {
    const needs = [
      ...(!state.deployed && "owner" in target ? [deployAction] : []),
      ...(input.fund === undefined
        ? []
        : ((await input.fund(client, cook.pot, signer, true)).needs ?? [])),
    ];
    if (needs.length > 0) throw unapproved(needs);
  }
  let deployed: Sent | undefined;
  if (!state.deployed) {
    const missing = `Pot ${cook.pot} is not deployed on ${input.chain.slug}`;
    if (!("owner" in target)) {
      throw new CliError(`${missing}. Deploy it first: ${deployHint(input.chain, target)}`);
    }
    const agreed = await input.approver.approve(
      deployAction,
      `Pot ${cook.pot} (owner ${target.owner}, salt ${target.salt}) is not deployed on ` +
        `${input.chain.slug}. Deploy it now? [y/N] `,
    );
    if (agreed !== true) {
      throw new CliError(
        agreed === undefined
          ? `${missing}. Deploy it first (${deployHint(input.chain, target)}), or pass ` +
              "--auto-approve to deploy it before the cook"
          : `${missing}, so nothing was sent. Deploy it with: ${deployHint(input.chain, target)}`,
      );
    }
    const deploy = sauceEvmDeployPotCall({
      kitchen: kitchenAddress(),
      owner: target.owner,
      salt: target.salt,
    });
    deployed = await sendAndWait(client, input.rpcUrl, input.account, {
      to: kitchenAddress(),
      data: deploy.data,
      value: 0n,
    });
    if (deployed.status !== "success") {
      throw new CliError(`${sentText("deploying the Pot", deployed)}; the Pot is not there`);
    }
    // The cook is rehearsed next: on an endpoint behind the deployment it would "succeed" on an
    // address with no code, so wait until the endpoint shows the Pot.
    await awaitPot(client, cook.pot, deployed.blockNumber);
  } else if (state.owner !== signer) {
    throw new CliError(
      `Pot ${cook.pot} belongs to ${state.owner}, not the signer ${signer}: cook() is onlyOwner`,
    );
  }
  // Funding, once the Pot is there: approvals and transfers it needs first, the signatures the pulls
  // carry, and the program wrapped to pull, run and sweep.
  const funding = input.fund === undefined ? undefined : await input.fund(client, cook.pot, signer);
  const funded =
    funding === undefined ? cook : cookOf({ ...input, text: funding.wrap(input.text) }, files);
  const value =
    valueOf(input.value, await kitchenFee(client, input.chain), input.chain) +
    (funding?.value ?? 0n);
  const request: TxRequest = { to: cook.pot, data: funded.data, value };
  const sent = await sendAndWait(client, input.rpcUrl, input.account, request);
  const stored = input.onSent === undefined ? [] : await input.onSent(sent);
  const notes = [...(funding?.notes ?? []), ...stored];
  // What the cook cost, and what it moved, from its receipt.
  const cost = sent.receipt === undefined ? undefined : costOf(sent.receipt, value);
  const report =
    sent.receipt === undefined || sent.status !== "success"
      ? undefined
      : // The cook was sent: a failure to read its receipt back is a note, never the result.
        await cookReport(client, input.chain, sent.receipt, {
          sender: signer,
          pot: cook.pot,
          wallet: "your wallet",
        }).catch((error: unknown) => {
          notes.push(
            `what the cook moved could not be read back: ${(error as { shortMessage?: string }).shortMessage ?? "the endpoint failed"}`,
          );

          return undefined;
        });
  notes.push(...(report?.notes ?? []));

  return {
    text: [
      ...(deployed === undefined
        ? []
        : sentLines(`deployed Pot ${cook.pot} in`, deployed, input.chain)),
      ...(funding?.sent ?? []).flatMap((step) => sentLines(step.what, step.sent, input.chain)),
      ...sentLines("cook", sent, input.chain),
      ...(cost === undefined
        ? []
        : [costLine(cost, input.chain, "the Kitchen's fee and any native the program spends")]),
      ...(report?.left ?? []),
      ...(report?.lines ?? []),
    ].join("\n"),
    json: {
      chain: input.chain.slug,
      from: signer,
      pot: cook.pot,
      value: value.toString(),
      ...(report === undefined ? {} : { leftInPot: report.leftInPot }),
      ...(deployed === undefined ? {} : { deployPot: sentJson(deployed, input.chain) }),
      ...(funding === undefined
        ? {}
        : {
            funding: funding.sent.map((step) => ({
              what: step.what,
              ...sentJson(step.sent, input.chain),
            })),
          }),
      cook: {
        ...sentJson(sent, input.chain),
        ...(cost === undefined ? {} : { cost: costJson(cost) }),
        ...(report === undefined ? {} : { effects: report.effects }),
      },
    },
    ...(notes.length === 0 ? {} : { notes }),
    ...(sent.status === "success" ? {} : { exitCode: 1 }),
  };
}

// ---------------------------------------------------------------------------------------------
// The Pot
// ---------------------------------------------------------------------------------------------

export interface PotCommandInput extends SaltChoice {
  readonly chain: CanonicalChain;
  readonly owner: Address;
}

/** What refuses the Pot's deployment on a preview chain: `sauce pot` predicts it there, and no more. */
const POT_DEPLOYMENT = "building the Pot's deployment";

/**
 * `sauce pot`: the Pot an owner and salt give, and the unsigned Kitchen call that deploys it. On a
 * preview chain only the prediction: the deployment is left out, and `refused` says why.
 */
export function potCommand(input: PotCommandInput): CommandOutput {
  if (input.chain.kind !== "evm") {
    throw new Error(`internal: ${input.chain.slug}'s Pot is predicted by solana.ts`);
  }
  const kitchen = kitchenAddress();
  const pot = v12PredictPot(input.owner, input.salt) as Address;
  const predicted = { chainId: input.chain.id, pot, owner: input.owner, salt: input.salt, kitchen };
  const refused: PreviewChainRefusal | undefined = previewRefusal(POT_DEPLOYMENT, [input.chain]);
  if (refused !== undefined) {
    const json = { ...predicted, refused };

    return { text: JSON.stringify(json, null, 2), json, notes: [refused.message] };
  }
  const call = sauceEvmDeployPotCall({ kitchen, owner: input.owner, salt: input.salt });
  const json = { ...predicted, to: kitchen, data: call.data, value: "0" };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    cast: castSend(kitchen, call.data),
    notes: [
      `This is Kitchen.deployPot on the released Kitchen. Any account may send it: the Pot is ` +
        `${input.owner}'s either way, and it deploys once.`,
    ],
  };
}

/** What `sauce pot` reads off a chain: the released engine and Kitchen, and the Pot. */
function deploymentLines(
  chain: CanonicalChain,
  released: Released,
  pot: Address,
  state: { readonly deployed: boolean; readonly owner?: Address },
): { json: Record<string, unknown>; notes: string[] } {
  const there = (deployed: boolean) => (deployed ? "deployed" : "NOT deployed");
  const { engine, kitchen } = released;

  return {
    json: {
      engine: { address: engine.address, deployed: engine.deployed },
      kitchen: {
        address: kitchen.address,
        deployed: kitchen.deployed,
        ...(kitchen.executionFee === undefined
          ? {}
          : { executionFee: kitchen.executionFee.toString() }),
      },
      pot: {
        address: pot,
        deployed: state.deployed,
        ...(state.owner === undefined ? {} : { owner: state.owner }),
      },
    },
    notes: [
      `On ${chain.slug}: the engine ${engine.address} is ${there(engine.deployed)}; the Kitchen ` +
        `${kitchen.address} is ${there(kitchen.deployed)}` +
        (kitchen.executionFee === undefined
          ? ""
          : `, its execution fee ${kitchen.executionFee} wei`) +
        `; the Pot ${pot} is ${there(state.deployed)}` +
        (state.owner === undefined ? "." : `, owned by ${state.owner}.`),
      ...(kitchen.deployed
        ? []
        : [
            `The released Kitchen has no code on ${chain.slug}: no Pot can be deployed there, and no ` +
              "cook runs.",
          ]),
      ...(engine.deployed || !kitchen.deployed
        ? []
        : [
            `The released engine has no code on ${chain.slug}: a cook there has nothing to run on.`,
          ]),
    ],
  };
}

/** `sauce pot` with an endpoint: the prediction, and what is deployed on the chain. */
export async function potStatusCommand(
  input: PotCommandInput & ChainAccess,
): Promise<CommandOutput> {
  const predicted = potCommand(input);
  const pot = predicted.json.pot as Address;
  const client = await connect(input.rpcUrl, input.chain);
  const [released, state] = await Promise.all([releasedContracts(client), potState(client, pot)]);
  const deployment = deploymentLines(input.chain, released, pot, state);
  const json = { ...predicted.json, deployment: deployment.json };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    ...(predicted.cast === undefined ? {} : { cast: predicted.cast }),
    notes: [
      ...deployment.notes,
      ...(state.deployed && predicted.cast !== undefined ? [] : (predicted.notes ?? [])),
    ],
  };
}

/** `sauce pot --deploy`: sends the Kitchen call, unless the Pot is already there. */
export async function potDeployCommand(
  input: PotCommandInput & ChainAccess & { readonly account: PrivateKeyAccount },
): Promise<CommandOutput> {
  requireSupported("deploying a Pot", [input.chain]);
  const predicted = potCommand(input);
  const pot = predicted.json.pot as Address;
  const client = await connect(input.rpcUrl, input.chain);
  const released = await releasedContracts(client);
  // A deployPot sent to an address with no code "succeeds" and deploys nothing.
  if (!released.kitchen.deployed) {
    throw new CliError(
      `the released Kitchen ${released.kitchen.address} has no code on ${input.chain.slug}: no Pot ` +
        "can be deployed there, so nothing was sent",
    );
  }
  const state = await potState(client, pot);
  if (state.deployed) {
    const json = { ...predicted.json, deployed: true, owner: state.owner };
    const note = `Pot ${pot} is already deployed on ${input.chain.slug}, owned by ${state.owner}.`;

    return { text: JSON.stringify(json, null, 2), json, notes: [note] };
  }
  const sent = await sendAndWait(client, input.rpcUrl, input.account, {
    to: predicted.json.to as Address,
    data: predicted.json.data as Hex,
    value: 0n,
  });
  // Deployed means the endpoint shows its code, not only that a receipt said success.
  if (sent.status === "success") await awaitPot(client, pot, sent.blockNumber);
  const sender = input.account.address;
  const json = {
    ...predicted.json,
    deployed: sent.status === "success",
    sender,
    deployPot: sentJson(sent, input.chain),
  };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [
      ...sentLines(`deployed Pot ${pot} in`, sent, input.chain).map((line) => line.trim()),
      ...(getAddress(input.owner) === sender
        ? []
        : [
            `The Pot is ${input.owner}'s: ${sender} sent and paid for the deployment, and has no ` +
              "control over it.",
          ]),
    ],
    ...(sent.status === "success" ? {} : { exitCode: 1 }),
  };
}
