/**
 * What `sauce compile`, `sauce tx` and `sauce pot` compute. Each returns its result twice — as the
 * lines a person reads and as the object `--json` prints — and none of them signs or sends.
 *
 * Every piece is the SDK's own: `compileSauceProgram`/`compileSauceRoute` under `withChainAmbient`
 * compile the file exactly as `openRoute` compiles a route body, `v12PredictPot` and
 * `sauceEvmDeployPotCall` are the Pot, `v12Pot.encodeCook` (inside `compileSauceRoute`) is the cook,
 * and `destinationExecutionFee` is the Kitchen's fee. Nothing is reimplemented here.
 */
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import {
  bytesToHex,
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import {
  v12DeployedAddresses,
  v12EngineAddress,
  v12SvmEngineProgramId,
} from "../deployments/index.js";
import { v12GateKitchen, v12PredictPot } from "../deployments/pot.js";
import { v12Pot } from "../evm/engine.js";
import { destinationExecutionFee } from "../evm/execution-fee.js";
import { withChainAmbient } from "../routes/ambient.js";
import { sauceEvmDeployPotCall } from "../routes/sauce-calls.js";
import {
  compileSauceProgram,
  compileSauceRoute,
  type SauceCompileOptions,
} from "../routes/sauce-route.js";
import { UsageError, type DefineValue } from "./args.js";
import { describeCompileError } from "./diagnostics.js";

/** A failure that is not the invocation's fault: a program that does not compile, a chain that
 *  disagrees. Exit 1, where a {@link UsageError} is exit 2. */
export class CliError extends Error {}

/** The filesystem the commands read, injected so the tests can drive them without a process. */
export interface CliFiles {
  /** A file's text. Throws when it cannot be read. */
  readonly readText: (path: string) => string;
  /** A file's bytes, or `undefined` when nothing is there — the compiler's resolver contract. */
  readonly readModule: (path: string) => Uint8Array | undefined;
}

export interface CommandOutput {
  /** For a person: what `sauce` prints without `--json`. */
  readonly text: string;
  /** For a program: what `--json` prints. Amounts are decimal strings. */
  readonly json: Record<string, unknown>;
}

/** What every compiling command takes. */
export interface ProgramInput {
  readonly file: string;
  /** The file's text, already read: its header chose `chain`. */
  readonly text: string;
  readonly chain: CanonicalChain;
  readonly defines: Record<string, DefineValue>;
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

const PLACEHOLDER_RPC = "<RPC_URL>";
const PLACEHOLDER_KEY = "<PRIVATE_KEY>";

/** A `cast send` of exactly `to`/`data`/`value`, with the endpoint and key left to the reader —
 *  never filled in from `--rpc-url`, whose URL often carries a provider key. */
export function castSend(to: Address, data: Hex, value?: bigint): string {
  return [
    "cast send",
    to,
    data,
    ...(value === undefined ? [] : ["--value", value.toString()]),
    "--rpc-url",
    PLACEHOLDER_RPC,
    "--private-key",
    PLACEHOLDER_KEY,
  ].join(" ");
}

/**
 * The options every compile here runs with: the chain's ambient bundle (`withChainAmbient`, the
 * one `openRoute` uses), the defines over it, the intent settings, and a resolver that serves the
 * program's own relative imports from beside the file.
 */
function compileOptions(input: ProgramInput, files: CliFiles): SauceCompileOptions {
  const dir = dirname(resolvePath(input.file));
  const { deadline, creator, executionFee } = input.intents;
  const intents = {
    ...(deadline === undefined ? {} : { deadline }),
    ...(creator === undefined ? {} : { creator }),
    ...(executionFee === undefined ? {} : { executionFee }),
  };

  return withChainAmbient(input.chain, {
    defines: input.defines,
    ...(Object.keys(intents).length === 0 ? {} : { intents }),
    resolve: (path) => files.readModule(resolvePath(dir, path)),
  });
}

/** Runs `compile`, turning a compile failure into one message about the file. */
function compiling<T>(input: ProgramInput, compile: () => T): T {
  try {
    return compile();
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

/** `sauce compile`: the program's bytecode, and with `--json` what it pairs with. */
export function compileCommand(input: ProgramInput, files: CliFiles): CommandOutput {
  const program = compiling(input, () =>
    compileSauceProgram(input.chain, input.text, compileOptions(input, files)),
  );
  const bytes = program.compiled.bytecode[0]!;
  const bytecode = bytesToHex(bytes);

  return {
    text: bytecode,
    json: {
      chain: input.chain.slug,
      chainId: input.chain.id,
      target: input.chain.kind,
      bytecode,
      size: bytes.length,
      compiler: compilerPackage(),
      engine: pairedEngine(input.chain),
      ...(program.manifest === undefined ? {} : { manifest: program.manifest }),
    },
  };
}

/** Where `sauce tx` cooks: a Pot named outright, or derived from its owner and salt. */
export type PotInput =
  | { readonly pot: Address }
  | { readonly owner: Address; readonly salt: Hex; readonly saltGiven: boolean };

export interface TxInput extends ProgramInput {
  readonly target: PotInput;
  readonly value?: bigint;
  readonly rpcUrl?: string;
}

/** What `--rpc-url` told us, when it was given. */
interface ChainReading {
  readonly fee: bigint;
  readonly deployed: boolean;
  readonly owner?: Address;
}

/** The chain id, the Kitchen's fee, and whether (and to whom) the Pot is deployed. */
async function readChain(
  rpcUrl: string,
  chain: CanonicalChain,
  pot: Address,
): Promise<ChainReading> {
  const client: PublicClient = createPublicClient({ transport: http(rpcUrl) });
  const request = async <T>(what: string, read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      // viem's short message, never its details: those repeat the URL, which often carries a key.
      const reason = (error as { shortMessage?: string }).shortMessage ?? "the request failed";
      throw new CliError(`--rpc-url: reading ${what} failed: ${reason}`);
    }
  };
  const chainId = await request("the chain id", () => client.getChainId());
  if (chainId !== chain.id) {
    throw new CliError(`--rpc-url serves chain ${chainId}, but ${chain.slug} is chain ${chain.id}`);
  }
  const fee = destinationExecutionFee();
  const answer = await request("the Kitchen's executionFee()", () =>
    client.call({ to: fee.to, data: fee.data }),
  );
  if (answer.data === undefined || answer.data === "0x") {
    throw new CliError(
      `the Kitchen ${getAddress(fee.to)} has no code on ${chain.slug}: the released Sauce ` +
        "contracts are not deployed there",
    );
  }
  const code = await request("the Pot's code", () => client.getCode({ address: pot }));
  const deployed = code !== undefined && code !== "0x";
  const owner = deployed
    ? await request("the Pot's owner()", () =>
        client.readContract({ address: pot, abi: v12Pot.abi, functionName: "owner" }),
      )
    : undefined;

  return { fee: fee.decode(answer.data), deployed, ...(owner === undefined ? {} : { owner }) };
}

/** What has to be true on chain for the transaction to land, as `sauce tx` says it. */
function preconditions(
  chain: CanonicalChain,
  target: PotInput,
  pot: Address,
  reading: ChainReading | undefined,
): string[] {
  const deploy =
    "owner" in target
      ? `sauce pot --owner ${target.owner} --chain ${chain.slug}` +
        (target.saltGiven ? ` --salt ${target.salt}` : "")
      : `sauce pot --owner <its owner> --chain ${chain.slug}`;
  const owner = reading?.owner ?? ("owner" in target ? target.owner : undefined);
  const notes = [
    "owner" in target
      ? `Pot ${pot} belongs to ${target.owner} (salt ${target.salt}).`
      : `Pot ${pot}.`,
  ];
  if (reading === undefined) {
    notes.push(
      `It must be deployed (${deploy}) and funded with what the program spends. ` +
        "Pass --rpc-url to check.",
    );
  } else if (reading.deployed) {
    notes.push("It is deployed. Fund it with what the program spends.");
  } else {
    notes.push(`It is NOT deployed. Deploy it first (${deploy}), then fund it.`);
  }
  notes.push(`Send from ${owner ?? "the Pot's owner"}: cook() is onlyOwner.`);

  return notes;
}

/** `sauce tx`: the transaction that cooks the program on its Pot. */
export async function txCommand(input: TxInput, files: CliFiles): Promise<CommandOutput> {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce tx builds an EVM transaction, and ${input.chain.slug} is not an EVM chain. For ` +
        "Solana, compile with `sauce compile`, then stage and execute it through the Kitchen " +
        "(docs/guides/solana.md).",
    );
  }
  if (input.value === undefined && input.rpcUrl === undefined) {
    throw new UsageError(
      "missing --value <wei>: the cook pays the Kitchen's execution fee plus any native the " +
        "program spends. Pass it, or pass --rpc-url <url> to read the fee from the chain.",
    );
  }
  const target = input.target;
  const pot = "pot" in target ? target.pot : (v12PredictPot(target.owner, target.salt) as Address);
  const engine = getAddress(v12EngineAddress());
  const route = compiling(input, () =>
    compileSauceRoute(input.chain, input.text, { pot, engine }, compileOptions(input, files)),
  );
  const data = route.calls[0]!.data;

  const reading =
    input.rpcUrl === undefined ? undefined : await readChain(input.rpcUrl, input.chain, pot);
  if (reading !== undefined && input.value !== undefined && input.value < reading.fee) {
    throw new CliError(
      `--value ${input.value} is below the Kitchen's execution fee on ${input.chain.slug}, ` +
        `${reading.fee} wei: the cook would revert with FeeNotPaid`,
    );
  }
  const value = input.value ?? reading!.fee;
  const cast = castSend(pot, data, value);
  const owner = reading?.owner ?? ("owner" in target ? target.owner : undefined);

  return {
    text: [
      `to     ${pot}`,
      `data   ${data}`,
      `value  ${value}`,
      "",
      cast,
      "",
      ...preconditions(input.chain, target, pot, reading),
    ].join("\n"),
    json: {
      chain: input.chain.slug,
      chainId: input.chain.id,
      to: pot,
      data,
      value: value.toString(),
      engine,
      pot: {
        address: pot,
        owner: owner ?? null,
        salt: "salt" in target ? target.salt : null,
        deployed: reading === undefined ? null : reading.deployed,
      },
      size: route.compiled.bytecode[0]!.length,
      cast,
    },
  };
}

export interface PotCommandInput {
  readonly chain: CanonicalChain;
  readonly owner: Address;
  readonly salt: Hex;
}

/** `sauce pot`: the Pot an owner and salt give, and the Kitchen call that deploys it. */
export function potCommand(input: PotCommandInput): CommandOutput {
  if (input.chain.kind !== "evm") {
    throw new UsageError(
      `sauce pot predicts an EVM Pot, and ${input.chain.slug} is not an EVM chain. A Solana ` +
        "Pot is a Kitchen account: see docs/guides/solana.md.",
    );
  }
  const kitchen = v12GateKitchen() as Address;
  const pot = v12PredictPot(input.owner, input.salt) as Address;
  const call = sauceEvmDeployPotCall({ kitchen, owner: input.owner, salt: input.salt });
  const cast = castSend(kitchen, call.data);

  return {
    text: [
      `pot    ${pot}`,
      `to     ${kitchen}`,
      `data   ${call.data}`,
      "value  0",
      "",
      cast,
      "",
      `Kitchen.deployPot(${input.owner}, ${input.salt}), on the released Kitchen. Any account ` +
        `may send it and the Pot is ${input.owner}'s either way; it deploys once.`,
    ].join("\n"),
    json: {
      chain: input.chain.slug,
      chainId: input.chain.id,
      owner: input.owner,
      salt: input.salt,
      pot,
      kitchen,
      to: kitchen,
      data: call.data,
      value: "0",
      cast,
    },
  };
}
