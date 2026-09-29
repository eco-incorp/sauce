/**
 * E4.1 universal swap adapter — CONTRACT tests. Pure data assertions, no compiler/forge/network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { swapThenDepositSource } from "../src/deposit/source.js";
import { getProtocol } from "../src/protocols/index.js";
import {
  amountSpecifiedFor,
  isCallbackFree,
  isCallbackVenue,
  POOL_KEY_FIELDS,
  ROUTER_GENERATION_FOR_VENUE,
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
    expect(() => amountSpecifiedFor(SwapPoolType.UniV3, -1n)).toThrow(/exact-input amount/);
  });
});

/** `amountSpecified` as the Router reads it: an `int256`. */
const asInt256 = (word: bigint): bigint => (word >= 2n ** 255n ? word - 2n ** 256n : word);

describe("exact input only — no path emits an exact-output amountSpecified", () => {
  // The generation-3 Router caps a V3-family or Maverick callback at the exact input and refuses an
  // owed V4/Infinity output lane; an exact-output swap names no input maximum, so it is unbounded
  // and may be refused. Uniswap V3 reads a POSITIVE amountSpecified as exact input, V4 a NEGATIVE
  // one, and every other handler takes abs().
  const AMOUNTS = [0n, 1n, 1_000n, 2n ** 128n, 2n ** 255n - 1n];

  it("every pool type, every amount up to 2^255 - 1: the sign is the exact-input one", () => {
    for (const poolType of ALL_DISPATCHABLE) {
      for (const amountIn of AMOUNTS) {
        const read = asInt256(
          toSwapParams(spec({ poolType, amountIn, poolKey: {} })).amountSpecified,
        );
        if (poolType === SwapPoolType.UniV4)
          expect([poolType, read]).toEqual([poolType, -amountIn]);
        else expect([poolType, read]).toEqual([poolType, amountIn]);
      }
    }
  });

  it("refuses an amount that would wrap into the exact-output sign of the int256", () => {
    for (const poolType of ALL_DISPATCHABLE) {
      for (const amountIn of [2n ** 255n, 2n ** 256n - 1n]) {
        expect(() => amountSpecifiedFor(poolType, amountIn)).toThrow(/exact OUTPUT/);
        expect(() => toSwapParams(spec({ poolType, amountIn, poolKey: {} }))).toThrow(
          /exact OUTPUT/,
        );
      }
    }
  });

  it("a 'balance' amount stays exact input: the V3 path reads the balance, V4 negates it", () => {
    const v3 = swapCallStatement({ ...spec(), amountIn: "balance" });
    expect(v3).toMatch(/amountSpecified: IERC20\.at\([^)]*\)\.balanceOf\(ctx\.self\(\)\),/);
    const v4 = swapCallStatement({
      ...spec({ poolType: SwapPoolType.UniV4, poolKey: {} }),
      amountIn: "balance",
    });
    // Unary `-` (NEG), never `0n - x`: subtraction is checked unsigned and reverts for any x > 0.
    expect(v4).toMatch(/amountSpecified: -\(IERC20\.at\([^)]*\)\.balanceOf\(ctx\.self\(\)\)\),/);
    for (const poolType of ALL_DISPATCHABLE) {
      const statement = swapCallStatement({
        ...spec({ poolType, poolKey: {} }),
        amountIn: "balance",
      });
      expect(statement).not.toContain("0n - ");
      if (poolType !== SwapPoolType.UniV4) expect(statement).not.toContain("-(");
    }
  });

  it("a spec has no output-amount field to ask for exact output with", () => {
    const params = toSwapParams(spec({ amountOut: 5n, exactOutput: true } as Partial<SwapSpec>));
    expect(Object.keys(params)).toEqual(SWAP_PARAMS_FIELDS);
    expect(params.amountSpecified).toBe(1_000n);
  });
});

describe("V3 forks that call back under their own name need a generation-3 Router", () => {
  const synthra = (overrides: Partial<SwapSpec> = {}): SwapSpec =>
    spec({ venue: "synthra-v3", ...overrides });

  it("names each venue's first answering generation, and each is a registered protocol", () => {
    expect(ROUTER_GENERATION_FOR_VENUE).toEqual({ "synthra-v3": 3, "unitflow-v3": 3 });
    for (const slug of Object.keys(ROUTER_GENERATION_FOR_VENUE)) {
      expect(getProtocol(slug)).toBeDefined();
    }
  });

  it("refuses without a routerGeneration, naming the callback and the generation", () => {
    expect(() => toSwapParams(synthra())).toThrow(
      /synthra-v3 pool calls back synthraV3SwapCallback, which only a generation-3 Router answers; pass `routerGeneration`/,
    );
    expect(() => toSwapParams(spec({ venue: "unitflow-v3" }))).toThrow(/unitFlowV3SwapCallback/);
  });

  it("refuses a Pot on an older Router", () => {
    for (const routerGeneration of [1, 2]) {
      expect(() => toSwapParams(synthra(), { routerGeneration })).toThrow(
        new RegExp(`the Pot's Router is generation ${routerGeneration}`),
      );
    }
  });

  it("builds a plain UniV3 swap on a generation-3 Router — the venue adds nothing to the call", () => {
    for (const venue of ["synthra-v3", "unitflow-v3"] as const) {
      expect(toSwapParams(spec({ venue }), { routerGeneration: 3 })).toEqual(toSwapParams(spec()));
      expect(swapSource(spec({ venue }), { routerGeneration: 3 })).toBe(swapSource(spec()));
    }
  });

  it("is only a UniV3 pool", () => {
    expect(() =>
      toSwapParams(synthra({ poolType: SwapPoolType.UniV4, poolKey: {} }), { routerGeneration: 3 }),
    ).toThrow(/dispatches as poolType UniV3/);
  });

  it("carries the Router generation through every builder", () => {
    expect(() => swapSource(synthra())).toThrow(/routerGeneration/);
    expect(() => swapCallStatement(synthra(), { routerGeneration: 2 })).toThrow(/generation 2/);
    const deposit = {
      protocol: "aave-v3",
      action: "supply",
      target: OTHER,
      token: TOKEN_OUT,
      amount: "delta",
    } as const;
    expect(() => swapThenDepositSource(synthra(), deposit)).toThrow(/routerGeneration/);
    expect(swapThenDepositSource(synthra(), deposit, { routerGeneration: 3 })).toBe(
      swapThenDepositSource(spec(), deposit),
    );
  });

  it("leaves every other UniV3 pool alone, whatever the Router", () => {
    expect(() => toSwapParams(spec())).not.toThrow();
    expect(() => toSwapParams(spec(), { routerGeneration: 1 })).not.toThrow();
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
    expect(() =>
      toSwapParams(spec({ poolType: UndispatchablePoolType.PancakeInfinityCL as never })),
    ).toThrow(/not dispatchable/);
    expect(() =>
      toSwapParams(spec({ poolType: UndispatchablePoolType.PancakeInfinityBin as never })),
    ).toThrow(/not dispatchable/);
  });

  it("an out-of-range poolType throws", () => {
    expect(() => toSwapParams(spec({ poolType: 99 as never }))).toThrow(/unknown poolType/);
  });

  it("a non-empty callback on a non-callback-driven pool type throws (mirrors Router.sol:279)", () => {
    expect(() => toSwapParams(spec({ poolType: SwapPoolType.UniV2, callback: "0xaa" }))).toThrow(
      /callback-driven/,
    );
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
    expect(() => toSwapParams(spec({ poolType: SwapPoolType.UniV4 }))).toThrow(
      /poolKey is required/,
    );
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

  it("amountIn at Number.MAX_SAFE_INTEGER is accepted exactly", () => {
    expect(toSwapParams(spec({ amountIn: Number.MAX_SAFE_INTEGER })).amountSpecified).toBe(
      9007199254740991n,
    );
  });

  it("an unsafe integer amountIn throws under its label instead of silently rounding", () => {
    expect(() => toSwapParams(spec({ amountIn: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(
      /amountIn: expected a safe integer, got 9007199254740992/,
    );
    expect(() => toSwapParams(spec({ amountIn: 1e18 }))).toThrow(
      /amountIn: expected a safe integer, got 1000000000000000000/,
    );
  });

  it("an unsafe integer poolKey.fee throws under its own label", () => {
    expect(() =>
      toSwapParams(spec({ poolType: SwapPoolType.UniV4, poolKey: { fee: 1e18 } })),
    ).toThrow(/poolKey\.fee: expected a safe integer, got 1000000000000000000/);
  });

  it("a non-integer amountIn still throws the plain integer message", () => {
    expect(() => toSwapParams(spec({ amountIn: 1.5 }))).toThrow(
      /amountIn: expected an integer, got 1\.5/,
    );
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

  it("a 'balance' amountIn on UniV4 negates the balance read with unary minus (two's-complement NEG)", () => {
    const src = swapSource(
      spec({ poolType: SwapPoolType.UniV4, poolKey: { fee: 3000n }, amountIn: "balance" as const }),
    );
    expect(src).toContain(
      `amountSpecified: -(IERC20.at(${BigInt(TOKEN_IN)}n).balanceOf(ctx.self())),`,
    );
  });

  it("no 'balance' leg does NOT import IERC20", () => {
    const src = swapSource(spec());
    expect(src).not.toContain("IERC20");
  });
});
