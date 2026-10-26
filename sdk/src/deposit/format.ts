/** Tiny formatting helpers shared by `templates.ts` and `source.ts` — no compiler import. */

export function formatBigint(value: bigint): string {
  return `${value.toString()}n`;
}

/** A resolved address field: `bigint` -> its numeric literal, `"pot"` -> `ctx.self()`. */
export function formatAddressField(value: bigint | "pot"): string {
  return value === "pot" ? "ctx.self()" : formatBigint(value);
}
