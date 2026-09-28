/**
 * One valid instance of every action type, in JSON form (no `chainId`, which a program supplies),
 * for the suites that need the whole catalogue. NOT a `.test.ts`.
 */
import type { RoutingAction, RoutingActionType } from "../src/types.js";

const T = "0x2000000000000000000000000000000000000001";
const A = "0x1000000000000000000000000000000000000001";
const B = "0x1000000000000000000000000000000000000002";
const R = "0x3000000000000000000000000000000000000001";
const ZERO = "0x0000000000000000000000000000000000000000";
const B32 = `0x${"ab".repeat(32)}`;
const D = 9_999_999_999;

type Sample = Record<string, unknown> & { type: RoutingActionType };

export const SAMPLES: Record<RoutingActionType, Sample> = {
  uniswapV3ExactInput: {
    type: "uniswapV3ExactInput",
    router: T,
    tokenIn: A,
    tokenOut: B,
    fee: 500,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
    deadline: D,
  },
  uniswapV3ExactInputMultiHop: {
    type: "uniswapV3ExactInputMultiHop",
    router: T,
    path: `${A}0001f4${B.slice(2)}`,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: "self",
    deadline: D,
  },
  uniswapV4ExactInput: {
    type: "uniswapV4ExactInput",
    router: T,
    poolKey: { currency0: A, currency1: B, fee: 500, tickSpacing: 10, hooks: ZERO },
    zeroForOne: true,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  uniswapV4ExactInputMultiHop: {
    type: "uniswapV4ExactInputMultiHop",
    router: T,
    currencyIn: A,
    path: [{ intermediateCurrency: B, fee: 500, tickSpacing: 10, hooks: ZERO }],
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  curveSwap: {
    type: "curveSwap",
    pool: T,
    tokenIn: A,
    tokenOut: B,
    i: 1,
    j: 2,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  curveRouterNGSwap: {
    type: "curveRouterNGSwap",
    router: T,
    route: [A, T, B],
    swapParams: [[1, 2, 1, 1, 3]],
    amountIn: "1000",
    amountOutMin: "1",
    pools: [],
    recipient: R,
  },
  balancerV2Swap: {
    type: "balancerV2Swap",
    vault: T,
    poolId: B32,
    tokenIn: A,
    tokenOut: B,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
    deadline: D,
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
    router: T,
    pool: A,
    tokenIn: A,
    tokenOut: B,
    amountIn: "1000",
    amountOutMin: "1",
    deadline: D,
    wethIsEth: false,
  },
  uniswapV2Swap: {
    type: "uniswapV2Swap",
    router: T,
    amountIn: "1000",
    amountOutMin: "1",
    path: [A, B],
    recipient: R,
    deadline: D,
  },
  ambientSwap: {
    type: "ambientSwap",
    dex: T,
    base: A,
    quote: B,
    poolIdx: 420,
    isBuy: true,
    inBaseQty: true,
    amountIn: "1000",
    tip: 0,
    limitPrice: "1",
    minOut: "1",
    reserveFlags: 0,
  },
  dodoSwap: {
    type: "dodoSwap",
    proxy: T,
    fromToken: A,
    toToken: B,
    amountIn: "1000",
    amountOutMin: "1",
    dodoPairs: [T],
    directions: 0,
    deadline: D,
    version: "v1",
  },
  maverickSwap: {
    type: "maverickSwap",
    router: T,
    pool: A,
    tokenAIn: true,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  maverickMultiHopSwap: {
    type: "maverickMultiHopSwap",
    router: T,
    path: "0xabcd",
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  carbonSwap: {
    type: "carbonSwap",
    controller: T,
    sourceToken: A,
    targetToken: B,
    tradeActions: [{ strategyId: "340282366920938463463374607431768211457", amount: "1000" }],
    amountIn: "1000",
    amountOutMin: "1",
    deadline: D,
  },
  fraxswapSwap: {
    type: "fraxswapSwap",
    router: T,
    amountIn: "1000",
    amountOutMin: "1",
    path: [A, B],
    recipient: R,
    deadline: D,
  },
  clipperSwap: {
    type: "clipperSwap",
    exchange: T,
    inputToken: A,
    outputToken: B,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
    auxiliaryData: "0x",
  },
  integralSwap: {
    type: "integralSwap",
    delay: T,
    tokenIn: A,
    tokenOut: B,
    amountIn: "1000",
    amountOutMin: "1",
    wrapUnwrap: false,
    recipient: R,
    gasLimit: "400000",
    submitDeadline: 1_700_000_000,
  },
  fluidDexT1Swap: {
    type: "fluidDexT1Swap",
    pool: T,
    swap0to1: true,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  fluidDexLiteSwap: {
    type: "fluidDexLiteSwap",
    dex: T,
    token0: A,
    token1: B,
    salt: B32,
    swap0To1: true,
    amountIn: "1000",
    amountOutMin: "1",
    recipient: R,
  },
  acrossBridge: {
    type: "acrossBridge",
    destChainId: 10,
    spokePool: T,
    token: A,
    amount: "1000",
    relayerFeePct: "0",
    quoteTimestamp: 1,
    fillDeadline: 2,
    exclusivityDeadline: 0,
    message: "0x",
  },
  stargateBridge: {
    type: "stargateBridge",
    destChainId: 110,
    router: T,
    token: A,
    srcPoolId: 1,
    dstPoolId: 1,
    amount: "1000",
    amountOutMin: "1",
    lzFee: "7",
  },
  cctpBridge: {
    type: "cctpBridge",
    destChainId: 10,
    tokenMessenger: T,
    token: A,
    srcDomain: 0,
    destDomain: 2,
    amount: "1000",
    mintRecipient: B32,
  },
  hyperlaneBridge: {
    type: "hyperlaneBridge",
    destChainId: 10,
    router: T,
    token: A,
    amount: "1000",
    destinationDomain: 10,
    gasPayment: "9",
  },
  wrapETH: { type: "wrapETH", weth: T, amount: "1000" },
  unwrapETH: { type: "unwrapETH", weth: T, amount: "1000" },
  wrapStETH: { type: "wrapStETH", wstETH: T, stETHAmount: "1000" },
  unwrapStETH: { type: "unwrapStETH", wstETH: T, wstETHAmount: "1000" },
  lidoStake: { type: "lidoStake", stETH: T, amount: "1000", referral: ZERO },
  lidoUnstake: { type: "lidoUnstake", withdrawalQueue: T, stETHAmount: "1000" },
  rocketPoolStake: { type: "rocketPoolStake", rETH: A, depositPool: T, amount: "1000" },
  rocketPoolUnstake: { type: "rocketPoolUnstake", rETH: T, amount: "1000" },
  coinbaseStake: { type: "coinbaseStake", cbETH: T, amount: "1000" },
  etherFiStake: { type: "etherFiStake", liquidityPool: T, amount: "1000" },
  aaveV3Supply: {
    type: "aaveV3Supply",
    pool: T,
    token: A,
    amount: "1000",
    onBehalfOf: "self",
    referralCode: 0,
  },
  aaveV3Withdraw: { type: "aaveV3Withdraw", pool: T, token: A, amount: "1000", to: R },
  aaveV3Borrow: {
    type: "aaveV3Borrow",
    pool: T,
    token: A,
    amount: "1000",
    interestRateMode: 2,
    onBehalfOf: R,
    referralCode: 0,
  },
  aaveV3Repay: {
    type: "aaveV3Repay",
    pool: T,
    token: A,
    amount: "1000",
    interestRateMode: 2,
    onBehalfOf: R,
  },
  compoundV3Supply: { type: "compoundV3Supply", comet: T, token: A, amount: "1000" },
  compoundV3Withdraw: { type: "compoundV3Withdraw", comet: T, token: A, amount: "1000" },
  transfer: { type: "transfer", token: A, to: R, amount: "1000" },
  approve: { type: "approve", token: A, spender: T, amount: "1000" },
  balanceOf: { type: "balanceOf", token: A },
  nativeBalance: { type: "nativeBalance" },
  argument: { type: "argument", name: "amount" },
};

/** A one-action program for `type` — or, for a source action, the action plus one that reads it. */
export function sampleProgram(type: RoutingActionType, chainId = 1): Record<string, unknown> {
  const sample = SAMPLES[type];
  const reader =
    type === "nativeBalance"
      ? { type: "wrapETH", weth: T }
      : { type: "approve", token: A, spender: T };
  const actions =
    sample.type === "balanceOf" || sample.type === "nativeBalance" || sample.type === "argument"
      ? [sample, reader]
      : [sample];

  return { version: 1, chainId, actions: structuredClone(actions) };
}

/** Every sample as a typed action on `chainId`. */
export function sampleAction(type: RoutingActionType, chainId = 1): RoutingAction {
  const sample = structuredClone(SAMPLES[type]);
  const field = type.endsWith("Bridge") ? "srcChainId" : "chainId";

  return { ...sample, [field]: chainId } as unknown as RoutingAction;
}
