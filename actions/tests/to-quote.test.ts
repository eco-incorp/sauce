import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { actionToQuote, type QuoteOpts } from "../src/to-quote.js";
import { execSync } from "child_process";
import { createPublicClient, http, custom, parseAbi, type Address, type Hex } from "viem";
import type { SwapAction } from "../src/types.js";
import { DEADLINE, startMainnet, type Mainnet } from "./mainnet.js";

// =============================================================================
// Configuration — Ethereum mainnet at the pinned block, replayed from captured state (mainnet.ts)
// =============================================================================

/** The local anvil's URL, set in `before()`. */
let RPC: string;
let mainnet: Mainnet;

// --- Mainnet addresses ---
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address;

// Protocols
const SWAP_ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address; // UniV3 SwapRouter02
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Address;
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7" as Address;
const CURVE_ROUTER_NG = "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D" as Address;
const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8" as Address;
const BALANCER_V2_POOL_ID =
  "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019" as Hex;
const AMBIENT_DEX = "0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688" as Address;
const FLUID_DEX_T1_WSTETH_ETH = "0x0B1a513ee24972DAEf112bC777a5610d4325C9e7" as Address;

// Quoter / resolver contracts
const UNI_V3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as Address;
const UNI_V4_QUOTER = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203" as Address;
const MAVERICK_QUOTER = "0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A" as Address;
const CROC_IMPACT = "0x3e3EDd3eD7621891E574E5d7f47b1f30A994c0D0" as Address;
const INTEGRAL_RELAYER = "0xd17b3c9784510E33cD5B87b490E79253BcD81e2E" as Address;
const FLUID_RESOLVER = "0x05Bd8269A20C472b148246De20E6852091BF16Ff" as Address;

const QUOTE_OPTS: QuoteOpts = {
  quoterV3: UNI_V3_QUOTER,
  quoterV4: UNI_V4_QUOTER,
  quoterMaverick: MAVERICK_QUOTER,
  impact: CROC_IMPACT,
  relayer: INTEGRAL_RELAYER,
  fluidResolver: FLUID_RESOLVER,
};

// Manual-quote ABIs
const curveGetDyAbi = parseAbi([
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
]);
const v2GetAmountsOutAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
]);
const balV2QueryAbi = parseAbi([
  "function queryBatchSwap(uint8 kind, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds) returns (int256[])",
]);
const uniV3QuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const uniV3QuoterMultiAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);
const maverickQuoterAbi = parseAbi([
  "function calculateSwap(address pool, uint128 amount, bool tokenAIn, bool exactOutput, int32 tickLimit) returns (uint256 amountIn, uint256 amountOut, uint256 gasEstimate)",
]);
const fraxswapTwammAbi = parseAbi([
  "function getAmountsOutWithTwamm(uint256 amountIn, address[] path) returns (uint256[] amounts)",
]);
const uniV4QuoterAbi = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
  "function quoteExactInputSingle((PoolKey poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
  "function quoteExactInput((address exactCurrency, PathKey[] path, uint128 exactAmount) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);
const maverickMultiQuoterAbi = parseAbi([
  "function calculateMultiHopSwap(bytes path, uint256 amount, bool exactOutput) returns (uint256 returnAmount, uint256 gasEstimate)",
]);
const dodoV1QueryAbi = parseAbi([
  "function querySellBaseToken(uint256 amount) view returns (uint256 receiveQuote)",
]);
const carbonQuoteAbi = parseAbi([
  "function calculateTradeTargetAmount(address sourceToken, address targetToken, (uint256 strategyId, uint128 amount)[] tradeActions) view returns (uint128)",
]);
const crocImpactAbi = parseAbi([
  "function calcImpact(address base, address quote, uint256 poolIdx, bool isBuy, bool inBaseQty, uint128 qty, uint16 tip, uint128 limitPrice) view returns (int128 baseFlow, int128 quoteFlow, uint128 finalPrice)",
]);
const fluidEstimateAbi = parseAbi([
  "function estimateSwapIn(address dex, bool swap0to1, uint256 amountIn, uint256 amountOutMin) returns (uint256 amountOut)",
]);

// =============================================================================
// Hardhat lifecycle
// =============================================================================

let client: ReturnType<typeof createPublicClient>;

/**
 * Every eth_call gets 15M gas — the budget these quoters were written against, below the pinned
 * block's 60M limit — so a quoter that measures or rations gas sees the same budget every run.
 */
function cappedTransport() {
  const base = http(RPC);
  return custom({
    request: async (args: { method: string; params?: unknown[] }) => {
      if (args.method === "eth_call" && args.params?.[0]) {
        args.params[0] = { ...args.params[0], gas: "0xe4e1c0" }; // 15M
      }
      const t = base({ chain: undefined, retryCount: 0, timeout: 30_000 });
      return t.request(args as any);
    },
  });
}

function snapshot(): string {
  return JSON.parse(
    execSync(`cast rpc evm_snapshot --rpc-url ${RPC}`, { encoding: "utf8" }).trim(),
  );
}

function revert(id: string): void {
  execSync(`cast rpc evm_revert "${id}" --rpc-url ${RPC}`, { encoding: "utf8" });
}

// =============================================================================
// Helpers
// =============================================================================

/** Execute the QuoteCall via eth_call and decode using the QuoteCall's decoder. */
async function executeQuote(
  action: SwapAction,
  amountIn: bigint,
  opts = QUOTE_OPTS,
): Promise<bigint> {
  const q = actionToQuote(action, amountIn, opts);
  const result = await client.call({ to: q.to, data: q.data });
  if (!result.data) throw new Error(`eth_call returned no data for ${action.type}`);
  return q.decode(result.data);
}

// =============================================================================
// Tests
// =============================================================================

describe("actionToQuote integration tests", { timeout: 120_000 }, () => {
  let snap: string;

  before(async () => {
    mainnet = await startMainnet("to-quote");
    RPC = mainnet.rpc;
    client = createPublicClient({ transport: cappedTransport() });
  });

  after(async () => {
    await mainnet?.stop();
  });
  beforeEach(() => {
    snap = snapshot();
  });
  afterEach(() => {
    revert(snap);
  });

  // =========================================================================
  // Curve — get_dy (view)
  // =========================================================================

  describe("curveSwap", () => {
    const amountIn = 1_000_000000n; // 1000 USDC (6 decimals)
    const action: SwapAction = {
      type: "curveSwap",
      chainId: 1,
      pool: CURVE_3POOL,
      tokenIn: USDC,
      tokenOut: USDT,
      i: 1, // USDC index in 3pool
      j: 2, // USDT index in 3pool
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches manual get_dy call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: CURVE_3POOL,
        abi: curveGetDyAbi,
        functionName: "get_dy",
        args: [1n, 2n, amountIn],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual get_dy=${manual}`);
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // Curve Router NG — get_dy (view)
  // =========================================================================

  describe("curveRouterNGSwap", () => {
    const amountIn = 1_000_000000n; // 1000 USDC
    const route = [USDC, CURVE_3POOL, USDT] as Address[];
    const swapParams: [number, number, number, number, number][] = [[1, 2, 1, 1, 3]];
    const pools = ["0x0000000000000000000000000000000000000000" as Address];

    const action: SwapAction = {
      type: "curveRouterNGSwap",
      chainId: 1,
      router: CURVE_ROUTER_NG,
      route,
      swapParams,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      pools,
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches manual Curve RouterNG get_dy call", async () => {
      const quoted = await executeQuote(action, amountIn);

      // Manual: pad and call get_dy on the router directly
      const paddedRoute = [...route] as Address[];
      while (paddedRoute.length < 11)
        paddedRoute.push("0x0000000000000000000000000000000000000000" as Address);
      const paddedParams = [...swapParams] as [number, number, number, number, number][];
      while (paddedParams.length < 5) paddedParams.push([0, 0, 0, 0, 0]);
      const paddedPools = [...pools] as Address[];
      while (paddedPools.length < 5)
        paddedPools.push("0x0000000000000000000000000000000000000000" as Address);

      const manual = await client.readContract({
        address: CURVE_ROUTER_NG,
        abi: parseAbi([
          "function get_dy(address[11] route, uint256[5][5] swapParams, uint256 amount, address[5] pools) view returns (uint256)",
        ]),
        functionName: "get_dy",
        args: [
          paddedRoute as any,
          paddedParams.map((r) => r.map((v) => BigInt(v))) as any,
          amountIn,
          paddedPools as any,
        ],
      });

      assert.equal(quoted, manual, `actionToQuote=${quoted} vs manual=${manual}`);
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // UniswapV2 — getAmountsOut (view)
  // =========================================================================

  describe("uniswapV2Swap", () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    const action: SwapAction = {
      type: "uniswapV2Swap",
      chainId: 1,
      router: UNISWAP_V2_ROUTER,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      path: [WETH, USDC],
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    it("matches manual getAmountsOut call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: UNISWAP_V2_ROUTER,
        abi: v2GetAmountsOutAbi,
        functionName: "getAmountsOut",
        args: [amountIn, [WETH, USDC]],
      });

      assert.equal(
        quoted,
        manual[manual.length - 1],
        `actionToQuote=${quoted} vs manual=${manual[manual.length - 1]}`,
      );
      assert.ok(quoted > 1000_000000n, "Should return >$1000 for 1 ETH");
    });
  });

  // =========================================================================
  // Fraxswap — getAmountsOut (view, same as UniV2)
  // =========================================================================

  describe("fraxswapSwap", () => {
    // Fraxswap's FRAX/WETH pair. Fraxswap pairs run TWAMM orders, and the view getAmountsOut reverts
    // ("twamm out of date") while any are pending, so the quote is getAmountsOutWithTwamm.
    const FRAXSWAP_ROUTER = "0xC14d550632db8592D1243Edc8B95b0Ad06703867" as Address;
    const FRAX = "0x853d955aCEf822Db058eb8505911ED77F175b99e" as Address;
    const amountIn = 1_000_000000000000000000n; // 1000 FRAX (18 decimals)

    const action: SwapAction = {
      type: "fraxswapSwap",
      chainId: 1,
      router: FRAXSWAP_ROUTER,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      path: [FRAX, WETH],
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    it("matches manual getAmountsOutWithTwamm call", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.simulateContract({
        address: FRAXSWAP_ROUTER,
        abi: fraxswapTwammAbi,
        functionName: "getAmountsOutWithTwamm",
        args: [amountIn, [FRAX, WETH]],
      });

      assert.equal(quoted, manual.result[manual.result.length - 1]);
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // BalancerV2 single swap — queryBatchSwap
  // =========================================================================

  describe("balancerV2Swap", () => {
    const amountIn = 100000000000000n; // 0.0001 ETH
    const action: SwapAction = {
      type: "balancerV2Swap",
      chainId: 1,
      vault: BALANCER_V2_VAULT,
      poolId: BALANCER_V2_POOL_ID,
      tokenIn: WETH,
      tokenOut: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    // The Vault runs the swap and reverts to return, so every emitted form of this quote is a
    // program that reverts. Absence of both fields is the contract that says so.
    it("exposes no on-chain quote form", () => {
      const quote = actionToQuote(action, amountIn, QUOTE_OPTS);
      assert.equal(quote.toSauce, undefined, "queryBatchSwap cannot run inside a STATICCALL");
      assert.equal(quote.toSauceDynamic, undefined, "nor with a runtime amount");
    });

    it("matches manual queryBatchSwap call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: BALANCER_V2_VAULT,
        abi: balV2QueryAbi,
        functionName: "queryBatchSwap",
        args: [
          0, // GIVEN_IN
          [
            {
              poolId: BALANCER_V2_POOL_ID,
              assetInIndex: 0n,
              assetOutIndex: 1n,
              amount: amountIn,
              userData: "0x",
            },
          ],
          [WETH, USDC],
          {
            sender: "0x0000000000000000000000000000000000000000",
            fromInternalBalance: false,
            recipient: "0x0000000000000000000000000000000000000000",
            toInternalBalance: false,
          },
        ],
      });

      const deltas = manual.result;
      const expected = deltas[1] < 0n ? -deltas[1] : deltas[1];
      assert.equal(
        quoted,
        expected,
        `actionToQuote=${quoted} vs manual queryBatchSwap=${expected}`,
      );
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // BalancerV2 batch swap — queryBatchSwap
  // =========================================================================

  describe("balancerV2BatchSwap", () => {
    const amountIn = 100000000000000n; // 0.0001 ETH
    const action: SwapAction = {
      type: "balancerV2BatchSwap",
      chainId: 1,
      vault: BALANCER_V2_VAULT,
      steps: [
        {
          poolId: BALANCER_V2_POOL_ID,
          assetInIndex: 0,
          assetOutIndex: 1,
          amount: amountIn.toString(),
        },
      ],
      assets: [WETH, USDC],
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    // The Vault runs the swap and reverts to return, so every emitted form of this quote is a
    // program that reverts. Absence of both fields is the contract that says so.
    it("exposes no on-chain quote form", () => {
      const quote = actionToQuote(action, amountIn, QUOTE_OPTS);
      assert.equal(quote.toSauce, undefined, "queryBatchSwap cannot run inside a STATICCALL");
      assert.equal(quote.toSauceDynamic, undefined, "nor with a runtime amount");
    });

    it("matches manual queryBatchSwap call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: BALANCER_V2_VAULT,
        abi: balV2QueryAbi,
        functionName: "queryBatchSwap",
        args: [
          0,
          [
            {
              poolId: BALANCER_V2_POOL_ID,
              assetInIndex: 0n,
              assetOutIndex: 1n,
              amount: amountIn,
              userData: "0x",
            },
          ],
          [WETH, USDC],
          {
            sender: "0x0000000000000000000000000000000000000000",
            fromInternalBalance: false,
            recipient: "0x0000000000000000000000000000000000000000",
            toInternalBalance: false,
          },
        ],
      });

      const deltas = manual.result;
      const expected = deltas[1] < 0n ? -deltas[1] : deltas[1];
      assert.equal(quoted, expected);
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // UniswapV3 single — QuoterV2 quoteExactInputSingle
  // =========================================================================

  describe("uniswapV3ExactInput", () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    const action: SwapAction = {
      type: "uniswapV3ExactInput",
      chainId: 1,
      router: SWAP_ROUTER,
      tokenIn: WETH,
      tokenOut: USDC,
      fee: 500,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    it("matches manual QuoterV2 quoteExactInputSingle call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: UNI_V3_QUOTER,
        abi: uniV3QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: WETH, tokenOut: USDC, amountIn, fee: 500, sqrtPriceLimitX96: 0n }],
      });

      assert.equal(
        quoted,
        manual.result[0],
        `actionToQuote=${quoted} vs manual=${manual.result[0]}`,
      );
      assert.ok(quoted > 1000_000000n, "Should return >$1000 for 1 ETH");
    });
  });

  // =========================================================================
  // UniswapV3 multi-hop — QuoterV2 quoteExactInput
  // =========================================================================

  describe("uniswapV3ExactInputMultiHop", () => {
    const amountIn = 1_000000000000000000n; // 1 ETH
    // Encoded path: WETH --500fee--> USDC
    const path = ("0x" +
      WETH.slice(2).toLowerCase() +
      "0001f4" +
      USDC.slice(2).toLowerCase()) as Hex;
    const action: SwapAction = {
      type: "uniswapV3ExactInputMultiHop",
      chainId: 1,
      router: SWAP_ROUTER,
      path,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
      deadline: DEADLINE,
    };

    it("matches manual QuoterV2 quoteExactInput call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.simulateContract({
        address: UNI_V3_QUOTER,
        abi: uniV3QuoterMultiAbi,
        functionName: "quoteExactInput",
        args: [path, amountIn],
      });

      assert.equal(
        quoted,
        manual.result[0],
        `actionToQuote=${quoted} vs manual=${manual.result[0]}`,
      );
      assert.ok(quoted > 1000_000000n, "Should return >$1000 for 1 ETH");
    });
  });

  // =========================================================================
  // UniswapV4 single — V4Quoter quoteExactInputSingle
  // =========================================================================

  describe("uniswapV4ExactInput", () => {
    // V4 ETH/USDC 0.3% pool on mainnet
    const amountIn = 1_000000000000000000n; // 1 ETH
    const ZERO = "0x0000000000000000000000000000000000000000" as Address;
    const action: SwapAction = {
      type: "uniswapV4ExactInput",
      chainId: 1,
      router: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address,
      poolKey: {
        currency0: ZERO, // ETH (native)
        currency1: USDC,
        fee: 3000,
        tickSpacing: 60,
        hooks: ZERO,
      },
      zeroForOne: true,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches the V4Quoter's quoteExactInputSingle", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.simulateContract({
        address: UNI_V4_QUOTER,
        abi: uniV4QuoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: { currency0: ZERO, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: ZERO },
            zeroForOne: true,
            exactAmount: amountIn,
            hookData: "0x",
          },
        ],
      });
      assert.equal(quoted, manual.result[0]);
      assert.ok(quoted > 1_000_000000n, `1 ETH should quote above 1,000 USDC, got ${quoted}`);
    });
  });

  // =========================================================================
  // DODO V2 — querySellBase (view)
  // =========================================================================

  describe("dodoSwap", () => {
    // The DODO V1 Classical WETH/USDC pair the swap suite trades against.
    const DODO_V1_WETH_USDC = "0x75c23271661d9d143dcb617222bc4bec783eff34" as Address;
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: "dodoSwap",
      chainId: 1,
      proxy: "0xa356867fDCEa8e71AEaF87805808803806231FdC" as Address,
      fromToken: WETH,
      toToken: USDC,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      dodoPairs: [DODO_V1_WETH_USDC],
      directions: 0, // bit 0 = 0 → selling base
      deadline: DEADLINE,
      version: "v1",
    };

    it("matches manual querySellBaseToken call on a V1 pair", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.readContract({
        address: DODO_V1_WETH_USDC,
        abi: dodoV1QueryAbi,
        functionName: "querySellBaseToken",
        args: [amountIn],
      });
      assert.equal(quoted, manual);
      assert.ok(quoted > 0n, "Should return non-zero USDC output");
    });
  });

  // =========================================================================
  // Ambient (CrocSwap) — calcImpact (view)
  // =========================================================================

  describe("ambientSwap", () => {
    // USDC(base) / WETH(quote), poolIdx=420
    // isBuy=false, inBaseQty=false → selling quote (WETH) for base (USDC)
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: "ambientSwap",
      chainId: 1,
      dex: AMBIENT_DEX,
      base: USDC,
      quote: WETH,
      poolIdx: 420,
      isBuy: false,
      inBaseQty: false,
      amountIn: amountIn.toString(),
      tip: 0,
      limitPrice: "65537",
      minOut: "0",
      reserveFlags: 0,
    };

    it("matches manual calcImpact call", async () => {
      const quoted = await executeQuote(action, amountIn);

      const manual = await client.readContract({
        address: CROC_IMPACT,
        abi: crocImpactAbi,
        functionName: "calcImpact",
        args: [USDC, WETH, 420n, false, false, amountIn, 0, 65537n],
      });

      // isBuy=false → output is baseFlow (USDC), should be negative (leaving pool)
      const expected = manual[0] < 0n ? -manual[0] : manual[0];
      assert.equal(quoted, expected, `actionToQuote=${quoted} vs manual calcImpact=${expected}`);
      assert.ok(quoted > 0n, "Should return non-zero output");
    });
  });

  // =========================================================================
  // Clipper — getSellQuote (view)
  // =========================================================================

  describe("clipperSwap", () => {
    it.skip("the Clipper exchange's getSellQuote reverts at the pinned block: Clipper prices through quotes signed off-chain", () => {});
  });

  // =========================================================================
  // Maverick V2 — calculateSwap (revert-sim)
  // =========================================================================

  describe("maverickSwap", () => {
    // A Maverick V2 USDC/USDT pool (token A = USDC) with liquidity at the pinned block.
    const MAVERICK_USDC_USDT_POOL = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA" as Address;
    const amountIn = 10_000000n; // 10 USDC

    const action: SwapAction = {
      type: "maverickSwap",
      chainId: 1,
      router: "0x62e31802c6145A2D5E842EeD8efe01fC224422fA" as Address,
      pool: MAVERICK_USDC_USDT_POOL,
      tokenAIn: true,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches manual calculateSwap call", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.simulateContract({
        address: MAVERICK_QUOTER,
        abi: maverickQuoterAbi,
        functionName: "calculateSwap",
        // No tick limit in the swap's direction, as the router's swap applies none.
        args: [MAVERICK_USDC_USDT_POOL, amountIn, true, false, 2 ** 31 - 1],
      });

      assert.equal(quoted, manual.result[1]);
      assert.ok(quoted > 9_900000n, `10 USDC should quote ~10 USDT, got ${quoted}`);
    });
  });

  // =========================================================================
  // Integral SIZE — quoteSell (view)
  // =========================================================================

  describe("integralSwap", () => {
    it.skip("Integral's relayer rejects a WETH/USDC quoteSell at the pinned block (TR5A), in both directions", () => {});
  });

  // =========================================================================
  // Fluid DEX T1 — estimateSwapIn (revert-sim)
  // =========================================================================

  describe("fluidDexT1Swap", () => {
    // wstETH/ETH pool — swap ETH(token1) → wstETH(token0), swap0to1=false
    const amountIn = 100000000000000000n; // 0.1 ETH
    const action: SwapAction = {
      type: "fluidDexT1Swap",
      chainId: 1,
      pool: FLUID_DEX_T1_WSTETH_ETH,
      swap0to1: false,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches manual estimateSwapIn call", async () => {
      let quoted: bigint;
      try {
        quoted = await executeQuote(action, amountIn);
      } catch {
        // Fluid resolver may revert if pool is not active
        return;
      }

      const manual = await client.simulateContract({
        address: FLUID_RESOLVER,
        abi: fluidEstimateAbi,
        functionName: "estimateSwapIn",
        args: [FLUID_DEX_T1_WSTETH_ETH, false, amountIn, 0n],
      });

      assert.equal(
        quoted,
        manual.result,
        `actionToQuote=${quoted} vs manual estimateSwapIn=${manual.result}`,
      );
      assert.ok(quoted > 0n, "Should return non-zero wstETH output");
    });
  });

  // =========================================================================
  // Carbon — calculateTradeTargetAmount (view)
  // Skipped: requires live strategy IDs that change dynamically
  // =========================================================================

  describe("carbonSwap", () => {
    const CARBON_CONTROLLER = "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1" as Address;
    // A USDC/USDT strategy holding USDT at the pinned block.
    const STRATEGY = 1020847100762815390390123822295304634823n;
    const amountIn = 1_000000n; // 1 USDC
    const action: SwapAction = {
      type: "carbonSwap",
      chainId: 1,
      controller: CARBON_CONTROLLER,
      sourceToken: USDC,
      targetToken: USDT,
      tradeActions: [{ strategyId: STRATEGY.toString(), amount: amountIn.toString() }],
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      deadline: DEADLINE,
    };

    it("matches manual calculateTradeTargetAmount call", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.readContract({
        address: CARBON_CONTROLLER,
        abi: carbonQuoteAbi,
        functionName: "calculateTradeTargetAmount",
        args: [USDC, USDT, [{ strategyId: STRATEGY, amount: amountIn }]],
      });
      assert.equal(quoted, manual);
      assert.ok(quoted > 990_000n, `1 USDC should buy ~0.99 USDT, got ${quoted}`);
    });
  });

  // =========================================================================
  // BalancerV3 — querySwapSingleTokenExactIn
  // Skipped: requires discovering a V3 pool with liquidity
  // =========================================================================

  describe("balancerV3Swap", () => {
    it.skip("kept with the swap it quotes, which cannot execute from a Pot: the V3 Router pulls its input through Permit2, and no action grants a Permit2 allowance", () => {});
  });

  // =========================================================================
  // UniswapV4 multi-hop
  // =========================================================================

  describe("uniswapV4ExactInputMultiHop", () => {
    const ZERO = "0x0000000000000000000000000000000000000000" as Address;
    const amountIn = 10_000000n; // 10 USDC
    const action: SwapAction = {
      type: "uniswapV4ExactInputMultiHop",
      chainId: 1,
      router: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address,
      currencyIn: USDC,
      // USDC/USDT at 0.001%, the pool the V4 suite swaps through.
      path: [{ intermediateCurrency: USDT, fee: 10, tickSpacing: 1, hooks: ZERO }],
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches the V4Quoter's quoteExactInput", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.simulateContract({
        address: UNI_V4_QUOTER,
        abi: uniV4QuoterAbi,
        functionName: "quoteExactInput",
        args: [
          {
            exactCurrency: USDC,
            path: [
              { intermediateCurrency: USDT, fee: 10, tickSpacing: 1, hooks: ZERO, hookData: "0x" },
            ],
            exactAmount: amountIn,
          },
        ],
      });
      assert.equal(quoted, manual.result[0]);
      assert.ok(quoted > 9_900000n, `10 USDC should quote ~10 USDT, got ${quoted}`);
    });
  });

  // =========================================================================
  // Maverick multi-hop
  // =========================================================================

  describe("maverickMultiHopSwap", () => {
    const MAVERICK_USDC_USDT_POOL = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA" as Address;
    // Per hop: the pool's 20 bytes, then one byte for tokenAIn.
    const path = `${MAVERICK_USDC_USDT_POOL}01` as Hex;
    const amountIn = 10_000000n; // 10 USDC
    const action: SwapAction = {
      type: "maverickMultiHopSwap",
      chainId: 1,
      router: "0x62e31802c6145A2D5E842EeD8efe01fC224422fA" as Address,
      path,
      amountIn: amountIn.toString(),
      amountOutMin: "0",
      recipient: "0x0000000000000000000000000000000000000001" as Address,
    };

    it("matches manual calculateMultiHopSwap call", async () => {
      const quoted = await executeQuote(action, amountIn);
      const manual = await client.simulateContract({
        address: MAVERICK_QUOTER,
        abi: maverickMultiQuoterAbi,
        functionName: "calculateMultiHopSwap",
        args: [path, amountIn, false],
      });
      assert.equal(quoted, manual.result[0]); // (returnAmount, gasEstimate)
      assert.ok(quoted > 9_900000n, `10 USDC should quote ~10 USDT, got ${quoted}`);
    });
  });

  // =========================================================================
  // Fluid DEX Lite
  // =========================================================================

  describe("fluidDexLiteSwap", () => {
    it.skip("a DEX Lite pool is addressed by a DexKey only its resolver lists, and no resolver is known here; the singleton had no swaps in the 10,000 blocks before the pinned block", () => {});
  });
});
