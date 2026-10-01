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
import type { AbiParameter, AccountManifest, ResolveModule, ResolvePackage } from "sauce-compiler";
import { bytesToHex } from "viem";

import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs } from "./rs-compile.js";
import { resolveTokenMap } from "./token-registry.js";
import type { AccessorOptions } from "./protocol-resolve.js";
import { pascalOfSlug } from "./accessors.js";
import { encodeCompactArguments } from "../compact-arguments.js";
import { v12KitchenAddress } from "../deployments/index.js";
import { chainAmbient, chainDefines } from "./ambient.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import { childCaptureSentinel, type CompiledChild } from "./intent-sugar.js";
import { resolveIntentPot } from "./intent-pot.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import {
  ecoRoutesPortal,
  ecoRoutesProver,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import {
  rewriteIntentSugar,
  type IntentSugarDefaults,
  type LoweredIntent,
} from "./intent-sugar.js";
import { entryParamsOf, type EntryParam } from "./entry.js";
import { isTokenSymbol } from "./extensions.js";
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
   *  default per-chain registry (see `resolveTokenMap`) -- the merged map drives both `<Sym>.
   *  transfer/.approve/.balanceOf(...)` and `<holder>.<Sym>` balance-sugar rewrites (see
   *  `token-rewrite.ts`). A bare `USDC.transfer(...)` on a chain the registry covers now compiles
   *  with NO entry here at all. EVM destinations only -- an svm destination throws if any site
   *  actually rewrites, pointing at the SPL account-plan `Token` emitter instead. */
  tokens?: Readonly<Record<string, AddressInput>>;
  /** Parsed ABI bindings, adapted to the compiler's inlineContracts option. */
  contracts?: ContractsConfig;
  /** The chain's protocol namespaces (`UniswapV3.Factory.getPool(…)`, `Cctp.TokenMessenger`) and a
   *  bare `self`, which the compiler reads from the extensions manifest. Enabled by default; pass
   *  false to leave both out, or an options object to configure them. Contract calls need an EVM
   *  destination. */
  accessors?: boolean | AccessorOptions;
  /**
   * Module specifiers whose exports are broadcast into every module with no `import` line: an
   * ambient module's exported functions and consts become callable/readable with no import. Ambient
   * always loses to user code — a name the module declares, imports or binds wins silently.
   */
  ambient?: string[];
  /**
   * Settings for `Chain(() => { ... }).reward({ ... })` written inside the program — creating an
   * intent from a program, rather than compiling a program into one. Everything the SDK can look up
   * it looks up; these are the fields it cannot, plus overrides. See `intent-sugar.ts`.
   *
   * Omitted entirely, the sugar still lowers if the source uses it — `deadline` and `creator` have
   * no safe defaults and are reported by name when missing.
   */
  intents?: Partial<IntentSugarDefaults> & EcoRoutesSelector;
  /** Compile for compact-v1 entry arguments. Set by the intent lowering for a child program whose
   *  captured values arrive at run time; a caller wanting entry arguments generally uses the raw
   *  compiler. */
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
const NESTED_SCOPE: RouteScope = { chainDefines: (chain) => chainDefines(chain) };

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
    ...Object.keys(chainDefines(enclosing, { tokens: options.tokens })),
    ...Object.keys(chainDefines(destination)),
  ]);
  const defines =
    options.defines === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.defines).filter(([name]) => !chainScoped.has(name)),
        );
  return { options: { ...options, defines, tokens: undefined }, scope: NESTED_SCOPE };
}

/** Every name the program can read as a compile-time scalar on `chain`: the chain's token symbols,
 *  then its chain-scoped values when a scope supplies them, then the caller's own defines, with
 *  the caller winning — the same precedence the compiler applies. */
function compileTimeValues(
  chain: ChainRefResolved,
  options: SauceCompileOptions,
  scope: RouteScope,
): ReadonlyMap<string, bigint> {
  const values = new Map<string, bigint>();
  for (const [symbol, address] of resolveTokenMap(chain, options.tokens)) {
    values.set(symbol, address);
  }
  for (const [name, value] of Object.entries({
    ...scope.chainDefines?.(chain),
    ...options.defines,
  })) {
    if (typeof value === "bigint") values.set(name, value);
    else if (typeof value === "number") values.set(name, BigInt(Math.trunc(value)));
    else values.set(name, value ? 1n : 0n);
  }
  return values;
}

/**
 * Compiles a closure body as a program for its own destination chain, and wraps it in the `cook`
 * the child's route will call.
 *
 * RE-ENTERS the route compile, which is what makes this general rather than a special case: the
 * child gets that chain's token and protocol rewrites, and the intent lowering runs again inside
 * it, so an intent opened within an intent is lowered by the same code at every depth. It is handed
 * the options and scope `levelOn` gives its chain, so its chain-scoped names are its own chain's.
 *
 * Captured values arrive as compact-v1 entry arguments at a DECLARED width. Minimal encoding would
 * move the payload's length with the values, leaving nothing at a fixed offset to splice; a
 * declared width keeps exactly one encoding per value and a constant length, which is the property
 * `compact-arguments.ts`'s `scalarWidth` exists for.
 */
function compileIntentChild(
  destination: ChainRefResolved,
  childSource: string,
  captures: readonly string[],
  destinationPortal: AddressInput,
  options: SauceCompileOptions,
  scope: RouteScope,
): CompiledChild {
  const intents = options.intents ?? {};
  // DERIVED, not asked for. A Pot is CREATE2 from the Kitchen over its owner and a salt; the owner a
  // route call must cook as is the Executor of the Portal this child's route RECORDS, itself that
  // Portal's second CREATE. Both ends are already in the SDK, so this needs no chain read and no
  // caller input -- `intents.pot` remains as an override for a Pot the caller owns instead. Derived
  // is not deployed: the Pot must exist before the child is fulfilled (`intent-pot.ts`).
  const { pot, engine } = resolveIntentPot(destinationPortal, intents);
  if (intents.executionFee === undefined) {
    throw new Error(
      `intent sugar: the intent on ${destination.slug} runs a program, so its cook must pay that ` +
        `chain's Kitchen fee — set \`intents.executionFee\`. This one is NOT derivable: the fee is ` +
        `mutable on-chain and lives on the destination, which the source chain cannot read while it ` +
        `executes. Read it before building with \`destinationExecutionFee()\` from ` +
        `\`@eco-incorp/sauce\`, or \`Kitchen.executionFee()\` at ${v12KitchenAddress()}.`,
    );
  }
  const compiled = compileScopedRoute(
    destination,
    childSource,
    { pot, engine, value: intents.executionFee },
    { ...options, compactArgs: captures.length > 0 },
    scope,
  );

  let program: Hex = bytesToHex(compiled.compiled.bytecode[0]!);
  const captureSentinels: bigint[] = [];
  if (captures.length > 0) {
    const schema = compiled.compiled.entrySchema;
    if (schema === undefined) {
      throw new Error(
        "intent sugar: the child program takes captured values but the compiler returned no entry " +
          "schema — its arguments cannot be encoded.",
      );
    }
    captures.forEach((_, index) => captureSentinels.push(childCaptureSentinel(index)));
    const args = encodeCompactArguments(schema, captureSentinels, { scalarWidth: 32 });
    program = `${program}${bytesToHex(args).slice(2)}` as Hex;
  }

  const call = buildSauceEvmCall({
    pot,
    engine,
    program,
    value: intents.executionFee,
  });

  return {
    call: {
      target: denormalizeToEvm(toUniversalAddress(call.target)) as Hex,
      data: call.data,
      value: intents.executionFee,
    },
    captureSentinels,
  };
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
 * {@link compileSauceRoute} with a {@link RouteScope} — `openRoute`'s entry, and every nested
 * intent's. Not exported from the package.
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
  /**
   * The intents the program itself publishes (`Arbitrum(() => { ... }).reward({ ... })`), in source
   * order, each as the lowering encoded it. One with no `captures` is fixed now: its hash, and the
   * Portal transactions that publish it, can be built without running the program. One that
   * captures a local of the program holds a sentinel where the value will be, which only exists
   * once the program runs.
   */
  readonly intents: readonly LoweredIntent[];
  /** Source after the SDK's rewrites, before the compiler adapter adds entry annotations. */
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
  sauce: string,
  options: SauceCompileOptions = {},
): CompiledSauceProgram {
  const resolved = requireChain(chain);
  // The bundle `openRoute` compiles a route body with, in the same two halves. The ambient MODULES
  // join the caller's. The chain-scoped NAMES travel as a scope for this program's chain, never in
  // `defines`, so an intent the program opens on another chain gets that chain's own (`levelOn`),
  // and `defines` stays exactly what the caller wrote.
  const ambient = Array.from(new Set([...chainAmbient(resolved), ...(options.ambient ?? [])]));
  const scope: RouteScope = {
    chainDefines: (on) => chainDefines(on, { tokens: options.tokens }),
  };
  const program = compileForChain(
    resolved,
    sauce,
    { ...options, ambient: ambient.length > 0 ? ambient : options.ambient },
    scope,
  );
  // The compiler's own reading of `main`, which leaves an SVM `Account` slot to the manifest.
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
): {
  readonly chain: CanonicalChain;
  readonly compiled: CompileResult;
  readonly source: string;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly entryParams: readonly AbiParameter[];
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
  // statements are the entry. The compiler tells the two apart; nothing here has to.
  let source = sauce;

  // The intent sugar lowers `Chain(() => …).reward(…)` as text until the compiler opens intents
  // itself. It reads `USDC` and `RECIPIENT` as compile-time values; what it leaves behind is ordinary
  // `evm.call` statements.
  const sugar = rewriteIntentSugar(source, {
    source: chain,
    chains: chainAccessorNames(),
    // This chain's values for this chain — the program's own names and the reward it funds — and
    // each other chain's own for a body there: see `levelOn`.
    definesFor: (destination) => {
      const level = levelOn(chain, destination, options, scope);
      return compileTimeValues(destination, level.options, level.scope);
    },
    portalOf: (destination) => ecoRoutesPortal(destination, options.intents),
    proverFor: (from, to) => ecoRoutesProver(from, to, options.intents),
    defaults: options.intents ?? {},
    compileChild: (destination, childSource, captures, destinationPortal) => {
      const level = levelOn(chain, destination, options, scope);
      return compileIntentChild(
        destination,
        childSource,
        captures,
        destinationPortal,
        level.options,
        level.scope,
      );
    },
  });
  source = sugar.source;
  // The chain's scalar spellings stay defines: a program may declare `const UniswapV3_Factory = 0n;`
  // as the default a chain overrides, which a manifest name — losing to every declaration — could
  // not do. Token symbols are not among them: a define has no type, and a symbol's methods are its
  // type's.
  const symbols = resolveTokenMap(chain, options.tokens);
  const chainScalars = Object.fromEntries(
    Object.entries(scope.chainDefines?.(chain) ?? {}).filter(([name]) => !symbols.has(name)),
  );
  const native = compileNatively(chain, source, target, {
    ...options,
    defines: { ...chainScalars, ...options.defines },
  });
  return { ...native, chain, source, intents: sugar.intents };
}

/**
 * The compile itself: the program as written — after the intent sugar, which still lowers as text —
 * compiled with the extensions manifest for `chain`. The compiler gives
 * it the chain's tokens, protocols, `chainId`, `Token`, `self` and `available` itself, so no define
 * carries a chain-scoped name and no rewrite runs; `defines` is exactly the caller's.
 */
function compileNatively(
  chain: CanonicalChain,
  source: string,
  target: CompileTarget,
  options: SauceCompileOptions,
): {
  readonly compiled: CompileResult;
  readonly entryEncoding: "abi-v1" | "compact-v1";
  readonly entryParams: readonly AbiParameter[];
  readonly manifest?: AccountManifest;
} {
  const accessors = typeof options.accessors === "object" ? options.accessors : {};
  // A define named like a token symbol is that token's address, as it was when the token rewrite
  // read the symbol from the defines: `chainDefines(chain)` handed over as `defines` carries every
  // symbol. As a define it would shadow the symbol's type and leave `USDC.transfer` nothing to call,
  // so it overrides the manifest's token instead.
  const defines: Record<string, DefineValue> = {};
  const tokens: Record<string, AddressInput> = { ...options.tokens };
  for (const [name, value] of Object.entries(options.defines ?? {})) {
    if (isTokenSymbol(name) && typeof value === "bigint")
      tokens[name] ??= `0x${value.toString(16)}`;
    else defines[name] = value;
  }
  const { manifest, entryEncoding, entryParams, ...compiled } = compileWithRs({
    source,
    target,
    resolve: options.resolve,
    resolvePackage: options.resolvePackage,
    defines,
    contracts: options.contracts,
    ambient: options.ambient,
    compactArgs: options.compactArgs,
    extensions: {
      chain,
      tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
      allowWidenedSelectors: accessors.allowWidenedSelectors,
      protocols: options.accessors !== false,
      self: options.accessors !== false && accessors.selfSugar !== false,
    },
  });
  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }

  return manifest === undefined
    ? { compiled, entryEncoding, entryParams }
    : { compiled, entryEncoding, entryParams, manifest };
}
