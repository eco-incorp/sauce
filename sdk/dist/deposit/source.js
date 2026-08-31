/**
 * SauceScript SOURCE emission for E4.2's universal deposit/stake/wrap adapter — pure string
 * templating over {@link toDeposit}'s normalized output. Imports NO compiler (same posture as
 * `sdk/src/swap/source.ts`). See `sdk/src/deposit/index.ts` for the module overview and
 * `sdk/src/swap/index.ts` for the E4.1 sibling this composes with.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SWAP_BASE_DIRS, swapCallStatement, swapImportLines } from "../swap/source.js";
import { formatBigint } from "./format.js";
import { toDeposit } from "./params.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
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
export const DEPOSIT_BASE_DIRS = [
    join(__dirname, ".."),
    join(__dirname, "..", "..", "src"),
];
/** `SWAP_BASE_DIRS` ∪ `DEPOSIT_BASE_DIRS`, de-duped — the `baseDirs` a `swapThenDepositSource`
 *  program needs. */
export const COMPOSED_BASE_DIRS = [...new Set([...SWAP_BASE_DIRS, ...DEPOSIT_BASE_DIRS])];
const IERC20_IMPORT = `import { IERC20 } from "./artifacts/IERC20.json";`;
function needsIerc20Import(d) {
    if (d.template.funding === "erc20-approve" && d.approvalPolicy !== "none")
        return true;
    if (d.template.binding !== null && d.amount === "balance")
        return true;
    return false;
}
/** The approve line(s) for a normalized deposit whose amount has already resolved to `amountExpr`
 *  (a literal or a bound identifier) — the ONE place `funding`/`approvalPolicy` is consulted, so no
 *  template emits its own approve and none can forget one. */
function approveLines(d, amountExpr) {
    if (d.template.funding !== "erc20-approve" || d.approvalPolicy === "none")
        return [];
    if (d.token === null)
        throw new Error("deposit: unreachable — erc20-approve template without a token");
    const approveAmount = d.approvalPolicy === "max" ? "(2n ** 256n - 1n)" : amountExpr;
    return [`IERC20.at(${formatBigint(d.token)}).approve(${formatBigint(d.target)}, ${approveAmount});`];
}
/** Resolves `d.amount` (a literal, or `"balance"`/`"max"`) into an amount EXPRESSION, plus any
 *  binding statement(s) that must precede it (a `"balance"` read is bound once to a const so both
 *  the approve line and the protocol call reuse the SAME value). Rejects `"delta"` — that shape
 *  needs a pre-swap snapshot, which only `swapThenDepositSource` can provide. */
function resolveAmountExpr(d, varSuffix) {
    if (d.amount === "delta") {
        throw new Error(`depositCallStatement: amount "delta" is only meaningful inside swapThenDepositSource (it needs a pre-swap balance snapshot) — ${d.template.protocol}:${d.template.action}`);
    }
    if (d.amount === "max") {
        return { pre: [], amountExpr: "(2n ** 256n - 1n)" };
    }
    if (d.amount === "balance") {
        if (d.template.binding === null) {
            return { pre: [], amountExpr: "ctx.selfBalance()" };
        }
        if (d.token === null)
            throw new Error("deposit: unreachable — erc20 template without a token");
        const varName = `depositAmt${varSuffix}`;
        return {
            pre: [`const ${varName} = IERC20.at(${formatBigint(d.token)}).balanceOf(ctx.self());`],
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
export function depositCallStatement(spec, varSuffix = "") {
    const normalized = toDeposit(spec);
    const { pre, amountExpr } = resolveAmountExpr(normalized, varSuffix);
    const lines = [...pre, ...approveLines(normalized, amountExpr), ...normalized.template.emit(normalized, amountExpr, varSuffix)];
    return lines.join("\n");
}
/** The import lines a `depositSource(specs)` program needs: each resolved template's own
 *  `imports`, plus `IERC20` iff any spec needs an approve or a `"balance"` ERC20 read. De-duped by
 *  exact line, in first-seen order (`IERC20` first, matching `swap`'s own ordering convention). */
export function depositImportLines(specs) {
    const list = Array.isArray(specs) ? specs : [specs];
    const lines = [];
    const seen = new Set();
    let needsIerc20 = false;
    for (const spec of list) {
        const normalized = toDeposit(spec);
        if (needsIerc20Import(normalized))
            needsIerc20 = true;
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
function indentBlock(text) {
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
export function depositSource(spec, opts = {}) {
    const specs = Array.isArray(spec) ? spec : [spec];
    if (specs.length === 0)
        throw new Error("depositSource: at least one deposit spec is required");
    const importLines = [...depositImportLines(specs), ...(opts.imports ?? [])];
    const fnName = opts.functionName ?? "main";
    const body = specs.map((s, i) => indentBlock(depositCallStatement(s, String(i)))).join("\n");
    return [...importLines, "", `function ${fnName}() {`, body, "}", ""].join("\n");
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
export function swapThenDepositSource(swaps, deposits, opts = {}) {
    const swapList = Array.isArray(swaps) ? swaps : [swaps];
    const depositList = Array.isArray(deposits) ? deposits : [deposits];
    if (swapList.length === 0)
        throw new Error("swapThenDepositSource: at least one swap spec is required");
    if (depositList.length === 0) {
        throw new Error("swapThenDepositSource: at least one deposit spec is required");
    }
    const importLines = [];
    const seen = new Set();
    for (const line of [...swapImportLines(swapList), ...depositImportLines(depositList), ...(opts.imports ?? [])]) {
        if (!seen.has(line)) {
            seen.add(line);
            importLines.push(line);
        }
    }
    // A "delta" deposit needs a balance read even if depositImportLines (which never sees "delta"
    // amounts as needing one — it only special-cases "balance") didn't already add it.
    const needsIerc20ForDelta = depositList.some((d) => {
        if (d.amount !== "delta")
            return false;
        const normalized = toDeposit({ ...d, amount: 0n });
        return normalized.template.binding !== null;
    });
    if (needsIerc20ForDelta && !seen.has(IERC20_IMPORT)) {
        importLines.unshift(IERC20_IMPORT);
    }
    const swapBlock = swapList.map(swapCallStatement).join("\n");
    const preLines = [];
    const postLines = [];
    const deltaAmountExprs = new Map();
    depositList.forEach((d, i) => {
        if (d.amount !== "delta")
            return;
        const normalized = toDeposit({ ...d, amount: 0n });
        const varBase = `deposit${i}`;
        if (normalized.template.binding === null) {
            preLines.push(`const ${varBase}Pre = ctx.selfBalance();`);
            postLines.push(`const ${varBase}Post = ctx.selfBalance();`);
        }
        else {
            if (normalized.token === null)
                throw new Error("deposit: unreachable — erc20 template without a token");
            const tokenLit = formatBigint(normalized.token);
            preLines.push(`const ${varBase}Pre = IERC20.at(${tokenLit}).balanceOf(ctx.self());`);
            postLines.push(`const ${varBase}Post = IERC20.at(${tokenLit}).balanceOf(ctx.self());`);
        }
        postLines.push(`const ${varBase}Amt = ${varBase}Post - ${varBase}Pre;`);
        deltaAmountExprs.set(i, `${varBase}Amt`);
    });
    const depositBlocks = depositList.map((d, i) => {
        const deltaExpr = deltaAmountExprs.get(i);
        if (deltaExpr === undefined)
            return depositCallStatement(d, String(i));
        const normalized = toDeposit({ ...d, amount: 0n });
        const lines = [...approveLines(normalized, deltaExpr), ...normalized.template.emit(normalized, deltaExpr, String(i))];
        return lines.join("\n");
    });
    const bodyLines = [...preLines, swapBlock, ...postLines, ...depositBlocks].filter((l) => l.length > 0);
    const fnName = opts.functionName ?? "main";
    const body = indentBlock(bodyLines.join("\n"));
    return [...importLines, "", `function ${fnName}() {`, body, "}", ""].join("\n");
}
//# sourceMappingURL=source.js.map