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
import { bytesToHex, getAddress, type Address, type Hex, type PublicClient } from "viem";
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
import { buildSauceEvmCall, sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceCompileOptions,
} from "../routes/sauce-route.js";
import { CliError, UsageError, type DefineValue, type SaltChoice } from "./args.js";
import { connect, kitchenFee, potState, sendAndWait, type Sent, type TxRequest } from "./chain.js";
import { describeCompileError } from "./diagnostics.js";
import type { Funding } from "./funding.js";

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

/** What every compiling command takes. */
export interface ProgramInput {
  readonly file: string;
  /** The file's text, already read: its header chose `chain`. */
  readonly text: string;
  readonly chain: CanonicalChain;
  readonly defines: Record<string, DefineValue>;
  /** Compile `main`'s parameters for compact-v1 arguments instead of ABI-v1. */
  readonly compactArgs: boolean;
  /** `Chain(() => …).reward(…)` inside the program: what the SDK cannot look up. */
  readonly intents: {
    readonly deadline?: bigint;
    readonly creator?: Address;
    readonly executionFee?: bigint;
  };
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
 * `compileSauceProgram` adds itself: the defines, the intent settings, the argument encoding, and a
 * resolver that serves the program's own relative imports from beside the file.
 */
function compileOptions(input: ProgramInput, files: CliFiles): SauceCompileOptions {
  const dir = dirname(resolvePath(input.file));
  const { deadline, creator, executionFee } = input.intents;
  const intents = {
    ...(deadline === undefined ? {} : { deadline }),
    ...(creator === undefined ? {} : { creator }),
    ...(executionFee === undefined ? {} : { executionFee }),
  };

  return {
    defines: input.defines,
    ...(Object.keys(intents).length === 0 ? {} : { intents }),
    ...(input.compactArgs ? { compactArgs: true } : {}),
    resolve: (path) => files.readModule(resolvePath(dir, path)),
  };
}

/** Compiles the file as a standalone program, turning a failure into one message about the file. */
export function compileProgram(input: ProgramInput, files: CliFiles): CompiledSauceProgram {
  try {
    return compileSauceProgram(input.chain, input.text, compileOptions(input, files));
  } catch (error) {
    throw new CliError(
      `${input.file} does not compile for ${input.chain.slug}\n` +
        describeCompileError(error, input.file, input.text, input.chain),
    );
  }
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

/** `sauce compile`: the program's bytecode, and with `--json` what it pairs with and takes. */
export function compileCommand(input: ProgramInput, files: CliFiles): CommandOutput {
  const program = compileProgram(input, files);
  const bytecode = bytesToHex(program.bytecode);

  return {
    text: bytecode,
    json: {
      chain: input.chain.slug,
      chainId: input.chain.id,
      target: input.chain.kind,
      bytecode,
      size: program.bytecode.length,
      entryEncoding: program.entryEncoding,
      entryParams: program.entryParams,
      entrySchema: program.entrySchema === undefined ? null : bytesToHex(program.entrySchema),
      compiler: compilerPackage(),
      engine: pairedEngine(input.chain),
      ...(program.manifest === undefined ? {} : { manifest: program.manifest }),
    },
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

/** The program with its encoded arguments appended: the `program` a cook runs. */
export function payloadOf(program: CompiledSauceProgram, args: ArgsInput | undefined): Hex {
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
    encoded = encodeEntryArguments(program, argumentValues(params, args));
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
  readonly fund?: (client: PublicClient, pot: Address, owner: Address) => Promise<Funding>;
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
  // `--deploy` signs as the owner, so the hint names the owner and where its key goes.
  return "owner" in target
    ? `sauce pot --deploy --owner ${target.owner} --chain ${chain.slug}${target.flag === undefined ? "" : ` ${target.flag}`} --keystore <its keystore>`
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

const sentJson = (sent: Sent): Record<string, unknown> => ({
  hash: sent.hash,
  status: sent.status,
  gasUsed: sent.gasUsed.toString(),
  blockNumber: sent.blockNumber.toString(),
  ...(sent.reason === undefined ? {} : { reason: sent.reason }),
});

/** Asks a yes/no question at the terminal; `undefined` when there is no terminal to ask on. */
export type Confirm = (question: string) => Promise<boolean | undefined>;

export interface RunInput extends CookInput, ChainAccess {
  readonly account: PrivateKeyAccount;
  /** `--yes`: do what the run needs first (deploying the Pot) without asking. */
  readonly yes: boolean;
  readonly confirm: Confirm;
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
  const client = await connect(input.rpcUrl, input.chain);
  const state = await potState(client, cook.pot);
  let deployed: Sent | undefined;
  if (!state.deployed) {
    const missing = `Pot ${cook.pot} is not deployed on ${input.chain.slug}`;
    if (!("owner" in target)) {
      throw new CliError(`${missing}. Deploy it first: ${deployHint(input.chain, target)}`);
    }
    const agreed = input.yes
      ? true
      : await input.confirm(
          `Pot ${cook.pot} (owner ${target.owner}, salt ${target.salt}) is not deployed on ` +
            `${input.chain.slug}. Deploy it now? [y/N] `,
        );
    if (agreed !== true) {
      throw new CliError(
        agreed === undefined
          ? `${missing}. Deploy it first (${deployHint(input.chain, target)}), or pass --yes to ` +
              "deploy it before the cook"
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
    if (deployed.status !== "success" || !(await potState(client, cook.pot)).deployed) {
      throw new CliError(`${sentText("deploying the Pot", deployed)}; the Pot is not there`);
    }
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

  return {
    text: [
      ...(deployed === undefined ? [] : [sentText(`deployed Pot ${cook.pot} in`, deployed)]),
      ...(funding?.sent ?? []).map((step) => sentText(step.what, step.sent)),
      sentText("cook", sent),
    ].join("\n"),
    json: {
      chain: input.chain.slug,
      from: signer,
      pot: cook.pot,
      value: value.toString(),
      ...(deployed === undefined ? {} : { deployPot: sentJson(deployed) }),
      ...(funding === undefined
        ? {}
        : { funding: funding.sent.map((step) => ({ what: step.what, ...sentJson(step.sent) })) }),
      cook: sentJson(sent),
    },
    ...(funding === undefined || funding.notes.length === 0 ? {} : { notes: funding.notes }),
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

/** `sauce pot`: the Pot an owner and salt give, and the unsigned Kitchen call that deploys it. */
export function potCommand(input: PotCommandInput): CommandOutput {
  if (input.chain.kind !== "evm") {
    throw new Error(`internal: ${input.chain.slug}'s Pot is predicted by solana.ts`);
  }
  const kitchen = kitchenAddress();
  const pot = v12PredictPot(input.owner, input.salt) as Address;
  const call = sauceEvmDeployPotCall({ kitchen, owner: input.owner, salt: input.salt });
  const json = {
    chainId: input.chain.id,
    pot,
    owner: input.owner,
    salt: input.salt,
    kitchen,
    to: kitchen,
    data: call.data,
    value: "0",
  };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    cast: castSend(kitchen, call.data),
    notes: [
      `Kitchen.deployPot on the released Kitchen. Any account may send it, the Pot is ` +
        `${input.owner}'s either way, and it deploys once.`,
    ],
  };
}

/** `sauce pot --deploy`: sends the Kitchen call, unless the Pot is already there. */
export async function potDeployCommand(
  input: PotCommandInput & ChainAccess & { readonly account: PrivateKeyAccount },
): Promise<CommandOutput> {
  const predicted = potCommand(input);
  const pot = predicted.json.pot as Address;
  const client = await connect(input.rpcUrl, input.chain);
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
  const json = {
    ...predicted.json,
    deployed: sent.status === "success",
    deployPot: sentJson(sent),
  };

  return {
    text: JSON.stringify(json, null, 2),
    json,
    notes: [sentText(`deployed Pot ${pot} in`, sent)],
    ...(sent.status === "success" ? {} : { exitCode: 1 }),
  };
}
