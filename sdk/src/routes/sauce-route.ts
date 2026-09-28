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
import { bytesToHex } from "viem";

import type { ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs } from "./rs-compile.js";
import { rewriteTokenFactory, rewriteTokenMembers } from "./token-rewrite.js";
import { resolveTokenMap } from "./token-registry.js";
import { rewriteProtocolAccessors, type ProtocolRewriteOptions } from "./protocol-rewrite.js";
import { TOKEN_BASE_DIRS } from "../token/source.js";
import { pascalOfSlug } from "./accessors.js";
import { encodeCompactArguments } from "../compact-arguments.js";
import { v12EngineAddress, v12KitchenAddress } from "../deployments/index.js";
import { v12PredictPot } from "../deployments/pot.js";
import { denormalizeToEvm } from "./encode.js";
import { toUniversalAddress } from "./normalize.js";
import { childCaptureSentinel, type CompiledChild } from "./intent-sugar.js";
import { CANONICAL_CHAINS } from "../chains/canonical.js";
import {
  ecoRoutesExecutor,
  ecoRoutesPortal,
  ecoRoutesProver,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import { rewriteIntentSugar, type IntentSugarDefaults } from "./intent-sugar.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import type { AddressInput, CallInput, Hex } from "./types.js";

export interface SauceCompileOptions {
  /** Defaults by destination `ChainKind`: `'v12'` for evm, `'svm'` for svm. */
  target?: CompileTarget;
  baseDirs?: string[];
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
  /** Source after SDK wrapping and rewrites, before the compiler adapter adds entry annotations. */
  readonly source: string;
}

/**
 * A source is treated as already containing an entry program whenever it
 * contains a top-level-looking `function main(` anywhere not immediately preceded by a word
 * character or `.` (so `foo.main(` or `xmain(` don't false-positive); anything else is wrapped as a
 * `function main() { ... }` body.
 */
const MAIN_FN_RE = /(^|[^.\w])function\s+main\s*\(/;

export function wrapSauceBody(sauce: string): string {
  if (MAIN_FN_RE.test(sauce)) return sauce;
  return `function main() {\n${sauce}\n}`;
}

/** Accessor name -> chain, for every canonical chain. `Base(() => ...)` in a program opens an
 *  intent for exactly the chains `import { Base }` gives a caller, so the two cannot diverge. */
let chainAccessorCache: ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> | undefined;
function chainAccessorNames(): ReadonlyMap<string, (typeof CANONICAL_CHAINS)[number]> {
  chainAccessorCache ??= new Map(
    CANONICAL_CHAINS.map((chain) => [pascalOfSlug(chain.slug), chain]),
  );
  return chainAccessorCache;
}

/** Every name the program can read as a compile-time scalar: the chain's token symbols and the
 *  caller's own defines, with the caller winning — the same precedence the compiler applies. */
function compileTimeValues(
  chain: ChainRefResolved,
  options: SauceCompileOptions,
): ReadonlyMap<string, bigint> {
  const values = new Map<string, bigint>();
  for (const [symbol, address] of resolveTokenMap(chain, options.tokens)) {
    values.set(symbol, address);
  }
  for (const [name, value] of Object.entries(options.defines ?? {})) {
    if (typeof value === "bigint") values.set(name, value);
    else if (typeof value === "number") values.set(name, BigInt(Math.trunc(value)));
    else values.set(name, value ? 1n : 0n);
  }
  return values;
}

type ChainRefResolved = ReturnType<typeof requireChain>;

/**
 * Compiles a closure body as a program for its own destination chain, and wraps it in the `cook`
 * the child's route will call.
 *
 * RE-ENTERS `compileSauceRoute`, which is what makes this general rather than a special case: the
 * child gets that chain's token and protocol rewrites, and the intent lowering runs again inside
 * it, so an intent opened within an intent is lowered by the same code at every depth.
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
  options: SauceCompileOptions,
): CompiledChild {
  const intents = options.intents ?? {};
  // DERIVED, not asked for. A Pot is CREATE2 from the Kitchen over its owner and a salt; the owner a
  // route call must cook as is the destination `Portal.executor()`, itself the Portal's second
  // CREATE. Both ends are already in the SDK, so this needs no chain read and no caller input --
  // `intents.pot` remains as an override for a Pot the caller owns instead.
  const pot = intents.pot ?? v12PredictPot(ecoRoutesExecutor(destination, intents));
  if (intents.executionFee === undefined) {
    throw new Error(
      `intent sugar: the intent on ${destination.slug} runs a program, so its cook must pay that ` +
        `chain's Kitchen fee — set \`intents.executionFee\`. This one is NOT derivable: the fee is ` +
        `mutable on-chain and lives on the destination, which the source chain cannot read while it ` +
        `executes. Read it before building with \`destinationExecutionFee()\` from ` +
        `\`@eco-incorp/sauce\`, or \`Kitchen.executionFee()\` at ${v12KitchenAddress()}.`,
    );
  }
  const engine: AddressInput = intents.engine ?? (v12EngineAddress() as Hex);

  const compiled = compileSauceRoute(
    destination,
    childSource,
    { pot, engine, value: intents.executionFee },
    { ...options, compactArgs: captures.length > 0 },
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
 * Compiles `sauce` (a complete `function main(){...}` program, or a bare body auto-wrapped by
 * {@link wrapSauceBody}) for `destination`'s `ChainKind`, and slots the result into exactly one
 * `CallInput` via the existing `buildSauceEvmCall`/`buildSauceSvmCall` fork — never a new encoder.
 */
export function compileSauceRoute(
  destination: ChainRef,
  sauce: string,
  execution: SauceEvmExecutionInput | SauceSvmExecutionInput,
  options: SauceCompileOptions = {},
): CompiledSauceRoute {
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
  // token-registry.ts#resolveTokenMap). Computed unconditionally: for an evm chain the registry may
  // already supply symbols even with no caller options.tokens at all; for an svm chain/id the
  // registry itself has no rows (no TOKEN_REGISTRY key is ever an svm chain id), so this reduces to
  // "only options.tokens, if any" -- preserving the existing svm-throws-on-any-rewrite behavior.
  const tokenMap = resolveTokenMap(chain, options.tokens);

  let source = wrapSauceBody(sauce);

  // The intent sugar runs FIRST, on the source as written. It reads `USDC` and `RECIPIENT` as
  // compile-time values itself, so a token rewrite that had already turned `USDC.transfer(...)`
  // into `IERC20.at(...).transfer(...)` would leave it nothing it recognises. What it leaves behind
  // is ordinary `evm.call` statements, which every later pass is free to walk over.
  const sugar = rewriteIntentSugar(source, {
    source: chain,
    chains: chainAccessorNames(),
    definesFor: (destination) => compileTimeValues(destination, options),
    portalOf: (destination) => ecoRoutesPortal(destination, options.intents),
    proverFor: (from, to) => ecoRoutesProver(from, to, options.intents),
    defaults: options.intents ?? {},
    compileChild: (destination, childSource, captures) =>
      compileIntentChild(destination, childSource, captures, options),
  });
  source = sugar.source;
  let baseDirs = options.baseDirs;
  let contracts: ContractsConfig | undefined = options.contracts;
  // Seed the resolved token map into defines UNDERNEATH the caller's own options.defines -- closes
  // a latent gap where a direct compileSauceRoute(..., { tokens }) call emitted a bare
  // `IERC20.at(USDC)` (the symbol, not a literal) with no `USDC` define at all. Idempotent with
  // openRoute's own ambient-defines merge (ambient.ts#chainDefines resolves the SAME registry), so
  // this is a no-op when reached via openRoute and a genuine fix for a direct caller.
  const defines: Record<string, bigint | boolean | number> | undefined =
    tokenMap.size > 0 ? { ...Object.fromEntries(tokenMap), ...options.defines } : options.defines;

  // ORDER IS LOAD-BEARING: the token pass (member and balance syntax) runs BEFORE the protocol-accessor
  // pass. The accessor pass's `self` sugar rewrites a bare `self` Identifier -> `ctx.self()`
  // textually; if it ran first, `self.USDC` would become `ctx.self().USDC` and the balance
  // sugar's holder would no longer be a bare Identifier, silently losing the site. Safe in the
  // other direction: the accessor pass cannot claim IERC20.at(...)'s output (neither a namespace
  // nor a chain key, and its call sits mid-chain, which `decomposeMemberChain` declines), and its
  // synthesized-binding collision check cannot trip on `IERC20` (`pascalOfSlug("erc20")` yields
  // `IErc20_*`, not `IERC20`); the sugar's own `ctx.self()` output is immune to the accessor
  // pass's self-sugar too (`self` there is a member PROPERTY, which its exclusion set already
  // covers). See routes-token-rewrite.test.ts's composition test for the regression lock.
  // Two ERC20 rewrites both lower to `IERC20.at(...)`: the `<Sym>.transfer(...)` symbol sugar
  // (when the chain has resolved token symbols) and the `Token(addr)` global wrapper (always —
  // it takes an arbitrary address, not a registry symbol). Whichever fires, the `IERC20` import is
  // injected ONCE and `TOKEN_BASE_DIRS` unioned in once; on svm either is the same EVM-only error.
  let tokenRewrote = false;
  if (tokenMap.size > 0) {
    const rewritten = rewriteTokenMembers(source, tokenMap);
    if (rewritten.rewrote) {
      source = rewritten.source;
      tokenRewrote = true;
    }
  }
  const factory = rewriteTokenFactory(source);
  if (factory.rewrote) {
    source = factory.source;
    tokenRewrote = true;
  }
  if (tokenRewrote) {
    if (chain.kind === "svm") {
      throw new Error(
        `compileSauceRoute: destination '${chain.slug}' is svm — the ERC20 token rewrite ` +
          "(`Token(addr)` / `<Sym>.transfer(...)`) is EVM-only; an SVM route needs the SPL " +
          "account-plan `Token` emitter (see token/api.ts) instead.",
      );
    }
    source = `${ERC20_IMPORT_LINE}\n${source}`;
    baseDirs = [...(options.baseDirs ?? []), ...TOKEN_BASE_DIRS];
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

  const compiled = compileWithRs({
    source,
    target,
    baseDirs,
    defines,
    contracts,
    ambient: options.ambient,
    compactArgs: options.compactArgs,
  });

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }
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
