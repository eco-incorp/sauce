import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { megasSwapToSauce } from '../src/megas-swap.js';
import type {
  AmbientSwapAction,
  ApproveAction,
  CurveSwapAction,
  SwapAction,
  UniswapV2SwapAction,
  UniswapV3ExactInputAction,
  UniswapV4ExactInputAction,
} from '../src/types.js';

// =============================================================================
// Fixtures (offline — no fork required)
// =============================================================================

const CHAIN_ID = 1;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;
const SWAP_ROUTER_V3 = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' as const;
const QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as const;
const CURVE_3POOL = '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7' as const;
const UNIV2_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as const;

const deadline = 9_999_999_999;

function uniV3(amount: string, fee: 100 | 500 = 500): UniswapV3ExactInputAction {
  return {
    type: 'uniswapV3ExactInput',
    chainId: CHAIN_ID,
    router: SWAP_ROUTER_V3,
    tokenIn: USDC,
    tokenOut: USDT,
    fee,
    amountIn: amount,
    amountOutMin: '1',
    recipient: USDC,
    deadline,
  };
}

function curve(amount: string): CurveSwapAction {
  return {
    type: 'curveSwap',
    chainId: CHAIN_ID,
    pool: CURVE_3POOL,
    tokenIn: USDC,
    tokenOut: USDT,
    i: 1,
    j: 2,
    amountIn: amount,
    amountOutMin: '1',
    recipient: USDC,
  };
}

function uniV2(amount: string): UniswapV2SwapAction {
  return {
    type: 'uniswapV2Swap',
    chainId: CHAIN_ID,
    router: UNIV2_ROUTER,
    path: [USDC, USDT],
    amountIn: amount,
    amountOutMin: '1',
    recipient: USDC,
    deadline,
  };
}

const QUOTER_OPTS = { quoterV3: QUOTER_V2 } as const;

function makeCandidates(amount: string, count: number): SwapAction[] {
  const all: SwapAction[] = [
    uniV3(amount, 100),
    uniV3(amount, 500),
    curve(amount),
    uniV2(amount),
  ];
  return all.slice(0, count);
}

// =============================================================================
// Tests
// =============================================================================

describe('megasSwapToSauce — bytecode shape', () => {
  it('returns N+3 programs (per-candidate quotes + quote_any + swap_any + main)', () => {
    for (const N of [1, 2, 3, 4]) {
      const amountIn = 1_000_000n * BigInt(N);
      const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), N), amountIn, N, QUOTER_OPTS);
      assert.equal(
        programs.length,
        N + 3,
        `expected N+3=${N + 3} programs for N=${N}, got ${programs.length}`,
      );
      // Every emitted program is non-empty bytecode.
      for (let i = 0; i < programs.length; i++) {
        assert.ok(programs[i].length > 0, `program[${i}] is empty for N=${N}`);
      }
    }
  });

  it('shape pins under varying n (number of buckets) too', () => {
    const N = 3;
    for (const n of [1, 2, 5, 10]) {
      const amountIn = BigInt(n) * 1_000_000n;
      const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), N), amountIn, n, QUOTER_OPTS);
      assert.equal(programs.length, N + 3);
    }
  });
});

describe('megasSwapToSauce — degenerate / edge n', () => {
  it('n=1 (single bucket) compiles', () => {
    const amountIn = 1_000_000n;
    const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), 3), amountIn, 1, QUOTER_OPTS);
    assert.equal(programs.length, 6); // 3 quote_i + quote_any + swap_any + main
  });

  it('n=N (one bucket per candidate) compiles', () => {
    const N = 4;
    const n = N;
    const amountIn = BigInt(n) * 1_000_000n;
    const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), N), amountIn, n, QUOTER_OPTS);
    assert.equal(programs.length, N + 3);
  });

  it('n > N (more buckets than candidates) compiles', () => {
    const N = 2;
    const n = 8;
    const amountIn = BigInt(n) * 1_000_000n;
    const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), N), amountIn, n, QUOTER_OPTS);
    assert.equal(programs.length, N + 3);
  });
});

describe('megasSwapToSauce — input validation', () => {
  it('throws on n < 1', () => {
    assert.throws(
      () => megasSwapToSauce(makeCandidates('1000000', 2), 1_000_000n, 0, QUOTER_OPTS),
      /n >= 1/,
    );
  });

  it('throws on empty candidates', () => {
    assert.throws(
      () => megasSwapToSauce([], 1_000_000n, 4, QUOTER_OPTS),
      /at least one candidate/,
    );
  });

  it('throws when amountIn is not divisible by n (residual would sit on Sauce)', () => {
    const amountIn = 1_000_001n;
    assert.throws(
      () => megasSwapToSauce(makeCandidates(amountIn.toString(), 3), amountIn, 10, QUOTER_OPTS),
      /must be divisible by/,
    );
  });

  it('throws when amountIn < n (bucket = 0)', () => {
    // 5 / 10 = 0. amountIn % n == 5 — divisibility fires first, good.
    assert.throws(
      () => megasSwapToSauce(makeCandidates('5', 2), 5n, 10, QUOTER_OPTS),
      /must be divisible by/,
    );
    // 10 / 20 = 0 with remainder 10 — divisibility check still fires.
    assert.throws(
      () => megasSwapToSauce(makeCandidates('10', 2), 10n, 20, QUOTER_OPTS),
      /must be divisible by/,
    );
  });

  it('throws when a candidate has no toSauceDynamic (UniV4 amount embedded statically)', () => {
    const v4Candidate: UniswapV4ExactInputAction = {
      type: 'uniswapV4ExactInput',
      chainId: CHAIN_ID,
      router: SWAP_ROUTER_V3,
      poolKey: {
        currency0: USDC,
        currency1: USDT,
        fee: 500,
        tickSpacing: 10,
        hooks: '0x0000000000000000000000000000000000000000',
      },
      zeroForOne: true,
      amountIn: '1000000',
      amountOutMin: '1',
      recipient: USDC,
    };
    assert.throws(
      () =>
        megasSwapToSauce([uniV3('1000000'), v4Candidate], 2_000_000n, 2, {
          quoterV3: QUOTER_V2,
          quoterV4: QUOTER_V2,
        }),
      /does not support runtime-amount quoting/,
    );
  });

  it('throws on prepend approve missing amount field', () => {
    const approveNoAmount: ApproveAction = {
      type: 'approve',
      chainId: CHAIN_ID,
      token: USDC,
      spender: SWAP_ROUTER_V3,
    };
    assert.throws(
      () =>
        megasSwapToSauce(makeCandidates('1000000', 2), 1_000_000n, 1, {
          ...QUOTER_OPTS,
          prepend: [approveNoAmount],
        }),
      /no amount/,
    );
  });
});

describe('megasSwapToSauce — prepend handling', () => {
  it('prepend = [] (default) compiles', () => {
    const amountIn = 1_000_000n;
    const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), 2), amountIn, 1, QUOTER_OPTS);
    assert.equal(programs.length, 5); // 2 quotes + dispatchers + main
  });

  it('prepend = [] (explicit empty array) compiles', () => {
    const amountIn = 1_000_000n;
    const programs = megasSwapToSauce(makeCandidates(amountIn.toString(), 2), amountIn, 1, {
      ...QUOTER_OPTS,
      prepend: [],
    });
    assert.equal(programs.length, 5);
  });

  it('prepend with multiple approvals compiles, and main grows monotonically', () => {
    const amountIn = 1_000_000n;
    const candidates = makeCandidates(amountIn.toString(), 2);
    const baseline = megasSwapToSauce(candidates, amountIn, 1, QUOTER_OPTS);
    const baseMainLen = baseline[baseline.length - 1].length;

    const approves: ApproveAction[] = [
      { type: 'approve', chainId: CHAIN_ID, token: USDC, spender: SWAP_ROUTER_V3, amount: amountIn.toString() },
      { type: 'approve', chainId: CHAIN_ID, token: USDC, spender: CURVE_3POOL,    amount: amountIn.toString() },
    ];
    const withPrepend = megasSwapToSauce(candidates, amountIn, 1, { ...QUOTER_OPTS, prepend: approves });
    const prependMainLen = withPrepend[withPrepend.length - 1].length;

    assert.equal(withPrepend.length, baseline.length, 'prepend does not change program count');
    assert.ok(
      prependMainLen > baseMainLen,
      `prepend should add bytes to main (was ${baseMainLen}, now ${prependMainLen})`,
    );
  });
});
