/**
 * `quoteAction` against the deployed mainnet quoters, on a local anvil holding mainnet state
 * captured at the pinned block (`mainnet.ts`) — no RPC. Every quote is sent as the `eth_call` it
 * describes, decoded by its own `decode`, and compared with an independent call of the same
 * quoter written here from the protocol's own ABI.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, custom, http, parseAbi, type Address, type Hex } from "viem";

import { quoteAction, type QuoteOptions } from "../src/index.js";
import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
import type { SwapAction } from "../src/types.js";
import { DEADLINE, startMainnet, type Mainnet } from "./mainnet.js";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FRAX = "0x853d955aCEf822Db058eb8505911ED77F175b99e";
const ZERO = "0x0000000000000000000000000000000000000000";
const RECIPIENT = "0x0000000000000000000000000000000000000001";

const SWAP_ROUTER_02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const FRAXSWAP_ROUTER = "0xC14d550632db8592D1243Edc8B95b0Ad06703867";
const CURVE_3POOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7";
const CURVE_ROUTER_NG = "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D";
const BALANCER_V2_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const BALANCER_V2_WETH_USDC = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019";
const BALANCER_V3_ROUTER = "0xAE563E3f8219521950555F5962419C8919758Ea2";
const BALANCER_V3_USDC_WETH = "0x84f2195dc84d540a3ab92e659603d770014f0440";
const AMBIENT_DEX = "0xAaAaAAAaA24eEeb8d57D431224f73832bC34f688";
const DODO_PROXY = "0xa356867fDCEa8e71AEaF87805808803806231FdC";
const DODO_V1_WETH_USDC = "0x75c23271661d9d143DCb617222BC4BEc783eff34";
const DODO_V2_WETH_USDC = "0x8B2F062d112aE1ac6Ccc6C358cc40C9518c847Dc";
const MAVERICK_V2_ROUTER = "0x62e31802c6145A2D5E842EeD8efe01fC224422fA";
const MAVERICK_USDC_USDT = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA";
const CARBON_CONTROLLER = "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1";
const CARBON_USDC_USDT = 1020847100762815390390123822295304634823n;
const FLUID_WSTETH_ETH = "0x0B1a513ee24972DAEf112bC777a5610d4325C9e7";

const QUOTERS = {
  uniswapV3Quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  uniswapV4Quoter: "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203",
  maverickQuoter: "0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A",
  ambientImpact: "0x3e3EDd3eD7621891E574E5d7f47b1f30A994c0D0",
  fluidDexResolver: "0x05Bd8269A20C472b148246De20E6852091BF16Ff",
} as const satisfies QuoteOptions;

const ONE_ETH = 10n ** 18n;
const V3_PATH = `${WETH}0001f4${USDC.slice(2)}` as Hex;
const MAVERICK_PATH = `${MAVERICK_USDC_USDT}01` as Hex;
const V4_ETH_USDC = {
  currency0: ZERO,
  currency1: USDC,
  fee: 3000,
  tickSpacing: 60,
  hooks: ZERO,
} as const;
const padded = <T>(items: readonly T[], length: number, fill: T): T[] => [
  ...items,
  ...Array<T>(length - items.length).fill(fill),
];

const abi = {
  curve: parseAbi(["function get_dy(int128, int128, uint256) view returns (uint256)"]),
  curveRouter: parseAbi([
    "function get_dy(address[11], uint256[5][5], uint256, address[5]) view returns (uint256)",
  ]),
  v2: parseAbi(["function getAmountsOut(uint256, address[]) view returns (uint256[])"]),
  fraxswap: parseAbi(["function getAmountsOutWithTwamm(uint256, address[]) returns (uint256[])"]),
  balancerV2: parseAbi([
    "function queryBatchSwap(uint8, (bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[], address[], (address sender, bool fromInternalBalance, address recipient, bool toInternalBalance)) returns (int256[])",
  ]),
  balancerV3: parseAbi([
    "function querySwapSingleTokenExactIn(address pool, address tokenIn, address tokenOut, uint256 exactAmountIn, address sender, bytes userData) returns (uint256)",
  ]),
  uniV3: parseAbi([
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256, uint160, uint32, uint256)",
    "function quoteExactInput(bytes, uint256) returns (uint256, uint160[], uint32[], uint256)",
  ]),
  uniV4: parseAbi([
    "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
    "struct PathKey { address intermediateCurrency; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }",
    "function quoteExactInputSingle((PoolKey poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256, uint256)",
    "function quoteExactInput((address exactCurrency, PathKey[] path, uint128 exactAmount)) returns (uint256, uint256)",
  ]),
  dodoV1: parseAbi(["function querySellBaseToken(uint256) view returns (uint256)"]),
  dodoV2: parseAbi(["function querySellBase(address, uint256) view returns (uint256, uint256)"]),
  ambient: parseAbi([
    "function calcImpact(address, address, uint256, bool, bool, uint128, uint16, uint128) view returns (int128, int128, uint128)",
  ]),
  maverick: parseAbi([
    "function calculateSwap(address, uint128, bool, bool, int32) returns (uint256, uint256, uint256)",
    "function calculateMultiHopSwap(bytes, uint256, bool) returns (uint256, uint256)",
  ]),
  carbon: parseAbi([
    "function calculateTradeTargetAmount(address, address, (uint256 strategyId, uint128 amount)[]) view returns (uint128)",
  ]),
  fluid: parseAbi(["function estimateSwapIn(address, bool, uint256, uint256) returns (uint256)"]),
};

describe("quoteAction, on mainnet state", { timeout: 300_000 }, () => {
  let mainnet: Mainnet;
  let client: ReturnType<typeof createPublicClient>;

  before(async () => {
    mainnet = await startMainnet("quote");
    const base = http(mainnet.rpc)({ chain: undefined, retryCount: 0, timeout: 30_000 });
    // Every eth_call gets 15M gas, so a quoter that meters gas sees the same budget every run.
    client = createPublicClient({
      transport: custom({
        request: async (args: { method: string; params?: unknown[] }) => {
          if (args.method === "eth_call" && args.params?.[0]) {
            args.params[0] = { ...(args.params[0] as object), gas: "0xe4e1c0" };
          }
          return base.request(args as never);
        },
      }),
    });
  });
  after(async () => {
    await mainnet?.stop();
  });

  /** The quote, sent as its `eth_call` (from the zero address) and decoded by its own decoder. */
  async function quote(action: SwapAction): Promise<bigint> {
    const { to, data, decode } = quoteAction(action, QUOTERS);
    const { data: result } = await client.call({ account: ZERO, to, data });
    assert.ok(result, `${action.type}: the quote returned nothing`);

    return decode(result);
  }

  /** `simulateContract`'s result, from the zero address. */
  async function simulate(
    address: string,
    contract: readonly unknown[],
    functionName: string,
    args: unknown[],
  ) {
    const { result } = await client.simulateContract({
      account: ZERO,
      address: address as Address,
      abi: contract,
      functionName,
      args,
    } as never);

    return result as unknown;
  }
  const view = (
    address: string,
    contract: readonly unknown[],
    functionName: string,
    args: unknown[],
  ) =>
    client.readContract({
      address: address as Address,
      abi: contract,
      functionName,
      args,
    } as never) as Promise<unknown>;

  const cases: Array<{
    readonly action: SwapAction;
    /** The same quote, asked independently. */
    readonly expected: () => Promise<bigint>;
    /** A floor that shows the quote is a real price. */
    readonly atLeast: bigint;
  }> = [
    {
      action: {
        type: "curveSwap",
        amount: "1000000000",
        pool: CURVE_3POOL,
        tokenOut: USDT,
        i: 1,
        j: 2,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (await view(CURVE_3POOL, abi.curve, "get_dy", [1n, 2n, 1_000_000_000n])) as bigint,
      atLeast: 990_000_000n,
    },
    {
      action: {
        type: "curveRouterNGSwap",
        amount: "1000000000",
        router: CURVE_ROUTER_NG,
        route: [USDC, CURVE_3POOL, USDT],
        swapParams: [[1, 2, 1, 1, 3]],
        pools: [],
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (await view(CURVE_ROUTER_NG, abi.curveRouter, "get_dy", [
          padded([USDC, CURVE_3POOL, USDT], 11, ZERO),
          padded([[1n, 2n, 1n, 1n, 3n]], 5, [0n, 0n, 0n, 0n, 0n]),
          1_000_000_000n,
          padded([], 5, ZERO),
        ])) as bigint,
      atLeast: 990_000_000n,
    },
    {
      action: {
        type: "uniswapV2Swap",
        amount: `${ONE_ETH}`,
        router: UNISWAP_V2_ROUTER,
        path: [WETH, USDC],
        amountOutMin: "0",
        recipient: RECIPIENT,
        deadline: DEADLINE,
      },
      expected: async () =>
        (
          (await view(UNISWAP_V2_ROUTER, abi.v2, "getAmountsOut", [
            ONE_ETH,
            [WETH, USDC],
          ])) as bigint[]
        )[1]!,
      atLeast: 1_000_000_000n,
    },
    {
      // Fraxswap pairs run TWAMM orders, and the view getAmountsOut reverts while any are pending.
      action: {
        type: "fraxswapSwap",
        amount: `${1000n * ONE_ETH}`,
        router: FRAXSWAP_ROUTER,
        path: [FRAX, WETH],
        amountOutMin: "0",
        recipient: RECIPIENT,
        deadline: DEADLINE,
      },
      expected: async () =>
        (
          (await simulate(FRAXSWAP_ROUTER, abi.fraxswap, "getAmountsOutWithTwamm", [
            1000n * ONE_ETH,
            [FRAX, WETH],
          ])) as bigint[]
        )[1]!,
      atLeast: ONE_ETH / 10n,
    },
    {
      action: {
        type: "balancerV2Swap",
        amount: `${ONE_ETH / 10_000n}`,
        vault: BALANCER_V2_VAULT,
        poolId: BALANCER_V2_WETH_USDC,
        tokenIn: WETH,
        tokenOut: USDC,
        amountOutMin: "0",
        recipient: RECIPIENT,
        deadline: DEADLINE,
      },
      expected: () => balancerV2Query(ONE_ETH / 10_000n),
      atLeast: 1n,
    },
    {
      action: {
        type: "balancerV2BatchSwap",
        vault: BALANCER_V2_VAULT,
        steps: [
          {
            poolId: BALANCER_V2_WETH_USDC,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: `${ONE_ETH / 10_000n}`,
          },
        ],
        assets: [WETH, USDC],
        amountOutMin: "0",
        recipient: RECIPIENT,
        deadline: DEADLINE,
      },
      expected: () => balancerV2Query(ONE_ETH / 10_000n),
      atLeast: 1n,
    },
    {
      // The Vault answers a query only outside a transaction: tx.origin must be the zero address.
      action: {
        type: "balancerV3Swap",
        amount: "100000000",
        router: BALANCER_V3_ROUTER,
        pool: BALANCER_V3_USDC_WETH,
        tokenIn: USDC,
        tokenOut: WETH,
        amountOutMin: "0",
        deadline: DEADLINE,
        wethIsEth: false,
      },
      expected: async () =>
        (await simulate(BALANCER_V3_ROUTER, abi.balancerV3, "querySwapSingleTokenExactIn", [
          BALANCER_V3_USDC_WETH,
          USDC,
          WETH,
          100_000_000n,
          ZERO,
          "0x",
        ])) as bigint,
      atLeast: ONE_ETH / 100n,
    },
    {
      action: {
        type: "uniswapV3ExactInput",
        amount: `${ONE_ETH}`,
        router: SWAP_ROUTER_02,
        tokenIn: WETH,
        tokenOut: USDC,
        fee: 500,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(QUOTERS.uniswapV3Quoter, abi.uniV3, "quoteExactInputSingle", [
            { tokenIn: WETH, tokenOut: USDC, amountIn: ONE_ETH, fee: 500, sqrtPriceLimitX96: 0n },
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000_000n,
    },
    {
      action: {
        type: "uniswapV3ExactInputMultiHop",
        amount: `${ONE_ETH}`,
        router: SWAP_ROUTER_02,
        path: V3_PATH,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(QUOTERS.uniswapV3Quoter, abi.uniV3, "quoteExactInput", [
            V3_PATH,
            ONE_ETH,
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000_000n,
    },
    {
      action: {
        type: "uniswapV4ExactInput",
        amount: `${ONE_ETH}`,
        router: UNIVERSAL_ROUTER,
        poolKey: V4_ETH_USDC,
        zeroForOne: true,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(QUOTERS.uniswapV4Quoter, abi.uniV4, "quoteExactInputSingle", [
            { poolKey: V4_ETH_USDC, zeroForOne: true, exactAmount: ONE_ETH, hookData: "0x" },
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000_000n,
    },
    {
      action: {
        type: "uniswapV4ExactInputMultiHop",
        amount: "10000000",
        router: UNIVERSAL_ROUTER,
        currencyIn: USDC,
        path: [{ intermediateCurrency: USDT, fee: 10, tickSpacing: 1, hooks: ZERO }],
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(QUOTERS.uniswapV4Quoter, abi.uniV4, "quoteExactInput", [
            {
              exactCurrency: USDC,
              path: [
                {
                  intermediateCurrency: USDT,
                  fee: 10,
                  tickSpacing: 1,
                  hooks: ZERO,
                  hookData: "0x",
                },
              ],
              exactAmount: 10_000_000n,
            },
          ])) as bigint[]
        )[0]!,
      atLeast: 9_900_000n,
    },
    {
      action: dodo("v1", DODO_V1_WETH_USDC),
      expected: async () =>
        (await view(DODO_V1_WETH_USDC, abi.dodoV1, "querySellBaseToken", [
          ONE_ETH / 10n,
        ])) as bigint,
      atLeast: 1n,
    },
    {
      action: dodo("v2", DODO_V2_WETH_USDC),
      expected: async () =>
        (
          (await view(DODO_V2_WETH_USDC, abi.dodoV2, "querySellBase", [
            ZERO,
            ONE_ETH / 10n,
          ])) as bigint[]
        )[0]!,
      atLeast: 1n,
    },
    {
      // Sells quote (WETH) for base (USDC); the received flow is the negative one.
      action: {
        type: "ambientSwap",
        amount: `${ONE_ETH / 10n}`,
        dex: AMBIENT_DEX,
        base: USDC,
        quote: WETH,
        poolIdx: 420,
        isBuy: false,
        inBaseQty: false,
        tip: 0,
        limitPrice: "65537",
        amountOutMin: "0",
        reserveFlags: 0,
      },
      expected: async () =>
        -(
          (await view(QUOTERS.ambientImpact, abi.ambient, "calcImpact", [
            USDC,
            WETH,
            420n,
            false,
            false,
            ONE_ETH / 10n,
            0,
            65537n,
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000n,
    },
    {
      action: {
        type: "maverickSwap",
        amount: "10000000",
        router: MAVERICK_V2_ROUTER,
        pool: MAVERICK_USDC_USDT,
        tokenAIn: true,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      // No tick limit in the swap's direction, as the router's swap applies none.
      expected: async () =>
        (
          (await simulate(QUOTERS.maverickQuoter, abi.maverick, "calculateSwap", [
            MAVERICK_USDC_USDT,
            10_000_000n,
            true,
            false,
            2 ** 31 - 1,
          ])) as bigint[]
        )[1]!,
      atLeast: 9_900_000n,
    },
    {
      action: {
        type: "maverickMultiHopSwap",
        amount: "10000000",
        router: MAVERICK_V2_ROUTER,
        path: MAVERICK_PATH,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(QUOTERS.maverickQuoter, abi.maverick, "calculateMultiHopSwap", [
            MAVERICK_PATH,
            10_000_000n,
            false,
          ])) as bigint[]
        )[0]!,
      atLeast: 9_900_000n,
    },
    {
      action: {
        type: "carbonSwap",
        controller: CARBON_CONTROLLER,
        sourceToken: USDC,
        targetToken: USDT,
        tradeActions: [{ strategyId: `${CARBON_USDC_USDT}`, amount: "1000000" }],
        amountOutMin: "0",
        deadline: DEADLINE,
      },
      expected: async () =>
        (await view(CARBON_CONTROLLER, abi.carbon, "calculateTradeTargetAmount", [
          USDC,
          USDT,
          [{ strategyId: CARBON_USDC_USDT, amount: 1_000_000n }],
        ])) as bigint,
      atLeast: 990_000n,
    },
    {
      // Sells wstETH (token0) for ETH, the direction the swap suite trades.
      action: {
        type: "fluidDexT1Swap",
        amount: `${ONE_ETH / 10n}`,
        pool: FLUID_WSTETH_ETH,
        swap0to1: true,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (await simulate(QUOTERS.fluidDexResolver, abi.fluid, "estimateSwapIn", [
          FLUID_WSTETH_ETH,
          true,
          ONE_ETH / 10n,
          0n,
        ])) as bigint,
      atLeast: ONE_ETH / 10n,
    },
  ];

  function dodo(version: "v1" | "v2", pair: string): SwapAction {
    return {
      type: "dodoSwap",
      amount: `${ONE_ETH / 10n}`,
      proxy: DODO_PROXY,
      fromToken: WETH,
      toToken: USDC,
      pairs: [pair as Address],
      directions: 0, // sells base (WETH)
      amountOutMin: "0",
      deadline: DEADLINE,
      version,
    };
  }

  async function balancerV2Query(amount: bigint): Promise<bigint> {
    const deltas = (await simulate(BALANCER_V2_VAULT, abi.balancerV2, "queryBatchSwap", [
      0,
      [
        {
          poolId: BALANCER_V2_WETH_USDC,
          assetInIndex: 0n,
          assetOutIndex: 1n,
          amount,
          userData: "0x",
        },
      ],
      [WETH, USDC],
      { sender: ZERO, fromInternalBalance: false, recipient: ZERO, toInternalBalance: false },
    ])) as bigint[];

    return -deltas[1]!;
  }

  for (const { action, expected, atLeast } of cases) {
    const name = action.type === "dodoSwap" ? `dodoSwap (${action.version})` : action.type;
    it(`${name}: matches the quoter asked directly`, async () => {
      const quoted = await quote(action);
      assert.equal(quoted, await expected());
      assert.ok(quoted >= atLeast, `${name} quoted ${quoted}`);
    });
  }

  it("quotes every swap action type", () => {
    const quoted = new Set<string>(cases.map((c) => c.action.type));
    const swaps = ACTION_TYPES.filter((type) => ACTION_SPECS[type].group === "swap");
    assert.deepEqual(
      swaps.filter((type) => !quoted.has(type)),
      [],
    );
  });

  it("refuses an action with no amount, and a quoter it was not given", () => {
    const { amount: _, ...bare } = cases[0]!.action as { amount?: string } & SwapAction;
    assert.throws(
      () => quoteAction(bare as SwapAction),
      /set the curveSwap's `amount` to quote it/,
    );
    const v3 = cases.find((c) => c.action.type === "uniswapV3ExactInput")!.action;
    assert.throws(() => quoteAction(v3), /needs `uniswapV3Quoter` in the quote options/);
  });
});
