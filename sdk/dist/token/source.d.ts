import { type SvmEmitState } from "./svm.js";
import type { TokenSpec, TokenTarget } from "./types.js";
/** `baseDirs` for compiling any program `tokenSource`/`tokenCallStatement` produces — resolves the
 *  generated `import { IERC20 } from "./artifacts/IERC20.json"` against this installed package's
 *  dist root. Same value/pattern as `swap/source.ts`'s `SWAP_BASE_DIRS`. */
export declare const TOKEN_BASE_DIRS: readonly string[];
/** The import lines a `tokenSource(specs, target)` program needs. On an EVM target: `IERC20`, iff
 *  any spec is `transfer`/`approve`/`balanceOf` (always — every op needs the binding). On `svm`:
 *  none (SVM ops use only the built-in `svm.sload`/`svm.call` globals). */
export declare function tokenImportLines(specs: readonly TokenSpec[], target: TokenTarget): readonly string[];
/** One statement (transfer/approve) or `undefined` (balanceOf has no statement form — see
 *  {@link tokenExpression}) for `spec` on `target`, for splicing into a larger, hand-written
 *  program. Runs the full per-op/per-target validation. `svmState` threads dedup across multiple
 *  ops in one program (`tokenSource`'s own concern) — omit it to get a fresh, single-op program. */
export declare function tokenCallStatement(spec: TokenSpec, target: TokenTarget, index?: number, svmState?: SvmEmitState): string;
/** The expression form of `Token.balanceOf(spec)` — the only op with one. Throws (named) for
 *  `transfer`/`approve`, which have no meaningful expression form. */
export declare function tokenExpression(spec: TokenSpec, target: TokenTarget): string;
/** The account-manifest refs a `transfer`/`approve` spec attaches, in order — mirrors
 *  `svmSettleRefs`. Throws for `balanceOf` (a pure read; its only ref is the caller-supplied
 *  `source`) and for an EVM-target spec (no account manifest on that target). */
export declare function tokenAccountRefs(spec: TokenSpec, target: TokenTarget): readonly string[];
export interface TokenSourceOptions {
    /** Defaults to `"main"`. */
    functionName?: string;
    /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
    imports?: readonly string[];
}
/**
 * A complete, compilable `function main() { ... }` program: one statement per `transfer`/`approve`
 * spec (in order), plus, if the LAST spec is a `balanceOf`, a trailing `return <expr>;` — because
 * `Token.program`'s only consumer (`V12Pot.cook`) executes `ingredients[0]` and wants its result, if
 * any, as the return value. A `balanceOf` in any OTHER position is spliced as a discarded
 * expression statement.
 */
export declare function tokenSource(spec: TokenSpec | readonly TokenSpec[], target: TokenTarget, opts?: TokenSourceOptions): string;
//# sourceMappingURL=source.d.ts.map