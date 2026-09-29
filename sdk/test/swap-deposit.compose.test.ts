/**
 * E4.1/E4.2 composition seam — real-compile tests, mirroring `swap.compile.test.ts`'s "the E3
 * seam, end to end" case, extended one leg further (swap -> deposit).
 */
import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import { bytesToHex, decodeFunctionData } from "viem";

import { buildSauceEvmCall } from "../src/routes/sauce-calls.js";
import { requireChain } from "../src/chains/canonical.js";
import { assembleIntent } from "../src/routes/intent.js";
import { normalizeRoute } from "../src/routes/normalize.js";
import { v12PotAbi } from "../src/evm/engine.js";
import { swapThenDepositSource } from "../src/deposit/source.js";
import { swapSource } from "../src/swap/source.js";
import { SwapPoolType, type SwapSpec } from "../src/swap/types.js";
import type { DepositSpec } from "../src/deposit/types.js";

const POOL = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_IN = "0x2222222222222222222222222222222222222222" as const;
const TOKEN_OUT = "0x3333333333333333333333333333333333333333" as const;
const AAVE_POOL = "0x4444444444444444444444444444444444444444" as const;
const POT = "0x5555555555555555555555555555555555555555" as const;

const univ3Leg: SwapSpec = {
  poolType: SwapPoolType.UniV3,
  pool: POOL,
  tokenIn: TOKEN_IN,
  tokenOut: TOKEN_OUT,
  amountIn: 1_000n,
};

function aaveSupply(overrides: Partial<DepositSpec & { amount: "balance" | "delta" }> = {}) {
  return {
    protocol: "aave-v3",
    action: "supply",
    target: AAVE_POOL,
    token: TOKEN_OUT,
    amount: "balance" as const,
    ...overrides,
  };
}

describe("swapThenDepositSource — swap output feeds a deposit, one program", () => {
  it(`compiles (amount: 'balance')`, () => {
    const src = swapThenDepositSource(univ3Leg, aaveSupply());
    const { bytecode } = compile(src, { baseDirs: [...SDK_SOURCE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("'delta' variant compiles and its source contains the pre/post/delta bracket", () => {
    const src = swapThenDepositSource(univ3Leg, aaveSupply({ amount: "delta" }));
    expect(src).toMatch(/const deposit0Pre = IERC20\.at\(.*\)\.balanceOf\(ctx\.self\(\)\);/);
    expect(src).toMatch(/const deposit0Post = IERC20\.at\(.*\)\.balanceOf\(ctx\.self\(\)\);/);
    expect(src).toMatch(/const deposit0Amt = deposit0Post - deposit0Pre;/);

    const { bytecode } = compile(src, { baseDirs: [...SDK_SOURCE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("WETH unwrap snapshots the WETH increase across the swap", () => {
    const source = swapThenDepositSource(univ3Leg, {
      protocol: "weth",
      action: "unwrap",
      target: TOKEN_OUT,
      amount: "delta",
    });
    const balance = `IERC20.at(${BigInt(TOKEN_OUT)}n).balanceOf(ctx.self())`;
    expect(source).toContain('import { IERC20 } from "./artifacts/IERC20.json";');
    expect(source).toContain(`const deposit0Pre = ${balance};`);
    expect(source).toContain(`const deposit0Post = ${balance};`);
    expect(source).toContain("const deposit0Amt = deposit0Post - deposit0Pre;");
    expect(source).toContain("dUnwrap0.concat(abi.encode(deposit0Amt))");
    expect(source).not.toContain("ctx.selfBalance()");
    expect(source.indexOf("deposit0Pre")).toBeLessThan(source.indexOf(".swap("));
    expect(source.indexOf("deposit0Post")).toBeGreaterThan(source.indexOf(".swap("));

    const { bytecode } = compile(source, { baseDirs: [...SDK_SOURCE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("native-funded wrapping still measures the ETH delta", () => {
    const source = swapThenDepositSource(univ3Leg, {
      protocol: "weth",
      action: "wrap",
      target: TOKEN_OUT,
      amount: "delta",
    });
    expect(source).toContain("const deposit0Pre = ctx.selfBalance();");
    expect(source).toContain("const deposit0Post = ctx.selfBalance();");
    expect(source).not.toContain(".balanceOf(");

    const { bytecode } = compile(source, { baseDirs: [...SDK_SOURCE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("unions the IERC20 import line exactly once even though both sides need it", () => {
    const src = swapThenDepositSource(univ3Leg, aaveSupply());
    const ierc20Count = (
      src.match(/import \{ IERC20 \} from "\.\/artifacts\/IERC20\.json";/g) ?? []
    ).length;
    expect(ierc20Count).toBe(1);
    expect(src).toContain('import { ISauceRouter } from "./artifacts/ISauceRouter.json";');
  });

  it("the E3 seam, end to end: compile -> bytesToHex -> buildSauceEvmCall -> normalizeRoute", () => {
    const src = swapThenDepositSource(univ3Leg, aaveSupply());
    const { bytecode } = compile(src, { baseDirs: [...SDK_SOURCE_DIRS] });
    const ingredient = bytesToHex(bytecode[0]!);
    const call = buildSauceEvmCall({
      pot: POT,
      engine: "0x6666666666666666666666666666666666666666",
      program: ingredient,
    });

    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: v12PotAbi, data: call.data as `0x${string}` });
    expect(decoded.functionName).toBe("cook");

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

describe("negative control — swapSource alone is unaffected by the swapImportLines extraction", () => {
  it("still compiles fine (regression pin for the swapImportLines extraction)", () => {
    const { bytecode } = compile(swapSource(univ3Leg), { baseDirs: [...SDK_SOURCE_DIRS] });
    expect(bytecode[0]!.length).toBeGreaterThan(0);
  });
});
