/**
 * One valid instance of every action type, for the suites that need the whole catalogue. Typed
 * against `types.ts` and parsed against `spec.ts`, so the two cannot drift apart. NOT a `.test.ts`.
 */
import type { Action, ActionProgram, ActionType } from "../src/types.js";

/** The contract each sample calls. */
export const T = "0x2000000000000000000000000000000000000001";
/** The token each sample spends (and a pool address where one is an argument). */
export const A = "0x1000000000000000000000000000000000000001";
/** The token each sample buys. */
export const B = "0x1000000000000000000000000000000000000002";
/** Each sample's recipient. */
export const R = "0x3000000000000000000000000000000000000001";
export const ZERO = "0x0000000000000000000000000000000000000000";
export const B32 = `0x${"ab".repeat(32)}` as const;
/** Each sample's deadline. */
export const D = 9_999_999_999;

type Samples = { [K in ActionType]: Extract<Action, { type: K }> };

export const SAMPLES: Samples = {
  uniswapV2Swap: {
    type: "uniswapV2Swap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    recipient: R,
  },
  uniswapV3Swap: {
    type: "uniswapV3Swap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    recipient: R,
  },
  uniswapV4Swap: {
    type: "uniswapV4Swap",
    amount: "1000",
    poolManager: T,
    tokenIn: A,
    tokenOut: B,
    fee: 500,
    tickSpacing: 10,
    hooks: ZERO,
    amountOutMin: "1",
    recipient: R,
  },
  curveSwap: {
    type: "curveSwap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    i: 1,
    j: 2,
    indexType: "int128",
    amountOutMin: "1",
    recipient: R,
  },
  balancerV2Swap: {
    type: "balancerV2Swap",
    amount: "1000",
    vault: T,
    poolId: B32,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    recipient: R,
  },
  dodoV2Swap: {
    type: "dodoV2Swap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    baseToken: A,
    quoteToken: B,
    amountOutMin: "1",
    recipient: R,
  },
  traderJoeLBSwap: {
    type: "traderJoeLBSwap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    tokenX: B,
    tokenY: A,
    amountOutMin: "1",
    recipient: R,
  },
  woofiSwap: {
    type: "woofiSwap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    recipient: R,
  },
  maverickV2Swap: {
    type: "maverickV2Swap",
    amount: "1000",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    recipient: R,
  },
  curveRouterNGSwap: {
    type: "curveRouterNGSwap",
    amount: "1000",
    router: T,
    route: [A, T, B],
    swapParams: [[1, 2, 1, 1, 3]],
    pools: [],
    amountOutMin: "1",
    recipient: R,
  },
  balancerV2BatchSwap: {
    type: "balancerV2BatchSwap",
    vault: T,
    steps: [{ poolId: B32, assetInIndex: 0, assetOutIndex: 1, amount: "1000" }],
    assets: [A, B],
    amountOutMin: "1",
    recipient: R,
    deadline: D,
  },
  balancerV3Swap: {
    type: "balancerV3Swap",
    amount: "1000",
    router: T,
    pool: A,
    tokenIn: A,
    tokenOut: B,
    amountOutMin: "1",
    deadline: D,
    wethIsEth: false,
  },
  ambientSwap: {
    type: "ambientSwap",
    amount: "1000",
    dex: T,
    base: A,
    quote: B,
    poolIdx: 420,
    isBuy: true,
    inBaseQty: true,
    tip: 0,
    limitPrice: "1",
    amountOutMin: "1",
    reserveFlags: 0,
  },
  dodoV1Swap: {
    type: "dodoV1Swap",
    amount: "1000",
    proxy: T,
    tokenIn: A,
    tokenOut: B,
    pairs: [T],
    directions: 0,
    amountOutMin: "1",
    deadline: D,
  },

  carbonSwap: {
    type: "carbonSwap",
    controller: T,
    sourceToken: A,
    targetToken: B,
    tradeActions: [{ strategyId: "340282366920938463463374607431768211457", amount: "1000" }],
    amountOutMin: "1",
    deadline: D,
  },
  fraxswapSwap: {
    type: "fraxswapSwap",
    amount: "1000",
    router: T,
    path: [A, B],
    amountOutMin: "1",
    recipient: R,
    deadline: D,
  },
  fluidDexT1Swap: {
    type: "fluidDexT1Swap",
    amount: "1000",
    pool: T,
    swap0to1: true,
    amountOutMin: "1",
    recipient: R,
  },
  // Registry tokens of the same decimals, Ethereum's USDC for Optimism's: an `outputToken` the
  // registry cannot hold to the input's decimals is refused.
  acrossBridge: {
    type: "acrossBridge",
    amount: "1000",
    spokePool: T,
    token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    outputToken: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    destChainId: 10,
    recipient: R,
    relayerFee: "10",
    quoteTimestamp: 1,
    fillDeadline: 2,
    exclusivityDeadline: 0,
    message: "0x",
  },
  stargateBridge: {
    type: "stargateBridge",
    amount: "1000",
    pool: T,
    dstEid: 30110,
    recipient: R,
    amountOutMin: "990",
  },
  cctpBridge: {
    type: "cctpBridge",
    amount: "1000",
    tokenMessenger: T,
    token: A,
    destinationDomain: 5,
    recipient: B32,
    maxFee: "0",
    minFinalityThreshold: 2000,
  },
  hyperlaneBridge: {
    type: "hyperlaneBridge",
    amount: "1000",
    router: T,
    destinationDomain: 10,
    recipient: R,
  },
  wrapETH: { type: "wrapETH", amount: "1000", weth: T },
  unwrapETH: { type: "unwrapETH", amount: "1000", weth: T },
  wrapStETH: { type: "wrapStETH", amount: "1000", wstETH: T },
  unwrapStETH: { type: "unwrapStETH", amount: "1000", wstETH: T },
  lidoStake: { type: "lidoStake", amount: "1000", stETH: T, referral: ZERO },
  lidoUnstake: { type: "lidoUnstake", amount: "1000", withdrawalQueue: T, owner: "pot" },
  rocketPoolStake: { type: "rocketPoolStake", amount: "1000", depositPool: T, rETH: A },
  rocketPoolUnstake: { type: "rocketPoolUnstake", amount: "1000", rETH: T },
  etherFiStake: { type: "etherFiStake", amount: "1000", liquidityPool: T, eETH: A },
  aaveV3Supply: {
    type: "aaveV3Supply",
    amount: "1000",
    pool: T,
    token: A,
    onBehalfOf: "pot",
    referralCode: 0,
  },
  aaveV3Withdraw: { type: "aaveV3Withdraw", amount: "1000", pool: T, token: A, recipient: R },
  aaveV3Borrow: { type: "aaveV3Borrow", amount: "1000", pool: T, token: A, onBehalfOf: R },
  aaveV3Repay: { type: "aaveV3Repay", amount: "1000", pool: T, token: A, onBehalfOf: R },
  compoundV3Supply: { type: "compoundV3Supply", amount: "1000", comet: T, token: A },
  compoundV3Withdraw: { type: "compoundV3Withdraw", amount: "1000", comet: T, token: A },
  transfer: { type: "transfer", amount: "1000", token: A, recipient: R },
  approve: { type: "approve", amount: "1000", token: A, spender: T },
  permit2Approve: {
    type: "permit2Approve",
    amount: "1000",
    permit2: T,
    token: A,
    spender: B,
    expiration: D,
  },
  balanceOf: { type: "balanceOf", token: A },
  nativeBalance: { type: "nativeBalance" },
  argument: { type: "argument", name: "amount" },
};

/** A one-action program for `type` — or, for a source action, the action plus one that reads it. */
export function sampleProgram(type: ActionType, chainId = 1): ActionProgram {
  const sample = structuredClone(SAMPLES[type]) as Action;
  const reader: Action =
    type === "nativeBalance"
      ? { type: "wrapETH", weth: T }
      : { type: "approve", token: A, spender: T };
  const actions =
    sample.type === "balanceOf" || sample.type === "nativeBalance" || sample.type === "argument"
      ? [sample, reader]
      : [sample];

  return { version: 1, chainId, actions };
}
