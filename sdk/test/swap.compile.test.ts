/**
 * E4.1 universal swap adapter — real-compile tests. Uses the ordinary compiler,
 * no forge/fork/anvil. Same import + baseDirs pattern as `svm-settle.compile.test.ts`.
 */
import { compileProgram as compile } from "./helpers";
import { bytesToHex } from "viem";

import { buildSauceEvmCall } from "../src/routes/sauce-calls.js";
import { requireChain } from "../src/chains/canonical.js";
import { assembleIntent } from "../src/routes/intent.js";
import { normalizeRoute } from "../src/routes/normalize.js";
import { v12PotAbi } from "../src/evm/engine.js";
import { decodeFunctionData } from "viem";
import { SWAP_BASE_DIRS, swapSource } from "../src/swap/source.js";
import { SwapPoolType, type SwapSpec } from "../src/swap/types.js";

const POOL = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_IN = "0x2222222222222222222222222222222222222222" as const;
const TOKEN_OUT = "0x3333333333333333333333333333333333333333" as const;
const POT = "0x4444444444444444444444444444444444444444" as const;

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

/** Every dispatchable poolType needs its own minimal-but-valid spec (poolKey where required). */
function specFor(poolType: SwapPoolType): SwapSpec {
  if (poolType === SwapPoolType.UniV4) {
    return spec({
      poolType,
      poolKey: {
        currency0: TOKEN_IN,
        currency1: TOKEN_OUT,
        fee: 3000n,
        tickSpacing: 60n,
        hooks: "0x0000000000000000000000000000000000000000",
      },
    });
  }
  if (poolType === SwapPoolType.UniV2) {
    return spec({ poolType, poolKey: { fee: 3000n } });
  }
  return spec({ poolType });
}

describe("swap adapter compiles for every dispatchable poolType", () => {
  for (const poolType of Object.values(SwapPoolType) as SwapPoolType[]) {
    it(`poolType ${poolType}`, () => {
      const { bytecode } = compile(swapSource(specFor(poolType)), { baseDirs: [...SWAP_BASE_DIRS] });
      expect(bytecode[0]!.length).toBeGreaterThan(0);
    });
  }
});

describe("a realistic 2-leg balance-chained program (UniV3 positive -> UniV4 negative-from-balance)", () => {
  const src = swapSource([
    spec({ poolType: SwapPoolType.UniV3, amountIn: 1_000n }),
    spec({
      poolType: SwapPoolType.UniV4,
      tokenIn: TOKEN_OUT,
      tokenOut: TOKEN_IN,
      amountIn: "balance",
      poolKey: {
        currency0: TOKEN_IN,
        currency1: TOKEN_OUT,
        fee: 3000n,
        tickSpacing: 60n,
        hooks: "0x0000000000000000000000000000000000000000",
      },
    }),
  ]);

  it("compiles", () => {
    const { bytecode } = compile(src, { baseDirs: [...SWAP_BASE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});

describe("the sign is actually in the bytes", () => {
  it("the UniV4 leg's blob contains the 32-byte two's-complement word; the UniV3 leg's contains the minimal positive push", () => {
    const univ3 = compile(swapSource(specFor(SwapPoolType.UniV3)), { baseDirs: [...SWAP_BASE_DIRS] })
      .bytecode[0]!;
    const univ4 = compile(swapSource(specFor(SwapPoolType.UniV4)), { baseDirs: [...SWAP_BASE_DIRS] })
      .bytecode[0]!;

    // 1000n minimal-width push: 0x03e8 (2 bytes) should be present in the UniV3 blob.
    expect(indexOfBytes(univ3, new Uint8Array([0x03, 0xe8]))).toBeGreaterThanOrEqual(0);

    // UniV4's negated amount (2**256 - 1000) forces the full 32-byte word — its low two bytes are
    // the two's complement of 1000 (0xfc18), preceded by 30 bytes of 0xff.
    const negated = 2n ** 256n - 1_000n;
    const hex = negated.toString(16).padStart(64, "0");
    const wideBytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    expect(indexOfBytes(univ4, wideBytes)).toBeGreaterThanOrEqual(0);
  });
});

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe("the E3 seam, end to end", () => {
  it("compile -> bytesToHex -> buildSauceEvmCall -> survives RouteInput.calls through normalizeRoute unchanged", () => {
    const { bytecode } = compile(swapSource(specFor(SwapPoolType.UniV3)), { baseDirs: [...SWAP_BASE_DIRS] });
    const ingredient = bytesToHex(bytecode[0]!);
    const call = buildSauceEvmCall({ pot: POT, ingredients: [ingredient] });

    expect(call.target).toBe(("0x" + "00".repeat(12) + POT.slice(2)).toLowerCase());
    expect(call.value).toBe(0n);

    const decoded = decodeFunctionData({ abi: v12PotAbi, data: call.data as `0x${string}` });
    expect(decoded.functionName).toBe("cook");
    expect((decoded.args[0] as readonly string[])[0]).toBe(ingredient);

    const intent = assembleIntent(
      requireChain("base"),
      requireChain("solana"),
      {
        deadline: 2n,
        portal: POT,
        calls: [call],
        tokens: [{ token: TOKEN_IN, amount: 1n }],
      },
      { deadline: 1n, creator: POT, prover: POT },
    );

    const normalized = normalizeRoute(intent.route);
    expect(normalized.calls[0]!.data).toBe(call.data);
    expect(normalized.calls[0]!.value).toBe(0n);
  });
});
