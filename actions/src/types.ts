/**
 * The action-program JSON document, as TypeScript. Every type here is exactly the JSON it
 * describes — `parseProgram` returns these, `serializeProgram` writes them — and nothing in it is
 * a function, a class instance or a `bigint`: amounts are base-10 strings.
 *
 * The shared vocabulary:
 *
 * - `amount` is what an action spends. Omit it (and `amountRef`) to spend the previous action's
 *   output; set `amountRef` to spend the output an earlier action saved with `saveOutputAs`.
 * - `amountOutMin` is the least output a venue may return before it reverts.
 * - `recipient` receives an action's output when nothing chains it; `"self"` is the executing Pot.
 */

type Address = `0x${string}`;
type Hex = `0x${string}`;

/** An address, or `"self"` for the executing Pot. */
export type Recipient = Address | "self";

/** A recipient on another chain: an address, or a 32-byte account for a non-EVM chain (Solana). */
export type RemoteRecipient = `0x${string}`;

/** An action that spends an amount, which may be chained from an earlier action. */
interface Spends {
  /** Base-10 integer string. Omit to spend the previous action's output. */
  amount?: string;
  /** Spend the output an earlier action saved under this name. */
  amountRef?: string;
  /** Save this action's output under a name later actions can reference. */
  saveOutputAs?: string;
}

/** An action whose amounts are all explicit in its own fields. */
interface Explicit {
  saveOutputAs?: string;
}

// =============================================================================
// Swaps through `@sauce/router` — one pool each, one implementation per venue
// =============================================================================

/**
 * One Uniswap V2 pair, or a fork's (`@sauce/router`'s `uniswapV2`): priced from its reserves, paid
 * by a push, swapped directly. The direction is the pair's sort order.
 */
export interface UniswapV2SwapAction extends Spends {
  type: "uniswapV2Swap";
  /** The pair. */
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** The pair's LP fee in parts per million; absent (or 0) is 3000. PancakeSwap V2 is 2500. */
  feePpm?: number;
  amountOutMin: string;
  recipient: Recipient;
}

/** One Uniswap V3 pool, or a fork's, through the Pot's Router (`@sauce/router`'s `uniswapV3`). */
export interface UniswapV3SwapAction extends Spends {
  type: "uniswapV3Swap";
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** A price at which the swap stops; absent or `"0"` for none. */
  sqrtPriceLimitX96?: string;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * One Uniswap V4 pool, through the Pot's Router (`@sauce/router`'s `uniswapV4`). The pool key is
 * `tokenIn` and `tokenOut` in sort order with `fee`, `tickSpacing` and `hooks`; native ETH is the
 * zero address.
 */
export interface UniswapV4SwapAction extends Spends {
  type: "uniswapV4Swap";
  poolManager: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  /** A price at which the swap stops; absent or `"0"` for none. */
  sqrtPriceLimitX96?: string;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * A Curve pool's 4-argument `exchange` (`@sauce/router`'s `curve`), approved for exactly the input;
 * the output is the `tokenOut` balance delta.
 */
export interface CurveSwapAction extends Spends {
  type: "curveSwap";
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  i: number;
  j: number;
  /** `"int128"` for StableSwap and NG pools, `"uint256"` for CryptoSwap pools. */
  indexType: "int128" | "uint256";
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * One Balancer V2 pool, through its Vault (`@sauce/router`'s `balancerV2`), approved for exactly the
 * input.
 */
export interface BalancerV2SwapAction extends Spends {
  type: "balancerV2Swap";
  vault: Address;
  poolId: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * A DODO V2 pool — DVM, DPP or DSP — paid by a push (`@sauce/router`'s `dodoV2`). `tokenIn` and
 * `tokenOut` must be the pool's base and quote tokens, in either order.
 */
export interface DodoV2SwapAction extends Spends {
  type: "dodoV2Swap";
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** The pool's `_BASE_TOKEN_()`. */
  baseToken: Address;
  /** The pool's `_QUOTE_TOKEN_()`. */
  quoteToken: Address;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * A Trader Joe Liquidity Book pair, paid by a push (`@sauce/router`'s `traderJoeLB`). `tokenIn` and
 * `tokenOut` must be the pair's X and Y tokens, in either order.
 */
export interface TraderJoeLBSwapAction extends Spends {
  type: "traderJoeLBSwap";
  /** The pair. */
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** The pair's `getTokenX()`. */
  tokenX: Address;
  /** The pair's `getTokenY()`. */
  tokenY: Address;
  amountOutMin: string;
  recipient: Recipient;
}

/** WOOFi's WooPPV2 itself, paid by a push (`@sauce/router`'s `woofi`). */
export interface WoofiSwapAction extends Spends {
  type: "woofiSwap";
  /** The WooPPV2, not the WooRouterV2. */
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  /** Required and positive: the pool prices from an oracle. */
  amountOutMin: string;
  recipient: Recipient;
}

/** One Maverick V2 pool, through the Pot's Router (`@sauce/router`'s `maverickV2`). */
export interface MaverickV2SwapAction extends Spends {
  type: "maverickV2Swap";
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountOutMin: string;
  recipient: Recipient;
}

// =============================================================================
// Swaps at venues `@sauce/router` does not cover
// =============================================================================

/** A Curve RouterNG route of up to five hops. */
export interface CurveRouterNGSwapAction extends Spends {
  type: "curveRouterNGSwap";
  router: Address;
  route: Address[];
  /** Per hop: [i, j, swap_type, pool_type, n_coins]. */
  swapParams: [number, number, number, number, number][];
  pools: Address[];
  amountOutMin: string;
  recipient: Recipient;
}

export interface BalancerV2BatchStep {
  poolId: Hex;
  assetInIndex: number;
  assetOutIndex: number;
  /** The step's input; `"0"` spends the previous step's output. */
  amount: string;
}

/** A Balancer V2 batch across pools; the output is the last step's asset delta. */
export interface BalancerV2BatchSwapAction extends Explicit {
  type: "balancerV2BatchSwap";
  vault: Address;
  steps: BalancerV2BatchStep[];
  assets: Address[];
  amountOutMin: string;
  recipient: Recipient;
  deadline: number;
}

/** One Balancer V3 pool. The router pulls through Permit2: `permit2Approve` it first. */
export interface BalancerV3SwapAction extends Spends {
  type: "balancerV3Swap";
  router: Address;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountOutMin: string;
  deadline: number;
  wethIsEth: boolean;
}

/** An Ambient (CrocSwap) pool; the output is the received token's balance delta. */
export interface AmbientSwapAction extends Spends {
  type: "ambientSwap";
  dex: Address;
  base: Address;
  quote: Address;
  poolIdx: number;
  isBuy: boolean;
  inBaseQty: boolean;
  tip: number;
  limitPrice: string;
  amountOutMin: string;
  reserveFlags: number;
}

/** Legacy DODO V1 (Classical) pairs, through the DODO proxy; approvals go to DODOApprove. */
export interface DodoV1SwapAction extends Spends {
  type: "dodoV1Swap";
  proxy: Address;
  tokenIn: Address;
  tokenOut: Address;
  pairs: Address[];
  /** A bit per pair: 0 sells base, 1 sells quote. */
  directions: number;
  amountOutMin: string;
  deadline: number;
}

export interface CarbonTradeAction {
  strategyId: string;
  amount: string;
}

/** Carbon strategies, by source amount; the controller pays the Pot. */
export interface CarbonSwapAction extends Explicit {
  type: "carbonSwap";
  controller: Address;
  sourceToken: Address;
  targetToken: Address;
  tradeActions: CarbonTradeAction[];
  amountOutMin: string;
  deadline: number;
}

/** A Fraxswap path; the output is the last token's balance delta. */
export interface FraxswapSwapAction extends Spends {
  type: "fraxswapSwap";
  router: Address;
  path: Address[];
  amountOutMin: string;
  recipient: Recipient;
  deadline: number;
}

/** A Fluid DEX T1 pool, selling its ERC-20 side. */
export interface FluidDexT1SwapAction extends Spends {
  type: "fluidDexT1Swap";
  pool: Address;
  swap0to1: boolean;
  amountOutMin: string;
  recipient: Recipient;
}

/** A swap that `@sauce/router` implements: one pool, at one of its nine venues. */
export type RouterSwapAction =
  | UniswapV2SwapAction
  | UniswapV3SwapAction
  | UniswapV4SwapAction
  | CurveSwapAction
  | BalancerV2SwapAction
  | DodoV2SwapAction
  | TraderJoeLBSwapAction
  | WoofiSwapAction
  | MaverickV2SwapAction;

export type SwapAction =
  | RouterSwapAction
  | CurveRouterNGSwapAction
  | BalancerV2BatchSwapAction
  | BalancerV3SwapAction
  | AmbientSwapAction
  | DodoV1SwapAction
  | CarbonSwapAction
  | FraxswapSwapAction
  | FluidDexT1SwapAction;

// =============================================================================
// Bridges — the program's chain is the source
// =============================================================================

/** Across: deposit for the same token on the destination, less the relayer fee. */
export interface AcrossBridgeAction extends Spends {
  type: "acrossBridge";
  spokePool: Address;
  token: Address;
  destChainId: number;
  /** Receives on the destination. */
  recipient: Address;
  /** Taken by the relayer: the destination receives `amount - relayerFee`. */
  relayerFee: string;
  quoteTimestamp: number;
  fillDeadline: number;
  exclusivityDeadline: number;
  message: Hex;
}

/** Stargate V2: send from a StargatePool, paying the LayerZero fee it quotes on-chain. */
export interface StargateBridgeAction extends Spends {
  type: "stargateBridge";
  pool: Address;
  /** The destination LayerZero endpoint id. */
  dstEid: number;
  recipient: RemoteRecipient;
  amountOutMin: string;
}

/** Circle CCTP V2: burn USDC for minting on the destination. */
export interface CCTPBridgeAction extends Spends {
  type: "cctpBridge";
  tokenMessenger: Address;
  token: Address;
  destinationDomain: number;
  recipient: RemoteRecipient;
  /** The most the transfer may pay in fees, from the amount; default `"0"`. */
  maxFee?: string;
  /** 2000 finalized (standard, the default), 1000 confirmed (fast). */
  minFinalityThreshold?: number;
}

/** A Hyperlane warp route: `transferRemote`, paying the interchain gas it quotes on-chain. */
export interface HyperlaneBridgeAction extends Spends {
  type: "hyperlaneBridge";
  router: Address;
  destinationDomain: number;
  recipient: RemoteRecipient;
}

export type BridgeAction =
  AcrossBridgeAction | StargateBridgeAction | CCTPBridgeAction | HyperlaneBridgeAction;

// =============================================================================
// Wrapping and staking
// =============================================================================

export interface WrapETHAction extends Spends {
  type: "wrapETH";
  weth: Address;
}

export interface UnwrapETHAction extends Spends {
  type: "unwrapETH";
  weth: Address;
}

/** stETH to wstETH; wstETH pulls the stETH, so approve it first. */
export interface WrapStETHAction extends Spends {
  type: "wrapStETH";
  wstETH: Address;
}

export interface UnwrapStETHAction extends Spends {
  type: "unwrapStETH";
  wstETH: Address;
}

export interface LidoStakeAction extends Spends {
  type: "lidoStake";
  stETH: Address;
  /** Lido's referral; default the zero address. */
  referral?: Address;
}

/** Requests a withdrawal of stETH; the queue pulls it, so approve it first. */
export interface LidoUnstakeAction extends Spends {
  type: "lidoUnstake";
  withdrawalQueue: Address;
  /** Receives the withdrawal NFT, which claims the ETH once finalized. */
  owner: Recipient;
}

export interface RocketPoolStakeAction extends Spends {
  type: "rocketPoolStake";
  /** The live RocketDepositPool — Rocket Pool upgrades move it; read it from RocketStorage. */
  depositPool: Address;
  /** The rETH token, whose balance delta is the output. */
  rETH: Address;
}

export interface RocketPoolUnstakeAction extends Spends {
  type: "rocketPoolUnstake";
  rETH: Address;
}

export interface EtherFiStakeAction extends Spends {
  type: "etherFiStake";
  liquidityPool: Address;
  /** The eETH token, whose balance delta is the output. */
  eETH: Address;
}

export type WrapAction = WrapETHAction | UnwrapETHAction | WrapStETHAction | UnwrapStETHAction;

export type StakeAction =
  | LidoStakeAction
  | LidoUnstakeAction
  | RocketPoolStakeAction
  | RocketPoolUnstakeAction
  | EtherFiStakeAction;

// =============================================================================
// Lending
// =============================================================================

export interface AaveV3SupplyAction extends Spends {
  type: "aaveV3Supply";
  pool: Address;
  token: Address;
  onBehalfOf: Recipient;
  referralCode?: number;
}

/** Withdraws from Aave V3; the output is the amount withdrawn. */
export interface AaveV3WithdrawAction extends Spends {
  type: "aaveV3Withdraw";
  pool: Address;
  token: Address;
  recipient: Recipient;
}

/** Borrows at the variable rate, the only rate Aave V3 offers. */
export interface AaveV3BorrowAction extends Spends {
  type: "aaveV3Borrow";
  pool: Address;
  token: Address;
  onBehalfOf: Recipient;
  referralCode?: number;
}

export interface AaveV3RepayAction extends Spends {
  type: "aaveV3Repay";
  pool: Address;
  token: Address;
  onBehalfOf: Recipient;
}

export interface CompoundV3SupplyAction extends Spends {
  type: "compoundV3Supply";
  comet: Address;
  token: Address;
}

export interface CompoundV3WithdrawAction extends Spends {
  type: "compoundV3Withdraw";
  comet: Address;
  token: Address;
}

export type LendingAction =
  | AaveV3SupplyAction
  | AaveV3WithdrawAction
  | AaveV3BorrowAction
  | AaveV3RepayAction
  | CompoundV3SupplyAction
  | CompoundV3WithdrawAction;

// =============================================================================
// Tokens
// =============================================================================

export interface TransferAction extends Spends {
  type: "transfer";
  token: Address;
  recipient: Recipient;
}

export interface ApproveAction extends Spends {
  type: "approve";
  token: Address;
  spender: Address;
}

/**
 * A Permit2 allowance, for spenders that pull through Permit2 (Balancer V3's router, Uniswap's
 * Universal Router). The token must also be ERC-20-approved to Permit2 itself.
 */
export interface Permit2ApproveAction extends Spends {
  type: "permit2Approve";
  /** Permit2 — 0x000000000022D473030F116dDEE9F6B43aC78BA3 on every chain Uniswap deploys it. */
  permit2: Address;
  token: Address;
  spender: Address;
  /** Unix seconds after which the allowance lapses. */
  expiration: number;
}

export type TokenAction = TransferAction | ApproveAction | Permit2ApproveAction;

// =============================================================================
// Sources — produce a value, move nothing
// =============================================================================

/** The Pot's balance of `token` when the program reaches this action. */
export interface BalanceOfAction extends Explicit {
  type: "balanceOf";
  token: Address;
}

/** The Pot's native balance when the program reaches this action. */
export interface NativeBalanceAction extends Explicit {
  type: "nativeBalance";
}

/** A runtime argument of the compiled program: `main(<name>: Uint256)`. Standalone programs only. */
export interface ArgumentAction extends Explicit {
  type: "argument";
  name: string;
}

export type SourceAction = BalanceOfAction | NativeBalanceAction | ArgumentAction;

// =============================================================================
// The document
// =============================================================================

export type Action =
  SwapAction | BridgeAction | WrapAction | StakeAction | LendingAction | TokenAction | SourceAction;

export type ActionType = Action["type"];

/** An action program: the chain it executes on, and its actions in order. */
export interface ActionProgram {
  /** Format version; `1`. */
  version: 1;
  /** The chain every action executes on. A bridge's destination is its own field. */
  chainId: number;
  actions: Action[];
}
