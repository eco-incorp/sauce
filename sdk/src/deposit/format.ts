/** Tiny formatting helpers shared by `templates.ts` and `source.ts` — no compiler import. */

export function formatBigint(value: bigint): string {
  return `${value.toString()}n`;
}

/** A resolved address field: `bigint` -> its numeric literal, `"self"` -> `ctx.self()`. */
export function formatAddressField(value: bigint | "self"): string {
  return value === "self" ? "ctx.self()" : formatBigint(value);
}
