/**
 * Compile a Sauce program for a route's destination and construct its execution call.
 *
 * `compileSauceRoute` selects the target from the destination chain, compiles the program as
 * written through the published compiler dependency — the chain's names (tokens, protocols, `self`,
 * intents) are the compiler's HOST's to declare (`host.ts`, `intent-host.ts`), never rewritten into
 * the text — and delegates call encoding to `buildSauceEvmCall` or `buildSauceSvmCall`. One body
 * produces one bytecode segment and one call.
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
import { availableAsComparison } from "./available.js";
import { compileWithRs, toRsDefines, type RsCompileResult } from "./rs-compile.js";
import { chainHost, isChainScalar, withHost, type ChainHost } from "./host.js";
import { registryTokenSymbols, resolveTokenMap } from "./token-registry.js";
import type { ProtocolNameOptions } from "./protocol-names.js";
import { pascalOfSlug } from "./accessors.js";
import { chainAmbient, chainDefines, sharedChainDefines } from "./ambient.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import type { EcoRoutesSelector } from "../protocols/eco-routes/lookup.js";
import { intentHost, type IntentSugarDefaults, type LoweredIntent } from "./intent-host.js";
import { entryParamsOf, type EntryParam } from "./entry.js";
import { unknownGlobalError } from "./unknown-global.js";
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
   * `recipes/cctp-split.sauce.ts`) is specialized for one intent. A value is one 256-bit word, so an
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
   * Settings for `Chain(() => { ... }).reward({ ... })` written inside the program — creating an
   * intent from a program, rather than compiling a program into one. Everything the SDK can look up
   * it looks up; these are the fields it cannot, plus overrides. See `intent-host.ts`.
   *
   * Omitted entirely, an intent the source opens still compiles — `deadline` and `creator` have
   * no safe defaults and are reported by name when missing.
   */
  intents?: Partial<IntentSugarDefaults> & EcoRoutesSelector;
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

/** Accessor name -> chain, for every canonical chain. `Base(() => ...)` in a program opens an
 *  intent for exactly the chains `import { Base }` gives a caller, so the two cannot diverge. */
let chainAccessorCache: ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> | undefined;
export function chainAccessorNames(): ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> {
  chainAccessorCache ??= new Map(
    CANONICAL_CHAINS.map((chain) => [pascalOfSlug(chain.slug), chain]),
  );
  return chainAccessorCache;
}

type ChainRefResolved = ReturnType<typeof requireChain>;

type DefineValue = bigint | boolean | number;

/**
 * The chain-scoped values a compile gets beyond the caller's options. Internal to the SDK — passed
 * beside the options rather than inside them, so the public option surface stays what
 * `compileSauceRoute` documents. `openRoute` supplies one for the program it compiles; every nested
 * level gets {@link NESTED_SCOPE}.
 */
export interface RouteScope {
  /**
   * The compile-time values that belong to ONE chain: `chainId`, its protocol contracts and its
   * token symbols (`ambient.ts#chainDefines`). A function rather than values because the values
   * differ per chain, and a program names more than one chain as soon as it opens an intent.
   */
  readonly chainDefines?: (chain: ChainRefResolved) => Readonly<Record<string, DefineValue>>;
}

/** What a nested level resolves its chain-scoped names with: its own chain's registry values and
 *  nothing a caller supplied for another chain. */
const NESTED_SCOPE: RouteScope = { chainDefines: (chain) => sharedChainDefines(chain) };

/**
 * The options and scope a level on `destination` gets, when a program compiled for `enclosing`
 * names it: an intent's body there, its delivery, and the program that body compiles to.
 *
 * NAMES ARE SCOPED PER CHAIN, the way protocol accessors already are (they fold in each chain's own
 * literal address). A token symbol, `chainId` or a protocol define means the chain its part runs on.
 * So everything the caller supplied under a chain-scoped name — a `defines` entry named like one of
 * the enclosing chain's values or the destination's, and every `tokens` override — belongs to the
 * program it was supplied for, and is dropped for the level on another chain. That level takes its
 * own chain's values instead. What the caller named that no chain uses (`RECIPIENT`) holds at every
 * depth.
 *
 * Name-based, not value-based: it does not matter whether a `USDC` define came from
 * `chainDefines(base)` or was chosen by hand. It was a Base name in either case. This is what closes
 * both ways Base's USDC reached an Arbitrum body: `openRoute` folding its chain's values into
 * `defines`, and a direct caller passing them there itself.
 *
 * A level on the SAME chain keeps the enclosing options: its names are the ones they were given for.
 */
function levelOn(
  enclosing: ChainRefResolved,
  destination: ChainRefResolved,
  options: SauceCompileOptions,
  scope: RouteScope,
): { readonly options: SauceCompileOptions; readonly scope: RouteScope } {
  if (destination.id === enclosing.id) return { options, scope };
  const chainScoped = new Set([
    ...Object.keys(scope.chainDefines?.(enclosing) ?? {}),
    ...Object.keys(definesOf(enclosing, options.tokens)),
    ...Object.keys(sharedChainDefines(destination)),
  ]);
  const defines =
    options.defines === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.defines).filter(([name]) => !chainScoped.has(name)),
        );
  return { options: { ...options, defines, tokens: undefined }, scope: NESTED_SCOPE };
}

/** A chain's defines with `tokens` over its registry's: the chain's own, built once, with none. */
function definesOf(
  chain: ChainRefResolved,
  tokens: SauceCompileOptions["tokens"],
): Readonly<Record<string, DefineValue>> {
  return tokens === undefined ? sharedChainDefines(chain) : chainDefines(chain, { tokens });
}

/**
 * What a program compiled for `chain` is given: the chain's HOST (`host.ts`) — every chain-scoped
 * name, a token symbol, `chainId`, a protocol contract, `self`, `Token(...)` — which the compiler
 * asks about each name the program reads and does not bind, and on an EVM chain the intents a
 * program there may open (`intent-host.ts`), each body compiled through the host this builds for
 * its own chain. Only the caller's own compile-time values travel as defines: a define named like
 * a chain-scoped name is the host's (`splitChainDefines`).
 */
function routeHost(
  chain: ChainRefResolved,
  options: SauceCompileOptions,
  scope: RouteScope,
  lowered: LoweredIntent[],
): {
  readonly host: ChainHost;
  readonly defines: SauceCompileOptions["defines"];
  /** Every name the compiler asked about that the host does not declare. */
  readonly declined: ReadonlySet<string>;
} {
  const { defines, tokens, values } = splitChainDefines(options.defines, options.tokens);
  const declined = new Set<string>();
  const recording = (host: ChainHost): ChainHost => ({
    ...host,
    declare: (name) => {
      const declaration = host.declare(name);
      if (declaration === undefined) declined.add(name);
      return declaration;
    },
  });
  const names = chainHost(chain, { tokens, values, accessors: options.accessors });
  if (chain.kind !== "evm") return { host: recording(names), defines, declined };
  const intents = intentHost({
    source: chain,
    chains: chainAccessorNames(),
    defaults: options.intents ?? {},
    lowered,
    // A body on another chain names that chain's values, and nothing the caller supplied for this
    // one (`levelOn`); its own intents are funded on its chain and lowered by its own host.
    programOn: (destination) => {
      const next = levelOn(chain, destination, options, scope);
      const child = routeHost(destination, next.options, next.scope, []);
      return {
        target: destination.kind === "svm" ? "svm" : "evm",
        declare: child.host.declare,
        types: child.host.types,
        hostModules: child.host.hostModules,
        ...(child.host.nested === undefined ? {} : { nested: child.host.nested }),
        ...(child.host.bind === undefined ? {} : { bind: child.host.bind }),
        defines: toRsDefines(child.defines),
        ambient: next.options.ambient,
      };
    },
  });

  return { host: recording(withHost(names, intents)), defines, declined };
}

/**
 * `defines` split by what each name is. One named like a chain-scoped name — a registered token
 * symbol, `chainId`, a protocol contract's address key — is the caller choosing that chain's value
 * for it, so it goes to the chain's host (`tokens`, `values`), which declares it for this chain
 * alone; a body on another chain names its own. The rest are the caller's own compile-time values.
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
    ? compileScopedRoute(destination, closureText(sauce), execution, options, {}, "closure")
    : compileScopedRoute(destination, sauce, execution, options, {});
}

/**
 * {@link compileSauceRoute} with a {@link RouteScope} — `openRoute`'s entry, and every nested
 * intent's. Not exported from the package.
 */
export function compileScopedRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions,
  scope: RouteScope,
  entryKind: "module" | "closure" = "module",
): CompiledSauceRoute {
  const { chain, compiled, source } = compileForChain(
    destination,
    sauce,
    options,
    scope,
    entryKind,
  );
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
  /**
   * The intents the program itself publishes (`Arbitrum(() => { ... }).reward({ ... })`), in source
   * order, each as the lowering encoded it. One with no `captures` is fixed now: its hash, and the
   * Portal transactions that publish it, can be built without running the program. One that
   * captures a local of the program holds a sentinel where the value will be, which only exists
   * once the program runs.
   */
  readonly intents: readonly LoweredIntent[];
  /** The source the compiler was given: the program as written. */
  readonly source: string;
}

/**
 * Compiles a standalone program for `chain`: a program that runs directly on a Pot, rather than
 * the destination half of an intent.
 *
 * It gets everything `openRoute` gives a route body except the intent around it: the chain's
 * ambient bundle (`chainId`, protocol addresses and token symbols as compile-time values scoped to
 * this chain, and the `@sauce/token` functions with no import), the token and protocol syntax, and
 * intents the program itself opens (`Arbitrum(() => { ... }).reward({ ... })`, which take their deadline and
 * creator from `options.intents`). So one source compiles, unchanged, for any chain whose names it
 * uses. `main` may declare typed runtime parameters; `entryParams` reports them and
 * `encodeEntryArguments` encodes values for them.
 */
export function compileSauceProgram(
  chain: ChainRef,
  body: SauceBody,
  options: SauceCompileOptions = {},
): CompiledSauceProgram {
  const sauce = isSauceClosure(body) ? closureText(body) : body;
  const resolved = requireChain(chain);
  // The bundle `openRoute` compiles a route body with, in the same two halves. The ambient MODULES
  // join the caller's. The chain-scoped NAMES travel as a scope for this program's chain, never in
  // `defines`, so an intent the program opens on another chain gets that chain's own (`levelOn`),
  // and `defines` stays exactly what the caller wrote.
  const ambient = Array.from(new Set([...chainAmbient(resolved), ...(options.ambient ?? [])]));
  const scope: RouteScope = {
    chainDefines: (on) => definesOf(on, options.tokens),
  };
  const program = compileForChain(
    resolved,
    sauce,
    { ...options, ambient: ambient.length > 0 ? ambient : options.ambient },
    scope,
    isSauceClosure(body) ? "closure" : "module",
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
    intents: program.intents,
    source: program.source,
  };
}

/**
 * The compile half of {@link compileSauceRoute} and {@link compileSauceProgram}: the compile, with
 * the chain's host, for `destination`, with no execution — no Pot, engine or staged code account,
 * because the bytecode depends on none of them — and none of the chain's ambient bundle beyond what
 * `scope` supplies, which `compileSauceRoute` deliberately leaves to its caller.
 */
function compileForChain(
  destination: ChainRef,
  sauce: string,
  options: SauceCompileOptions,
  scope: RouteScope,
  entryKind: "module" | "closure" = "module",
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly entryParams: RsCompileResult["entryParams"];
  readonly source: string;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly manifest?: AccountManifest;
  readonly intents: readonly LoweredIntent[];
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
  // statements are the entry. The compiler reads it as it is but for one spelling: `available(X)`,
  // which it is given as the comparison `0n != X` it decides, character for character in place.
  const source = sauce;
  const tokens = resolveTokenMap(chain, options.tokens);
  const lowered: LoweredIntent[] = [];
  const level = routeHost(chain, options, scope, lowered);
  let rs: RsCompileResult;
  try {
    rs = compileWithRs({
      source: availableAsComparison(source, chain, tokens, entryKind),
      target,
      entryKind,
      resolve: options.resolve,
      resolvePackage: options.resolvePackage,
      defines: level.defines,
      contracts: options.contracts,
      ambient: options.ambient,
      compactArgs: options.compactArgs,
      host: level.host,
    });
  } catch (error) {
    // A token or protocol name the chain does not have, reported as one rather than as the call
    // the compiler could not lower — from the compiler's own located diagnostics.
    throw (
      unknownGlobalError(
        source,
        "main.js",
        chain,
        level.declined,
        tokens.keys(),
        error,
      ) ?? error
    );
  }
  const { manifest, entryEncoding, entryParams, ...compiled } = rs;

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }
  const intents = lowered;

  return manifest === undefined
    ? { chain, compiled, entryParams, source, entryEncoding, intents }
    : { chain, compiled, entryParams, source, entryEncoding, manifest, intents };
}
