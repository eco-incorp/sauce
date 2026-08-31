import { type SwapSourceSpec } from "./types.js";
/**
 * `baseDirs` for compiling any program `swapSource`/`swapCallStatement` produces — resolves the
 * generated `import { ISauceRouter } from "./artifacts/ISauceRouter.json"` (and, for a `"balance"`
 * leg, `./artifacts/IERC20.json`) against this installed package's dist root. Same value/pattern as
 * `sdk/src/recipes/index.ts`'s `SAUCE_BASE_DIRS`.
 */
export declare const SWAP_BASE_DIRS: readonly string[];
/**
 * One `ISauceRouter.at(ctx.self()).swap({...})` statement for `spec` — for splicing into a
 * larger, hand-written program. Runs the FULL `toSwapParams` normalization/guard pass (a
 * `"balance"` `amountIn` reuses every other field's normalization, only the amount itself is
 * emitted as a runtime expression instead of a literal).
 */
export declare function swapCallStatement(spec: SwapSourceSpec): string;
export interface SwapSourceOptions {
    /** Defaults to `"main"`. */
    functionName?: string;
    /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
    imports?: readonly string[];
}
/**
 * The import lines a `swapSource(specs)` program needs — `ISauceRouter` always, plus `IERC20` iff
 * any spec uses `amountIn: "balance"`. Extracted so `swapThenDepositSource` (E4.2's composition
 * seam) can union these with the deposit side's own import lines instead of duplicating this rule;
 * `swapSource` itself just calls this, so its own output is unaffected byte-for-byte.
 */
export declare function swapImportLines(specs: SwapSourceSpec | readonly SwapSourceSpec[]): readonly string[];
/**
 * A complete, compilable `function main() { ... }` program: one `ISauceRouter.swap(...)` statement
 * per spec, in the given order, inside ONE function — because `V12Pot.cook` executes only
 * `ingredients[0]` (its own doc), a multi-hop route is ONE program with N swap statements, not N
 * separate cooks. See `sdk/src/swap/index.ts` for the full compile → `routes.buildSauceEvmCall`
 * seam.
 */
export declare function swapSource(spec: SwapSourceSpec | readonly SwapSourceSpec[], opts?: SwapSourceOptions): string;
//# sourceMappingURL=source.d.ts.map