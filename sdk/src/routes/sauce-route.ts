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
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs, type RsCompileResult } from "./rs-compile.js";
import {
  rewriteTokenFactory,
  rewriteTokenMembers,
  tokenImportLines,
  type SafeWrite,
  type TokenImports,
} from "./token-rewrite.js";
import { resolveTokenMap } from "./token-registry.js";
import { rewriteProtocolAccessors, type ProtocolRewriteOptions } from "./protocol-rewrite.js";
import { rewriteAvailability } from "./available.js";
import { unknownGlobalError } from "./unknown-global.js";
import { pascalOfSlug } from "./accessors.js";
import { chainAmbient, chainDefines, sharedChainDefines } from "./ambient.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import {
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
   * yields fixed bytecode. This is how a standalone `.sauce.ts` asset (e.g.
   * a recipe's program) is specialized for one use. A value is one 256-bit word, so an
   * array or a lookup table cannot be supplied this way — a program needing a variable-length list
   * generates one declaration per element instead (see `svm/recipes/index.ts`).
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
  /** Resolve registered protocol calls and addresses, and rewrite bare `self` to `ctx.self()`.
   *  Enabled by default; pass false to disable this pass or an options object to configure it.
   *  Contract accessor rewrites require an EVM destination. */
  accessors?: boolean | ProtocolRewriteOptions;
  /**
   * Module specifiers whose exports are broadcast into every module with no `import` line: an
   * ambient module's exported functions and consts become callable/readable with no import. Ambient
   * always loses to user code — a name the module declares, imports or binds wins silently.
   */
  ambient?: string[];
  /** Compile for compact-v1 entry arguments; a caller wanting entry arguments generally uses the
   *  raw compiler. */
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
  const { chain, compiled, source } = compileForChain(destination, sauce, options, scope);
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
  /** Source after the SDK's rewrites: what the compiler was given. */
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
  const { args, ...compile } = options;
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
  args?: readonly (bigint | boolean | string)[],
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly source: string;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly manifest?: AccountManifest;
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

  // The source is the program, as written: a module with a `main`, or a script whose top-level
  // statements are the entry. The compiler tells the two apart; nothing here has to.
  let source = sauce;

  // `available(...)` FIRST: it removes the branches that name a contract or token this chain lacks,
  // before any other pass resolves a name in them (see available.ts). A closure body is left for its
  // own chain's compile.
  source = rewriteAvailability(source, chain, tokenMap).source;

  let contracts: ContractsConfig | undefined = options.contracts;
  // Seed the resolved token map into defines UNDERNEATH the caller's own options.defines -- closes
  // a latent gap where a direct compileSauceRoute(..., { tokens }) call emitted a bare `USDC`
  // token argument (the symbol, not a literal) with no `USDC` define at all. Then THIS chain's
  // scoped values, when `compileSauceProgram` supplied a scope (ambient.ts#chainDefines resolves the SAME
  // registry, so the token symbols agree), and the caller's own defines over both.
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

  // ORDER IS LOAD-BEARING: the token pass (member and balance syntax) runs BEFORE the protocol-accessor
  // pass. The accessor pass's `self` sugar rewrites a bare `self` Identifier -> `ctx.self()`
  // textually; if it ran first, `self.USDC` would become `ctx.self().USDC` and the balance
  // sugar's holder would no longer be a bare Identifier, silently losing the site. Safe in the
  // other direction: the accessor pass cannot claim the token pass's output (`__sauce_<write>(...)`
  // is a bare call, and `IERC20` is neither a namespace nor a chain key and its call sits
  // mid-chain, which `decomposeMemberChain` declines), and its
  // synthesized-binding collision check cannot trip on `IERC20` (`pascalOfSlug("erc20")` yields
  // `IErc20_*`, not `IERC20`); the sugar's own `ctx.self()` output is immune to the accessor
  // pass's self-sugar too (`self` there is a member PROPERTY, which its exclusion set already
  // covers). See routes-token-rewrite.test.ts's composition test for the regression lock.
  // Two ERC20 rewrites: the `<Sym>.transfer(...)` symbol syntax (when the chain has resolved token
  // symbols) and the `Token(addr)` global wrapper (always — it takes an arbitrary address, not a
  // registry symbol). Both lower a WRITE to `@sauce/token`'s SafeERC20 function and a READ to the
  // typed `IERC20.at(...)` binding, so their imports are collected across both and injected ONCE
  // (the SDK serves both modules itself); on svm either is the same EVM-only error.
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
  if (tokenMap.size > 0) absorb(rewriteTokenMembers(source, tokenMap));
  absorb(rewriteTokenFactory(source));
  if (tokenRewrote) {
    if (chain.kind === "svm") {
      throw new Error(
        `compileSauceRoute: destination '${chain.slug}' is svm — the ERC20 token rewrite ` +
          "(`Token(addr)` / `<Sym>.transfer(...)` / `self.<Sym>`) is EVM-only. On svm a token " +
          "symbol is the mint, a value for the @sauce/token functions with the accounts as " +
          "Account parameters: `transfer(USDC, tokenProgram, source, dest, authority, amount)`, " +
          "`balanceOf(USDC, account)`; or the SPL account-plan `Token` emitter (see token/api.ts).",
      );
    }
    source = [...tokenImportLines({ writes, erc20 }), source].join("\n");
  }

  if (options.accessors !== false) {
    const accessorOpts: ProtocolRewriteOptions =
      typeof options.accessors === "object" ? options.accessors : {};
    const rewrittenAccessors = rewriteProtocolAccessors(source, chain, {
      ...accessorOpts,
      existingContracts: contracts,
    });
    if (rewrittenAccessors.rewrote) {
      if (chain.kind === "svm") {
        throw new Error(
          `compileSauceRoute: destination '${chain.slug}' is svm — the protocol-accessor rewrite ` +
            "(options.accessors) is EVM-only; contract bindings are not supported on target 'svm'.",
        );
      }
      source = rewrittenAccessors.source;
      contracts = { ...contracts, ...rewrittenAccessors.contracts };
    }
  }

  let rs: RsCompileResult;
  try {
    rs = compileWithRs({
      source,
      target,
      resolve: options.resolve,
      resolvePackage: options.resolvePackage,
      defines,
      ...(chainValues === undefined ? {} : { baseDefines: chainValues }),
      contracts,
      ambient: options.ambient,
      compactArgs: options.compactArgs,
      ...(args === undefined ? {} : { args }),
    });
  } catch (error) {
    // A token or protocol name the chain does not have, reported as one rather than as the call
    // the compiler could not lower. Asked only of a program the compiler refused.
    throw (
      unknownGlobalError(
        source,
        chain,
        {
          defines: Object.keys(defines ?? {}),
          contracts: Object.keys(contracts ?? {}),
          tokens: tokenMap.keys(),
        },
        error,
      ) ?? error
    );
  }
  const { manifest, entryEncoding, entryParams, entrySignature, ...compiled } = rs;

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }

  return manifest === undefined
    ? { chain, compiled, source, entryEncoding, entryParams, entrySignature }
    : { chain, compiled, source, entryEncoding, manifest, entryParams, entrySignature };
}
