/**
 * Greedy split routing across several venues, as ONE SauceScript program.
 *
 * Declared functions:
 *   quote_i(amount)        One per candidate; invokes the venue's quoter with a runtime amount.
 *   quote_any(idx, amount) if/else dispatch to the matching quote_i.
 *   swap_any(idx, amount)  Same dispatch, but executing the swap; returns what it realized.
 *   main()                 The three passes below.
 *
 * Main algorithm (all three passes are real `for` loops — the per-candidate state lives in
 * transient storage keyed by `i`):
 *   1. Init:    for i in 0..N-1 { marg[i] = quote_any(i, bucket); }
 *               used[i] and total[i] default to 0 (TLOAD of untouched keys).
 *   2. Greedy:  for iter in 0..n-1 {
 *                 for i in 0..N-1 argmax → (bestMarg, bestIdx);
 *                 used[bestIdx]  += 1;
 *                 total[bestIdx] += marg[bestIdx];          // cached, no call
 *                 marg[bestIdx]   = quote_any(bestIdx, (used[bestIdx]+1)*bucket)
 *                                    - total[bestIdx];
 *               }
 *   3. Execute: for i in 0..N-1 if (used[i] > 0) swap_any(i, used[i]*bucket);
 *
 * The compiler's constant folder UNROLLS a loop whose bound it knows, and `N`/`n` are compile-time
 * constants here, so the emitted main is O(N + n·N) instructions.
 */
import {
  formatBigint,
  fn,
  indent,
  newEmitter,
  type Emitter,
  type Expr,
  type Stmt,
} from "./emit.js";
import { contractsFor, type BindingName } from "./abis.js";
import { compiled, type CompiledProgram } from "./compose.js";
import { parseActions } from "./program.js";
import { lowerAction, type ActionResult } from "./to-sauce.js";
import { quoteCall, type QuoteOptions } from "./to-quote.js";
import type { ApproveAction, SwapAction } from "./types.js";

type Address = `0x${string}`;

/** A swap of `amount` split greedily, `buckets` slices at a time, across `candidates`. */
export interface SplitSwap {
  /**
   * The venues to split across. Each is an ordinary swap action without `amount`, `amountRef` or
   * `saveOutputAs` — the split decides its amount — and must have an on-chain quote with a fixed
   * amount offset (every venue but Uniswap V4, Balancer and Carbon). Each delivers to the Pot.
   */
  readonly candidates: readonly SwapAction[];
  /** The total input, a base-10 string divisible by `buckets`. */
  readonly amount: string;
  /** How many equal slices the greedy allocation hands out; at least 1. */
  readonly buckets: number;
  /**
   * The least total output, checked once after every leg — a per-leg floor cannot express it,
   * because a leg's share is decided at runtime. Required: `"0"` waives it deliberately.
   */
  readonly amountOutMin: string;
  /** Approvals to run first, each with an explicit `amount`. */
  readonly approvals?: readonly ApproveAction[];
  /** Sends the total output of `token` to `recipient` at the end; omit to keep it in the Pot. */
  readonly sweep?: { readonly token: Address; readonly recipient: Address };
  /** The quoter contracts the candidates price through. */
  readonly quoters?: QuoteOptions;
}

const UINT_RE = /^(0|[1-9][0-9]*)$/;

/** Compiles a split swap into one program. It takes no runtime arguments. */
export function compileSplitSwap(swap: SplitSwap): CompiledProgram {
  const candidates = parseActions(swap.candidates, "candidates") as SwapAction[];
  candidates.forEach((candidate, i) => {
    for (const key of ["amount", "amountRef", "saveOutputAs"] as const) {
      if ((candidate as unknown as Record<string, unknown>)[key] !== undefined) {
        throw new Error(
          `candidates[${i}].${key}: a split-swap candidate's amount is decided by the split; remove it`,
        );
      }
    }
  });
  const approvals = parseActions(swap.approvals ?? [], "approvals") as ApproveAction[];
  approvals.forEach((approval, i) => {
    if (approval.type !== "approve" || approval.amount === undefined) {
      throw new Error(
        `approvals[${i}]: expected an \`approve\` action with an explicit \`amount\``,
      );
    }
  });
  if (candidates.length === 0) throw new Error("a split swap needs at least one candidate");
  const n = swap.buckets;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(`buckets must be a positive integer, got ${n}`);
  }
  for (const key of ["amount", "amountOutMin"] as const) {
    if (typeof swap[key] !== "string" || !UINT_RE.test(swap[key])) {
      throw new Error(
        `${key} must be a base-10 unsigned integer string, got ${JSON.stringify(swap[key])}` +
          (key === "amountOutMin" ? ' — pass "0" to waive the floor deliberately' : ""),
      );
    }
  }
  const amount = BigInt(swap.amount);
  if (amount % BigInt(n) !== 0n) {
    throw new Error(
      `amount (${amount}) must be divisible by buckets (${n}) — a remainder would stay in the Pot under the approvals`,
    );
  }
  const bucket = amount / BigInt(n);
  if (bucket === 0n) throw new Error(`amount (${amount}) must be at least buckets (${n})`);

  const N = candidates.length;
  const emit = newEmitter();
  const bindings = new Set<BindingName>();
  const use = (result: ActionResult): ActionResult => {
    for (const b of result.bindings) bindings.add(b);
    return result;
  };

  const quoteFns = candidates.map((candidate, i) => {
    const dynamic = quoteCall(candidate, bucket, swap.quoters).toSauceDynamic;
    if (!dynamic) {
      throw new Error(
        `candidates[${i}] (${candidate.type}) has no on-chain quote with a runtime amount, which a split needs`,
      );
    }
    const quote = dynamic(emit, "amount");

    return fn(`quote_${i}`, ["amount: Uint256"], "Uint256", [
      ...quote.stmts,
      `return ${quote.expr};`,
    ]);
  });

  const quoteAny = fn("quote_any", ["idx: Uint256", "amount: Uint256"], "Uint256", [
    ...outOfRangeGuard(N),
    ...returnDispatch(N, (i) => `return quote_${i}(amount);`),
  ]);

  // Every leg is lowered as consumed (`needsOutput`): it delivers to the Pot and returns what it
  // realized, which the execute pass sums for the aggregate floor.
  const swapAny = fn("swap_any", ["idx: Uint256", "amount: Uint256"], "Uint256", [
    ...outOfRangeGuard(N),
    ...blockDispatch(N, (i) => {
      const built = use(lowerAction(emit, candidates[i]!, "amount", true));

      return [...built.stmts, `return ${built.output};`];
    }),
  ]);

  const main = mainFn(emit, N, n, bucket, swap, approvals, use);
  const source = [...quoteFns, quoteAny, swapAny, main].join("\n\n") + "\n";

  return compiled(source, contractsFor(bindings), []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatchers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns an otherwise-silent fall-through (any out-of-range idx would land on branch N-1) into an
 * explicit revert, so callers can't accidentally route an invalid index to the last candidate.
 */
function outOfRangeGuard(N: number): Stmt[] {
  return [`if (idx >= ${N}n) { revert(); }`];
}

/** `if (idx == 0) return …; … return <last>;` — every path returns. */
function returnDispatch(N: number, branch: (i: number) => Stmt): Stmt[] {
  const early = Array.from({ length: N - 1 }, (_, i) => `if (idx == ${i}n) { ${branch(i)} }`);

  return [...early, branch(N - 1)];
}

/** `if (idx == 0) { … } else if … else { <last> }` — exactly one branch runs. */
function blockDispatch(N: number, branch: (i: number) => readonly Stmt[]): Stmt[] {
  if (N === 1) return [...branch(0)];

  const lines: Stmt[] = [];
  for (let i = 0; i < N - 1; i++) {
    lines.push(`${i === 0 ? "" : "} else "}if (idx == ${i}n) {`);
    lines.push(indent(branch(i)));
  }
  lines.push("} else {");
  lines.push(indent(branch(N - 1)));
  lines.push("}");

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function mainFn(
  emit: Emitter,
  N: number,
  n: number,
  bucket: bigint,
  swap: SplitSwap,
  approvals: readonly ApproveAction[],
  use: (result: ActionResult) => ActionResult,
): string {
  // Transient-storage key layout (compile-time bases; indexed at runtime):
  //   used[i]  at key i
  //   total[i] at key N + i
  //   marg[i]  at key 2N + i
  const key = (base: number, idx: Expr): Expr => (base === 0 ? idx : `${base}n + ${idx}`);
  const used = (idx: Expr): Expr => `evm.tload(${key(0, idx)})`;
  const total = (idx: Expr): Expr => `evm.tload(${key(N, idx)})`;
  const marg = (idx: Expr): Expr => `evm.tload(${key(2 * N, idx)})`;
  const bucketExpr = formatBigint(bucket);

  const body: Stmt[] = [];

  for (const approval of approvals) {
    body.push(
      ...use(lowerAction(emit, approval, formatBigint(BigInt(approval.amount!)), false)).stmts,
    );
  }

  // Init loop: marg[i] = quote_any(i, bucket).
  body.push(
    `for (let i = 0n; i < ${N}n; i = i + 1n) {`,
    `  evm.tstore(${key(2 * N, "i")}, quote_any(i, ${bucketExpr}));`,
    "}",
  );

  // Greedy loop.
  body.push(
    "let bestMarg = 0n;",
    "let bestIdx = 0n;",
    `for (let iter = 0n; iter < ${n}n; iter = iter + 1n) {`,
    "  bestMarg = 0n;",
    "  bestIdx = 0n;",
    `  for (let j = 0n; j < ${N}n; j = j + 1n) {`,
    `    if (${marg("j")} > bestMarg) {`,
    `      bestMarg = ${marg("j")};`,
    "      bestIdx = j;",
    "    }",
    "  }",
    // Allocate only when some venue actually pays. With every marginal at zero the argmax leaves
    // bestIdx at 0, so the old code walked used[0] up to n and sent the WHOLE trade to candidate 0.
    "  if (bestMarg > 0n) {",
    `    evm.tstore(${key(0, "bestIdx")}, ${used("bestIdx")} + 1n);`,
    `    evm.tstore(${key(N, "bestIdx")}, ${total("bestIdx")} + ${marg("bestIdx")});`,
    // The next marginal, CLAMPED. `-` is checked on both engines (compiler/README.md's ledger: the
    // EVM's Math.huff checks add/sub/mul natively), so a quote that comes back below the running
    // total does not wrap — it REVERTS, killing the whole route. Quotes are not guaranteed monotone
    // across sizes: fee tiers are discontinuous, curves are not concave, and an oracle-backed
    // quoter can move between two calls in the same transaction.
    `    let nextQuote = quote_any(bestIdx, (${used("bestIdx")} + 1n) * ${bucketExpr});`,
    `    let running = ${total("bestIdx")};`,
    `    evm.tstore(${key(2 * N, "bestIdx")}, nextQuote > running ? nextQuote - running : 0n);`,
    "  }",
    "}",
  );

  // Execute loop: dispatch the swap for every candidate with used > 0, summing what each returns.
  body.push(
    "let totalOut = 0n;",
    `for (let k = 0n; k < ${N}n; k = k + 1n) {`,
    `  if (${used("k")} > 0n) {`,
    `    totalOut = totalOut + swap_any(k, ${used("k")} * ${bucketExpr});`,
    "  }",
    "}",
  );

  // The aggregate floor, over the realized sum — see `SplitSwap.amountOutMin`.
  const amountOutMin = BigInt(swap.amountOutMin);
  if (amountOutMin > 0n) {
    body.push(`if (totalOut < ${formatBigint(amountOutMin)}) { revert(); }`);
  }

  if (swap.sweep) {
    const { token, recipient } = swap.sweep;
    body.push(
      ...use(lowerAction(emit, { type: "transfer", token, recipient }, "totalOut", false)).stmts,
    );
  }

  return fn("main", [], "void", body);
}
