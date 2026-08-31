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
 * the caller has the bytecode to stage) but requires `execution.buffer` to already name an
 * already-staged buffer; omitting it is a build-time error pointing back at that section, not a
 * silent no-op or a confusing later encode-time failure.
 *
 * ONE COOK = ONE PROGRAM: `V12Pot.cook` only ever executes `ingredients[0]`, so a route body is
 * always compiled to exactly one bytecode blob (`compiled.bytecode[0]`) and slotted as exactly one
 * `Call` — a multi-statement body is one program with N statements, never N cooks.
 */
import { compile, type ArgValue, type CompileResult, type CompileTarget, type ContractsConfig } from "@eco-incorp/sauce-compiler";
import { bytesToHex } from "viem";

import type { ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import { compileWithRs } from "./rs-compile.js";
import { rewriteTokenMembers } from "./token-rewrite.js";
import { resolveTokenMap } from "./token-registry.js";
import { rewriteProtocolAccessors, type ProtocolRewriteOptions } from "./protocol-rewrite.js";
import { TOKEN_BASE_DIRS } from "../token/source.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import type { AddressInput, CallInput } from "./types.js";

export interface SauceCompileOptions {
  /** Defaults by destination `ChainKind`: `'v12'` for evm, `'svm'` for svm. */
  target?: CompileTarget;
  /**
   * P6: which compiler `compile()` runs through. `'ts'` (default, omitted) is today's
   * `@eco-incorp/sauce-compiler` TypeScript compiler -- completely unchanged. `'rs'` routes
   * through the RS/WASM compiler instead (`rs-compile.ts`) -- the only path that understands
   * `ambient` below. Every other option on this interface is best-effort translated for the RS
   * path; see `rs-compile.ts`'s own per-field notes for exactly how (e.g. `target: 'v1'|'v12'`
   * both map to the RS compiler's single `'evm'` backend).
   */
  compiler?: "ts" | "rs";
  baseDirs?: string[];
  tsSource?: boolean;
  treeshake?: boolean;
  /**
   * Compile-time argument VALUES baked into a parameterized `main(...)` as a constant-folded
   * arg-prologue: the compiler rewrites `main(a, b, ...)` into a no-arg `main` that opens with these
   * literals, so a program shipped as a standalone `.sauce.ts` asset (e.g. `recipes/cctp-split.sauce.ts`,
   * `settle.sauce.ts`) becomes fixed bytecode with no runtime inputs. TS compiler ONLY: the RS/WASM
   * compiler has no args field, so `compiler: 'rs'` together with `args` throws (see `compileSauceRoute`)
   * rather than silently emit a program whose params never get bound.
   */
  args?: ArgValue[];
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
   * Module specifiers whose exports are broadcast into every module with no `import` line --
   * RS-COMPILER-ONLY (see `compiler` above). Forwarded when `compiler: 'rs'`; a NON-EMPTY value
   * with `compiler` omitted/`'ts'` is rejected up front (parallel to the `args + rs` guard) rather
   * than silently dropped, since the TS compiler has no `ambient` concept and a program relying on
   * it would otherwise fail later with an opaque unresolved-identifier error. An empty array is a
   * no-op on either path and is accepted, so a caller passing `ambient: []` unconditionally is safe.
   */
  ambient?: string[];
}

export interface SauceEvmExecutionInput {
  /** The Pot contract to `cook()` on — see `sauce-calls.ts#SauceEvmCallParams`, never defaulted. */
  pot: AddressInput;
  value?: bigint | number | string;
}

/**
 * Verbatim the existing `sauce-calls.ts#SauceSvmCallParams` shape (`StagedBufferRef` + `accounts` +
 * `programId?`/`executor?`) — a route's SVM execution input IS a staged-buffer execution, no new
 * fields needed.
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
  let defines: Record<string, bigint | boolean | number> | undefined =
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
  if (tokenMap.size > 0) {
    const rewritten = rewriteTokenMembers(source, tokenMap);
    if (rewritten.rewrote) {
      if (chain.kind === "svm") {
        throw new Error(
          `compileSauceRoute: destination '${chain.slug}' is svm — the ERC20 member rewrite ` +
            "(options.tokens) is EVM-only; an SVM route needs the SPL account-plan `Token` emitter " +
            "(see token/api.ts) instead.",
        );
      }
      source = `${ERC20_IMPORT_LINE}\n${rewritten.source}`;
      baseDirs = [...(options.baseDirs ?? []), ...TOKEN_BASE_DIRS];
    }
  }

  if (options.accessors !== false) {
    const accessorOpts: ProtocolRewriteOptions = typeof options.accessors === "object" ? options.accessors : {};
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

  // P6 compiler selector: 'rs' routes through the RS/WASM compiler (rs-compile.ts) -- the only
  // path that understands `options.ambient` -- everything else falls through to the existing TS
  // compile() call, unchanged.
  if (options.compiler === "rs" && options.args !== undefined) {
    throw new Error(
      "compileSauceRoute: options.args (compile-time arg baking) is unsupported by the RS/WASM " +
        "compiler -- it has no args field, so a parameterized `main(...)` would compile with its " +
        "params unbound. Use the default TS compiler (omit `compiler`, or set `compiler: 'ts'`) for " +
        "an args-baked program, or inline the values instead of parameterizing `main`.",
    );
  }
  if (options.compiler !== "rs" && options.ambient !== undefined && options.ambient.length > 0) {
    throw new Error(
      "compileSauceRoute: options.ambient (module exports broadcast into every module with no " +
        "`import` line) is RS-COMPILER-ONLY -- the TS compiler this repo vendors has no `ambient` " +
        "concept to forward it to, so a program relying on it would fail later with an opaque " +
        "unresolved-identifier error. Set `compiler: 'rs'` to use ambient, or drop the option.",
    );
  }
  const compiled =
    options.compiler === "rs"
      ? compileWithRs({ source, target, baseDirs, defines, contracts, ambient: options.ambient })
      : compile(source, {
          target,
          baseDirs,
          tsSource: options.tsSource,
          treeshake: options.treeshake,
          defines,
          contracts,
          args: options.args,
        });

  if (compiled.bytecode.length === 0) {
    throw new Error("compileSauceRoute: compile() produced zero bytecode segments");
  }
  const bytecodeHex = bytesToHex(compiled.bytecode[0]!);

  if (chain.kind === "svm") {
    const svmExecution = execution as SauceSvmExecutionInput;
    if (svmExecution.buffer === undefined) {
      throw new Error(
        "compileSauceRoute: an svm route requires execution.buffer — a buffer this module did NOT " +
          "stage; see sauce-calls.ts's 'SVM STAGING IS A PREREQUISITE' section for the init/write/" +
          "finalize sequence a solver must run first, staging exactly the bytecode this call returns " +
          "in `compiled.bytecode[0]`.",
      );
    }
    const call = buildSauceSvmCall(svmExecution);
    return { calls: [call], compiled, source };
  }

  const evmExecution = execution as SauceEvmExecutionInput;
  const call = buildSauceEvmCall({
    pot: evmExecution.pot,
    ingredients: [bytecodeHex],
    value: evmExecution.value,
  });
  return { calls: [call], compiled, source };
}
