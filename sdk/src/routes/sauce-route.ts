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
import { compile, type CompileResult, type CompileTarget } from "@eco-incorp/sauce-compiler";
import { bytesToHex } from "viem";

import type { ChainRef } from "../chains/canonical.js";
import { requireChain } from "../chains/canonical.js";
import { buildSauceEvmCall, buildSauceSvmCall, type SauceSvmCallParams } from "./sauce-calls.js";
import type { AddressInput, CallInput } from "./types.js";

export interface SauceCompileOptions {
  /** Defaults by destination `ChainKind`: `'v12'` for evm, `'svm'` for svm. */
  target?: CompileTarget;
  baseDirs?: string[];
  tsSource?: boolean;
  treeshake?: boolean;
  defines?: Record<string, bigint | boolean | number>;
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

  const source = wrapSauceBody(sauce);
  const compiled = compile(source, {
    target,
    baseDirs: options.baseDirs,
    tsSource: options.tsSource,
    treeshake: options.treeshake,
    defines: options.defines,
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
