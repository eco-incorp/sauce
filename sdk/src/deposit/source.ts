/**
 * SauceScript SOURCE emission for E4.2's universal deposit/stake/wrap adapter — pure string
 * templating over {@link toDeposit}'s normalized output. Imports NO compiler (same posture as
 * `sdk/src/swap/source.ts`). See `sdk/src/deposit/index.ts` for the module overview and
 * `sdk/src/swap/index.ts` for the E4.1 sibling this composes with. A template's
 * `./protocols/<slug>/<Export>.json` import and the `./artifacts/IERC20.json` an approval needs are
 * both served by the route compiler, so compiling one needs no resolver option.
 */
import { swapCallStatement, swapImportLines } from "../swap/source.js";
import type { SwapSourceSpec } from "../swap/types.js";
import { safeApproveStatements } from "../token/safe.js";
import { formatBigint } from "./format.js";
import { toDeposit } from "./params.js";
import type { DepositSpec, DepositSourceSpec, NormalizedDeposit } from "./types.js";

const MAX_UINT256 = (1n << 256n) - 1n;

const IERC20_IMPORT = `import { IERC20 } from "./artifacts/IERC20.json";`;

function needsIerc20Import(d: NormalizedDeposit): boolean {
  if (d.template.funding === "erc20-approve" && d.approvalPolicy !== "none") return true;
  return d.template.funding !== "native-value" && (d.amount === "balance" || d.amount === "delta");
}

function balanceExpression(deposit: NormalizedDeposit): string {
  if (deposit.template.funding === "native-value") return "ctx.selfBalance()";

  // WETH unwrap reads the target token itself; typed templates name their asset separately.
  const token = deposit.token ?? deposit.target;

  return `IERC20.at(${formatBigint(token)}).balanceOf(ctx.self())`;
}

/** The approve line(s) for a normalized deposit whose amount has already resolved to `amountExpr`
 *  (a literal or a bound identifier) — the ONE place `funding`/`approvalPolicy` is consulted, so no
 *  template emits its own approve and none can forget one. */
function approveLines(d: NormalizedDeposit, amountExpr: string, varSuffix = ""): string[] {
  if (d.template.funding !== "erc20-approve" || d.approvalPolicy === "none") return [];
  if (d.token === null)
    throw new Error("deposit: unreachable — erc20-approve template without a token");
  // `SafeERC20`/`forceApprove` semantics, not `IERC20.at(t).approve(...)`: the vendored ABI's
  // `bool` return is decoded even when discarded (which reverts on a no-return token like USDT),
  // and skipping the decode alone would accept a `false` return as success. `token/safe.ts` also
  // resets a non-zero allowance first, which USDT requires. A literal amount is passed as a
  // literal so it folds into the calldata; anything else is a bound identifier.
  const amount = /^\d+n$/.test(amountExpr)
    ? { literal: BigInt(amountExpr.slice(0, -1)) }
    : { local: amountExpr };
  return [
    ...safeApproveStatements(
      `dep${varSuffix}_`,
      formatBigint(d.token),
      { literal: d.target },
      d.approvalPolicy === "max" ? { literal: MAX_UINT256 } : amount,
    ),
  ];
}

/** Resolves `d.amount` (a literal, or `"balance"`/`"max"`) into an amount EXPRESSION, plus any
 *  binding statement(s) that must precede it (a `"balance"` read is bound once to a const so both
 *  the approve line and the protocol call reuse the SAME value). Rejects `"delta"` — that shape
 *  needs a pre-swap snapshot, which only `swapThenDepositSource` can provide. */
function resolveAmountExpr(
  d: NormalizedDeposit,
  varSuffix: string,
): { pre: string[]; amountExpr: string } {
  if (d.amount === "delta") {
    throw new Error(
      `depositCallStatement: amount "delta" is only meaningful inside swapThenDepositSource (it needs a pre-swap balance snapshot) — ${d.template.protocol}:${d.template.action}`,
    );
  }
  if (d.amount === "max") {
    return { pre: [], amountExpr: formatBigint(MAX_UINT256) };
  }
  if (d.amount === "balance") {
    if (d.template.funding === "native-value") {
      return { pre: [], amountExpr: balanceExpression(d) };
    }
    const varName = `depositAmt${varSuffix}`;
    return {
      pre: [`const ${varName} = ${balanceExpression(d)};`],
      amountExpr: varName,
    };
  }
  return { pre: [], amountExpr: formatBigint(d.amount) };
}

/**
 * One deposit's full statement block (any `"balance"` binding line, the approve line if
 * applicable, then the protocol call) for `spec` — for splicing into a larger, hand-written
 * program. `varSuffix` disambiguates EVERY local this block binds — the `depositAmtN` balance read
 * and a template's own selector const — when several deposits share one program (`depositSource`
 * passes the spec's own index).
 */
export function depositCallStatement(spec: DepositSourceSpec, varSuffix = ""): string {
  const normalized = toDeposit(spec);
  const { pre, amountExpr } = resolveAmountExpr(normalized, varSuffix);
  const lines = [
    ...pre,
    ...approveLines(normalized, amountExpr, varSuffix),
    ...normalized.template.emit(normalized, amountExpr, varSuffix),
  ];
  return lines.join("\n");
}

/** The import lines a `depositSource(specs)` program needs: each resolved template's own
 *  `imports`, plus `IERC20` iff any spec needs an approval or an ERC20 balance/delta read. De-duped by
 *  exact line, in first-seen order (`IERC20` first, matching `swap`'s own ordering convention). */
export function depositImportLines(
  specs: DepositSourceSpec | readonly DepositSourceSpec[],
): readonly string[] {
  const list = Array.isArray(specs) ? specs : [specs];
  const lines: string[] = [];
  const seen = new Set<string>();
  let needsIerc20 = false;

  for (const spec of list) {
    const normalized = toDeposit(spec);
    if (needsIerc20Import(normalized)) needsIerc20 = true;
    for (const line of normalized.template.imports) {
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
  }

  if (needsIerc20 && !seen.has(IERC20_IMPORT)) {
    lines.unshift(IERC20_IMPORT);
  }
  return lines;
}

export interface DepositSourceOptions {
  /** Defaults to `"main"`. */
  functionName?: string;
  /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
  imports?: readonly string[];
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

/**
 * A complete, compilable `function main() { ... }` program: one deposit statement block per spec,
 * in the given order, inside ONE function. See `sdk/src/deposit/index.ts` for the compile →
 * `routes.buildSauceEvmCall` seam (identical to `swap`'s).
 */
export function depositSource(
  spec: DepositSourceSpec | readonly DepositSourceSpec[],
  opts: DepositSourceOptions = {},
): string {
  const specs = Array.isArray(spec) ? spec : [spec];
  if (specs.length === 0) throw new Error("depositSource: at least one deposit spec is required");

  const importLines = [...depositImportLines(specs), ...(opts.imports ?? [])];
  const fnName = opts.functionName ?? "main";
  const body = specs.map((s, i) => indentBlock(depositCallStatement(s, String(i)))).join("\n");

  return [...importLines, "", `function ${fnName}() {`, body, "}", ""].join("\n");
}

export interface SwapThenDepositOptions {
  /** Defaults to `"main"`. */
  functionName?: string;
  /** Extra import lines spliced in verbatim, ahead of the generated `main`/`functionName` body. */
  imports?: readonly string[];
}

/**
 * The E4.1/E4.2 composition seam: **one cook = one program** (`V12Pot.cook` takes exactly one) — a
 * swap-then-deposit is ONE `main()` with the swap statements followed by the deposit statements, not
 * two cooks. Mirrors the `swapAndSupply` recipe's own shape:
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
export function swapThenDepositSource(
  swaps: SwapSourceSpec | readonly SwapSourceSpec[],
  deposits: DepositSourceSpec | readonly DepositSourceSpec[],
  opts: SwapThenDepositOptions = {},
): string {
  const swapList = Array.isArray(swaps) ? swaps : [swaps];
  const depositList = Array.isArray(deposits) ? deposits : [deposits];
  if (swapList.length === 0)
    throw new Error("swapThenDepositSource: at least one swap spec is required");
  if (depositList.length === 0) {
    throw new Error("swapThenDepositSource: at least one deposit spec is required");
  }

  const importLines: string[] = [];
  const seen = new Set<string>();
  for (const line of [
    ...swapImportLines(swapList),
    ...depositImportLines(depositList),
    ...(opts.imports ?? []),
  ]) {
    if (!seen.has(line)) {
      seen.add(line);
      importLines.push(line);
    }
  }
  const swapBlock = swapList.map(swapCallStatement).join("\n");

  const preLines: string[] = [];
  const postLines: string[] = [];
  const deltaAmountExprs = new Map<number, string>();

  depositList.forEach((d, i) => {
    if (d.amount !== "delta") return;
    const normalized = toDeposit({ ...d, amount: 0n } as DepositSpec);
    const varBase = `deposit${i}`;
    const balance = balanceExpression(normalized);
    preLines.push(`const ${varBase}Pre = ${balance};`);
    postLines.push(`const ${varBase}Post = ${balance};`);
    postLines.push(`const ${varBase}Amt = ${varBase}Post - ${varBase}Pre;`);
    deltaAmountExprs.set(i, `${varBase}Amt`);
  });

  const depositBlocks = depositList.map((d, i) => {
    const deltaExpr = deltaAmountExprs.get(i);
    if (deltaExpr === undefined) return depositCallStatement(d, String(i));
    const normalized = toDeposit({ ...d, amount: 0n } as DepositSpec);
    const lines = [
      ...approveLines(normalized, deltaExpr, String(i)),
      ...normalized.template.emit(normalized, deltaExpr, String(i)),
    ];
    return lines.join("\n");
  });

  const bodyLines = [...preLines, swapBlock, ...postLines, ...depositBlocks].filter(
    (l) => l.length > 0,
  );
  const fnName = opts.functionName ?? "main";
  const body = indentBlock(bodyLines.join("\n"));

  return [...importLines, "", `function ${fnName}() {`, body, "}", ""].join("\n");
}
