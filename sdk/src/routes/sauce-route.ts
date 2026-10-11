/**
 * Compile a Sauce program for a route's destination and construct its execution call.
 *
 * `compileSauceRoute` selects the target from the destination chain, compiles the program as
 * written through the published compiler dependency — the chain's names (tokens, protocols, `self`,
 * chains) are a SauceScript module the SDK writes from its registries and hands the compiler as an
 * ambient module (`chain-module.ts`), never rewritten into the text — and delegates call encoding
 * to `buildSauceEvmCall` or `buildSauceSvmCall`. One body produces one bytecode segment and one
 * call.
 *
 * EVM calls carry the program bytes and invoke the supplied Pot with the supplied engine.
 * SVM calls name a finalized CODE account through `execution.code`; this module does not stage
 * that account or verify its contents. Compare its contents with `compiled.bytecode[0]` yourself.
 *
 * The engine's staged instruction carries no content pin. Kitchen finalization checks a digest,
 * and a separately constructed Kitchen cook can check a pin, but neither guarantee is added to
 * this route call. The fulfillment integration must also provide the Kitchen invocation required
 * by the released engine. See `docs/guides/solana.md` for the execution boundary.
 */
import type { CompileResult, CompileTarget, ContractsConfig } from "./compile-types.js";
import type { AccountManifest, ResolveModule, ResolvePackage } from "sauce-compiler";
import { bytesToHex } from "viem";

import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs, type RsCompileResult } from "./rs-compile.js";
import {
  CHAIN_DEFINE,
  chainModuleSource,
  isChainScalar,
  isPlainModule,
  type ChainModuleOptions,
} from "./chain-module.js";
import { registryTokenSymbols } from "./token-registry.js";
import type { ProtocolNameOptions } from "./protocol-names.js";
import { pascalOfSlug } from "./pascal.js";
import { chainAmbient } from "./ambient.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import {
  entryParamsOf,
  entryWords,
  type EntryParam,
  type EntrySignature,
  type EntryValue,
} from "./entry.js";
import type { AddressInput, CallInput, Hex } from "./types.js";

export interface SauceCompileOptions {
  /** Defaults by destination `ChainKind`: `'v12'` for evm, `'svm'` for svm. */
  target?: CompileTarget;
  /**
   * Serves the program's own imports, with the compiler's `resolve` contract: bytes for a path it
   * has, `undefined` for one it does not. Consulted after the entry and before the SDK's own
   * modules — the engine ABIs (`./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json`), every
   * protocol ABI twin (`./protocols/<slug>/<Export>.json`) and the `@sauce/token` library, which the
   * SDK serves from memory without being asked.
   */
  resolve?: ResolveModule;
  /** Maps a bare specifier to a path `resolve` serves; consulted after the SDK's `@sauce/token`. */
  resolvePackage?: ResolvePackage;
  /**
   * Compile-time parameters, injected into every module as a module-scope `const` — a define
   * REPLACES the module's own `const` of that name and is constant-folded, so a given set of values
   * yields fixed bytecode. This is how a standalone `.sauce.ts` asset (e.g.
   * a recipe's program) is specialized for one use. A value is one 256-bit word, so an
   * array or a lookup table cannot be supplied this way — a program needing a variable-length list
   * generates one declaration per element instead (see `svm/recipes/index.ts`).
   */
  defines?: Record<string, bigint | boolean | number>;
  /** Caller token symbol -> address OVERRIDES, merged per-key on top of `token-registry.ts`'s
   *  default per-chain registry (see `resolveTokenMap`): the symbols the chain's host declares, so
   *  `USDC.transfer/.approve/.transferFrom/.balanceOf(...)` and `<holder>.USDC` reach `@sauce/token`
   *  for that address. A symbol the registry covers needs NO entry here. On an svm destination a
   *  symbol is the mint's key, a plain value with no token methods. */
  tokens?: Readonly<Record<string, AddressInput>>;
  /** Parsed ABI bindings, adapted to the compiler's inlineContracts option. */
  contracts?: ContractsConfig;
  /** The registry's protocol names (`UniswapV3.Factory`): declared by the chain's host by default;
   *  `false` declares none, and an options object configures them (`protocol-names.ts`). Contracts
   *  are EVM-only. */
  accessors?: boolean | ProtocolNameOptions;
  /**
   * Module specifiers whose exports are broadcast into every module with no `import` line: an
   * ambient module's exported functions and consts become callable/readable with no import. Ambient
   * always loses to user code — a name the module declares, imports or binds wins silently.
   */
  ambient?: string[];
  /** Compile for compact-v1 entry arguments. */
  compactArgs?: boolean;
}

export interface SauceEvmExecutionInput {
  /** The Pot contract to `cook()` on — see `sauce-calls.ts#SauceEvmCallParams`, never defaulted. */
  pot: AddressInput;
  /** The compatible interpreter to pass to this Pot's cook. Required: a Pot does not select or
   *  store the engine on behalf of the caller. */
  engine: AddressInput;
  /** Total cook value: the current Kitchen execution fee plus any native program funding. */
  value?: bigint | number | string;
}

/**
 * Staged SVM execution settings from the route call builder. The caller supplies a finalized CODE
 * account and its execution accounts. `expectedSha256` is rejected because the engine instruction
 * does not carry a pin; see `svm/instructions.ts#assertNoExecutePin`.
 */
export type SauceSvmExecutionInput = SauceSvmCallParams;

export interface CompiledSauceRoute {
  readonly calls: readonly CallInput[];
  readonly compiled: CompileResult;
  /** The source the compiler was given: the program as written. */
  readonly source: string;
}

/** Accessor name -> chain, for every canonical chain: the chains `import { Base }` gives a caller. */
let chainAccessorCache: ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> | undefined;
export function chainAccessorNames(): ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> {
  chainAccessorCache ??= new Map(
    CANONICAL_CHAINS.map((chain) => [pascalOfSlug(chain.slug), chain]),
  );
  return chainAccessorCache;
}

type DefineValue = bigint | boolean | number;

/**
 * `defines` split by what each name is. One named like a chain-scoped name — a registered token
 * symbol, `chainId`, a protocol contract's address key — is the caller choosing that chain's value
 * for it, so it goes into the chain's module (`tokens`, `values`) for this chain alone; a body on
 * another chain names its own. The rest are the caller's own compile-time values, which hold at
 * every depth.
 *
 * WHY NOT LEAVE THEM DEFINES. A define replaces a module's `const` of that name in EVERY module, the
 * chain's module included: a `USDC` define would put a plain number where the module has the
 * `Token` `USDC`, and `USDC.transfer(...)` would stop compiling — in the program it was given for,
 * and in every body, where it would name this chain's value on another.
 */
function splitChainDefines(
  defines: SauceCompileOptions["defines"],
  tokens: SauceCompileOptions["tokens"],
): {
  readonly defines: SauceCompileOptions["defines"];
  readonly tokens: SauceCompileOptions["tokens"];
  readonly values: Readonly<Record<string, bigint>>;
} {
  if (defines === undefined) return { defines, tokens, values: {} };
  const symbols = registryTokenSymbols();
  const moved: Record<string, AddressInput> = {};
  const values: Record<string, bigint> = {};
  const kept: Record<string, DefineValue> = {};
  for (const [name, value] of Object.entries(defines)) {
    if (symbols.has(name) && typeof value === "bigint") moved[name] = toAddress(value);
    else if (isChainScalar(name) && typeof value !== "boolean") values[name] = BigInt(value);
    else kept[name] = value;
  }

  return { defines: kept, tokens: { ...moved, ...tokens }, values };
}

const toAddress = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;

function defaultTargetFor(kind: "evm" | "svm"): CompileTarget {
  return kind === "svm" ? "svm" : "v12";
}

/** The bare specifier a compile's module of names is named by: `@sauce/chain-evm`, the one module of
 *  the target, or `@sauce/chain-evm-own` for a compile that chose values of its own. */
const moduleSpecifier = (chain: CanonicalChain, options: ChainModuleOptions): string =>
  `@sauce/chain-${chain.kind === "evm" ? "evm" : "svm"}${isPlainModule(options) ? "" : "-own"}`;

/**
 * What a compile for `chain` hands the compiler beyond the program: the chain's module of names,
 * and the caller's own defines.
 *
 * NAMES ARE VALUED PER CHAIN. A token symbol, `chainId` or a protocol name is declared for every
 * chain in one module, and its value is the one of the chain the program is compiled for, whose id
 * the define `__sauce_chain` is. A `tokens` override and a chain value the caller chose are that
 * chain's, in a module of the compile's own; the caller's other defines (`RECIPIENT`) stay defines.
 */
function chainModules(
  chain: CanonicalChain,
  options: SauceCompileOptions,
): {
  readonly modules: Map<string, string>;
  readonly ambient: string[];
  readonly defines: SauceCompileOptions["defines"];
} {
  const { defines, tokens, values } = splitChainDefines(options.defines, options.tokens);
  if (defines !== undefined && CHAIN_DEFINE in defines) {
    throw new Error(
      `compileSauceRoute: \`${CHAIN_DEFINE}\` is the SDK's own define, set to the chain's id`,
    );
  }
  const moduleOptions: ChainModuleOptions = { tokens, values, accessors: options.accessors };
  const own = moduleSpecifier(chain, moduleOptions);

  return {
    modules: new Map([[own, chainModuleSource(chain, moduleOptions)]]),
    ambient: [...new Set([...(options.ambient ?? []), own])],
    defines: { ...defines, [CHAIN_DEFINE]: BigInt(chain.id) },
  };
}

/**
 * Compiles `sauce` for `destination`'s `ChainKind`, and slots the result into exactly one
 * `CallInput` via the existing `buildSauceEvmCall`/`buildSauceSvmCall` fork — never a new encoder.
 *
 * `sauce` is a SauceScript file: a module declaring `function main`, or a script whose top-level
 * statements run as the entry. It reaches the compiler as written.
 * A value-returning or early-exiting program declares `main`, since a top-level `return` is not
 * SauceScript.
 */
export function compileSauceRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions = {},
): CompiledSauceRoute {
  const { chain, compiled, source } = compileForChain(destination, sauce, options);
  const bytecodeHex = bytesToHex(compiled.bytecode[0]!);

  if (chain.kind === "svm") {
    const svmExecution = execution as SauceSvmExecutionInput;
    if (svmExecution.code === undefined) {
      throw new Error(
        "compileSauceRoute: an svm route requires execution.code — a finalized code account this " +
          "module did NOT stage. Stage it through the kitchen (create/grow/write/finalize) and pass " +
          "the CODE account; see kitchen.ts. It must hold exactly the bytecode this call returns in " +
          "`compiled.bytecode[0]`.",
      );
    }
    // Passed through UNPINNED, and no route call can be otherwise: the released engine's
    // `execute_from_account` has no payload to carry a pin. The kitchen's `cook_from_account` does
    // enforce one, but the STAGING caller issues that — a different transaction, by the party that
    // already controlled the bytes — so it is not a guarantee this call's consumer inherits.
    const call = buildSauceSvmCall(svmExecution);
    return { calls: [call], compiled, source };
  }

  const evmExecution = execution as SauceEvmExecutionInput;
  const call = buildSauceEvmCall({
    pot: evmExecution.pot,
    engine: evmExecution.engine,
    program: bytecodeHex,
    value: evmExecution.value,
  });
  return { calls: [call], compiled, source };
}

/** A standalone program, compiled for one chain: {@link compileSauceProgram}'s result. */
export interface CompiledSauceProgram {
  readonly chain: CanonicalChain;
  /** The program. `Pot.cook(engine, program)` runs it, with any entry arguments appended. */
  readonly bytecode: Uint8Array;
  /** How `main`'s arguments are encoded: `abi-v1`, or `compact-v1` under `compactArgs`. */
  readonly entryEncoding: "abi-v1" | "compact-v1";
  /** With compact-v1, the schema its arguments are encoded against. */
  readonly entrySchema?: Uint8Array;
  /** `main`'s runtime parameters, in order — on Solana without the `Account` slots, which the
   *  manifest carries. `encodeEntryArguments` encodes values for them. */
  readonly entryParams: readonly EntryParam[];
  /** The SVM account manifest: the accounts to attach, in order. Absent on the EVM. */
  readonly manifest?: AccountManifest;
  /** `main`'s signature as the compile reports it. */
  readonly entrySignature: EntrySignature;
  /** The source the compiler was given: the program as written. */
  readonly source: string;
}

/** {@link compileSauceProgram}'s options: a route's, and `main`'s arguments to bind. */
export interface SauceProgramOptions extends SauceCompileOptions {
  /**
   * `main`'s arguments the program is compiled for, one per entry of `entryParams` and in its
   * order: `main` is compiled with each such parameter a constant of its value (and every `const`
   * computed from them), so it takes none at run time and the result's `entryParams` is empty. On
   * Solana an `Account` parameter is no entry of `entryParams` and takes no value here: it stays a
   * slot of the manifest. Each value is one word: an unsigned integer, an address or a `bool`; the
   * compiler holds each to its parameter. Leave it out to compile `main` taking its arguments as it
   * runs.
   */
  readonly args?: readonly EntryValue[];
}

/**
 * Compiles a standalone program for `chain`: a program that runs directly on a Pot, rather than
 * the destination half of an intent.
 *
 * It gets the chain's names (tokens, protocols, `self`, chains) and the `@sauce/token` functions with
 * no import. So one source compiles, unchanged, for any chain whose names it uses. `main` may declare typed runtime parameters; `entryParams` reports them and
 * `encodeEntryArguments` encodes values for them.
 */
export function compileSauceProgram(
  chain: ChainRef,
  source: string,
  options: SauceProgramOptions = {},
): CompiledSauceProgram {
  const resolved = requireChain(chain);
  const { args, ...given } = options;
  const ambient = Array.from(new Set([...chainAmbient(resolved), ...(given.ambient ?? [])]));
  const program = compileForChain(
    resolved,
    source,
    { ...given, ambient: ambient.length > 0 ? ambient : given.ambient },
    args === undefined ? undefined : entryWords(args),
  );
  // As the compiler reports them: an ABI signature, with no `Account` slot, which the manifest
  // carries. Nothing is read from the source.
  const entryParams = entryParamsOf(program.entryParams);

  return {
    chain: resolved,
    bytecode: program.compiled.bytecode[0]!,
    entryEncoding: program.entryEncoding,
    ...(program.compiled.entrySchema === undefined
      ? {}
      : { entrySchema: program.compiled.entrySchema }),
    entryParams,
    ...(program.manifest === undefined ? {} : { manifest: program.manifest }),
    entrySignature: program.entrySignature,
    source: program.source,
  };
}

/**
 * The compile half of {@link compileSauceRoute} and {@link compileSauceProgram}: the compile, with
 * the chain's names, for `destination`, with no execution — no Pot, engine or staged code account,
 * because the bytecode depends on none of them.
 */
function compileForChain(
  destination: ChainRef,
  sauce: string,
  options: SauceCompileOptions,
  args?: readonly (bigint | boolean | string)[],
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly entryParams: RsCompileResult["entryParams"];
  readonly source: string;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly manifest?: AccountManifest;
  readonly entrySignature: EntrySignature;
} {
  const chain = requireChain(destination);
  const target = options.target ?? defaultTargetFor(chain.kind);

  if (chain.kind === "svm" && target !== "svm") {
    throw new Error(
      `compileSauceRoute: destination '${chain.slug}' is svm but options.target is '${target}' — an svm destination requires target 'svm'`,
    );
  }
  if (chain.kind === "evm" && target === "svm") {
    throw new Error(
      `compileSauceRoute: destination '${chain.slug}' is evm but options.target is 'svm'`,
    );
  }

  // The source is the program, as written: a module with a `main`, or a script whose top-level
  // statements are the entry. Nothing here reads or rewrites it.
  const source = sauce;
  const names = chainModules(chain, options);
  const rs = compileWithRs({
    source,
    target,
    resolve: options.resolve,
    resolvePackage: options.resolvePackage,
    defines: names.defines,
    contracts: options.contracts,
    ambient: names.ambient,
    compactArgs: options.compactArgs,
    modules: names.modules,
    ...(args === undefined ? {} : { args }),
  });
  const { manifest, entryEncoding, entryParams, entrySignature, ...compiled } = rs;

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }
  return manifest === undefined
    ? { chain, compiled, entryParams, source, entryEncoding, entrySignature }
    : { chain, compiled, entryParams, source, entryEncoding, manifest, entrySignature };
}
