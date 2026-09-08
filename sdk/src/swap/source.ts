/**
 * SauceScript SOURCE emission for E4.1's universal swap adapter — pure string templating over
 * {@link toSwapParams}'s normalized output. Imports NO compiler (matches `sdk/src/recipes/index.ts`
 * and `sdk/src/svm/recipes/index.ts`'s posture: every compile option stays explicit at the call
 * site). See `sdk/src/swap/index.ts` for the full E3-composition example.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { toSwapParams } from "./params.js";
import { SwapPoolType, type Hex, type SwapSourceSpec, type SwapSpec } from "./types.js";
import type { SwapParams, PoolKey } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `baseDirs` for compiling any program `swapSource`/`swapCallStatement` produces — resolves the
 * generated `import { ISauceRouter } from "./artifacts/ISauceRouter.json"` (and, for a `"balance"`
 * leg, `./artifacts/IERC20.json`) against this installed package's dist root. Same value/pattern as
 * `sdk/src/recipes/index.ts`'s `SAUCE_BASE_DIRS`.
 */
export const SWAP_BASE_DIRS: readonly string[] = [join(__dirname, "..")];

function formatBigint(value: bigint): string {
  return `${value.toString()}n`;
}

/** `bigint` → its numeric literal; the `"self"` sentinel → the SauceScript `ctx.self()` global. */
function formatAddressField(value: bigint | "self"): string {
  return value === "self" ? "ctx.self()" : formatBigint(value);
}

/** The bytes as a SauceScript `hex` literal; `"0x"` yields the empty one. */
function formatCallback(callback: Hex): string {
  const digits = callback.slice(2);
  if (digits.length % 2 !== 0) throw new Error(`formatCallback: odd-length hex string ${callback}`);

  return `hex\`${digits.toLowerCase()}\``;
}

function formatPoolKey(poolKey: PoolKey): string {
  return (
    `{ currency0: ${formatBigint(poolKey.currency0)}, currency1: ${formatBigint(poolKey.currency1)}, ` +
    `fee: ${formatBigint(poolKey.fee)}, tickSpacing: ${formatBigint(poolKey.tickSpacing)}, ` +
    `hooks: ${formatBigint(poolKey.hooks)} }`
  );
}

function fieldsFromParams(params: SwapParams): Omit<SwapParams, "amountSpecified"> {
  const { amountSpecified: _amountSpecified, ...rest } = params;
  return rest;
}

/**
 * One `ISauceRouter.at(ctx.self()).swap({...})` statement for `spec` — for splicing into a
 * larger, hand-written program. Runs the FULL `toSwapParams` normalization/guard pass (a
 * `"balance"` `amountIn` reuses every other field's normalization, only the amount itself is
 * emitted as a runtime expression instead of a literal).
 */
export function swapCallStatement(spec: SwapSourceSpec): string {
  const concreteSpec: SwapSpec = spec.amountIn === "balance" ? { ...spec, amountIn: 0n } : spec;
  const params = toSwapParams(concreteSpec);
  const fields = fieldsFromParams(params);
  const tokenInLiteral = formatAddressField(fields.tokenIn);

  const amountExpr =
    spec.amountIn === "balance"
      ? spec.poolType === SwapPoolType.UniV4
        ? `(0n - (IERC20.at(${tokenInLiteral}).balanceOf(ctx.self())))`
        : `IERC20.at(${tokenInLiteral}).balanceOf(ctx.self())`
      : formatBigint(params.amountSpecified);

  const lines = [
    "ISauceRouter.at(ctx.self()).swap({",
    `  poolType: ${fields.poolType}n,`,
    `  pool: ${formatAddressField(fields.pool)},`,
    `  poolKey: ${formatPoolKey(fields.poolKey)},`,
    `  tokenIn: ${tokenInLiteral},`,
    `  tokenOut: ${formatAddressField(fields.tokenOut)},`,
    `  amountSpecified: ${amountExpr},`,
    `  sqrtPriceLimitX96: ${formatBigint(fields.sqrtPriceLimitX96)},`,
    `  payer: ${formatAddressField(fields.payer)},`,
    `  recipient: ${formatAddressField(fields.recipient)},`,
    `  callback: ${formatCallback(fields.callback)},`,
    "});",
  ];
  return lines.join("\n");
}

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
export function swapImportLines(
  specs: SwapSourceSpec | readonly SwapSourceSpec[],
): readonly string[] {
  const list = Array.isArray(specs) ? specs : [specs as SwapSourceSpec];
  const needsBalanceImport = list.some((s) => s.amountIn === "balance");
  return [
    `import { ISauceRouter } from "./artifacts/ISauceRouter.json";`,
    ...(needsBalanceImport ? [`import { IERC20 } from "./artifacts/IERC20.json";`] : []),
  ];
}

/**
 * A complete, compilable `function main() { ... }` program: one `ISauceRouter.swap(...)` statement
 * per spec, in the given order, inside ONE function — because `V12Pot.cook` executes only
 * `ingredients[0]` (its own doc), a multi-hop route is ONE program with N swap statements, not N
 * separate cooks. See `sdk/src/swap/index.ts` for the full compile → `routes.buildSauceEvmCall`
 * seam.
 */
export function swapSource(
  spec: SwapSourceSpec | readonly SwapSourceSpec[],
  opts: SwapSourceOptions = {},
): string {
  const specs = Array.isArray(spec) ? spec : [spec as SwapSourceSpec];
  if (specs.length === 0) throw new Error("swapSource: at least one swap spec is required");

  const importLines = [...swapImportLines(specs), ...(opts.imports ?? [])];

  const fnName = opts.functionName ?? "main";
  const body = specs
    .map((s) =>
      swapCallStatement(s)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
    )
    .join("\n");

  return [...importLines, "", `function ${fnName}() {`, body, "}", ""].join("\n");
}
