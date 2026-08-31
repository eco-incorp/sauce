/**
 * E4.1 universal swap adapter — CONTRACT tests. Pure data assertions, no compiler/forge/network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  amountSpecifiedFor,
  isCallbackFree,
  isCallbackVenue,
  POOL_KEY_FIELDS,
  SWAP_PARAMS_FIELDS,
  SwapPoolType,
  toSwapParams,
  UndispatchablePoolType,
  usesPoolKey,
  ZERO_POOL_KEY,
} from "../src/swap/index.js";
import { swapCallStatement, swapSource } from "../src/swap/source.js";
import type { SwapSpec } from "../src/swap/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const POOL = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_IN = "0x2222222222222222222222222222222222222222" as const;
const TOKEN_OUT = "0x3333333333333333333333333333333333333333" as const;
const OTHER = "0x4444444444444444444444444444444444444444" as const;
const HOOKS = "0x5555555555555555555555555555555555555555" as const;

function spec(overrides: Partial<SwapSpec> = {}): SwapSpec {
  return {
    poolType: SwapPoolType.UniV3,
    pool: POOL,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: 1_000n,
    ...overrides,
  };
}

const ALL_DISPATCHABLE = Object.values(SwapPoolType) as SwapPoolType[];

describe("amountSpecifiedFor — the sign matrix, exhaustive over 0..8", () => {
  it("every pool type except UniV4 returns the amount unchanged", () => {
    for (const poolType of ALL_DISPATCHABLE) {
      if (poolType === SwapPoolType.UniV4) continue;
      expect(amountSpecifiedFor(poolType, 1_000n)).toBe(1_000n);
    }
  });

  it("UniV3 is explicitly POSITIVE = exact input (Router.sol:431 passthrough to Uniswap V3 — fork-verified, contradicts the struct doc comment)", () => {
    expect(amountSpecifiedFor(SwapPoolType.UniV3, 1_000n)).toBe(1_000n);
  });

  it("UniV4 negates to the exact two's-complement uint256 word", () => {
    expect(amountSpecifiedFor(SwapPoolType.UniV4, 1_000n)).toBe(2n ** 256n - 1_000n);
  });

  it("UniV4 with amountIn 0n stays 0n (not 2**256)", () => {
    expect(amountSpecifiedFor(SwapPoolType.UniV4, 0n)).toBe(0n);
  });

  it("rejects a negative amountIn", () => {
    expect(() => amountSpecifiedFor(SwapPoolType.UniV3, -1n)).toThrow(/positive/);
  });
});

describe("ABI drift pin — SWAP_PARAMS_FIELDS / POOL_KEY_FIELDS against the vendored artifact", () => {
  const artifact = JSON.parse(
    readFileSync(join(HERE, "..", "src", "artifacts", "ISauceRouter.json"), "utf-8"),
  );
  const swapFn = artifact.abi.find((item: { type: string; name?: string }) => item.name === "swap");
  const paramsComponent = swapFn.inputs[0];
  const poolKeyComponent = paramsComponent.components.find(
    (c: { name: string }) => c.name === "poolKey",
  );

  it("top-level SwapParams field order matches SWAP_PARAMS_FIELDS", () => {
    const artifactOrder = paramsComponent.components.map((c: { name: string }) => c.name);
    expect(artifactOrder).toEqual(SWAP_PARAMS_FIELDS);
  });

  it("nested poolKey field order matches POOL_KEY_FIELDS", () => {
    const artifactOrder = poolKeyComponent.components.map((c: { name: string }) => c.name);
    expect(artifactOrder).toEqual(POOL_KEY_FIELDS);
  });

  it("toSwapParams's own key order matches SWAP_PARAMS_FIELDS", () => {
    const params = toSwapParams(spec({ poolType: SwapPoolType.UniV4, poolKey: { fee: 3000n } }));
    expect(Object.keys(params)).toEqual(SWAP_PARAMS_FIELDS);
  });
});

describe("toSwapParams — guards", () => {
  it("poolType 9/10 throws naming the Infinity follow-up", () => {
    expect(() => toSwapParams(spec({ poolType: UndispatchablePoolType.PancakeInfinityCL as never }))).toThrow(
      /not dispatchable/,
    );
    expect(() => toSwapParams(spec({ poolType: UndispatchablePoolType.PancakeInfinityBin as never }))).toThrow(
      /not dispatchable/,
    );
  });

  it("an out-of-range poolType throws", () => {
    expect(() => toSwapParams(spec({ poolType: 99 as never }))).toThrow(/unknown poolType/);
  });

  it("a non-empty callback on a non-callback-driven pool type throws (mirrors Router.sol:279)", () => {
    expect(() =>
      toSwapParams(spec({ poolType: SwapPoolType.UniV2, callback: "0xaa" })),
    ).toThrow(/callback-driven/);
  });

  it("a non-empty callback with an overridden payer or recipient throws", () => {
    expect(() =>
      toSwapParams(spec({ poolType: SwapPoolType.UniV3, callback: "0xaa", payer: OTHER })),
    ).toThrow(/ctx\.self\(\)/);
    expect(() =>
      toSwapParams(spec({ poolType: SwapPoolType.UniV3, callback: "0xaa", recipient: OTHER })),
    ).toThrow(/ctx\.self\(\)/);
  });

  it("a non-empty callback on a callback venue with default payer/recipient is accepted", () => {
    const params = toSwapParams(spec({ poolType: SwapPoolType.UniV3, callback: "0xaa" }));
    expect(params.callback).toBe("0xaa");
  });

  it("UniV4 without poolKey throws", () => {
    expect(() => toSwapParams(spec({ poolType: SwapPoolType.UniV4 }))).toThrow(/poolKey is required/);
  });

  it("UniV2 poolKey.fee >= 1_000_000 throws", () => {
    expect(() =>
      toSwapParams(spec({ poolType: SwapPoolType.UniV2, poolKey: { fee: 1_000_000n } })),
    ).toThrow(/must be < 1000000/);
  });

  it("UniV2 fee: 0 is accepted (documented as the engine's default 3000)", () => {
    const params = toSwapParams(spec({ poolType: SwapPoolType.UniV2, poolKey: { fee: 0n } }));
    expect(params.poolKey.fee).toBe(0n);
  });
});

describe("toSwapParams — defaults", () => {
  it("payer/recipient default to the 'self' sentinel", () => {
    const params = toSwapParams(spec());
    expect(params.payer).toBe("self");
    expect(params.recipient).toBe("self");
  });

  it("an explicit payer/recipient overrides the sentinel", () => {
    const params = toSwapParams(spec({ payer: OTHER, recipient: OTHER }));
    expect(params.payer).toBe(BigInt(OTHER));
    expect(params.recipient).toBe(BigInt(OTHER));
  });

  it("sqrtPriceLimitX96 defaults to 0n", () => {
    expect(toSwapParams(spec()).sqrtPriceLimitX96).toBe(0n);
  });

  it("a pool type that doesn't use poolKey ignores it entirely (ZERO_POOL_KEY)", () => {
    const params = toSwapParams(spec({ poolType: SwapPoolType.Curve, poolKey: { fee: 999n } }));
    expect(params.poolKey).toEqual(ZERO_POOL_KEY);
  });

  it("callback defaults to empty (0x)", () => {
    expect(toSwapParams(spec()).callback).toBe("0x");
  });
});

describe("predicates", () => {
  it("isCallbackVenue is exactly {UniV3, UniV4, MaverickV2}", () => {
    expect(isCallbackVenue(SwapPoolType.UniV3)).toBe(true);
    expect(isCallbackVenue(SwapPoolType.UniV4)).toBe(true);
    expect(isCallbackVenue(SwapPoolType.MaverickV2)).toBe(true);
    expect(isCallbackVenue(SwapPoolType.UniV2)).toBe(false);
  });

  it("isCallbackFree covers the six abs()-taking, callback-free venues, and does NOT include MaverickV2", () => {
    for (const t of [
      SwapPoolType.UniV2,
      SwapPoolType.Curve,
      SwapPoolType.BalancerV2,
      SwapPoolType.DODOV2,
      SwapPoolType.TraderJoeLB,
      SwapPoolType.WOOFi,
    ]) {
      expect(isCallbackFree(t)).toBe(true);
    }
    expect(isCallbackFree(SwapPoolType.MaverickV2)).toBe(false);
    expect(isCallbackFree(SwapPoolType.UniV3)).toBe(false);
    expect(isCallbackFree(SwapPoolType.UniV4)).toBe(false);
  });

  it("usesPoolKey is exactly {UniV4, UniV2}", () => {
    expect(usesPoolKey(SwapPoolType.UniV4)).toBe(true);
    expect(usesPoolKey(SwapPoolType.UniV2)).toBe(true);
    expect(usesPoolKey(SwapPoolType.UniV3)).toBe(false);
  });
});

describe("source shape", () => {
  it("swapCallStatement's output contains every field in ABI order, with ctx.self() as the default payer/recipient", () => {
    const out = swapCallStatement(spec());
    const order = SWAP_PARAMS_FIELDS.map((f) => out.indexOf(`${f}:`));
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]!);
    }
    expect(out).toContain("payer: ctx.self()");
    expect(out).toContain("recipient: ctx.self()");
    expect(out).not.toMatch(/payer: 0x/);
  });

  it("swapSource([a, b]) emits two swap( statements in order inside one main", () => {
    const src = swapSource([
      spec({ poolType: SwapPoolType.UniV3, amountIn: 1n }),
      spec({ poolType: SwapPoolType.UniV4, amountIn: 2n, poolKey: { fee: 3000n } }),
    ]);
    const matches = [...src.matchAll(/\.swap\(/g)];
    expect(matches).toHaveLength(2);
    expect(src.indexOf("function main")).toBeLessThan(src.indexOf(".swap("));
    // the UniV4 leg's amount is the two's-complement literal, the UniV3 leg's is the plain positive one
    expect(src).toContain("1n,");
    expect(src).toContain(`${2n ** 256n - 2n}n,`);
  });

  it("a 'balance' amountIn emits a runtime IERC20.balanceOf read and imports IERC20", () => {
    const src = swapSource(spec({ amountIn: "balance" as const }));
    expect(src).toContain('import { IERC20 } from "./artifacts/IERC20.json"');
    expect(src).toContain(`IERC20.at(${BigInt(TOKEN_IN)}n).balanceOf(ctx.self())`);
  });

  it("a 'balance' amountIn on UniV4 wraps the balance read in the two's-complement negation", () => {
    const src = swapSource(
      spec({ poolType: SwapPoolType.UniV4, poolKey: { fee: 3000n }, amountIn: "balance" as const }),
    );
    expect(src).toContain(`(0n - (IERC20.at(${BigInt(TOKEN_IN)}n).balanceOf(ctx.self())))`);
  });

  it("no 'balance' leg does NOT import IERC20", () => {
    const src = swapSource(spec());
    expect(src).not.toContain("IERC20");
  });
});
