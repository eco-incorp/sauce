/**
 * Cross-chain intent DSL — S1: compile a Sauce program for a route's DESTINATION chain and slot it
 * into `route.calls`. Additive, compiler-untouching (see `docs/plans/2026-08-09-xchain-intent-dsl-v2.md`
 * for the full staged design; this file implements stage 1 only).
 *
 * `compileSauceRoute` is the compile-and-slot seam: it never re-implements the EVM/SVM call
 * builders (`buildSauceEvmCall`/`buildSauceSvmCall` in `sauce-calls.ts`) or the ABI/Borsh encoding —
 * it only decides WHICH target to compile for (from the destination chain's `ChainKind`) and forks
 * to the existing builder.
 *
 * SVM STAGING (unchanged prerequisite): a staged SVM route call executes bytecode that already
 * lives in a buffer PDA — this module never stages anything, exactly like `sauce-calls.ts`'s own
 * "SVM STAGING IS A PREREQUISITE" section documents. `compileSauceRoute` compiles the program (so
 * the caller has the bytecode to stage) but requires `execution.code` to already name an
 * already-staged buffer; omitting it is a build-time error pointing back at that section, not a
 * silent no-op or a confusing later encode-time failure.
 *
 * ONE COOK = ONE PROGRAM: `V12Pot.cook` takes exactly one `bytes program`, so a route body is
 * always compiled to exactly one bytecode blob (`compiled.bytecode[0]`) and slotted as exactly one
 * `Call` — a multi-statement body is one program with N statements, never N cooks.
 *
 * THE SVM CALL DOES NOT COMMIT TO THE COMPILE. An EVM call carries the compiled bytecode itself, but
 * a staged SVM call names only a CODE account, and the released engine's `execute_from_account` has
 * no instruction payload — so there is nowhere to put a content pin and nothing here injects one.
 * The returned calldata says which account to run, never which bytes are in it.
 *
 * The pin that IS enforced on chain is the kitchen's, supplied to
 * `buildFinalizeCodeBufferInstruction` when the buffer is finalized. That binds the bytes at
 * staging time, in another transaction, asserted by the party that already controlled them — so a
 * consumer of this route is not protected by it. Treat `compiled.bytecode[0]` as the thing to
 * compare the account's contents against yourself.
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
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import type { AddressInput, CallInput } from "./types.js";

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
   *  transfer/.approve/.balanceOf(...)` (U4) and `<holder>.<Sym>` balance-sugar rewrites (see
   *  `token-rewrite.ts`). A bare `USDC.transfer(...)` on a chain the registry covers now compiles
   *  with NO entry here at all. EVM destinations only -- an svm destination throws if any site
   *  actually rewrites, pointing at the SPL account-plan `Token` emitter instead. */
  tokens?: Readonly<Record<string, AddressInput>>;
  /** Forwarded directly to `compile()` -- merged with the bindings the protocol-accessor rewrite
   *  (below) synthesizes. A same-named entry with a DIFFERENT abi throws (see `protocol-rewrite.ts`). */
  contracts?: ContractsConfig;
  /** The full protocol-accessor rewrite (`protocol-rewrite.ts`) -- `Uniswap.UniversalRouter.execute(...)`
   *  -> `IUniswapV4_UniversalRouter.at(<addr>n).execute(...)`, plus bare `self` -> `ctx.self()`.
   *  Default ON (`true`); pass `false` to opt out entirely, or an options object to tune it. Default-ON
   *  is isolation-safe by measurement: the shapes it claims (a 1-3 segment member-chain call rooted at
   *  a registry namespace or canonical-chain key) do not compile at all today, so this can only turn a
   *  hard compile error into a success or a clearer error -- never break an already-compiling program.
   *  EVM destinations only -- an svm destination with at least one rewritten accessor site throws. */
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
  /**
   * The interpreter this cook runs on, required for the same reason `pot` is: it is not something
   * this module can guess correctly.
   *
   * It exists because a Pot holds no engine — the interpreter is a `cook` argument on both targets.
   * There is deliberately no default. `V12_EVM_CONTRACTS.v12Runtime` is the obvious candidate and is
   * the wrong one: those addresses are CREATE2 of the initcode that produced them, so they name the
   * stack deployed BEFORE the engine moved into `cook`'s arguments — an interpreter of the older
   * lineage. Defaulting to it would put the right program on the wrong engine silently, which is
   * the one mistake a caller cannot see in the encoded call.
   */
  engine: AddressInput;
  value?: bigint | number | string;
}

/**
 * Verbatim the existing `sauce-calls.ts#SauceSvmCallParams` shape (`StagedBufferRef` + `accounts` +
 * `programId?`/`executor?`) — a route's SVM execution input IS a staged-buffer execution, no new
 * fields needed. `expectedSha256` must be left off: nothing fills it, the engine instruction cannot
 * carry it, and passing it throws — see `svm/instructions.ts#assertNoExecutePin`.
 */
export type SauceSvmExecutionInput = SauceSvmCallParams;

export interface CompiledSauceRoute {
  readonly calls: readonly CallInput[];
  readonly compiled: CompileResult;
  /** The actual source text handed to `compile()` (after bare-body wrapping, if applied). */
  readonly source: string;
}

/**
 * Deliberately dumb, documented rule (the acorn-based version arrives in stage 3 alongside the
 * closure-sugar route-body form): a source is treated as "already a complete program" whenever it
 * contains a top-level-looking `function main(` anywhere not immediately preceded by a word
 * character or `.` (so `foo.main(` or `xmain(` don't false-positive); anything else is wrapped as a
 * `function main() { ... }` body.
 */
const MAIN_FN_RE = /(^|[^.\w])function\s+main\s*\(/;

export function wrapSauceBody(sauce: string): string {
  if (MAIN_FN_RE.test(sauce)) return sauce;
  return `function main() {\n${sauce}\n}`;
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
  let baseDirs = options.baseDirs;
  let contracts: ContractsConfig | undefined = options.contracts;
  // Seed the resolved token map into defines UNDERNEATH the caller's own options.defines -- closes
  // a latent gap where a direct compileSauceRoute(..., { tokens }) call emitted U4's bare
  // `IERC20.at(USDC)` (the symbol, not a literal) with no `USDC` define at all. Idempotent with
  // openRoute's own ambient-defines merge (ambient.ts#chainDefines resolves the SAME registry), so
  // this is a no-op when reached via openRoute and a genuine fix for a direct caller.
  const defines: Record<string, bigint | boolean | number> | undefined =
    tokenMap.size > 0 ? { ...Object.fromEntries(tokenMap), ...options.defines } : options.defines;

  // ORDER IS LOAD-BEARING: the token pass (U4 + balance sugar) runs BEFORE the protocol-accessor
  // pass. The accessor pass's `self` sugar rewrites a bare `self` Identifier -> `ctx.self()`
  // textually; if it ran first, `self.USDC` would become `ctx.self().USDC` and the balance
  // sugar's holder would no longer be a bare Identifier, silently losing the site. Safe in the
  // other direction: the accessor pass cannot claim IERC20.at(...)'s output (neither a namespace
  // nor a chain key, and its call sits mid-chain, which `decomposeMemberChain` declines), and its
  // synthesized-binding collision check cannot trip on `IERC20` (`pascalOfSlug("erc20")` yields
  // `IErc20_*`, not `IERC20`); the sugar's own `ctx.self()` output is immune to the accessor
  // pass's self-sugar too (`self` there is a member PROPERTY, which its exclusion set already
  // covers). See routes-token-rewrite.test.ts's composition test for the regression lock.
  // Two ERC20 rewrites, both lowering to `IERC20.at(...)`: the `<Sym>.transfer(...)` symbol sugar
  // (only when the chain has resolved token symbols) and the `Token(addr)` global wrapper (always —
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
      existingContracts: options.contracts,
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
