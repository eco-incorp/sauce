/**
 * Non-breaking sibling of `tsPartialEval` that ALSO surfaces the out-of-band width-forcing
 * signal the return-array escape fold (`scanArrayUses` Rule 6b, gated to `main()` only —
 * see the "one escaping shape that IS authorized" doc note) produces. `tsPartialEval` returns
 * plain TEXT that `acorn.parse` re-parses from scratch, so a `return [lit0, ...];` node this
 * pass SYNTHESIZES can carry no metadata of its own once handed back as a string — the width
 * has to ride alongside the text instead, out-of-band. `wideReturnArrays` is a set of
 * fingerprints (`elements.join(',')`, e.g. `"0,2,4"`) — one per fold-synthesized literal array
 * return — that `compile()` (src/index.ts) consults, via `CompilerContext.wideReturnArrays`, to
 * force BYTE_32 (uint256) element width for a matching return-position array literal (see
 * "Forcing uint256 element width").
 *
 * `tsPartialEval`'s own `(code, filePath) => string` signature is kept EXACTLY as it was — this
 * richer shape is a SEPARATE, additional export, not a breaking change to it — so the `.ts`
 * import seam (`processor/index.ts`'s `collectImportedFunctions`) and any external caller
 * relying on that signature are completely untouched. This also isn't a gap in practice: the
 * return-escape fold can never even fire through the import seam regardless, since an imported
 * module may not define `main` at all (`collectImportedFunctions`'s own `must not define main()`
 * check) and the fold is gated to a top-level `function main` specifically.
 */
export interface TsPartialEvalResult {
    readonly text: string;
    readonly wideReturnArrays: ReadonlySet<string>;
}
export declare function tsPartialEvalWithMeta(code: string, filePath: string): TsPartialEvalResult;
/**
 * Fold provably-constant branches/expressions/loops in a `.ts`/`.sauce.ts` module and
 * strip types, returning plain JS text ready for `acorn.parse`. Pure function of its input
 * text. A thin, signature-preserving wrapper over `tsPartialEvalWithMeta` — see there for the
 * width-forcing meta channel this drops.
 */
export declare function tsPartialEval(code: string, filePath: string): string;
//# sourceMappingURL=ts-frontend.d.ts.map