/**
 * `quoteAction` against the deployed mainnet quoters, on a local anvil holding mainnet state
 * captured at the pinned block (`mainnet.ts`) — no RPC. Every quote is sent as the `eth_call` it
 * describes, decoded by its own `decode`, and compared with an independent call of a quoter
 * written here from the protocol's own ABI.
 *
 * The anvil carries the released stack, because the Uniswap V3 and V4 swaps (`@sauce/router`'s,
 * through the Pot's Router) are quoted by the Router itself; each is held to Uniswap's own quoter.
 * The Trader Joe LB and WOOFi quotes run on their own chains' state, in `swap-avalanche` and
 * `swap-base`, against the swaps they price.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  hexToBytes,
  http,
  parseAbi,
  type Address,
} from "viem";

import { quoteAction, type QuoteOptions } from "../src/index.js";
import { ACTION_SPECS, ACTION_TYPES } from "../src/spec.js";
import type { ActionType, SwapAction } from "../src/types.js";
import { compileEvm } from "../src/compile.js";
import { newEmitter, type Fragment } from "../src/emit.js";
import { quoteCall } from "../src/to-quote.js";
import { skipReason, startAnvil, type Anvil } from "./anvil.js";
import { DEADLINE } from "./mainnet.js";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const FRAX = "0x853d955aCEf822Db058eb8505911ED77F175b99e";
const ZERO = "0x0000000000000000000000000000000000000000";
const RECIPIENT = "0x0000000000000000000000000000000000000001";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
/** Uniswap V2's USDC/WETH pair, and Uniswap V3's USDC/WETH 0.05% pool. */
const UNIV2_USDC_WETH = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const UNIV3_USDC_WETH_500 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
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
const MAVERICK_USDC_USDT = "0x31373595F40Ea48a7aAb6CBCB0d377C6066E2dCA";
const CARBON_CONTROLLER = "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1";
const CARBON_USDC_USDT = 1020847100762815390390123822295304634823n;
const FLUID_WSTETH_ETH = "0x0B1a513ee24972DAEf112bC777a5610d4325C9e7";

/** Uniswap's own quoters, which the Router's quotes of the same swaps must agree with. */
const UNISWAP_V3_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const UNISWAP_V4_QUOTER = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203";

/** Every quoter but the Router, whose address is the stack's on this anvil. */
const QUOTERS = {
  maverickQuoter: "0xb40AfdB85a07f37aE217E7D6462e609900dD8D7A",
  ambientImpact: "0x3e3EDd3eD7621891E574E5d7f47b1f30A994c0D0",
  fluidDexResolver: "0x05Bd8269A20C472b148246De20E6852091BF16Ff",
} as const satisfies QuoteOptions;

/** Swap action types whose venue Ethereum lacks: their quotes run on their own chain's state. */
const QUOTED_ELSEWHERE: readonly ActionType[] = ["traderJoeLBSwap", "woofiSwap"];

const ONE_ETH = 10n ** 18n;
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

describe("quoteAction, on mainnet state", { skip: skipReason(), timeout: 300_000 }, () => {
  let env: Anvil;
  let client: ReturnType<typeof createPublicClient>;
  /** The quoters, with the Router the stack deployed. */
  let quoters: QuoteOptions;

  before(async () => {
    env = await startAnvil({ mainnet: "quote" });
    quoters = { ...QUOTERS, router: env.quoteRouter };
    const base = http(env.rpc)({ chain: undefined, retryCount: 0, timeout: 30_000 });
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
    await env?.stop();
  });

  it("refuses the execution Router as a quote service before issuing a call", () => {
    assert.notEqual(env.router, env.quoteRouter);
    assert.throws(() =>
      quoteAction(
        {
          type: "uniswapV3Swap",
          pool: UNIV3_USDC_WETH_500,
          tokenIn: USDC,
          tokenOut: WETH,
          amount: "1000000",
          amountOutMin: "0",
          recipient: "self",
        },
        { router: env.router },
      ),
    );
  });

  /** The quote, sent as its `eth_call` (from the zero address) and decoded by its own decoder. */
  async function quote(action: SwapAction): Promise<bigint> {
    const { to, data, decode } = quoteAction(action, quoters);
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
        tokenIn: USDC,
        tokenOut: USDT,
        i: 1,
        j: 2,
        indexType: "int128",
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
      // The pair's reserves, priced in the quote's decoder, agree with Router02's getAmountsOut.
      action: {
        type: "uniswapV2Swap",
        amount: `${ONE_ETH}`,
        pool: UNIV2_USDC_WETH,
        tokenIn: WETH,
        tokenOut: USDC,
        amountOutMin: "0",
        recipient: RECIPIENT,
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
      // The Router's own quote of the swap it runs, against Uniswap's QuoterV2.
      action: {
        type: "uniswapV3Swap",
        amount: `${ONE_ETH}`,
        pool: UNIV3_USDC_WETH_500,
        tokenIn: WETH,
        tokenOut: USDC,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(UNISWAP_V3_QUOTER, abi.uniV3, "quoteExactInputSingle", [
            { tokenIn: WETH, tokenOut: USDC, amountIn: ONE_ETH, fee: 500, sqrtPriceLimitX96: 0n },
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000_000n,
    },
    {
      // The Router's own quote of the swap it runs, against Uniswap's V4Quoter: native ETH in.
      action: {
        type: "uniswapV4Swap",
        amount: `${ONE_ETH}`,
        poolManager: POOL_MANAGER,
        tokenIn: ZERO,
        tokenOut: USDC,
        fee: V4_ETH_USDC.fee,
        tickSpacing: V4_ETH_USDC.tickSpacing,
        hooks: V4_ETH_USDC.hooks,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      expected: async () =>
        (
          (await simulate(UNISWAP_V4_QUOTER, abi.uniV4, "quoteExactInputSingle", [
            { poolKey: V4_ETH_USDC, zeroForOne: true, exactAmount: ONE_ETH, hookData: "0x" },
          ])) as bigint[]
        )[0]!,
      atLeast: 1_000_000_000n,
    },
    {
      action: {
        type: "dodoV1Swap",
        amount: `${ONE_ETH / 10n}`,
        proxy: DODO_PROXY,
        tokenIn: WETH,
        tokenOut: USDC,
        pairs: [DODO_V1_WETH_USDC],
        directions: 0, // sells base (WETH)
        amountOutMin: "0",
        deadline: DEADLINE,
      },
      expected: async () =>
        (await view(DODO_V1_WETH_USDC, abi.dodoV1, "querySellBaseToken", [
          ONE_ETH / 10n,
        ])) as bigint,
      atLeast: 1n,
    },
    {
      action: {
        type: "dodoV2Swap",
        amount: `${ONE_ETH / 10n}`,
        pool: DODO_V2_WETH_USDC,
        tokenIn: WETH,
        tokenOut: USDC,
        baseToken: WETH,
        quoteToken: USDC,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
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
      // Selling token A, the pool's lower-addressed token, USDC.
      action: {
        type: "maverickV2Swap",
        amount: "10000000",
        pool: MAVERICK_USDC_USDT,
        tokenIn: USDC,
        tokenOut: USDT,
        amountOutMin: "0",
        recipient: RECIPIENT,
      },
      // No tick limit in the swap's direction, as the Router's swap applies none.
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
    const name = action.type;
    it(`${name}: matches the quoter asked directly`, async () => {
      const quoted = await quote(action);
      assert.equal(quoted, await expected());
      assert.ok(quoted >= atLeast, `${name} quoted ${quoted}`);
    });
  }

  // An Ambient quote reads `int128` flows and a V4 quote writes a negative `int256 amountSpecified`:
  // each on-chain form, run as a program with its amount fixed and with it a run-time argument,
  // must quote what the venue's own quoter does.
  for (const type of ["uniswapV4Swap", "ambientSwap"] as const) {
    it(`${type}: its on-chain forms match the venue's own quoter`, async () => {
      const { action, expected } = cases.find((c) => c.action.type === type)!;
      assert.ok("amount" in action && typeof action.amount === "string");
      const amount = BigInt(action.amount);
      const { toSauce, toSauceDynamic } = quoteCall(action, amount, quoters);
      assert.ok(toSauce && toSauceDynamic);
      const args = hexToBytes(encodeAbiParameters([{ type: "uint256" }], [amount]));
      const run = async (fragment: Fragment): Promise<bigint> => {
        const compiled = compileEvm(
          `function main(amount: Uint256): Uint256 {\n${fragment.stmts.join("\n")}\nreturn ${fragment.expr};\n}`,
        );
        return BigInt(await env.returned(new Uint8Array([...compiled.bytecode, ...args])));
      };
      const want = await expected();
      assert.equal(await run(toSauce(newEmitter())), want, "fixed amount");
      assert.equal(await run(toSauceDynamic(newEmitter(), "amount")), want, "run-time amount");
    });
  }

  it("quotes every swap action type", () => {
    const quoted = new Set<string>([...cases.map((c) => c.action.type), ...QUOTED_ELSEWHERE]);
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
    const v3 = cases.find((c) => c.action.type === "uniswapV3Swap")!.action;
    assert.throws(() => quoteAction(v3), /needs `router` in the quote options/);
  });
});
