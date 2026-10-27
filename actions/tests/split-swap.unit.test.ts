/**
 * The split swap's program shape and input checks (`split-swap.ts`). Offline;
 * `split-swap.test.ts` executes it against captured mainnet state.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compileSplitSwap, ProgramError, type SplitSwap } from "../src/index.js";
import type { ApproveAction, SwapAction, UniswapV3SwapAction } from "../src/types.js";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
/** Uniswap V3's USDC/USDT pools at 0.01% and 0.05%. */
const V3_POOLS = {
  100: "0x3416cF6C708Da44DB2624D63ea0AAef7113527C6",
  500: "0x7858E59e0C01EA06Df3aF3D20aC7B0003275D4Bf",
} as const;
/** The Sauce Router, which quotes the V3 legs. Any address: nothing here executes. */
const ROUTER = "0x5000000000000000000000000000000000000005";
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
/** A periphery router a non-library candidate pulls through, so it needs an approval first. */
const CURVE_ROUTER_NG = "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D";
/** Uniswap V2's USDC/USDT pair. */
const UNIV2_USDC_USDT = "0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f";

const uniV3 = (fee: 100 | 500): UniswapV3SwapAction => ({
  type: "uniswapV3Swap",
  pool: V3_POOLS[fee],
  tokenIn: USDC,
  tokenOut: USDT,
  amountOutMin: "1",
  recipient: "pot",
});
const CANDIDATES: SwapAction[] = [
  uniV3(100),
  uniV3(500),
  {
    type: "curveSwap",
    pool: CURVE_3POOL,
    tokenIn: USDC,
    tokenOut: USDT,
    i: 1,
    j: 2,
    indexType: "int128",
    amountOutMin: "1",
    recipient: "pot",
  },
  {
    type: "uniswapV2Swap",
    pool: UNIV2_USDC_USDT,
    tokenIn: USDC,
    tokenOut: USDT,
    amountOutMin: "1",
    recipient: "pot",
  },
];

/** A split of 1 USDC per bucket over the first `count` candidates; the floor waived. */
function swap(count: number, buckets: number, extra: Partial<SplitSwap> = {}): SplitSwap {
  return {
    candidates: CANDIDATES.slice(0, count),
    amount: (1_000_000n * BigInt(buckets)).toString(),
    buckets,
    amountOutMin: "0",
    quoters: { router: ROUTER },
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
        text.match(new RegExp(`if \\(idx >= ${N}\\) \\{ revert\\(\\); \\}`, "g"))?.length,
        2,
      );
      assert.ok(compiled.bytecode.length > 0);
      assert.deepEqual(compiled.parameters, []);
    }
  });

  it("the bucket count bounds the greedy loop and nothing else", () => {
    for (const n of [1, 2, 5, 10]) {
      const text = source(swap(3, n));
      assert.match(text, new RegExp(`for \\(let iter = 0; iter < ${n};`));
      assert.match(text, /for \(let i = 0; i < 3;/);
    }
  });

  it("writes every counter before reading it: the Pot's transient storage outlives the cook", () => {
    // A split cooked earlier in the same transaction leaves its used/total/marg behind; the init
    // loop must overwrite all three (split-swap.mainnet.test.ts runs two cooks in one transaction).
    for (const N of [1, 3]) {
      const text = source(swap(N, 2));
      const init = text.indexOf(`for (let i = 0; i < ${N}; i = i + 1) {`);
      assert.ok(init >= 0 && init < text.indexOf("evm.tload("), "the init loop comes first");
      const loop = text.slice(init, text.indexOf("}", init));
      assert.match(loop, /evm\.tstore\(i, 0\);/);
      assert.match(loop, new RegExp(`evm\\.tstore\\(${N} \\+ i, 0\\);`));
      assert.match(loop, new RegExp(`evm\\.tstore\\(${2 * N} \\+ i, quote_any\\(i, `));
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
    assert.equal(swapAny.match(/if \(idx == \d+\) \{/g)?.length, 3);
    // An else tail: a bare if chain would run the last branch for every idx.
    assert.match(swapAny, /\} else \{/);
  });

  it("every leg delivers to the Pot, whatever its recipient says", () => {
    const text = source(swap(1, 1, { candidates: [{ ...uniV3(100), recipient: USDT }] }));
    assert.match(text, /uniswapV3\([^;]*, ctx\.self\(\)\);/);
    assert.doesNotMatch(text, /0xdac17f958d2ee523a2206206994597c13d831ec7\);/);
  });
});

describe("split swap — the aggregate floor", () => {
  it("is checked once, after every leg, over the realized sum", () => {
    const text = source(swap(2, 4, { amountOutMin: "12345" }));
    assert.match(text, /let totalOut = 0;/);
    assert.match(text, /totalOut = totalOut \+ swap_any\(/);
    assert.equal(text.match(/if \(totalOut < 12345\) \{ revert\(\); \}/g)?.length, 1);
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
    assert.match(text, /nextQuote > running \? nextQuote - running : 0/);
    // Without this, zero marginals leave bestIdx at 0 and send the whole trade to candidate 0.
    assert.match(text, /if \(bestMarg > 0\) \{/);
  });
});

describe("split swap — approvals and the sweep", () => {
  const approve = (spender: `0x${string}`): ApproveAction => ({
    type: "approve",
    amount: "2000000",
    token: USDC,
    spender,
  });

  it("runs each approval first, through the SDK's SafeERC20 lowering", () => {
    const approvals = [approve(CURVE_ROUTER_NG), approve(CURVE_3POOL)];
    const text = source(swap(2, 2, { approvals }));
    // One allowance read per approval: the reset `forceApprove` makes when one is standing.
    assert.equal(text.match(/hex`dd62ed3e/g)?.length, 2);
    assert.ok(text.indexOf("dd62ed3e") < text.indexOf("for (let i = 0"));
  });

  it("sweeps the realized total, and without a sweep nothing leaves the Pot", () => {
    const swept = source(swap(2, 1, { sweep: { token: USDT, recipient: USDC } }));
    assert.match(swept, /totalOut\.toBytesBe\(32\)/);
    assert.match(swept, /evm\.call\(0xdac17f958d2ee523a2206206994597c13d831ec7, 0, /);
    assert.doesNotMatch(source(swap(2, 1)), /a9059cbb/);
  });

  it('takes "pot" as the sweep\'s recipient, and refuses "self" at sweep.recipient, naming "pot"', () => {
    assert.match(source(swap(2, 1, { sweep: { token: USDT, recipient: "pot" } })), /ctx\.self\(\)/);
    assert.throws(
      () =>
        compileSplitSwap(
          swap(2, 1, {
            sweep: { token: USDT, recipient: "self" } as unknown as SplitSwap["sweep"],
          }),
        ),
      (error: unknown) =>
        error instanceof ProgramError &&
        error.issues.some(
          (issue) =>
            issue.path === "sweep.recipient" &&
            issue.message === 'the Pot is "pot", not "self": write "pot"',
        ),
    );
  });

  it("refuses a retired sweep recipient as document validation, whatever the chain", () => {
    // Whether the Pot is "pot" or "self" does not depend on a deployment, so no chain is named in the
    // error, and an unsupported chain is not what the caller is told about first.
    for (const chain of [undefined, "ethereum", "solana"] as const) {
      const run = () =>
        compileSplitSwap(
          swap(2, 1, {
            sweep: { token: USDT, recipient: "self" } as unknown as SplitSwap["sweep"],
            ...(chain === undefined ? {} : { chain }),
          }),
        );
      assert.throws(
        run,
        (error: unknown) =>
          error instanceof ProgramError &&
          error.chain === undefined &&
          error.issues.length === 1 &&
          error.issues[0]!.path === "sweep.recipient" &&
          error.issues[0]!.message === 'the Pot is "pot", not "self": write "pot"' &&
          error.message.startsWith("invalid action program (1 issue):") &&
          !/does not compile for/.test(error.message),
        `chain ${String(chain)}`,
      );
    }
  });

  it("rejects an approval without an amount", () => {
    const { amount: _, ...bare } = approve(CURVE_ROUTER_NG);
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
          swap(1, 1, { candidates: [{ ...uniV3(100), pool: "nope" } as unknown as SwapAction] }),
        ),
      (error: unknown) =>
        error instanceof ProgramError && error.issues[0]!.path === "candidates[0].pool",
    );
  });

  it("rejects a venue with no runtime-amount quote on-chain", () => {
    // The Vault prices a Balancer swap only by performing it, so no quote runs inside a program.
    const balancer: SwapAction = {
      type: "balancerV2Swap",
      vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
      poolId: "0x06df3b2bbb68adc8b0e302443692037ed9f91b42000000000000000000000063",
      tokenIn: USDC,
      tokenOut: USDT,
      amountOutMin: "1",
      recipient: "pot",
    };
    const balancerV3: SwapAction = {
      type: "balancerV3Swap",
      router: "0xAE563E3f8219521950555F5962419C8919758Ea2",
      pool: "0x84f2195dc84d540a3ab92e659603d770014f0440",
      tokenIn: USDC,
      tokenOut: USDT,
      amountOutMin: "1",
      deadline: 9_999_999_999,
      wethIsEth: false,
    };
    for (const candidate of [balancer, balancerV3]) {
      assert.throws(
        () =>
          compileSplitSwap(
            swap(1, 2, {
              candidates: [uniV3(100), candidate],
            }),
          ),
        /candidates\[1\] \(\w+\) has no on-chain quote with a runtime amount/,
      );
    }
  });
});
