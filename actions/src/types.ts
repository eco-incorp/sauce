// =============================================================================
// Routing Actions — concrete protocol-level operations that execute intents
// =============================================================================

type Address = `0x${string}`;
type Hex = `0x${string}`;

// =============================================================================
// CHAINING OPTIONS — shared by all actions
// =============================================================================

/** Chaining options shared by all actions. */
export interface ActionChainInput {
  /** Use a previously saved output as this action's amount. */
  amountRef?: string;
  /** Save this action's output amount to a named slot for later use. */
  saveOutputAs?: string;
}

/** Alias for actions that produce a capturable output (e.g. swaps). */
export interface ActionChainOptions extends ActionChainInput {}

// =============================================================================
// SWAP ACTIONS
// =============================================================================

/** UniswapV3 single-pool exact-input swap — use either amountOutMin or sqrtPriceLimitX96 */
interface UniswapV3ExactInputBase extends ActionChainOptions {
  type: "uniswapV3ExactInput";
  chainId: number;
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: 100 | 500 | 3000 | 10000;
  amountIn?: string;
  recipient: Address;
  deadline: number;
}

export type UniswapV3ExactInputAction =
  | (UniswapV3ExactInputBase & { amountOutMin: string; sqrtPriceLimitX96?: never })
  | (UniswapV3ExactInputBase & { sqrtPriceLimitX96: string; amountOutMin?: never });

/** UniswapV3 multi-hop exact-input swap (encoded path) */
export interface UniswapV3ExactInputMultiHopAction extends ActionChainOptions {
  type: "uniswapV3ExactInputMultiHop";
  chainId: number;
  router: Address;
  /** ABI-encoded path: token0 ++ fee ++ token1 ++ fee ++ token2 ... */
  path: Hex;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
  deadline: number;
}

/** UniswapV4 single-pool exact-input swap via Universal Router */
export interface UniswapV4ExactInputAction extends ActionChainOptions {
  type: "uniswapV4ExactInput";
  chainId: number;
  router: Address;
  poolKey: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  zeroForOne: boolean;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** UniswapV4 multi-hop exact-input swap via Universal Router (PathKey path) */
export interface UniswapV4ExactInputMultiHopAction extends ActionChainOptions {
  type: "uniswapV4ExactInputMultiHop";
  chainId: number;
  router: Address;
  currencyIn: Address;
  path: Array<{
    intermediateCurrency: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  }>;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** Curve stable/crypto pool swap (uses exchange with receiver overload) */
export interface CurveSwapAction extends ActionChainOptions {
  type: "curveSwap";
  chainId: number;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** Index of input token in the pool */
  i: number;
  /** Index of output token in the pool */
  j: number;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** BalancerV2 single swap */
export interface BalancerV2SwapAction extends ActionChainOptions {
  type: "balancerV2Swap";
  chainId: number;
  vault: Address;
  poolId: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
  deadline: number;
}

/** BalancerV2 batch swap (multi-hop through multiple pools) */
export interface BalancerV2BatchSwapAction extends ActionChainInput {
  type: "balancerV2BatchSwap";
  chainId: number;
  vault: Address;
  steps: Array<{
    poolId: Hex;
    assetInIndex: number;
    assetOutIndex: number;
    amount: string;
  }>;
  assets: Address[];
  amountOutMin: string;
  recipient: Address;
  deadline: number;
}

/** UniswapV2 exact-input swap via V2 Router */
export interface UniswapV2SwapAction extends ActionChainOptions {
  type: "uniswapV2Swap";
  chainId: number;
  router: Address;
  amountIn?: string;
  amountOutMin: string;
  /** Token addresses defining the swap route */
  path: Address[];
  recipient: Address;
  deadline: number;
}

/** Curve RouterNG multi-hop swap (up to 5 hops) */
export interface CurveRouterNGSwapAction extends ActionChainOptions {
  type: "curveRouterNGSwap";
  chainId: number;
  router: Address;
  /** Routing path (up to 11 entries) */
  route: Address[];
  /** Per-swap params: [i, j, swap_type, pool_type, n_coins] */
  swapParams: [number, number, number, number, number][];
  amountIn?: string;
  amountOutMin: string;
  /** Actual pool addresses when using zaps */
  pools: Address[];
  recipient: Address;
}

/** BalancerV3 single-token exact-input swap via Router */
export interface BalancerV3SwapAction extends ActionChainOptions {
  type: "balancerV3Swap";
  chainId: number;
  router: Address;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn?: string;
  amountOutMin: string;
  deadline: number;
  wethIsEth: boolean;
}

/** Ambient (CrocSwap) swap via userCmd */
export interface AmbientSwapAction extends ActionChainOptions {
  type: "ambientSwap";
  chainId: number;
  dex: Address;
  base: Address;
  quote: Address;
  poolIdx: number;
  isBuy: boolean;
  inBaseQty: boolean;
  amountIn?: string;
  tip: number;
  limitPrice: string;
  minOut: string;
  reserveFlags: number;
}

/** DODO token-to-token swap via DODOProxy (supports V1 Classical and V2 pools) */
export interface DODOSwapAction extends ActionChainOptions {
  type: "dodoSwap";
  chainId: number;
  proxy: Address;
  fromToken: Address;
  toToken: Address;
  amountIn?: string;
  amountOutMin: string;
  dodoPairs: Address[];
  directions: number;
  deadline: number;
  // Pool generation: "v2" (default) uses dodoSwapV2TokenToToken; "v1" routes
  // legacy Classical pairs (e.g. 0x75c23271661d9d143DCb617222BC4BEc783eFf34)
  // through dodoSwapV1.
  version?: "v1" | "v2";
}

/** Maverick V2 exact-input single swap */
export interface MaverickSwapAction extends ActionChainOptions {
  type: "maverickSwap";
  chainId: number;
  router: Address;
  pool: Address;
  tokenAIn: boolean;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** Maverick V2 exact-input multi-hop swap */
export interface MaverickMultiHopSwapAction extends ActionChainOptions {
  type: "maverickMultiHopSwap";
  chainId: number;
  router: Address;
  /** Encoded path of pools and token directions */
  path: Hex;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** Carbon (Bancor) trade by source amount */
export interface CarbonSwapAction extends ActionChainOptions {
  type: "carbonSwap";
  chainId: number;
  controller: Address;
  sourceToken: Address;
  targetToken: Address;
  tradeActions: Array<{ strategyId: string; amount: string }>;
  amountIn?: string;
  amountOutMin: string;
  deadline: number;
}

/** Fraxswap exact-input swap (UniV2-compatible router) */
export interface FraxswapSwapAction extends ActionChainOptions {
  type: "fraxswapSwap";
  chainId: number;
  router: Address;
  amountIn?: string;
  amountOutMin: string;
  path: Address[];
  recipient: Address;
  deadline: number;
}

/** Clipper sellTokenForToken swap */
export interface ClipperSwapAction extends ActionChainOptions {
  type: "clipperSwap";
  chainId: number;
  exchange: Address;
  inputToken: Address;
  outputToken: Address;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
  auxiliaryData: Hex;
}

/** Integral SIZE delayed sell order */
export interface IntegralSwapAction extends ActionChainOptions {
  type: "integralSwap";
  chainId: number;
  delay: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn?: string;
  amountOutMin: string;
  wrapUnwrap: boolean;
  recipient: Address;
  gasLimit: string;
  submitDeadline: number;
}

/** Fluid DEX T1 pool swap (swapIn) */
export interface FluidDexT1SwapAction extends ActionChainOptions {
  type: "fluidDexT1Swap";
  chainId: number;
  pool: Address;
  swap0to1: boolean;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

/** Fluid DEX Lite singleton swap (swapSingle) */
export interface FluidDexLiteSwapAction extends ActionChainOptions {
  type: "fluidDexLiteSwap";
  chainId: number;
  dex: Address;
  token0: Address;
  token1: Address;
  salt: Hex;
  swap0To1: boolean;
  amountIn?: string;
  amountOutMin: string;
  recipient: Address;
}

export type SwapAction =
  | UniswapV3ExactInputAction
  | UniswapV3ExactInputMultiHopAction
  | UniswapV4ExactInputAction
  | UniswapV4ExactInputMultiHopAction
  | CurveSwapAction
  | CurveRouterNGSwapAction
  | BalancerV2SwapAction
  | BalancerV2BatchSwapAction
  | BalancerV3SwapAction
  | UniswapV2SwapAction
  | AmbientSwapAction
  | DODOSwapAction
  | MaverickSwapAction
  | MaverickMultiHopSwapAction
  | CarbonSwapAction
  | FraxswapSwapAction
  | ClipperSwapAction
  | IntegralSwapAction
  | FluidDexT1SwapAction
  | FluidDexLiteSwapAction;

// =============================================================================
// BRIDGE ACTIONS
// =============================================================================

/** Across V3 bridge */
export interface AcrossBridgeAction extends ActionChainInput {
  type: "acrossBridge";
  srcChainId: number;
  destChainId: number;
  spokePool: Address;
  token: Address;
  amount?: string;
  relayerFeePct: string;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  message: Hex;
}

/** Stargate / LayerZero bridge */
export interface StargateBridgeAction extends ActionChainInput {
  type: "stargateBridge";
  srcChainId: number;
  destChainId: number;
  router: Address;
  token: Address;
  srcPoolId: number;
  dstPoolId: number;
  amount?: string;
  amountOutMin: string;
  /** Native fee for LayerZero messaging */
  lzFee: string;
}

/** Circle CCTP native USDC bridge */
export interface CCTPBridgeAction extends ActionChainInput {
  type: "cctpBridge";
  srcChainId: number;
  destChainId: number;
  tokenMessenger: Address;
  token: Address;
  srcDomain: number;
  destDomain: number;
  amount?: string;
  mintRecipient: Hex;
}

/** Hyperlane token bridge */
export interface HyperlaneBridgeAction extends ActionChainInput {
  type: "hyperlaneBridge";
  srcChainId: number;
  destChainId: number;
  router: Address;
  token: Address;
  amount?: string;
  /** Hyperlane destination domain identifier */
  destinationDomain: number;
  /** Interchain gas payment */
  gasPayment: string;
}

export type BridgeAction =
  | AcrossBridgeAction
  | StargateBridgeAction
  | CCTPBridgeAction
  | HyperlaneBridgeAction;

// =============================================================================
// WRAP / UNWRAP ACTIONS
// =============================================================================

/** Wrap ETH → WETH via deposit() */
export interface WrapETHAction extends ActionChainInput {
  type: "wrapETH";
  chainId: number;
  weth: Address;
  amount?: string;
}

/** Unwrap WETH → ETH via withdraw() */
export interface UnwrapETHAction extends ActionChainInput {
  type: "unwrapETH";
  chainId: number;
  weth: Address;
  amount?: string;
}

/** Wrap stETH → wstETH */
export interface WrapStETHAction extends ActionChainInput {
  type: "wrapStETH";
  chainId: number;
  wstETH: Address;
  stETHAmount?: string;
}

/** Unwrap wstETH → stETH */
export interface UnwrapStETHAction extends ActionChainInput {
  type: "unwrapStETH";
  chainId: number;
  wstETH: Address;
  wstETHAmount?: string;
}

export type WrapAction =
  | WrapETHAction
  | UnwrapETHAction
  | WrapStETHAction
  | UnwrapStETHAction;

// =============================================================================
// LIQUID STAKING ACTIONS
// =============================================================================

/** Lido: stake ETH → stETH via submit() */
export interface LidoStakeAction extends ActionChainInput {
  type: "lidoStake";
  chainId: number;
  stETH: Address;
  amount?: string;
  referral: Address;
}

/** Lido: request withdrawal stETH → ETH (async, not instant) */
export interface LidoUnstakeAction extends ActionChainInput {
  type: "lidoUnstake";
  chainId: number;
  withdrawalQueue: Address;
  stETHAmount?: string;
}

/** Rocket Pool: stake ETH → rETH */
export interface RocketPoolStakeAction extends ActionChainInput {
  type: "rocketPoolStake";
  chainId: number;
  rETH: Address;
  depositPool: Address;
  amount?: string;
}

/** Rocket Pool: burn rETH → ETH */
export interface RocketPoolUnstakeAction extends ActionChainInput {
  type: "rocketPoolUnstake";
  chainId: number;
  rETH: Address;
  amount?: string;
}

/** Coinbase: stake ETH → cbETH */
export interface CoinbaseStakeAction extends ActionChainInput {
  type: "coinbaseStake";
  chainId: number;
  cbETH: Address;
  amount?: string;
}

/** EtherFi: stake ETH → eETH */
export interface EtherFiStakeAction extends ActionChainInput {
  type: "etherFiStake";
  chainId: number;
  liquidityPool: Address;
  amount?: string;
}

export type StakeAction =
  | LidoStakeAction
  | LidoUnstakeAction
  | RocketPoolStakeAction
  | RocketPoolUnstakeAction
  | CoinbaseStakeAction
  | EtherFiStakeAction;

// =============================================================================
// LENDING / BORROWING ACTIONS
// =============================================================================

/** Aave V3: supply token into lending pool */
export interface AaveV3SupplyAction extends ActionChainInput {
  type: "aaveV3Supply";
  chainId: number;
  pool: Address;
  token: Address;
  amount?: string;
  onBehalfOf: Address;
  referralCode: number;
}

/** Aave V3: withdraw token from lending pool */
export interface AaveV3WithdrawAction extends ActionChainOptions {
  type: "aaveV3Withdraw";
  chainId: number;
  pool: Address;
  token: Address;
  amount?: string;
  to: Address;
}

/** Aave V3: borrow token against collateral */
export interface AaveV3BorrowAction extends ActionChainInput {
  type: "aaveV3Borrow";
  chainId: number;
  pool: Address;
  token: Address;
  amount?: string;
  /** 2 = variable rate */
  interestRateMode: 2;
  onBehalfOf: Address;
  referralCode: number;
}

/** Aave V3: repay borrowed token */
export interface AaveV3RepayAction extends ActionChainInput {
  type: "aaveV3Repay";
  chainId: number;
  pool: Address;
  token: Address;
  amount?: string;
  /** 2 = variable rate */
  interestRateMode: 2;
  onBehalfOf: Address;
}

/** Compound V3: supply token to Comet market */
export interface CompoundV3SupplyAction extends ActionChainInput {
  type: "compoundV3Supply";
  chainId: number;
  comet: Address;
  token: Address;
  amount?: string;
}

/** Compound V3: withdraw token from Comet market */
export interface CompoundV3WithdrawAction extends ActionChainInput {
  type: "compoundV3Withdraw";
  chainId: number;
  comet: Address;
  token: Address;
  amount?: string;
}

export type LendingAction =
  | AaveV3SupplyAction
  | AaveV3WithdrawAction
  | AaveV3BorrowAction
  | AaveV3RepayAction
  | CompoundV3SupplyAction
  | CompoundV3WithdrawAction;

// =============================================================================
// TRANSFER ACTION
// =============================================================================

/** Plain ERC-20 or native token transfer */
export interface TransferAction extends ActionChainInput {
  type: "transfer";
  chainId: number;
  token: Address;
  to: Address;
  amount?: string;
}

/** Approve ERC-20 spending */
export interface ApproveAction extends ActionChainInput {
  type: "approve";
  chainId: number;
  token: Address;
  spender: Address;
  amount?: string;
}

// =============================================================================
// ROUTING ACTION — discriminated union of all concrete actions
// =============================================================================

export type RoutingAction =
  | SwapAction
  | BridgeAction
  | WrapAction
  | StakeAction
  | LendingAction
  | TransferAction
  | ApproveAction;

// =============================================================================
// ROUTING STEP & PLAN — an ordered execution plan
// =============================================================================

/** A single step in a routing plan, with execution metadata */
export interface RoutingStep {
  /** Position in the execution sequence (0-based) */
  stepIndex: number;
  /** The concrete action to execute */
  action: RoutingAction;
  /** Which step's output feeds into this step (undefined for first step) */
  dependsOn?: number;
  /** Estimated gas for this step */
  estimatedGas?: string;
}

/** A full routing plan that fulfills one or more SauceIntents */
export interface RoutingPlan {
  /** Unique identifier for this plan */
  id: string;
  /** Ordered steps to execute */
  steps: RoutingStep[];
  /** Total estimated gas across all steps and chains */
  totalEstimatedGas: string;
  /** Timestamp when this plan expires */
  expiresAt: number;
  /** The final output amount after all steps */
  expectedAmountOut: string;
  /** Minimum acceptable output (slippage-adjusted) */
  minAmountOut: string;
}
