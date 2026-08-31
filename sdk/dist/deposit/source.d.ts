import type { SwapSourceSpec } from "../swap/types.js";
import type { DepositSourceSpec } from "./types.js";
/**
 * `baseDirs` for compiling a `depositSource`/`depositCallStatement` program. Two entries, because
 * (unlike `swap`, whose only import is the engine-vendored `ISauceRouter`) a deposit template's
 * import resolves against the SDK's PROTOCOL registry, which lives in `sdk/src/protocols`, not
 * `sdk/dist/artifacts`:
 *
 * 1. `join(__dirname, "..")` — the dist root, resolving `./artifacts/IERC20.json` (same artifact
 *    `swap`'s `"balance"` path already uses).
 * 2. `join(__dirname, "..", "..", "src")` — the SHIPPED `sdk/src` tree (the root `package.json`
 *    `files` list ships `sdk/src/protocols` verbatim — see `sdk/src/deposit/index.ts`'s packaging
 *    note), resolving `./protocols/<slug>/<X>ABI.json`.
 *
 * In dev (this package's own `src/`), `__dirname` is `sdk/src/deposit`, so both entries land on
 * `sdk/src`, which already has both trees.
 */
export declare const DEPOSIT_BASE_DIRS: readonly string[];
/** `SWAP_BASE_DIRS` ∪ `DEPOSIT_BASE_DIRS`, de-duped — the `baseDirs` a `swapThenDepositSource`
 *  program needs. */
export declare const COMPOSED_BASE_DIRS: readonly string[];
/**
 * One deposit's full statement block (any `"balance"` binding line, the approve line if
 * applicable, then the protocol call) for `spec` — for splicing into a larger, hand-written
 * program. `varSuffix` disambiguates the bound `depositAmtN` local when multiple `"balance"`
 * deposits share one program (`depositSource` passes the spec's own index).
 */
export declare function depositCallStatement(spec: DepositSourceSpec, varSuffix?: string): string;
/** The import lines a `depositSource(specs)` program needs: each resolved template's own
 *  `imports`, plus `IERC20` iff any spec needs an approve or a `"balance"` ERC20 read. De-duped by
 *  exact line, in first-seen order (`IERC20` first, matching `swap`'s own ordering convention). */
export declare function depositImportLines(specs: DepositSourceSpec | readonly DepositSourceSpec[]): readonly string[];
export interface DepositSourceOptions {
    /** Defaults to `"main"`. */
    functionName?: string;
    /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
    imports?: readonly string[];
}
/**
 * A complete, compilable `function main() { ... }` program: one deposit statement block per spec,
 * in the given order, inside ONE function. See `sdk/src/deposit/index.ts` for the compile →
 * `routes.buildSauceEvmCall` seam (identical to `swap`'s).
 */
export declare function depositSource(spec: DepositSourceSpec | readonly DepositSourceSpec[], opts?: DepositSourceOptions): string;
export interface SwapThenDepositOptions {
    /** Defaults to `"main"`. */
    functionName?: string;
    /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
    imports?: readonly string[];
}
/**
 * The E4.1/E4.2 composition seam: **one cook = one program** (`V12Pot.cook` executes
 * `ingredients[0]` only) — a swap-then-deposit is ONE `main()` with the swap statements followed by
 * the deposit statements, not two cooks. Mirrors the `swapAndSupply` recipe's own shape:
 * `outToken.approve(aavePool, swapDelta); IAavePool.at(aavePool).supply(tokenOut, swapDelta,
 * beneficiary, 0);`.
 *
 * A deposit spec with `amount: "delta"` is bracketed around the WHOLE swap block: a balance
 * snapshot (`IERC20.balanceOf`/`ctx.selfBalance()`, per the template's funding kind) is taken before
 * the swap statements and again after, and the deposit uses `post - pre` — the exact
 * `swapAndSupply` idiom ("never sweep pre-existing tokenOut dust", since a cook may run in a shared
 * runtime context). `amount: "balance"`/a concrete literal are unaffected and just run after the
 * swap block, per `depositCallStatement`'s own rules.
 *
 * Import lines are unioned (not concatenated) — `swapImportLines` ∪ `depositImportLines`, de-duped
 * by exact line, so a program needing `IERC20` from both sides emits it exactly once (the compiler
 * throws `Conflicting ABIs registered` for two DIFFERENT ABIs bound to the same local name, but is
 * idempotent for the identical import line repeated).
 */
export declare function swapThenDepositSource(swaps: SwapSourceSpec | readonly SwapSourceSpec[], deposits: DepositSourceSpec | readonly DepositSourceSpec[], opts?: SwapThenDepositOptions): string;
//# sourceMappingURL=source.d.ts.map