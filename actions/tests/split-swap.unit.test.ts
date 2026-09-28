/**
 * The split swap's program shape and input checks (`split-swap.ts`). Offline;
 * `split-swap.test.ts` executes it against captured mainnet state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compileSplitSwap, ProgramError, type SplitSwap } from "../src/index.js";
import type { ApproveAction, SwapAction, UniswapV3ExactInputAction } from "../src/types.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const SWAP_ROUTER_V3 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
const UNIV2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

const uniV3 = (fee: 100 | 500): UniswapV3ExactInputAction => ({
  type: "uniswapV3ExactInput",
  router: SWAP_ROUTER_V3,
  tokenIn: USDC,
  tokenOut: USDT,
  fee,
  amountOutMin: "1",
  recipient: "self",
});
const CANDIDATES: SwapAction[] = [
  uniV3(100),
  uniV3(500),
  {
    type: "curveSwap",
    pool: CURVE_3POOL,
    tokenOut: USDT,
    i: 1,
    j: 2,
    amountOutMin: "1",
    recipient: "self",
  },
  {
    type: "uniswapV2Swap",
    router: UNIV2_ROUTER,
    path: [USDC, USDT],
    amountOutMin: "1",
    recipient: "self",
    deadline: 9_999_999_999,
  },
];

/** A split of 1 USDC per bucket over the first `count` candidates; the floor waived. */
function swap(count: number, buckets: number, extra: Partial<SplitSwap> = {}): SplitSwap {
  return {
    candidates: CANDIDATES.slice(0, count),
    amount: (1_000_000n * BigInt(buckets)).toString(),
    buckets,
    amountOutMin: "0",
    quoters: { uniswapV3Quoter: QUOTER_V2 },
    ...extra,
  };
}

const source = (split: SplitSwap): string => compileSplitSwap(split).source;

describe("split swap — program shape", () => {
  it("declares quote_0..quote_N-1, both dispatchers and main, and compiles to one program", () => {
    for (const N of [1, 2, 3, 4]) {
      const compiled = compileSplitSwap(swap(N, N));
      const text = compiled.source;
      for (let i = 0; i < N; i++) {
        assert.match(text, new RegExp(`function quote_${i}\\(amount: Uint256\\): Uint256`));
      }
      assert.doesNotMatch(text, new RegExp(`function quote_${N}\\(`));
      assert.match(text, /function quote_any\(idx: Uint256, amount: Uint256\): Uint256/);
      // swap_any RETURNS the realized output, so main can sum the legs for the aggregate floor.
      assert.match(text, /function swap_any\(idx: Uint256, amount: Uint256\): Uint256/);
      assert.match(text, /function main\(\): void/);
      // Both dispatchers guard idx, so an invalid one reverts instead of landing on the last leg.
      assert.equal(
        text.match(new RegExp(`if \\(idx >= ${N}n\\) \\{ revert\\(\\); \\}`, "g"))?.length,
        2,
      );
      assert.ok(compiled.bytecode.length > 0);
      assert.deepEqual(compiled.parameters, []);
    }
  });

  it("the bucket count bounds the greedy loop and nothing else", () => {
    for (const n of [1, 2, 5, 10]) {
      const text = source(swap(3, n));
      assert.match(text, new RegExp(`for \\(let iter = 0n; iter < ${n}n;`));
      assert.match(text, /for \(let i = 0n; i < 3n;/);
    }
  });

  it("every candidate is reachable from both dispatchers", () => {
    const text = source(swap(4, 4));
    const quoteAny = text.slice(
      text.indexOf("function quote_any"),
      text.indexOf("function swap_any"),
    );
    for (let i = 0; i < 4; i++)
      assert.match(quoteAny, new RegExp(`return quote_${i}\\(amount\\);`));
    const swapAny = text.slice(text.indexOf("function swap_any"), text.indexOf("function main"));
    assert.equal(swapAny.match(/if \(idx == \d+n\) \{/g)?.length, 3);
    // An else tail: a bare if chain would run the last branch for every idx.
    assert.match(swapAny, /\} else \{/);
  });

  it("every leg delivers to the Pot, whatever its recipient says", () => {
    const text = source(swap(1, 1, { candidates: [{ ...uniV3(100), recipient: USDT }] }));
    assert.match(text, /recipient: ctx\.self\(\)/);
    assert.doesNotMatch(text, /recipient: 0xdac17f/);
  });
});

describe("split swap — the aggregate floor", () => {
  it("is checked once, after every leg, over the realized sum", () => {
    const text = source(swap(2, 4, { amountOutMin: "12345" }));
    assert.match(text, /let totalOut = 0n;/);
    assert.match(text, /totalOut = totalOut \+ swap_any\(/);
    assert.equal(text.match(/if \(totalOut < 12345n\) \{ revert\(\); \}/g)?.length, 1);
  });

  it('is waived only by "0", which still sums the legs', () => {
    const text = source(swap(2, 4));
    assert.doesNotMatch(text, /if \(totalOut < /);
    assert.match(text, /totalOut = totalOut \+ swap_any\(/);
  });

  for (const bad of ["", "-1", "1.5", "abc", " 1", "1_000"]) {
    it(`rejects the floor ${JSON.stringify(bad)}`, () => {
      assert.throws(
        () => compileSplitSwap(swap(2, 4, { amountOutMin: bad })),
        /amountOutMin must be a base-10 unsigned integer string/,
      );
    });
  }

  it("clamps the next marginal instead of underflowing, and allocates nothing at zero", () => {
    const text = source(swap(2, 4));
    // `-` is checked, so a non-monotone quote would revert the route instead of wrapping.
    assert.match(text, /nextQuote > running \? nextQuote - running : 0n/);
    // Without this, zero marginals leave bestIdx at 0 and send the whole trade to candidate 0.
    assert.match(text, /if \(bestMarg > 0n\) \{/);
  });
});

describe("split swap — approvals and the sweep", () => {
  const approve = (spender: `0x${string}`): ApproveAction => ({
    type: "approve",
    amount: "2000000",
    token: USDC,
    spender,
  });

  it("runs each approval first, decoding nothing", () => {
    const approvals = [approve(SWAP_ROUTER_V3), approve(CURVE_3POOL)];
    const text = source(swap(2, 2, { approvals }));
    assert.equal(text.match(/hex`095ea7b3/g)?.length, 2);
    assert.ok(text.indexOf("095ea7b3") < text.indexOf("for (let i = 0n"));
  });

  it("sweeps the realized total, and without a sweep nothing leaves the Pot", () => {
    const swept = source(swap(2, 1, { sweep: { token: USDT, recipient: USDC } }));
    assert.match(swept, /totalOut\.toBytesBe\(32\)/);
    assert.match(swept, /evm\.call\(0xdac17f958d2ee523a2206206994597c13d831ec7n, 0n, /);
    assert.doesNotMatch(source(swap(2, 1)), /a9059cbb/);
  });

  it("rejects an approval without an amount", () => {
    const { amount: _, ...bare } = approve(SWAP_ROUTER_V3);
    assert.throws(
      () => compileSplitSwap(swap(2, 1, { approvals: [bare] })),
      /approvals\[0\]: expected an `approve` action with an explicit `amount`/,
    );
  });
});

describe("split swap — input checks", () => {
  it("rejects zero buckets and no candidates", () => {
    assert.throws(() => compileSplitSwap(swap(2, 1, { buckets: 0 })), /buckets must be a positive/);
    assert.throws(() => compileSplitSwap(swap(0, 1)), /at least one candidate/);
  });

  it("rejects an amount the buckets do not divide, which would stay in the Pot", () => {
    assert.throws(
      () => compileSplitSwap(swap(3, 10, { amount: "1000001" })),
      /must be divisible by buckets/,
    );
    assert.throws(() => compileSplitSwap(swap(2, 20, { amount: "10" })), /must be divisible/);
  });

  it("rejects a candidate that carries its own amount", () => {
    assert.throws(
      () => compileSplitSwap(swap(1, 1, { candidates: [{ ...uniV3(100), amount: "5" }] })),
      /candidates\[0\]\.amount: a split-swap candidate's amount is decided by the split/,
    );
  });

  it("rejects a malformed candidate with located issues", () => {
    assert.throws(
      () =>
        compileSplitSwap(
          swap(1, 1, { candidates: [{ ...uniV3(100), router: "nope" } as unknown as SwapAction] }),
        ),
      (error: unknown) =>
        error instanceof ProgramError && error.issues[0]!.path === "candidates[0].router",
    );
  });

  it("rejects a venue with no runtime-amount quote on-chain", () => {
    const v4: SwapAction = {
      type: "uniswapV4ExactInput",
      router: SWAP_ROUTER_V3,
      poolKey: {
        currency0: USDC,
        currency1: USDT,
        fee: 500,
        tickSpacing: 10,
        hooks: "0x0000000000000000000000000000000000000000",
      },
      zeroForOne: true,
      amountOutMin: "1",
      recipient: "self",
    };
    const balancer: SwapAction = {
      type: "balancerV2Swap",
      vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      poolId: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063",
      tokenIn: USDC,
      tokenOut: USDT,
      amountOutMin: "1",
      recipient: "self",
      deadline: 1,
    };
    for (const candidate of [v4, balancer]) {
      assert.throws(
        () =>
          compileSplitSwap(
            swap(1, 2, {
              candidates: [uniV3(100), candidate],
              quoters: { uniswapV3Quoter: QUOTER_V2, uniswapV4Quoter: QUOTER_V2 },
            }),
          ),
        /candidates\[1\] \(\w+\) has no on-chain quote with a runtime amount/,
      );
    }
  });
});
