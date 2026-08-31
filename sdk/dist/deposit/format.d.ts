/** Tiny formatting helpers shared by `templates.ts` and `source.ts` — no compiler import. */
export declare function formatBigint(value: bigint): string;
/** A resolved address field: `bigint` -> its numeric literal, `"self"` -> `ctx.self()`. */
export declare function formatAddressField(value: bigint | "self"): string;
//# sourceMappingURL=format.d.ts.map