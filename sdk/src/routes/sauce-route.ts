/**
 * Compile a Sauce program for a route's destination and construct its execution call.
 *
 * `compileSauceRoute` selects the target from the destination chain, compiles the program as
 * written through the published compiler dependency — the chain's names (tokens, protocols, `self`,
 * chains and their hops) are a SauceScript module the SDK writes from its registries and hands
 * the compiler as an ambient module (`chain-module.ts`), never rewritten into the text — and
 * delegates call encoding to `buildSauceEvmCall` or `buildSauceSvmCall`. One body produces one
 * bytecode segment and one call.
 *
 * An intent a program opens (`Arbitrum.hop({ … }).then(() => { … })`) is `@sauce/hop`'s classes,
 * which the compiler runs while it compiles. Its body is compiled as a program of its own,
 * `program(body, chainId)`, with the options `programOptions` gives that chain: its own module of
 * names, its target, and the caller's defines.
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
import type {
  AccountManifest,
  ArgValue,
  ProgramOptions,
  ProgramScope,
  ResolveModule,
  ResolvePackage,
} from "sauce-compiler";
import { bytesToHex } from "viem";

import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { chainById, requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs, toRsDefines, type RsCompileResult } from "./rs-compile.js";
import {
  CHAIN_DEFINE,
  chainModuleSource,
  isChainScalar,
  isPlainModule,
  levelModuleSource,
  type ChainModuleOptions,
} from "./chain-module.js";
import { registryTokenSymbols } from "./token-registry.js";
import type { ProtocolNameOptions } from "./protocol-names.js";
import { pascalOfSlug } from "./pascal.js";
import { chainAmbient } from "./ambient.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import type { EcoRoutesSelector } from "../protocols/eco-routes/lookup.js";
import { randomSalt, type IntentDefaults } from "./intent-defaults.js";
import { INTENT_FUND_VIA } from "./portal.js";
import {
  entryParamsOf,
  entryArguments,
  type EntryParam,
  type EntrySignature,
  type EntryValue,
} from "./entry.js";
import { resolveIntentPot } from "./intent-pot.js";
import { ecoRoutesPortal } from "../protocols/eco-routes/lookup.js";
import { fetchSwapRoutes, type SwapApis } from "./swap-apis.js";
import {
  SWAP_BODY_DEFINE,
  swapHost,
  swapScopeError,
  type SwapBindOptions,
  type SwapSite,
} from "./swap-host.js";
import { closureText, isSauceClosure, type SauceBody } from "./closure.js";
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
  /**
   * Settings for `Chain.hop({ ... }).then(...)` written inside the
   * program — creating an intent from a program, rather than compiling a program into one.
   * Everything the SDK can look up it looks up; these are the fields it cannot, plus overrides, for
   * every intent that does not set its own. See `@sauce/hop`.
   *
   * Omitted entirely, an intent still compiles: its deadlines and salt have defaults, and its
   * refundee (the reward's `creator`), which has none, is its own `refundee`.
   */
  intents?: IntentDefaults & EcoRoutesSelector;
  /** Compile for compact-v1 entry arguments. */
  compactArgs?: boolean;
  /**
   * The routes of the program's `kyberSwap`/`jupiterSwap`/`ecoSwap` calls: the Pot they are built
   * for, the routes fetched for them, and where each provider is asked
   * (`compileSauceProgramAsync`). See `swap-host.ts`.
   */
  swap?: SwapCompileOptions;
}

/** {@link SauceCompileOptions.swap}: what a compile's swaps are bound with, and where their routes
 *  are asked for. */
export interface SwapCompileOptions extends SwapBindOptions, SwapApis {}

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

/** Accessor name -> chain, for every canonical chain. `Base(() => ...)` in a program opens an
 *  intent for exactly the chains `import { Base }` gives a caller, so the two cannot diverge. */
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

/** `intents.fundVia` checked, refusing an option that belongs to the other mode. */
function requireFundVia(intents: IntentDefaults): void {
  const fundVia = intents.fundVia ?? "transfer";
  if (!INTENT_FUND_VIA.includes(fundVia)) {
    throw new Error(
      `intent sugar: \`intents.fundVia\` is '${String(fundVia)}', which is not ` +
        `${INTENT_FUND_VIA.map((via) => `"${via}"`).join(" or ")}`,
    );
  }
  if (fundVia === "transfer" && intents.allowPartial === true) {
    throw new Error(
      'intent sugar: `intents.allowPartial` goes with `fundVia: "publishAndFund"`: funding by ' +
        "transfer pays the whole reward into the vault, and `publish` takes no such flag",
    );
  }
}

function defaultTargetFor(kind: "evm" | "svm"): CompileTarget {
  return kind === "svm" ? "svm" : "v12";
}

/** The bare specifier a compile's module of names is named by: `@sauce/chain-evm`, the one module of
 *  the target, or `@sauce/chain-evm-own` for a compile that chose values of its own. */
const moduleSpecifier = (chain: CanonicalChain, options: ChainModuleOptions): string =>
  `@sauce/chain-${chain.kind === "evm" ? "evm" : "svm"}${isPlainModule(options) ? "" : "-own"}`;

/**
 * The bare specifier one program's level module is named by in a compile: `@sauce/chain-level-base`
 * for the program's own, `@sauce/chain-level-base-body` for every body on Base, whose intents open
 * when that body runs and are published by no wallet.
 */
const levelSpecifier = (chain: CanonicalChain, body: boolean): string =>
  `@sauce/chain-level-${chain.slug}${body ? "-body" : ""}`;

/**
 * What a compile for `chain` hands the compiler beyond the program: the chain's module of names, the
 * modules of every chain an intent's body runs on (written as the compiler asks for them), the
 * options each body compiles with, and the caller's own defines.
 *
 * NAMES ARE SCOPED PER CHAIN. A token symbol, `chainId` or a protocol name means the chain its part
 * runs on: a body's are its destination's, from that chain's module. So every `tokens` override and
 * every chain value the caller chose belongs to the program it was given for, and a body on another
 * chain takes its own chain's registry values instead; the caller's other defines (`RECIPIENT`)
 * hold at every depth. A body's own intents open when it runs, not when the file compiles, and no
 * wallet publishes them: each names its own refundee.
 */
function chainModules(
  chain: CanonicalChain,
  options: SauceCompileOptions,
): {
  readonly modules: Map<string, string>;
  readonly ambient: string[];
  readonly defines: SauceCompileOptions["defines"];
  readonly programOptions: (scope: ProgramScope) => ProgramOptions;
  readonly bodies: Map<number, CanonicalChain>;
  readonly swaps: ReturnType<typeof swapHost>;
} {
  const { defines, tokens, values } = splitChainDefines(options.defines, options.tokens);
  if (defines !== undefined && CHAIN_DEFINE in defines) {
    throw new Error(
      `compileSauceRoute: \`${CHAIN_DEFINE}\` is the SDK's own define, set to the chain's id`,
    );
  }
  if (defines !== undefined && SWAP_BODY_DEFINE in defines) {
    throw new Error(
      `compileSauceRoute: \`${SWAP_BODY_DEFINE}\` is the SDK's own define, set to whether a program is an intent's body`,
    );
  }
  requireFundVia(options.intents ?? {});
  const salt = options.intents?.salt ?? randomSalt();
  const moduleOptions: ChainModuleOptions = { tokens, values, accessors: options.accessors };
  // Every program of the compile reads the same names: a value the caller chose is its chain's, so
  // a body on another chain reads that chain's registry values.
  const own = moduleSpecifier(chain, moduleOptions);
  const level = levelSpecifier(chain, false);
  const modules = new Map([
    [own, chainModuleSource(chain, moduleOptions)],
    [level, levelModuleSource(chain, { intents: options.intents ?? {} }, salt)],
  ]);
  // A level below opens its intents when its parent runs, and funds them whatever the root does: a
  // rehearsal that leaves the root's rewards unpaid must not change the bodies it publishes.
  const { openedAt: _openedAt, fund: _fund, ...inherited } = options.intents ?? {};
  const bodies = new Map<number, CanonicalChain>();
  // A swap's route, which `@sauce/swap` reads with `globalIn` from a module the host writes for it;
  // an intent body's is built for the destination's shared Pot, the one its cook names.
  const swaps = swapHost({
    chain,
    options: options.swap ?? {},
    bodyPot: (destination) =>
      resolveIntentPot(
        inherited.destinationPortal ?? ecoRoutesPortal(destination, inherited),
        inherited,
      ).pot,
  });

  const programOptions = (scope: ProgramScope): ProgramOptions => {
    const swap = swaps.answer(scope, modules);
    if (swap !== undefined) return swap;
    const id = typeof scope === "bigint" ? Number(scope) : NaN;
    const destination = chainById(id);
    if (destination === undefined) {
      throw new Error(
        `program(closure, scope): the SDK compiles a closure for the chain whose id \`scope\` is; ` +
          `${String(scope)} is no chain it knows`,
      );
    }
    bodies.set(id, destination);
    const specifier = levelSpecifier(destination, true);
    if (!modules.has(specifier)) {
      modules.set(specifier, levelModuleSource(destination, { intents: inherited }, salt));
    }

    return {
      target: destination.kind === "svm" ? "svm" : "evm",
      ambient: [
        ...new Set([...chainAmbient(destination), ...(options.ambient ?? []), own, specifier]),
      ],
      defines: [
        ...(toRsDefines(defines) ?? []),
        [CHAIN_DEFINE, String(destination.id)],
        [SWAP_BODY_DEFINE, "1"],
      ],
    };
  };

  return {
    modules,
    ambient: [...new Set([...(options.ambient ?? []), own, level])],
    defines: { ...defines, [CHAIN_DEFINE]: BigInt(chain.id), [SWAP_BODY_DEFINE]: 0n },
    programOptions,
    bodies,
    swaps,
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
  sauce: SauceBody,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions = {},
): CompiledSauceRoute {
  return isSauceClosure(sauce)
    ? compileScopedRoute(destination, closureText(sauce), execution, options, "closure")
    : compileScopedRoute(destination, sauce, execution, options);
}

/**
 * {@link compileSauceRoute} on a program's text, a module's or a closure's — the internal route
 * builder's entry. Not exported from the package.
 */
export function compileScopedRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions,
  entryKind: "module" | "closure" = "module",
): CompiledSauceRoute {
  const { chain, compiled, source } = compileForChain(destination, sauce, options, entryKind);
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

/** A body the compile compiled for another chain: an intent's, cooked on that chain's shared Pot. */
export interface CompiledBody {
  /** The compiler's number for it, in the order it met the `program` calls. */
  readonly id: number;
  /** The bodies it is nested in, by number, outermost first: empty for the program's own intents. */
  readonly path: readonly number[];
  /** The chain it runs on. */
  readonly destination: CanonicalChain;
  readonly bytecode: Uint8Array;
  /** What it reads of the program around it, by name: each a word appended to its bytecode as the
   *  program opening the intent runs. None: the body is fixed now. */
  readonly captures: readonly string[];
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
  /** The body of every intent the program opens, at any depth
   *  (`Arbitrum.hop({ ... }).then(...)`), as compiled for its chain. */
  readonly bodies: readonly CompiledBody[];
  /** `main`'s signature as the compile reports it. */
  readonly entrySignature: EntrySignature;
  /** Each route the program's `kyberSwap(...)`/`jupiterSwap(...)`/`ecoSwap(...)` calls ask for, at
   *  any depth, with the route bound for it — none where a placeholder was (`swap.placeholders`). */
  readonly swaps: readonly SwapSite[];
  /** The source the compiler was given: the program as written. */
  readonly source: string;
}

/** {@link compileSauceProgram}'s options: a route's, and `main`'s arguments to bind. */
export interface SauceProgramOptions extends SauceCompileOptions {
  /**
   * `main`'s arguments the program is compiled for, one per entry of `entryParams` and in its
   * order: `main` is compiled with each such parameter a constant of its value (and every `const`
   * computed from them), so it takes none at run time and the result's `entryParams` is empty; an
   * intent's body folds them in too, capturing nothing for them. On Solana an `Account` parameter
   * is no entry of `entryParams` and takes no value here: it stays a slot of the manifest. Each
   * value is what its parameter reads: an unsigned integer, an address or a `bool`, a `bytes` (a
   * `Uint8Array` or `0x` hex), a string, an array of values, or a record (an array of its fields
   * in order, or an object of them by name); the compiler holds each to its parameter
   * (`ArgShape`, `ArgOutOfRange`). How a wallet publishes the intents a program opens from values known before anything
   * runs. Leave it out to compile `main` taking its arguments as it runs.
   */
  readonly args?: readonly EntryValue[];
}

/**
 * Compiles a standalone program for `chain`: a program that runs directly on a Pot, rather than
 * the destination half of an intent.
 *
 * It gets everything an intent's body gets except the intent around it: the chain's names
 * (tokens, protocols, `self`, chains and their hops) and the `@sauce/token` functions with no
 * import, and intents the program itself opens
 * (`Arbitrum.hop({ ... }).then(...)`), which take their deadline and
 * creator from `options.intents`. So one source compiles, unchanged, for any chain whose names it
 * uses. `main` may declare typed runtime parameters; `entryParams` reports them and
 * `encodeEntryArguments` encodes values for them.
 */
export function compileSauceProgram(
  chain: ChainRef,
  body: SauceBody,
  options: SauceProgramOptions = {},
): CompiledSauceProgram {
  const source = isSauceClosure(body) ? closureText(body) : body;
  const resolved = requireChain(chain);
  const { args, ...given } = options;
  const ambient = Array.from(new Set([...chainAmbient(resolved), ...(given.ambient ?? [])]));
  const program = compileForChain(
    resolved,
    source,
    { ...given, ambient: ambient.length > 0 ? ambient : given.ambient },
    isSauceClosure(body) ? "closure" : "module",
    args === undefined ? undefined : entryArguments(args),
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
    bodies: program.bodies,
    entrySignature: program.entrySignature,
    swaps: program.swaps,
    source: program.source,
  };
}

/**
 * {@link compileSauceProgram}, with each `kyberSwap(...)`/`jupiterSwap(...)`/`ecoSwap(...)` the
 * program calls given its route by its service. The compiler's callbacks are synchronous, so it
 * compiles twice: once with a placeholder for each route, to learn what each asks for, then — after
 * the routes are fetched (`swap-apis.ts#fetchSwapRoutes`) — with them bound. A program with no swap,
 * or whose routes are all given in `swap.routes`, compiles once.
 */
export async function compileSauceProgramAsync(
  chain: ChainRef,
  body: SauceBody,
  options: SauceProgramOptions = {},
): Promise<CompiledSauceProgram> {
  const swap = options.swap ?? {};
  const probe = compileSauceProgram(chain, body, {
    ...options,
    swap: { ...swap, placeholders: true },
  });
  const missing = probe.swaps.filter((site) => site.route === undefined);
  if (missing.length === 0) return probe;
  const fetched = await fetchSwapRoutes(
    missing.map((site) => site.request),
    swap,
  );

  return compileSauceProgram(chain, body, {
    ...options,
    swap: { ...swap, placeholders: false, routes: [...(swap.routes ?? []), ...fetched] },
  });
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
  entryKind: "module" | "closure" = "module",
  args?: readonly ArgValue[],
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly entryParams: RsCompileResult["entryParams"];
  readonly source: string;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly manifest?: AccountManifest;
  readonly bodies: readonly CompiledBody[];
  readonly entrySignature: EntrySignature;
  readonly swaps: readonly SwapSite[];
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
  let rs: RsCompileResult;
  try {
    rs = compileWithRs({
      source,
      target,
      entryKind,
      resolve: options.resolve,
      resolvePackage: options.resolvePackage,
      defines: names.defines,
      contracts: options.contracts,
      ambient: names.ambient,
      compactArgs: options.compactArgs,
      modules: names.modules,
      programOptions: names.programOptions,
      ...(args === undefined ? {} : { args }),
    });
  } catch (error) {
    // A swap the host refused, in the host's words: the compiler's carry them under its own.
    const refused = names.swaps.refusal;
    throw (
      (refused === undefined ? undefined : new Error(refused.message, { cause: error })) ??
      swapScopeError(source, error) ??
      error
    );
  }
  const { manifest, entryEncoding, entryParams, entrySignature, programs, ...compiled } = rs;

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }
  const bodies = programs.flatMap((report): CompiledBody[] => {
    const on = typeof report.scope === "bigint" ? chainById(Number(report.scope)) : undefined;
    return on === undefined
      ? []
      : [
          {
            id: report.id,
            path: report.path,
            destination: on,
            bytecode: report.bytecode,
            captures: report.captures,
          },
        ];
  });

  const swaps = names.swaps.sites;

  return manifest === undefined
    ? { chain, compiled, entryParams, source, entryEncoding, bodies, entrySignature, swaps }
    : {
        chain,
        compiled,
        entryParams,
        source,
        entryEncoding,
        manifest,
        bodies,
        entrySignature,
        swaps,
      };
}
