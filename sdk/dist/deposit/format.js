/** Tiny formatting helpers shared by `templates.ts` and `source.ts` — no compiler import. */
export function formatBigint(value) {
    return `${value.toString()}n`;
}
/** A resolved address field: `bigint` -> its numeric literal, `"self"` -> `ctx.self()`. */
export function formatAddressField(value) {
    return value === "self" ? "ctx.self()" : formatBigint(value);
}
//# sourceMappingURL=format.js.map