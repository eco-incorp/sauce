/**
 * Greedy split routing across several pools, as ONE SauceScript program.
 *
 * BREAKING, AND UNAVOIDABLE: this used to return `N + 3` separate bytecodes — one per candidate
 * quote, plus two dispatchers, plus `main` — because the retired TypeScript compiler had no module
 * linker: cross-program calls went through the v1 engine's function table, with a hand-managed slot
 * convention (`ctx.setVar('amount', 'scalar')` = slot 0, and the CALLER wrote the argument there).
 * The Rust compiler has ordinary functions and one output, so `quote_i` / `quote_any` / `swap_any`
 * are declared functions in a single module and the whole thing compiles to one program.
 *
 * The return type stays `Uint8Array[]` so the call site does not change: it is still exactly what
 * `Sauce.cook(bytes[])` takes, now a one-element list (a cook executes `ingredients[0]`).
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
import { contractsFor, type ActionContracts, type BindingName } from "./abis.js";
import { compileEvm } from "./compile.js";
import { buildAction, type ActionResult } from "./to-sauce.js";
import { actionToQuote, type QuoteOpts } from "./to-quote.js";
import type {
  ApproveAction,
  CurveSwapAction,
  SwapAction,
  UniswapV2SwapAction,
  UniswapV3ExactInputAction,
} from "./types.js";

export interface MegasSwapOpts extends QuoteOpts {
  /**
   * Approvals to emit in main *before* the split-swap logic. Each approval
   * runs at its own `amount` (no chaining, no runtime slot references).
   *
   * Restricted to `ApproveAction[]` so adding a new RoutingAction type with a
   * differently-named amount field can't silently break the prepend path.
   * If you need richer setup actions, run them in a separate `cook` segment.
   */
  prepend?: ApproveAction[];
  /**
   * Aggregate minimum output, enforced ONCE after every leg has executed.
   *
   * Required, because per-leg `amountOutMin` cannot express it and never could: `swap_any` receives
   * the runtime expression `amount`, so a leg's share is `used[k] * bucket` — a fraction of
   * `amountIn` decided during the greedy loop — while `amountOutMin` is baked in as a compile-time
   * literal. A floor sized for the whole trade would be applied to a fraction and revert the leg;
   * the only per-leg value that composes with runtime allocation is dust, which is why every
   * candidate here ships `"1"`. So the bound has to live at the end, over the sum.
   *
   * Pass `"0"` to waive it deliberately. There is no default: a silent default would be the same
   * unbounded trade this exists to prevent.
   */
  minTotalOut: string;
  /**
   * Token and recipient for the final sweep, emitted after the aggregate floor.
   *
   * Every leg is built with `needsOutput`, which makes the swap deliver to Sauce so its realized
   * amount is measurable as a balance delta — so a candidate's own `recipient` never receives
   * anything and the whole output accumulates on Sauce. Omit this to leave it there deliberately.
   */
  sweep?: { token: Addr; to: Addr };
}

/**
 * Emit the SauceScript for a greedy split-routing across `candidates`.
 *
 * Declared functions:
 *   quote_i(amount)        One per candidate; invokes the protocol quoter with a runtime amount.
 *   quote_any(idx, amount) if/else dispatch to the matching quote_i.
 *   swap_any(idx, amount)  Same dispatch, but executing the swap.
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
 * SIZE, CHANGED: the retired compiler kept every main-level pass a fixed-size loop, so the program
 * was O(N). The Rust compiler's constant folder UNROLLS a loop whose bound it knows, and `N`/`n`
 * are compile-time constants here, so the emitted main is O(N + n·N) instructions. Behaviour is
 * identical; only the byte count grows. Reach for a runtime bound if that ever matters.
 *
 * Requirements:
 * - n >= 1. n=1 reduces to "pick the single best pool at full size".
 * - Every candidate's quote must expose `toSauceDynamic` (fixed amount offset).
 * - Swap builders must accept a runtime amountIn expression; UniswapV4 does
 *   not and will embed a stale compile-time amount.
 */
export function megasSwapToSauceSource(
  candidates: SwapAction[],
  amountIn: bigint,
  n: number,
  opts: MegasSwapOpts,
): string {
  return megasSwapProgram(candidates, amountIn, n, opts).source;
}

/**
 * The split-swap program's source together with the ABI bindings its swaps and approvals call
 * through — what `megasSwapToSauce` compiles. The quotes stay raw calls (see `to-quote.ts`).
 */
export function megasSwapProgram(
  candidates: SwapAction[],
  amountIn: bigint,
  n: number,
  opts: MegasSwapOpts,
): { readonly source: string; readonly contracts: ActionContracts } {
  if (candidates.length === 0) {
    throw new Error("megasSwapToSauce requires at least one candidate");
  }
  if (n < 1) {
    throw new Error(`megasSwapToSauce requires n >= 1, got ${n}`);
  }

  if (amountIn % BigInt(n) !== 0n) {
    throw new Error(
      `amountIn (${amountIn}) must be divisible by n (${n}) — a non-zero remainder would leave residual on Sauce under the standing approvals emitted by prepend`,
    );
  }
  const bucket = amountIn / BigInt(n);
  if (bucket === 0n) {
    throw new Error(`amountIn (${amountIn}) must be >= n (${n}) so each bucket is non-zero`);
  }

  const N = candidates.length;
  const emit = newEmitter();
  const bindings = new Set<BindingName>();
  const use = (result: ActionResult): ActionResult => {
    for (const b of result.bindings) bindings.add(b);
    return result;
  };

  // Resolve dynamic-quote builders; fail early on unsupported protocols.
  const dynQuotes = candidates.map((cand, i) => {
    const q = actionToQuote(cand, bucket, opts);
    if (!q.toSauceDynamic) {
      throw new Error(
        `candidate[${i}] (${cand.type}) does not support runtime-amount quoting required for split routing`,
      );
    }
    return q.toSauceDynamic;
  });

  const quoteFns = dynQuotes.map((dyn, i) => {
    const quote = dyn(emit, "amount");

    return fn(`quote_${i}`, ["amount: Uint256"], "Uint256", [
      ...quote.stmts,
      `return ${quote.expr};`,
    ]);
  });

  const quoteAny = fn("quote_any", ["idx: Uint256", "amount: Uint256"], "Uint256", [
    ...outOfRangeGuard(N),
    ...returnDispatch(N, (i) => `return quote_${i}(amount);`),
  ]);

  // `needsOutput: true` — the whole point. Built void, its `.output` was discarded by
  // `blockDispatch` and the tstore arrays only ever held QUOTED amounts, so nothing downstream
  // could see what the trade actually returned.
  const swapAny = fn("swap_any", ["idx: Uint256", "amount: Uint256"], "Uint256", [
    ...outOfRangeGuard(N),
    ...blockDispatch(N, (i) => {
      const built = use(buildAction(emit, candidates[i], "amount", true));

      return [...built.stmts, `return ${built.output};`];
    }),
  ]);

  const main = mainFn(emit, N, n, bucket, opts, candidates[0].chainId, use);
  const source = [...quoteFns, quoteAny, swapAny, main].join("\n\n") + "\n";

  return { source, contracts: contractsFor(bindings) };
}

export function megasSwapToSauce(
  candidates: SwapAction[],
  amountIn: bigint,
  n: number,
  opts: MegasSwapOpts,
): Uint8Array[] {
  const { source, contracts } = megasSwapProgram(candidates, amountIn, n, opts);

  return [compileEvm(source, contracts).bytecode];
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
  opts: MegasSwapOpts,
  chainId: number,
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

  // Prepend: inline user-provided approvals so the whole split-swap runs in a single `cook` call.
  // Each approval uses its own `amount` field — no chaining, no runtime slots.
  for (const action of opts.prepend ?? []) {
    if (action.amount === undefined) {
      throw new Error(
        `prepend approve action for token ${action.token} has no amount; megasSwapToSauce requires an explicit amount on every prepend approval`,
      );
    }
    body.push(...use(buildAction(emit, action, formatBigint(BigInt(action.amount)), false)).stmts);
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

  // THE AGGREGATE BOUND, and the only one there is. Per-leg `amountOutMin` is a compile-time
  // literal applied to a runtime fraction of `amountIn`, so it cannot express this — see
  // `MegasSwapOpts.minTotalOut`. Checked after every leg, over the realized sum.
  //
  // Parsed strictly, because the whole design here is that the caller must CHOOSE a floor and "0"
  // is the choice that says none. `BigInt("")` and `BigInt("-1")` are both 0n-or-negative and would
  // land on the same branch as that explicit waiver — and `""` is what an unset env var, a missing
  // config key or a `?? ""` produces, so it waives silently without anyone deciding to. A value
  // that waives without being the waiver is exactly the hole a required parameter exists to close.
  if (!/^\d+$/.test(opts.minTotalOut)) {
    throw new Error(
      `megasSwapToSauce: minTotalOut must be a non-negative integer string, got ${JSON.stringify(
        opts.minTotalOut,
      )}. Pass "0" to waive the aggregate floor deliberately.`,
    );
  }
  const minTotalOut = BigInt(opts.minTotalOut);
  if (minTotalOut > 0n) {
    body.push(`if (totalOut < ${formatBigint(minTotalOut)}) { revert(); }`);
  }

  if (opts.sweep) {
    const { token, to } = opts.sweep;
    body.push(
      ...use(buildAction(emit, { type: "transfer", chainId, token, to }, "totalOut", false)).stmts,
    );
  }

  return fn("main", [], "void", body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-configured helper: USDC → USDT on Ethereum mainnet
// ─────────────────────────────────────────────────────────────────────────────

type Addr = `0x${string}`;

const ETH_MAINNET_USDC_USDT = {
  chainId: 1,
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Addr,
  usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Addr,
  uniV3Router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Addr,
  uniV3QuoterV2: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as Addr,
  curve3pool: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7" as Addr,
  uniV2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Addr,
} as const;

/**
 * Pre-configured greedy split router for USDC → USDT on Ethereum mainnet.
 *
 * Candidates (all pre-populated, caller never picks addresses or pool IDs):
 *   - UniswapV3 at 1 bps (pool 0x38…)
 *   - UniswapV3 at 5 bps (pool 0x7858…)
 *   - Curve stableswap 3pool (DAI/USDC/USDT, indices 1→2)
 *   - Uniswap V2 router via [USDC, USDT] pair
 *
 * The returned bytecode is self-contained and can be fed straight into
 * `Sauce.cook(bytes[])`: it approves all 3 spenders for `amountIn`, runs the
 * split-swap loop for `n` buckets, and sends the USDT output to `recipient`.
 *
 * Candidates whose pools are thin (UniV3 5 bps, shallow UniV2 pair) are still included — the
 * greedy algorithm handles them by never routing buckets that direction. That costs `N + n` extra
 * quoter CALLs worth of gas; drop them manually if you want to save.
 *
 * Balancer V2 is NOT a candidate: its only quote is `queryBatchSwap`, which mutates state and
 * reverts to return, so it cannot be called on-chain at all.
 */
export function megasUsdcUsdtSwapToSauce(
  amountIn: bigint,
  n: number,
  recipient: Addr,
  minTotalOut: string,
): Uint8Array[] {
  const C = ETH_MAINNET_USDC_USDT;
  const amountStr = amountIn.toString();
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const mkUniV3 = (fee: 100 | 500): UniswapV3ExactInputAction => ({
    type: "uniswapV3ExactInput",
    chainId: C.chainId,
    router: C.uniV3Router,
    tokenIn: C.usdc,
    tokenOut: C.usdt,
    fee,
    amountIn: amountStr,
    amountOutMin: "1",
    recipient,
    deadline,
  });
  const curveCandidate: CurveSwapAction = {
    type: "curveSwap",
    chainId: C.chainId,
    pool: C.curve3pool,
    tokenIn: C.usdc,
    tokenOut: C.usdt,
    i: 1, // USDC
    j: 2, // USDT
    amountIn: amountStr,
    amountOutMin: "1",
    recipient,
  };
  const uniV2Candidate: UniswapV2SwapAction = {
    type: "uniswapV2Swap",
    chainId: C.chainId,
    router: C.uniV2Router,
    path: [C.usdc, C.usdt],
    amountIn: amountStr,
    amountOutMin: "1",
    recipient,
    deadline,
  };

  const candidates: SwapAction[] = [mkUniV3(100), mkUniV3(500), curveCandidate, uniV2Candidate];

  const approves: ApproveAction[] = [
    {
      type: "approve",
      chainId: C.chainId,
      token: C.usdc,
      spender: C.uniV3Router,
      amount: amountStr,
    },
    {
      type: "approve",
      chainId: C.chainId,
      token: C.usdc,
      spender: C.curve3pool,
      amount: amountStr,
    },
    {
      type: "approve",
      chainId: C.chainId,
      token: C.usdc,
      spender: C.uniV2Router,
      amount: amountStr,
    },
  ];

  return megasSwapToSauce(candidates, amountIn, n, {
    quoterV3: C.uniV3QuoterV2,
    prepend: approves,
    minTotalOut,
    sweep: { token: C.usdt, to: recipient },
  });
}
