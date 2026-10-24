/**
 * Compile a Sauce program for a route's destination and construct its execution call.
 *
 * `compileSauceRoute` selects the target from the destination chain, applies SDK token/protocol
 * rewrites, compiles through the published compiler dependency, and delegates call encoding to
 * `buildSauceEvmCall` or `buildSauceSvmCall`. One body produces one bytecode segment and one call.
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
import { nativeCoinSymbol } from "../chains/index.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { ambientNamesOf, compileWithRs, firstAnswers, type RsCompileResult } from "./rs-compile.js";
import { resolveSdkPackage } from "../embedded/resolve.js";
import { POT_NAME, RETIRED_POT_NAME } from "./pot-sugar.js";
import { walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";
import {
  rewriteTokenFactory,
  rewriteTokenMembers,
  tokenImportLines,
  type SafeWrite,
  type TokenImports,
} from "./token-rewrite.js";
import { resolveTokenMap, svmTokenRows } from "./token-registry.js";
import { rewriteSvmTokenSyntax } from "./svm-token-rewrite.js";
import { rewriteContractResults } from "./contract-results.js";
import { rewriteProtocolAccessors, type ProtocolRewriteOptions } from "./protocol-rewrite.js";
import { checkNames, withoutDead } from "./absent-names.js";
import {
  INSTALLED_CHAIN_MODULE,
  CHAIN_MODULE_ROOT,
  chainKeyModule,
  chainKeyModulePath,
  chainNames,
} from "./chain-module.js";
import { unknownBalanceError, unknownGlobalError } from "./unknown-global.js";
import { pascalOfSlug } from "./accessors.js";
import { chainAmbient, chainDefines, sharedChainDefines } from "./ambient.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import {
  checkEntryWords,
  entryParamsOf,
  entryWords,
  type EntryParam,
  type EntrySignature,
  type EntryValue,
} from "./entry.js";
import type { AddressInput, CallInput } from "./types.js";

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
   * yields fixed bytecode. This is how a standalone `.sauce.ts` asset (e.g. a recipe's program) is
   * specialized for one use. A value is one 256-bit word, so an array or a lookup table cannot be
   * supplied this way — a program needing a variable-length list generates one declaration per
   * element instead (see `svm/recipes/index.ts`).
   */
  defines?: Record<string, bigint | boolean | number>;
  /** Caller token symbol -> address OVERRIDES, merged per-key on top of `token-registry.ts`'s
   *  default per-chain registry (see `resolveTokenMap`) -- the merged map drives both `<Sym>.
   *  transfer/.approve/.balanceOf(...)` and `<holder>.<Sym>` balance-sugar rewrites (see
   *  `token-rewrite.ts`). A bare `USDC.transfer(...)` on a chain the registry covers now compiles
   *  with NO entry here at all. EVM destinations only -- an svm destination throws if any site
   *  actually rewrites, pointing at the SPL account-plan `Token` emitter instead. */
  tokens?: Readonly<Record<string, AddressInput>>;
  /** Parsed ABI bindings merged with the protocol-accessor rewrite's bindings and adapted to the
   *  compiler's inlineContracts option. A same-named binding with a different ABI throws. */
  contracts?: ContractsConfig;
  /** Resolve registered protocol calls and addresses, and rewrite bare `pot` to `ctx.self()`.
   *  Enabled by default; pass false to disable this pass or an options object to configure it.
   *  Contract accessor rewrites require an EVM destination. */
  accessors?: boolean | ProtocolRewriteOptions;
  /**
   * Module specifiers whose exports are broadcast into every module with no `import` line: an
   * ambient module's exported functions and consts become callable/readable with no import. Ambient
   * always loses to user code — a name the module declares, imports or binds wins silently.
   */
  ambient?: string[];
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
  /** Source after the SDK's rewrites, before the compiler adapter adds entry annotations. */
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

type ChainRefResolved = ReturnType<typeof requireChain>;

type DefineValue = bigint | boolean | number;

/**
 * The chain-scoped values a compile gets beyond the caller's options. Internal to the SDK — passed
 * beside the options rather than inside them, so the public option surface stays what
 * `compileSauceRoute` documents. `compileSauceProgram` supplies one for the program it compiles.
 */
export interface RouteScope {
  /**
   * The compile-time values that belong to ONE chain: `chainId`, its protocol contracts and its
   * token symbols (`ambient.ts#chainDefines`). A function rather than values because the values
   * differ per chain.
   */
  readonly chainDefines?: (chain: ChainRefResolved) => Readonly<Record<string, DefineValue>>;
}

/** A chain's defines with `tokens` over its registry's: the chain's own, built once, with none. */
function definesOf(
  chain: ChainRefResolved,
  tokens: SauceCompileOptions["tokens"],
): Readonly<Record<string, DefineValue>> {
  return tokens === undefined ? sharedChainDefines(chain) : chainDefines(chain, { tokens });
}

/** The chain's defines a compile starts from: its token map, then its scope's values, merged once
 *  for each pair of them. A chain's own map and values are one object each on every compile
 *  (`resolveTokenMap`, `sharedChainDefines`), so their merge is kept, by both. */
const baseDefinesCache = new WeakMap<
  ReadonlyMap<string, bigint>,
  WeakMap<object, Readonly<Record<string, DefineValue>>>
>();
const NO_SCOPE = {};

function baseDefines(
  tokenMap: ReadonlyMap<string, bigint>,
  scoped: Readonly<Record<string, DefineValue>> | undefined,
): Readonly<Record<string, DefineValue>> {
  const byScope = baseDefinesCache.get(tokenMap) ?? new WeakMap();
  baseDefinesCache.set(tokenMap, byScope);
  let merged = byScope.get(scoped ?? NO_SCOPE);
  if (merged === undefined) {
    merged = Object.freeze({ ...Object.fromEntries(tokenMap), ...scoped });
    byScope.set(scoped ?? NO_SCOPE, merged);
  }
  return merged;
}

function defaultTargetFor(kind: "evm" | "svm"): CompileTarget {
  return kind === "svm" ? "svm" : "v12";
}

/**
 * Compiles `sauce` for `destination`'s `ChainKind`, and slots the result into exactly one
 * `CallInput` via the existing `buildSauceEvmCall`/`buildSauceSvmCall` fork — never a new encoder.
 *
 * `sauce` is a SauceScript file: a module declaring `function main`, or a script whose top-level
 * statements run as the entry. It reaches the compiler as written, apart from the SDK's rewrites.
 * A value-returning or early-exiting program declares `main`, since a top-level `return` is not
 * SauceScript.
 */
export function compileSauceRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions = {},
): CompiledSauceRoute {
  return compileScopedRoute(destination, sauce, execution, options, {});
}

/**
 * {@link compileSauceRoute} with a {@link RouteScope}. Not exported from the package.
 */
export function compileScopedRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions,
  scope: RouteScope,
): CompiledSauceRoute {
  const { chain, compiled, source, derivedAccounts } = compileForChain(
    destination,
    sauce,
    options,
    scope,
  );
  const bytecodeHex = bytesToHex(compiled.bytecode[0]!);

  if (chain.kind === "svm") {
    if (derivedAccounts !== undefined) {
      // A route's accounts are the caller's `execution.accounts`, built before this compile: the
      // accounts the token methods add, which a cook derives, have no place there.
      throw new Error(
        `compileSauceRoute: the token methods on Solana (\`USDC.transfer(to, amount)\`) add ` +
          `accounts to main (${Object.keys(derivedAccounts).join(", ")}) that a cook derives, ` +
          "which a route's execution.accounts cannot: compile the program with " +
          "compileSauceProgram and cook it (sauce run), or pass the accounts as Account " +
          "parameters to @sauce/token's transfer.",
      );
    }
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
  /** How `main`'s arguments are encoded. */
  readonly entryEncoding: "abi-v1";
  /** `main`'s runtime parameters, in order — on Solana without the `Account` slots, which the
   *  manifest carries. `encodeEntryArguments` encodes values for them. */
  readonly entryParams: readonly EntryParam[];
  /** The SVM account manifest: the accounts to attach, in order. Absent on the EVM. */
  readonly manifest?: AccountManifest;
  /**
   * The accounts the SDK added to `main` for the token methods (`USDC.transfer(to, amount)` on
   * Solana), by parameter name: how each is derived, as an `--account` value — `pot:USDC`, the
   * Pot's USDC account (`authority:USDC` where the program never names `pot`: the account of
   * whoever signs the engine call); `@to:USDC`, the USDC account of main's argument `to`. `sauce`
   * fills each from the cook (`svm/account-names.ts#resolveSvmAccountName`). Absent when it added
   * none.
   */
  readonly derivedAccounts?: Readonly<Record<string, string>>;
  /**
   * The `Uint256` values the SDK added to `main` after its accounts, in order, which no caller
   * gives: each with how the cook's builder works it out — on Solana, a venue's swap at a price
   * takes its pool's `stop` (`stop:<pool>:<token>:<limit>`, `svm/compute-stops.ts`). They are
   * encoded after the caller's arguments; `entryParams` leaves them out. Absent when it added none.
   */
  readonly derivedValues?: readonly DerivedValue[];
  /**
   * On Solana, each venue's swap at a price that a stop could hold, by its stop's derivation
   * (`stop:<pool>:<token>:<limit>`), in source order: what the cook's builder works stops out for,
   * and names in `stops` to compile the ones that bind. Absent when the program has none.
   */
  readonly stoppable?: readonly string[];
  /**
   * How many times each swap in `stoppable` that stands in a loop runs, by its derivation: the
   * loop's count where the loop writes it out (`for (let i = 0; i < 3; i++)`, `for (const x of
   * [a, b])`, nested ones multiplied), else null. A swap in no loop runs once and is not listed.
   */
  readonly stoppableRuns?: Readonly<Record<string, number | null>>;
  /** `main`'s signature as the compile reports it. */
  readonly entrySignature: EntrySignature;
  /** Source after the SDK's rewrites: what the compiler was given. */
  readonly source: string;
}

/** A `Uint256` the SDK added to `main`, which the cook's builder works out. */
export interface DerivedValue {
  readonly name: string;
  readonly type: "Uint256";
  /** How it is worked out: `stop:<pool>:<token>:<limit>`. */
  readonly derive: string;
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
  /**
   * On Solana, the venues' swaps at a price to hold to a stop, each by its stop's derivation (one of
   * `stoppable`): each is compiled to the Stopped form, its stop a value added to `main`
   * (`derivedValues`). Every other swap is the plain one. The `sauce` command names the swaps whose
   * stop binds (`svm/compute-stops.ts`); leave it out for none.
   */
  readonly stops?: readonly string[];
}

/**
 * Compiles a standalone program for `chain`: a program that runs directly on a Pot.
 *
 * It gets the chain's ambient bundle (`chainId`, protocol addresses and token symbols as
 * compile-time values scoped to this chain, and the `@sauce/token` functions with no import) and
 * the token and protocol syntax. So one source compiles, unchanged, for any chain whose names it
 * uses. `main` may declare typed runtime parameters; `entryParams` reports them and
 * `encodeEntryArguments` encodes values for them. Or `options.args` binds them into the program as
 * it compiles.
 */
export function compileSauceProgram(
  chain: ChainRef,
  source: string,
  options: SauceProgramOptions = {},
): CompiledSauceProgram {
  const resolved = requireChain(chain);
  const { args, stops, ...compile } = options;
  // The chain's bundle, in two halves. The ambient MODULES join the caller's. The chain-scoped
  // NAMES travel as a scope for this program's chain, never in `defines`, so `defines` stays exactly
  // what the caller wrote.
  const ambient = Array.from(new Set([...chainAmbient(resolved), ...(compile.ambient ?? [])]));
  const scope: RouteScope = {
    chainDefines: (on) => definesOf(on, compile.tokens),
  };
  const program = compileForChain(
    resolved,
    source,
    { ...compile, ambient: ambient.length > 0 ? ambient : compile.ambient },
    scope,
    stops,
    args === undefined ? undefined : entryWords(args),
  );
  if (args !== undefined) {
    checkEntryWords(args, program.entrySignature);
    const taken = program.entrySignature.params.find((param) =>
      Object.hasOwn(compile.defines ?? {}, param.name),
    );
    if (taken !== undefined) {
      throw new RangeError(
        `${taken.name} is main's parameter, given in args; it is not also a define`,
      );
    }
  }
  const values = program.derivedValues ?? {};
  // As the compiler reports them: an ABI signature, with no `Account` slot, which the manifest
  // carries, and none of the values the SDK added. Nothing is read from the source.
  const entryParams = entryParamsOf(program.entryParams).filter(
    (param) => !Object.hasOwn(values, param.name),
  );
  const derivedValues = Object.entries(values).map(([name, derive]): DerivedValue => ({
    name,
    type: "Uint256",
    derive,
  }));

  return {
    chain: resolved,
    bytecode: program.compiled.bytecode[0]!,
    entryEncoding: program.entryEncoding,
    entryParams,
    ...(program.manifest === undefined ? {} : { manifest: program.manifest }),
    ...(program.derivedAccounts === undefined ? {} : { derivedAccounts: program.derivedAccounts }),
    ...(derivedValues.length === 0 ? {} : { derivedValues }),
    ...(program.stoppable === undefined ? {} : { stoppable: program.stoppable }),
    ...(program.stoppableRuns === undefined ? {} : { stoppableRuns: program.stoppableRuns }),
    entrySignature: program.entrySignature,
    source: program.source,
  };
}

/**
 * The compile half of {@link compileSauceRoute} and {@link compileSauceProgram}: every rewrite and
 * the compile, for `destination`, with no execution — no Pot, engine or staged code account,
 * because the bytecode depends on none of them — and none of the chain's ambient bundle beyond what
 * `scope` supplies, which `compileSauceRoute` deliberately leaves to its caller.
 */
function compileForChain(
  destination: ChainRef,
  sauce: string,
  options: SauceCompileOptions,
  scope: RouteScope,
  /** On Solana, the swaps at a price to hold to a stop (`SauceProgramOptions.stops`). */
  stops: readonly string[] = [],
  /** `main`'s arguments the program is compiled for, as words (`entryWords`). */
  args?: readonly (bigint | boolean | string)[],
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly source: string;
  readonly entryEncoding: "abi-v1";
  readonly manifest?: AccountManifest;
  readonly derivedAccounts?: Readonly<Record<string, string>>;
  readonly derivedValues?: Readonly<Record<string, string>>;
  readonly stoppable?: readonly string[];
  readonly stoppableRuns?: Readonly<Record<string, number | null>>;
  readonly entryParams: RsCompileResult["entryParams"];
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

  // The registry-resolved token map (registry defaults + options.tokens overrides, per-key -- see
  // token-registry.ts#resolveTokenMap). Computed unconditionally: the registry may supply symbols
  // with no caller options.tokens at all -- an evm chain's token addresses, an svm chain's mint keys.
  // On svm they are values only: the token syntax below still throws there, by name.
  const tokenMap = resolveTokenMap(chain, options.tokens);
  // The chain's native coin, whose old spelling `<holder>.<symbol>` the token pass refuses, naming
  // `<holder>.balance`.
  const native = nativeCoinSymbol(chain);
  // Seed the resolved token map into defines UNDERNEATH the caller's own options.defines -- closes
  // a latent gap where a direct compileSauceRoute(..., { tokens }) call emitted a bare `USDC`
  // token argument (the symbol, not a literal) with no `USDC` define at all. Then THIS chain's
  // scoped values, when `compileSauceProgram` supplied a scope (ambient.ts#chainDefines resolves the
  // SAME registry, so the token symbols agree), and the caller's own defines over both.
  const scoped = scope.chainDefines?.(chain);
  // The chain's values are one frozen object for a chain's own map and scope (`baseDefines`), handed
  // over as they are when the caller adds none, so the compile adapter converts them once.
  const chainValues =
    tokenMap.size > 0 || scoped !== undefined ? baseDefines(tokenMap, scoped) : undefined;
  const defines: Readonly<Record<string, DefineValue>> | undefined =
    chainValues === undefined
      ? options.defines
      : options.defines === undefined || Object.keys(options.defines).length === 0
        ? chainValues
        : { ...chainValues, ...options.defines };

  // The names the compile binds beside the source: the caller's defines, its contract bindings and,
  // of the Pot's two names, each a caller's ambient module exports. The compiler says which:
  // `ambientNamesOf` asks it, with this compile's own options and the program's own imports, so a
  // module is found exactly where the compile finds it. It asks only where it can matter: the SDK's
  // own packages (`@sauce/token`), which the SDK resolves ahead of any caller's mapping, export
  // neither name, and a name the program does not read (`probeQuestions`) is none the rewrites
  // touch. A `pot` or `self` that is one of them is the caller's value, never the Pot.
  //
  // A probe the compiler refuses for any other reason gives no answer. It reads the same modules
  // with the same options as the compile, so its refusal is one the compile raises too: the probe's
  // names are left free and the compile below reports its own refusal. Were the compile to succeed
  // anyway, the probe's refusal is thrown instead, so nothing compiles on an answer never given.
  const ambient = options.ambient ?? [];
  // The caller's resolvers, as this compile reads them: each answers a question as it first did, so
  // the probe and the compile read the same modules (`firstAnswers`). The next compile asks afresh.
  const resolve = options.resolve === undefined ? undefined : firstAnswers(options.resolve);
  const resolvePackage =
    options.resolvePackage === undefined ? undefined : firstAnswers(options.resolvePackage);
  const probe = ambient.every((specifier) => resolveSdkPackage(specifier) !== undefined)
    ? undefined
    : probeQuestions(sauce);
  let callerNames: ReadonlySet<string> = new Set();
  let probeRefusal: { readonly error: unknown } | undefined;
  if (probe !== undefined) {
    try {
      callerNames = ambientNamesOf(
        {
          target,
          resolve,
          resolvePackage,
          defines,
          ...(chainValues === undefined ? {} : { baseDefines: chainValues }),
          contracts: options.contracts,
          ambient,
        },
        probe.names,
        probe.imports,
        probe.declared,
      );
    } catch (error) {
      probeRefusal = { error };
    }
  }
  const bound = new Set([
    ...Object.keys(options.defines ?? {}),
    ...Object.keys(options.contracts ?? {}),
    ...callerNames,
  ]);
  // A rewrite that reads `bound`, run as it is, but for a probe the compiler refused: a refusal the
  // rewrite makes then rests on no answer, and the probe's own refusal, which the compile would
  // raise too, is reported in its place.
  const readingBound = <T>(rewrite: () => T): T => {
    if (probeRefusal === undefined) return rewrite();
    try {
      return rewrite();
    } catch {
      throw probeRefusal.error;
    }
  };

  // The source is the program, as written: a module with a `main`, or a script whose top-level
  // statements are the entry. The compiler tells the two apart; nothing here has to.
  let source = sauce;

  // FIRST, before any pass rewrites it: every use of a name this chain lacks must be one a test of
  // the name rules out, which the compiler then leaves uncompiled (see absent-names.ts). The names
  // are the module the compiler is handed (chain-module.ts).
  const accessorOpts: ProtocolRewriteOptions =
    typeof options.accessors === "object" ? options.accessors : {};
  const defined = new Set(Object.keys(options.defines ?? {}));
  const names = chainNames(chain, {
    ...(options.tokens === undefined ? {} : { tokens: tokenMap }),
    defined,
    namespaces: options.accessors !== false,
    allowWidenedSelectors: accessorOpts.allowWidenedSelectors === true,
  });
  const checks = {
    defined,
    ...(accessorOpts.chainScope === undefined ? {} : { chainScope: accessorOpts.chainScope }),
    ...(accessorOpts.onContract === undefined ? {} : { onContract: accessorOpts.onContract }),
  };
  const named = checkNames(source, names, checks);
  // What a test rules out the compiler never compiles, and no pass below may read: a token write,
  // a balance, a venue call or a binding there would add an account, a check or a binding of its
  // own. Blanked in place, so every position the passes and the compiler report is the program's.
  // A contract binding under `&&`/`||` as a value is made the bool the language gives, `!!(…)`.
  source = withoutDead(source, named.dead, named.bindingSides);

  // A method called on a registry call's result (`UniswapV3.Factory.getPool(...).liquidity()`, or on
  // a `const` holding one) becomes the spelling that names the contract the result is
  // (`UniswapV3.Pool(<the call>).liquidity()`, a token's writes `Token(<the call>).transfer(...)`),
  // which the token and accessor passes below lower as written. It claims only calls, never
  // `<result>.<Sym>`, the token pass's balance read. EVM only, as contract bindings are.
  if (options.accessors !== false && chain.kind === "evm") {
    source = rewriteContractResults(source, chain).source;
  }

  let contracts: ContractsConfig | undefined = options.contracts;

  // ORDER IS LOAD-BEARING: the token pass (member and balance syntax) runs BEFORE the protocol-accessor
  // pass. The accessor pass's `pot` sugar rewrites a bare `pot` Identifier -> `ctx.self()`
  // textually; if it ran first, `pot.USDC` would become `ctx.self().USDC` and the balance
  // sugar's holder would no longer be a bare Identifier, silently losing the site. Safe in the
  // other direction: the accessor pass cannot claim the token pass's output (`__sauce_<write>(...)`
  // is a bare call, and `IERC20` is neither a namespace nor a chain key and its call sits
  // mid-chain, which `decomposeMemberChain` declines), and its
  // synthesized-binding collision check cannot trip on `IERC20` (`pascalOfSlug("erc20")` yields
  // `IErc20_*`, not `IERC20`); the sugar's own `ctx.self()` output is immune to the accessor
  // pass's pot-sugar too (`self` there is a member PROPERTY, never a bare read). See
  // routes-token-rewrite.test.ts's composition test for the regression lock.
  // Two ERC20 rewrites: the `<Sym>.transfer(...)` symbol syntax (when the chain has resolved token
  // symbols) and the `Token(addr)` global wrapper (always — it takes an arbitrary address, not a
  // registry symbol). Both lower a WRITE to `@sauce/token`'s SafeERC20 function and a READ to the
  // typed `IERC20.at(...)` binding, so their imports are collected across both and injected ONCE
  // (the SDK serves both modules itself). On svm both spellings are `svm-token-rewrite.ts`'s.
  const writes = new Set<SafeWrite>();
  let erc20 = false;
  let tokenRewrote = false;
  const absorb = (rewritten: TokenImports & { source: string; rewrote: boolean }): void => {
    if (!rewritten.rewrote) return;
    source = rewritten.source;
    tokenRewrote = true;
    for (const write of rewritten.writes) writes.add(write);
    erc20 ||= rewritten.erc20;
  };
  // On svm the same syntax lowers to @sauce/token's SVM arm instead, with the accounts each call
  // moves through added to `main`, and how each is derived reported beside the manifest.
  let derivedAccounts: Readonly<Record<string, string>> | undefined;
  let derivedValues: Readonly<Record<string, string>> | undefined;
  let stoppable: readonly string[] | undefined;
  let stoppableRuns: Readonly<Record<string, number | null>> | undefined;
  if (chain.kind === "svm") {
    const lowered = readingBound(() =>
      rewriteSvmTokenSyntax(
        source,
        svmTokenValues(tokenMap, options.defines),
        svmTokenRows(chain),
        // The caller's values, which a holder may name as a key: its defines.
        new Map(
          Object.entries(options.defines ?? {}).filter(
            (entry): entry is [string, bigint] => typeof entry[1] === "bigint",
          ),
        ),
        native,
        new Set(stops),
        bound,
        names.absentTokens,
      ),
    );
    if (lowered.rewrote) {
      source = lowered.source;
      derivedAccounts = lowered.derived;
      derivedValues = lowered.values;
      stoppable = lowered.stoppable;
      stoppableRuns = lowered.stoppableRuns;
    }
    if (args !== undefined && Object.keys(derivedValues ?? {}).length > 0) {
      throw new RangeError(
        "args: a swap held to a stop takes its stop as main runs, and a program compiled for its " +
          "arguments takes none: compile it without args, or without stops",
      );
    }
  } else {
    absorb(
      readingBound(() =>
        rewriteTokenMembers(
          source,
          tokenMap,
          native === undefined ? undefined : { symbol: native, chain: chain.slug },
          bound,
        ),
      ),
    );
    absorb(rewriteTokenFactory(source));
    if (tokenRewrote) source = [...tokenImportLines({ writes, erc20 }), source].join("\n");
  }

  if (options.accessors !== false) {
    const rewrittenAccessors = readingBound(() =>
      rewriteProtocolAccessors(
        source,
        chain,
        { ...accessorOpts, existingContracts: contracts },
        bound,
      ),
    );
    if (rewrittenAccessors.rewrote) {
      // A call through a protocol's default contract is a name the module holds, and decided on any
      // chain; a binding or `pot` is EVM only.
      if (
        chain.kind === "svm" &&
        (rewrittenAccessors.accessorSites > 0 || rewrittenAccessors.potSites > 0)
      ) {
        throw new Error(
          `compileSauceRoute: destination '${chain.slug}' is svm — the protocol-accessor rewrite ` +
            "(options.accessors) is EVM-only; contract bindings are not supported on target 'svm'.",
        );
      }
      source = rewrittenAccessors.source;
      contracts = { ...contracts, ...rewrittenAccessors.contracts };
    }
  }

  // The chain's names: a module the compiler is handed with the program, and one per chain the
  // program names by key (`Base`), each under a specifier only this process knows, so no import
  // reaches them (`chain-module.ts#INSTALLED_CHAIN_MODULE`, `rs-compile.ts`). A module the caller
  // serves is read by the same check as the entry, since the names reach every module.
  const keys = new Map(named.chainKeys.map((on) => [on.id, on]));
  const compileOnce = (): RsCompileResult =>
    compileWithRs({
      source,
      target,
      resolve,
      resolvePackage,
      defines,
      ...(chainValues === undefined ? {} : { baseDefines: chainValues }),
      contracts,
      ambient: [
        ...(options.ambient ?? []),
        INSTALLED_CHAIN_MODULE,
        ...[...keys.values()].map(chainKeyModule),
      ],
      packages: {
        [INSTALLED_CHAIN_MODULE]: `${CHAIN_MODULE_ROOT}/${names.path}`,
        ...Object.fromEntries(
          [...keys.values()].map((on) => [
            chainKeyModule(on),
            `${CHAIN_MODULE_ROOT}/${chainKeyModulePath(on)}`,
          ]),
        ),
      },
      // A module the caller serves is checked as the entry is, and compiled as the entry is: its
      // ruled-out code blanked, a contract under `&&`/`||` as a value made the bool.
      checkModule: (path, text) => {
        const module = checkNames(text, names, { ...checks, file: path });
        for (const on of module.chainKeys) keys.set(on.id, on);
        return module.dead.length === 0 && module.bindingSides.length === 0
          ? undefined
          : withoutDead(text, module.dead, module.bindingSides);
      },
      ...(args === undefined ? {} : { args }),
    });

  let rs: RsCompileResult;
  try {
    const before = keys.size;
    let first: RsCompileResult | undefined;
    let failure: unknown;
    try {
      first = compileOnce();
    } catch (error) {
      failure = error;
    }
    // A module the entry imports named a chain the entry does not: compile again with its names.
    if (keys.size !== before) rs = compileOnce();
    else if (first === undefined) throw failure;
    else rs = first;
  } catch (error) {
    // A token or protocol name no chain has, reported as one rather than as the call the compiler
    // could not lower. Asked only of a program the compiler refused.
    throw (
      unknownBalanceError(source, chain, { tokens: tokenMap.keys() }, error) ??
      unknownGlobalError(
        source,
        chain,
        {
          defines: Object.keys(defines ?? {}),
          contracts: Object.keys(contracts ?? {}),
          tokens: tokenMap.keys(),
        },
        error,
      ) ??
      error
    );
  }
  // The compile succeeded where the probe was refused: no answer the probe gave stands behind it.
  if (probeRefusal !== undefined) throw probeRefusal.error;
  const { manifest, entryEncoding, entryParams, entrySignature, ...compiled } = rs;

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }

  return {
    chain,
    compiled,
    source,
    entryEncoding,
    entryParams,
    entrySignature,
    ...(manifest === undefined ? {} : { manifest }),
    ...(derivedAccounts === undefined ? {} : { derivedAccounts }),
    ...(derivedValues === undefined ? {} : { derivedValues }),
    ...(stoppable === undefined ? {} : { stoppable }),
    ...(stoppableRuns === undefined ? {} : { stoppableRuns }),
  };
}

/**
 * The mint each token symbol is in an svm compile: the registry's, or the caller's where a define
 * gives the symbol a key of its own (a devnet mint), so an account derived from the symbol is the
 * one the program's own value names.
 */
function svmTokenValues(
  tokens: ReadonlyMap<string, bigint>,
  defines: Readonly<Record<string, DefineValue>> | undefined,
): ReadonlyMap<string, bigint> {
  const own = Object.entries(defines ?? {}).filter(
    ([name, value]) => tokens.has(name) && typeof value === "bigint",
  );
  if (own.length === 0) return tokens;
  const values = new Map(tokens);
  for (const [name, value] of own) values.set(name, value as bigint);

  return values;
}

/**
 * What the probe asks about `sauce`, from the parse every rewrite reads it with (`parseSauce`): the
 * Pot's names (`pot`, `self`) among the identifiers it reads, as the parser names them (an escaped
 * spelling, `p\u006ft`, is the name it spells; a member's name, `ctx.self()`, is none); its import
 * declarations as written, which the probe's entry repeats so that the compiler loads the modules
 * the compile does; and every identifier it writes, an import's binding included, which the probe's
 * own function is named apart from. A program that does not parse asks nothing: no rewrite reads
 * it either.
 */
function probeQuestions(sauce: string): {
  readonly names: readonly string[];
  readonly imports: readonly string[];
  readonly declared: ReadonlySet<string>;
} {
  let program: AstNode;
  try {
    program = parseSauce(sauce);
  } catch {
    return { names: [], imports: [], declared: new Set() };
  }
  const members = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "MemberExpression" && n.computed !== true) members.add(n.property as AstNode);
  });
  const names = new Set<string>();
  const declared = new Set<string>();
  walk(program, (n) => {
    const name = (n as { name?: unknown }).name;
    if (n.type !== "Identifier" || typeof name !== "string") return;
    declared.add(name);
    if (!members.has(n) && (name === POT_NAME || name === RETIRED_POT_NAME)) names.add(name);
  });
  const imports = (program.body as AstNode[])
    .filter((statement) => statement.type === "ImportDeclaration")
    .map((statement) => sauce.slice(statement.start, statement.end));

  return { names: [...names], imports, declared };
}
