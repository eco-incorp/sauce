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
 *   1. Init:    for i in 0..N-1 { used[i] = 0; total[i] = 0; marg[i] = quote_any(i, bucket); }
 *               Every key is written here before any pass reads it. Transient storage is the
 *               Pot's and lasts the whole transaction, not the cook, so an earlier cook in the
 *               same transaction (another split, or this one again) may have left values behind.
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
  COMPILER_POT_NAMES,
  formatBigint,
  fn,
  indent,
  newEmitter,
  POT_NAMES,
  type Emitter,
  type Expr,
  type Stmt,
} from "./emit.js";
import {
  resolveChain,
  type CanonicalChain,
  type ChainRef,
} from "../../sdk/dist/chains/canonical.js";
import { contractsFor, type BindingName } from "./abis.js";
import { compiled, type CompiledProgram } from "./compose.js";
import { resolveNames, usesNames } from "./names.js";
import { parseActions } from "./program.js";
import { ProgramError, type ProgramIssue } from "./semantics.js";
import { RETIRED_POT, RETIRED_POT_MESSAGE } from "./spec.js";
import { lowerAction, routerImport, type ActionResult, type RouterFunction } from "./to-sauce.js";
import { quoteCall, type QuoteOptions } from "./to-quote.js";
import type { Action, ApproveAction, Recipient, SwapAction, Token } from "./types.js";

/** A swap of `amount` split greedily, `buckets` slices at a time, across `candidates`. */
export interface SplitSwap {
  /**
   * The venues to split across. Each is an ordinary swap action without `amount`, `amountRef` or
   * `saveOutputAs` — the split decides its amount — and must have an on-chain quote with a fixed
   * amount offset (every venue but Balancer V2, Balancer V3 and Carbon). Each delivers to the Pot.
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
  readonly sweep?: { readonly token: Token; readonly recipient: Recipient };
  /** The quoter contracts the candidates price through. */
  readonly quoters?: QuoteOptions;
  /**
   * The chain the split runs on, which its token symbols and namespace references resolve on —
   * needed when any candidate, approval or the sweep names one. Each name becomes its address
   * there, because the quotes are calldata built here.
   */
  readonly chain?: ChainRef;
}

const UINT_RE = /^(0|[1-9][0-9]*)$/;

/** Compiles a split swap into one program. It takes no runtime arguments. */
export function compileSplitSwap(swap: SplitSwap): CompiledProgram {
  let candidates = parseActions(swap.candidates, "candidates") as SwapAction[];
  candidates.forEach((candidate, i) => {
    for (const key of ["amount", "amountRef", "saveOutputAs"] as const) {
      if ((candidate as unknown as Record<string, unknown>)[key] !== undefined) {
        throw new Error(
          `candidates[${i}].${key}: a split-swap candidate's amount is decided by the split; remove it`,
        );
      }
    }
  });
  let approvals = parseActions(swap.approvals ?? [], "approvals") as ApproveAction[];
  approvals.forEach((approval, i) => {
    if (approval.type !== "approve" || approval.amount === undefined) {
      throw new Error(
        `approvals[${i}]: expected an \`approve\` action with an explicit \`amount\``,
      );
    }
  });
  if (candidates.length === 0) throw new Error("a split swap needs at least one candidate");
  candidates.forEach((candidate, i) => {
    if ((candidate as { factory?: string }).factory !== undefined) {
      throw new Error(
        `candidates[${i}].factory: a split quotes each candidate at its pool's address, and a pool ` +
          "named by its key is found only while the program runs — give `pool`",
      );
    }
  });
  let sweep = swap.sweep;
  // A retired recipient is the document's own mistake, not the chain's: refuse it before the chain
  // is resolved, and name no chain, as the candidates' own fields are refused.
  if ((sweep?.recipient as string | undefined) === RETIRED_POT) {
    throw new ProgramError([{ path: "sweep.recipient", message: RETIRED_POT_MESSAGE }]);
  }
  const chain = swap.chain === undefined ? undefined : splitChain(swap.chain);
  const sweepAction: Action[] =
    sweep === undefined ? [] : [{ type: "transfer", amount: "0", ...sweep }];
  // The sweep is lowered as a transfer, so a malformed recipient (`"0x1"`, `"1"`) must be refused
  // here as a transfer's would be, not left-padded to an address the swept output is burned at.
  try {
    parseActions(sweepAction, "sweep");
  } catch (error) {
    if (!(error instanceof ProgramError)) throw error;
    // The sweep is one object, not a list: name `sweep.recipient`, not `sweep[0].recipient`.
    throw new ProgramError(
      error.issues.map((issue) => ({ ...issue, path: issue.path.replace(/^sweep\[0\]/, "sweep") })),
    );
  }
  if (usesNames([...candidates, ...approvals, ...sweepAction])) {
    if (chain === undefined) {
      throw new Error(
        "a split swap that names a token or a contract needs `chain`, the chain to resolve it on",
      );
    }
    const issues: ProgramIssue[] = [];
    const named = (actions: readonly Action[], path: string): Action[] => {
      const result = resolveNames(actions, chain, path);
      issues.push(...result.issues);

      return result.resolved;
    };
    candidates = named(candidates, "candidates") as SwapAction[];
    approvals = named(approvals, "approvals") as ApproveAction[];
    const [resolvedSweep] = named(sweepAction, "sweep") as { token: Token }[];
    if (sweep !== undefined) sweep = { ...sweep, token: resolvedSweep!.token };
    if (issues.length > 0) throw new ProgramError(issues, chain);
  }
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
  // With no chain the program compiles raw (`compose.ts#compiled`), where the Pot is the
  // compiler's `ctx.self()`; for a chain, the SDK's program compile reads `pot`.
  const emit = newEmitter(chain === undefined ? COMPILER_POT_NAMES : POT_NAMES);
  const bindings = new Set<BindingName>();
  const router = new Set<RouterFunction>();
  const use = (result: ActionResult): ActionResult => {
    for (const b of result.bindings) bindings.add(b);
    for (const f of result.router) router.add(f);
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
      const built = use(lowerAction(emit, candidates[i]!, "amount", true, `candidates[${i}]`));

      return [...built.stmts, `return ${built.output};`];
    }),
  ]);

  const main = mainFn(emit, N, n, bucket, { ...swap, sweep }, approvals, use);
  const source =
    routerImport([...router].sort()) + [...quoteFns, quoteAny, swapAny, main].join("\n\n") + "\n";

  return compiled(source, contractsFor(bindings), [], chain);
}

/** The split's chain, an EVM one the SDK knows. */
function splitChain(ref: ChainRef): CanonicalChain {
  const chain = resolveChain(ref);
  if (chain === undefined || chain.kind !== "evm") {
    throw new Error(`a split swap runs on an EVM chain the SDK knows; got ${String(ref)}`);
  }

  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatchers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns an otherwise-silent fall-through (any out-of-range idx would land on branch N-1) into an
 * explicit revert, so callers can't accidentally route an invalid index to the last candidate.
 */
function outOfRangeGuard(N: number): Stmt[] {
  return [`if (idx >= ${N}) { revert(); }`];
}

/** `if (idx == 0) return …; … return <last>;` — every path returns. */
function returnDispatch(N: number, branch: (i: number) => Stmt): Stmt[] {
  const early = Array.from({ length: N - 1 }, (_, i) => `if (idx == ${i}) { ${branch(i)} }`);

  return [...early, branch(N - 1)];
}

/** `if (idx == 0) { … } else if … else { <last> }` — exactly one branch runs. */
function blockDispatch(N: number, branch: (i: number) => readonly Stmt[]): Stmt[] {
  if (N === 1) return [...branch(0)];

  const lines: Stmt[] = [];
  for (let i = 0; i < N - 1; i++) {
    lines.push(`${i === 0 ? "" : "} else "}if (idx == ${i}) {`);
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
  const key = (base: number, idx: Expr): Expr => (base === 0 ? idx : `${base} + ${idx}`);
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

  // Init loop: used[i] = 0, total[i] = 0, marg[i] = quote_any(i, bucket). The zeroing is what makes
  // the counters this cook's own: the Pot's transient storage outlives the cook, so a split cooked
  // earlier in the same transaction left its used/total behind, and inheriting them swapped more
  // than `amount` and swept the excess to this cook's recipient.
  body.push(
    `for (let i = 0; i < ${N}; i = i + 1) {`,
    `  evm.tstore(${key(0, "i")}, 0);`,
    `  evm.tstore(${key(N, "i")}, 0);`,
    `  evm.tstore(${key(2 * N, "i")}, quote_any(i, ${bucketExpr}));`,
    "}",
  );

  // Greedy loop.
  body.push(
    "let bestMarg = 0;",
    "let bestIdx = 0;",
    `for (let iter = 0; iter < ${n}; iter = iter + 1) {`,
    "  bestMarg = 0;",
    "  bestIdx = 0;",
    `  for (let j = 0; j < ${N}; j = j + 1) {`,
    `    if (${marg("j")} > bestMarg) {`,
    `      bestMarg = ${marg("j")};`,
    "      bestIdx = j;",
    "    }",
    "  }",
    // Allocate only when some venue actually pays. With every marginal at zero the argmax leaves
    // bestIdx at 0, so the old code walked used[0] up to n and sent the WHOLE trade to candidate 0.
    "  if (bestMarg > 0) {",
    `    evm.tstore(${key(0, "bestIdx")}, ${used("bestIdx")} + 1);`,
    `    evm.tstore(${key(N, "bestIdx")}, ${total("bestIdx")} + ${marg("bestIdx")});`,
    // The next marginal, CLAMPED. `-` is checked on both engines (compiler/README.md's ledger: the
    // EVM's Math.huff checks add/sub/mul natively), so a quote that comes back below the running
    // total does not wrap — it REVERTS, killing the whole route. Quotes are not guaranteed monotone
    // across sizes: fee tiers are discontinuous, curves are not concave, and an oracle-backed
    // quoter can move between two calls in the same transaction.
    `    let nextQuote = quote_any(bestIdx, (${used("bestIdx")} + 1) * ${bucketExpr});`,
    `    let running = ${total("bestIdx")};`,
    `    evm.tstore(${key(2 * N, "bestIdx")}, nextQuote > running ? nextQuote - running : 0);`,
    "  }",
    "}",
  );

  // Execute loop: dispatch the swap for every candidate with used > 0, summing what each returns.
  // The slices spent are capped at `n`: a cook nested inside a leg's external call shares these
  // keys and could raise used[k] between the passes; the cap reverts instead of overspending.
  body.push(
    "let totalOut = 0;",
    "let slices = 0;",
    `for (let k = 0; k < ${N}; k = k + 1) {`,
    `  const share = ${used("k")};`,
    "  if (share > 0) {",
    "    slices = slices + share;",
    `    totalOut = totalOut + swap_any(k, share * ${bucketExpr});`,
    "  }",
    "}",
    `require(slices <= ${n});`,
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
