import { Saucer, CompilerContext } from '../../compiler/dist/index.js';
import { buildAction } from './to-sauce.js';
import { actionToQuote, type QuoteOpts } from './to-quote.js';
import type {
  ApproveAction,
  BalancerV2SwapAction,
  CurveSwapAction,
  SwapAction,
  UniswapV2SwapAction,
  UniswapV3ExactInputAction,
} from './types.js';

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
}

/**
 * Emit Sauce bytecode that performs a greedy split-routing across `candidates`.
 *
 * Programs returned (in `cook(bytes[])` order):
 *   [0..N-1]  quote_i(amount: uint256) -> uint256
 *             One per candidate; invokes the protocol quoter with a runtime amount.
 *   [N]       quote_any(idx: uint256, amount: uint256) -> uint256
 *             Compile-time if/else dispatch to the matching quote_i.
 *   [N+1]     swap_any(idx: uint256, amount: uint256) -> void
 *             Same dispatch pattern, but for executing the swap.
 *   [N+2]     main
 *
 * Main algorithm (all three passes are real on-chain `for` loops — the
 * per-candidate state lives in transient storage keyed by `i`):
 *   1. Init:    for i in 0..N-1 { marg[i] = quote_any(i, bucket); }
 *               used[i] and total[i] default to 0 (TLOAD of untouched keys).
 *   2. Greedy:  for iter in 0..n-1 {
 *                 for i in 0..N-1 argmax → (best_marg, best_idx);
 *                 used[best_idx]  += 1;
 *                 total[best_idx] += marg[best_idx];          // cached, no call
 *                 marg[best_idx]   = quote_any(best_idx, (used[best_idx]+1)*bucket)
 *                                    - total[best_idx];
 *               }
 *   3. Execute: for i in 0..N-1 if (used[i] > 0) swap_any(i, used[i]*bucket);
 *
 * Bytecode size is O(N): the `_any` dispatchers are emitted once and every
 * main-level pass is a fixed-size loop that calls through them.
 *
 * Requirements:
 * - n >= 1. n=1 reduces to "pick the single best pool at full size".
 * - Every candidate's quote must expose `toSauceDynamic` (fixed amount offset).
 * - Swap builders must accept a runtime amountIn expression; UniswapV4 does
 *   not and will embed a stale compile-time amount.
 */
export function megasSwapToSauce(
  candidates: SwapAction[],
  amountIn: bigint,
  n: number,
  opts: MegasSwapOpts = {},
): Uint8Array[] {
  if (candidates.length === 0) {
    throw new Error('megasSwapToSauce requires at least one candidate');
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

  // ── One function per candidate: quote_i(amount) -> uint256 ──────────────
  const quoteFuncBytecodes = dynQuotes.map((dyn) => {
    const fctx = new CompilerContext();
    fctx.setVar('amount', 'scalar'); // slot 0 — caller writes the param here
    const fs = new Saucer(fctx);
    return dyn(fs, fs.read('amount')).build();
  });

  // ── quote_any(idx, amount): nested if/else dispatcher ───────────────────
  const quoteAnyBc = buildDispatcher(
    N,
    (i, innerS) => innerS.callFunction(`quote_${i}`, [innerS.read('amount')]),
    { withQuoteFuncs: true },
  );

  // ── swap_any(idx, amount): dispatcher that runs the winning swap ────────
  const swapAnyBc = buildDispatcher(
    N,
    (i, innerS) => buildAction(innerS, candidates[i], innerS.read('amount'), false).call,
    { withQuoteFuncs: false },
  );

  // ── Main ───────────────────────────────────────────────────────────────
  const ctx = new CompilerContext();
  for (let i = 0; i < N; i++) ctx.addFunc(`quote_${i}`);
  ctx.addFunc('quote_any');
  ctx.addFunc('swap_any');
  const s = new Saucer(ctx);

  // Transient-storage key layout (compile-time offsets; indexed at runtime):
  //   used[i]  at key i
  //   total[i] at key N + i
  //   marg[i]  at key 2N + i
  const USED_BASE = 0n;
  const TOTAL_BASE = BigInt(N);
  const MARG_BASE = BigInt(2 * N);
  const usedKey = (idxExpr: Saucer) => s.add(s.int(USED_BASE), idxExpr);
  const totalKey = (idxExpr: Saucer) => s.add(s.int(TOTAL_BASE), idxExpr);
  const margKey = (idxExpr: Saucer) => s.add(s.int(MARG_BASE), idxExpr);
  const bucketExpr = () => s.int(bucket);

  let chain: Saucer = s;

  // Prepend: inline user-provided approvals so the whole split-swap runs in
  // a single `cook` call. Each approval uses its own `amount` field — no
  // chaining, no runtime slots.
  for (const action of opts.prepend ?? []) {
    if (action.amount === undefined) {
      throw new Error(
        `prepend approve action for token ${action.token} has no amount; megasSwapToSauce requires an explicit amount on every prepend approval`,
      );
    }
    const { call } = buildAction(s, action, s.int(BigInt(action.amount)), false);
    chain = chain.join(call);
  }

  // Init loop: marg[i] = quote_any(i, bucket).
  chain = chain.join(
    s.for(
      s.store('__i', s.int(0n)),
      s.lt(s.read('__i'), s.int(BigInt(N))),
      s.store('__i', s.add(s.read('__i'), s.int(1n))),
    ).loop(
      s.tstore(
        margKey(s.read('__i')),
        s.callFunction('quote_any', [s.read('__i'), bucketExpr()]),
      ),
    ),
  );

  // Greedy outer loop.
  chain = chain.join(
    s.for(
      s.store('__iter', s.int(0n)),
      s.lt(s.read('__iter'), s.int(BigInt(n))),
      s.store('__iter', s.add(s.read('__iter'), s.int(1n))),
    ).loop(buildIterBody(s, N, bucket, margKey, totalKey, usedKey, bucketExpr)),
  );

  // Execute loop: dispatch the swap for every candidate with used > 0.
  chain = chain.join(
    s.for(
      s.store('__i', s.int(0n)),
      s.lt(s.read('__i'), s.int(BigInt(N))),
      s.store('__i', s.add(s.read('__i'), s.int(1n))),
    ).loop(
      s.if(s.gt(s.tload(usedKey(s.read('__i'))), s.int(0n))).then(
        s.callFunction('swap_any', [
          s.read('__i'),
          s.mul(s.tload(usedKey(s.read('__i'))), bucketExpr()),
        ]),
      ),
    ),
  );

  return [...quoteFuncBytecodes, quoteAnyBc, swapAnyBc, chain.build()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a dispatcher function body of the form
 *   if (idx >= N) revert
 *   if (idx == 0) branch(0)
 *   else if (idx == 1) branch(1)
 *   ...
 *   else branch(N-1)
 * with `idx` at slot 0 and `amount` at slot 1.
 *
 * The leading `idx >= N` guard turns an otherwise-silent fall-through (any
 * out-of-range idx would land on branch(N-1)) into an explicit revert, so
 * callers can't accidentally route an invalid index to the last candidate.
 */
function buildDispatcher(
  N: number,
  branch: (i: number, s: Saucer) => Saucer,
  opts: { withQuoteFuncs: boolean },
): Uint8Array {
  const fctx = new CompilerContext();
  fctx.setVar('idx', 'scalar'); // slot 0
  fctx.setVar('amount', 'scalar'); // slot 1
  if (opts.withQuoteFuncs) {
    for (let i = 0; i < N; i++) fctx.addFunc(`quote_${i}`);
  }
  const fs = new Saucer(fctx);

  let body: Saucer = branch(N - 1, fs);
  for (let i = N - 2; i >= 0; i--) {
    body = fs
      .if(fs.eq(fs.read('idx'), fs.int(BigInt(i))))
      .then(branch(i, fs))
      .else(body);
  }
  // Out-of-range guard: revert with empty data. Without this, idx >= N would
  // silently dispatch to branch(N-1).
  const guard = fs
    .if(fs.gte(fs.read('idx'), fs.int(BigInt(N))))
    .then(fs.revert(fs.bytes(new Uint8Array(0))));
  return guard.join(body).build();
}

/** Body of the n-iteration greedy loop. */
function buildIterBody(
  s: Saucer,
  N: number,
  _bucket: bigint,
  margKey: (e: Saucer) => Saucer,
  totalKey: (e: Saucer) => Saucer,
  usedKey: (e: Saucer) => Saucer,
  bucketExpr: () => Saucer,
): Saucer {
  // Reset best tracker.
  let body: Saucer = s
    .store('__best_marg', s.int(0n))
    .join(s.store('__best_idx', s.int(0n)));

  // Argmax loop over marg[].
  body = body.join(
    s.for(
      s.store('__i', s.int(0n)),
      s.lt(s.read('__i'), s.int(BigInt(N))),
      s.store('__i', s.add(s.read('__i'), s.int(1n))),
    ).loop(
      s.if(s.gt(s.tload(margKey(s.read('__i'))), s.read('__best_marg'))).then(
        s.store('__best_marg', s.tload(margKey(s.read('__i'))))
          .join(s.store('__best_idx', s.read('__i'))),
      ),
    ),
  );

  // Commit winning bucket.
  const bestIdx = () => s.read('__best_idx');
  body = body
    // used[best]++
    .join(s.tstore(usedKey(bestIdx()), s.add(s.tload(usedKey(bestIdx())), s.int(1n))))
    // total[best] += marg[best]  (cached; avoids a quoter call)
    .join(s.tstore(totalKey(bestIdx()), s.add(s.tload(totalKey(bestIdx())), s.tload(margKey(bestIdx())))))
    // marg[best] = quote_any(best, (used[best]+1)*bucket) - total[best]
    .join(
      s.tstore(
        margKey(bestIdx()),
        s.sub(
          s.callFunction('quote_any', [
            bestIdx(),
            s.mul(s.add(s.tload(usedKey(bestIdx())), s.int(1n)), bucketExpr()),
          ]),
          s.tload(totalKey(bestIdx())),
        ),
      ),
    );

  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-configured helper: USDC → USDT on Ethereum mainnet
// ─────────────────────────────────────────────────────────────────────────────

type Addr = `0x${string}`;

const ETH_MAINNET_USDC_USDT = {
  chainId: 1,
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Addr,
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Addr,
  uniV3Router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as Addr,
  uniV3QuoterV2: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as Addr,
  curve3pool: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' as Addr,
  uniV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Addr,
  balV2Vault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8' as Addr,
  balV2_3poolId: '0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063' as Addr,
} as const;

/**
 * Pre-configured greedy split router for USDC → USDT on Ethereum mainnet.
 *
 * Candidates (all pre-populated, caller never picks addresses or pool IDs):
 *   - UniswapV3 at 1 bps (pool 0x38…)
 *   - UniswapV3 at 5 bps (pool 0x7858…)
 *   - Curve stableswap 3pool (DAI/USDC/USDT, indices 1→2)
 *   - Uniswap V2 router via [USDC, USDT] pair
 *   - Balancer V2 Vault against the legacy DAI/USDC/USDT stable pool
 *
 * The returned bytecode is self-contained and can be fed straight into
 * `Sauce.cook(bytes[])`: it approves all 4 spenders for `amountIn`, runs the
 * split-swap loop for `n` buckets, and sends the USDT output to `recipient`.
 *
 * Candidates whose pools are empty (drained BalV2 3pool, thin UniV3 5 bps,
 * shallow UniV2 pair) are still included — the greedy algorithm handles
 * them by never routing buckets that direction. That costs `N + n` extra
 * quoter CALLs worth of gas; drop them manually if you want to save.
 */
export function megasUsdcUsdtSwapToSauce(
  amountIn: bigint,
  n: number,
  recipient: Addr,
): Uint8Array[] {
  const C = ETH_MAINNET_USDC_USDT;
  const amountStr = amountIn.toString();
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const mkUniV3 = (fee: 100 | 500): UniswapV3ExactInputAction => ({
    type: 'uniswapV3ExactInput',
    chainId: C.chainId,
    router: C.uniV3Router,
    tokenIn: C.usdc,
    tokenOut: C.usdt,
    fee,
    amountIn: amountStr,
    amountOutMin: '1',
    recipient,
    deadline,
  });
  const curveCandidate: CurveSwapAction = {
    type: 'curveSwap',
    chainId: C.chainId,
    pool: C.curve3pool,
    tokenIn: C.usdc,
    tokenOut: C.usdt,
    i: 1, // USDC
    j: 2, // USDT
    amountIn: amountStr,
    amountOutMin: '1',
    recipient,
  };
  const uniV2Candidate: UniswapV2SwapAction = {
    type: 'uniswapV2Swap',
    chainId: C.chainId,
    router: C.uniV2Router,
    path: [C.usdc, C.usdt],
    amountIn: amountStr,
    amountOutMin: '1',
    recipient,
    deadline,
  };
  const balV2Candidate: BalancerV2SwapAction = {
    type: 'balancerV2Swap',
    chainId: C.chainId,
    vault: C.balV2Vault,
    poolId: C.balV2_3poolId,
    tokenIn: C.usdc,
    tokenOut: C.usdt,
    amountIn: amountStr,
    amountOutMin: '1',
    recipient,
    deadline,
  };

  const candidates: SwapAction[] = [
    mkUniV3(100),
    mkUniV3(500),
    curveCandidate,
    uniV2Candidate,
    balV2Candidate,
  ];

  const approves: ApproveAction[] = [
    { type: 'approve', chainId: C.chainId, token: C.usdc, spender: C.uniV3Router, amount: amountStr },
    { type: 'approve', chainId: C.chainId, token: C.usdc, spender: C.curve3pool,  amount: amountStr },
    { type: 'approve', chainId: C.chainId, token: C.usdc, spender: C.uniV2Router, amount: amountStr },
    { type: 'approve', chainId: C.chainId, token: C.usdc, spender: C.balV2Vault,  amount: amountStr },
  ];

  return megasSwapToSauce(candidates, amountIn, n, {
    quoterV3: C.uniV3QuoterV2,
    prepend: approves,
  });
}
