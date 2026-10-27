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
 * - `recipient` receives an action's output when nothing chains it; `"pot"` is the executing Pot.
 * - A token is a registry symbol (`"USDC"`, or a tokenized stock's, its issuer's ticker:
 *   `"SPCXc"`) or an address, and a protocol contract a namespace
 *   reference (`"UniswapV3.Factory"`) or an address. A document that names everything, and has no
 *   `chainId`, compiles for any chain where its names exist.
 */

type Address = `0x${string}`;
type Hex = `0x${string}`;

/**
 * A registry token symbol — `"USDC"`, `"WETH"` — in the spelling a Sauce program uses. It is the
 * program global of that name, so it resolves on the chain the program is compiled for, and
 * compiling for a chain that does not register it fails, naming the chain and the symbol.
 */
export type TokenSymbol = string;

/** A token: a registry symbol, or an address. */
export type Token = Address | TokenSymbol;

/** A token, or `"native"`: the venue's marker for the chain's native currency (the zero address). */
export type TokenOrNative = Token | "native";

/**
 * A protocol contract by namespace — `"UniswapV3.Factory"`, `"BalancerV2.Vault"` — in the spelling
 * a Sauce program uses. Like a symbol, it resolves on the chain the program is compiled for.
 */
export type ContractName = `${string}.${string}`;

/** A protocol contract: a namespace reference, or an address. */
export type Contract = Address | ContractName;

/** A contract that is also a token (WETH, wstETH, rETH): a symbol, a namespace reference or an address. */
export type TokenContract = Token | ContractName;

/** An address, or `"pot"` for the executing Pot. */
export type Recipient = Address | "pot";

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
 * by a push, swapped directly. The direction is the pair's sort order. The pair is `pool`, or the
 * one `factory.getPair(tokenIn, tokenOut)` names, read on chain.
 */
export type UniswapV2SwapAction = Spends & {
  type: "uniswapV2Swap";
  tokenIn: Token;
  tokenOut: Token;
  /** The pair's LP fee in parts per million; absent (or 0) is 3000. PancakeSwap V2 is 2500. */
  feePpm?: number;
  amountOutMin: string;
  recipient: Recipient;
} & (
    | {
        /** The pair. */
        pool: Contract;
        factory?: never;
      }
    | {
        /** A Uniswap V2-style factory (`"UniswapV2.Factory"`). */
        factory: Contract;
        pool?: never;
      }
  );

/**
 * One Uniswap V3 pool, or a fork's, through the Pot's Router (`@sauce/router`'s `uniswapV3`). The
 * pool is `pool`, or the one `factory.getPool(tokenIn, tokenOut, fee)` names — `tickSpacing` in
 * place of `fee` for Aerodrome Slipstream — read on chain.
 */
export type UniswapV3SwapAction = Spends & {
  type: "uniswapV3Swap";
  tokenIn: Token;
  tokenOut: Token;
  /** A price at which the swap stops; absent or `"0"` for none. */
  sqrtPriceLimitX96?: string;
  amountOutMin: string;
  recipient: Recipient;
} & (
    | { pool: Contract; factory?: never; fee?: never; tickSpacing?: never }
    | {
        /** A Uniswap V3-style factory (`"UniswapV3.Factory"`, `"PancakeswapV3.Factory"`). */
        factory: Contract;
        /** The pool's fee tier, in hundredths of a bip. */
        fee: number;
        pool?: never;
        tickSpacing?: never;
      }
    | {
        /** Aerodrome Slipstream's factory (`"AerodromeSlipstream.CLFactory"`). */
        factory: Contract;
        tickSpacing: number;
        pool?: never;
        fee?: never;
      }
  );

/**
 * One Uniswap V4 pool, through the Pot's Router (`@sauce/router`'s `uniswapV4`). A V4 pool has no
 * address: it is its key, `tokenIn` and `tokenOut` in sort order with `fee`, `tickSpacing` and
 * `hooks`. `"native"` is the native currency, which V4 keys as the zero address.
 */
export interface UniswapV4SwapAction extends Spends {
  type: "uniswapV4Swap";
  poolManager: Contract;
  tokenIn: TokenOrNative;
  tokenOut: TokenOrNative;
  fee: number;
  tickSpacing: number;
  /** The pool key's hooks contract; absent for a pool with none. */
  hooks?: Contract;
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
  pool: Contract;
  tokenIn: Token;
  tokenOut: Token;
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
  vault: Contract;
  poolId: Hex;
  tokenIn: Token;
  tokenOut: Token;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * A DODO V2 pool — DVM, DPP or DSP — paid by a push (`@sauce/router`'s `dodoV2`). `tokenIn` and
 * `tokenOut` must be the pool's base and quote tokens, in either order.
 */
export interface DodoV2SwapAction extends Spends {
  type: "dodoV2Swap";
  pool: Contract;
  tokenIn: Token;
  tokenOut: Token;
  /** The pool's `_BASE_TOKEN_()`. */
  baseToken: Token;
  /** The pool's `_QUOTE_TOKEN_()`. */
  quoteToken: Token;
  amountOutMin: string;
  recipient: Recipient;
}

/**
 * A Trader Joe Liquidity Book pair, paid by a push (`@sauce/router`'s `traderJoeLB`). The pair is
 * `pool`, or the one `factory.getLBPairInformation(tokenIn, tokenOut, binStep)` names, read on
 * chain. `tokenIn` and `tokenOut` must be its X and Y tokens, in either order; leave `tokenX` and
 * `tokenY` out to read them from the pair.
 */
export type TraderJoeLBSwapAction = Spends & {
  type: "traderJoeLBSwap";
  tokenIn: Token;
  tokenOut: Token;
  amountOutMin: string;
  recipient: Recipient;
} & (
    | {
        /** The pair. */
        pool: Contract;
        factory?: never;
        binStep?: never;
      }
    | {
        /** The LBFactory (`"TraderJoe.LBFactory"`). */
        factory: Contract;
        binStep: number;
        pool?: never;
      }
  ) &
  (
    | {
        /** The pair's `getTokenX()`. */
        tokenX: Token;
        /** The pair's `getTokenY()`. */
        tokenY: Token;
      }
    | { tokenX?: never; tokenY?: never }
  );

/** WOOFi's WooPPV2 itself, paid by a push (`@sauce/router`'s `woofi`). */
export interface WoofiSwapAction extends Spends {
  type: "woofiSwap";
  /** The WooPPV2, not the WooRouterV2. */
  pool: Contract;
  tokenIn: Token;
  tokenOut: Token;
  /** Required and positive: the pool prices from an oracle. */
  amountOutMin: string;
  recipient: Recipient;
}

/** One Maverick V2 pool, through the Pot's Router (`@sauce/router`'s `maverickV2`). */
export interface MaverickV2SwapAction extends Spends {
  type: "maverickV2Swap";
  pool: Contract;
  tokenIn: Token;
  tokenOut: Token;
  amountOutMin: string;
  recipient: Recipient;
}

// =============================================================================
// Swaps at venues `@sauce/router` does not cover
// =============================================================================

/** A Curve RouterNG route of up to five hops. */
export interface CurveRouterNGSwapAction extends Spends {
  type: "curveRouterNGSwap";
  router: Contract;
  route: TokenContract[];
  /** Per hop: [i, j, swap_type, pool_type, n_coins]. */
  swapParams: [number, number, number, number, number][];
  pools: Contract[];
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
  vault: Contract;
  steps: BalancerV2BatchStep[];
  assets: TokenOrNative[];
  amountOutMin: string;
  recipient: Recipient;
  deadline: number;
}

/**
 * One Balancer V3 pool. The router pulls through Permit2 (`permit2Approve` it first), except a WETH
 * input under `wethIsEth`, which the Pot pays as native ETH.
 */
export interface BalancerV3SwapAction extends Spends {
  type: "balancerV3Swap";
  router: Contract;
  pool: Contract;
  tokenIn: Token;
  tokenOut: Token;
  amountOutMin: string;
  deadline: number;
  wethIsEth: boolean;
}

/** An Ambient (CrocSwap) pool; the output is the received token's balance delta. */
export interface AmbientSwapAction extends Spends {
  type: "ambientSwap";
  dex: Contract;
  base: TokenOrNative;
  quote: Token;
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
  proxy: Contract;
  tokenIn: Token;
  tokenOut: Token;
  pairs: Contract[];
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
  controller: Contract;
  sourceToken: Token;
  targetToken: Token;
  tradeActions: CarbonTradeAction[];
  amountOutMin: string;
  deadline: number;
}

/** A Fraxswap path; the output is the last token's balance delta. */
export interface FraxswapSwapAction extends Spends {
  type: "fraxswapSwap";
  router: Contract;
  path: Token[];
  amountOutMin: string;
  recipient: Recipient;
  deadline: number;
}

/** A Fluid DEX T1 pool, selling its ERC-20 side. */
export interface FluidDexT1SwapAction extends Spends {
  type: "fluidDexT1Swap";
  pool: Contract;
  swap0to1: boolean;
  amountOutMin: string;
  recipient: Recipient;
}

/** A swap that `@sauce/router` implements: one pool, at one of its venues. */
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
  spokePool: Contract;
  token: Token;
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
  pool: Contract;
  /** The destination LayerZero endpoint id. */
  dstEid: number;
  recipient: RemoteRecipient;
  amountOutMin: string;
}

/** Circle CCTP V2: burn USDC for minting on the destination. */
export interface CCTPBridgeAction extends Spends {
  type: "cctpBridge";
  tokenMessenger: Contract;
  token: Token;
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
  router: Contract;
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
  weth: TokenContract;
}

export interface UnwrapETHAction extends Spends {
  type: "unwrapETH";
  weth: TokenContract;
}

/** stETH to wstETH; wstETH pulls the stETH, so approve it first. */
export interface WrapStETHAction extends Spends {
  type: "wrapStETH";
  wstETH: TokenContract;
}

export interface UnwrapStETHAction extends Spends {
  type: "unwrapStETH";
  wstETH: TokenContract;
}

export interface LidoStakeAction extends Spends {
  type: "lidoStake";
  stETH: TokenContract;
  /** Lido's referral; default the zero address. */
  referral?: Address;
}

/** Requests a withdrawal of stETH; the queue pulls it, so approve it first. */
export interface LidoUnstakeAction extends Spends {
  type: "lidoUnstake";
  withdrawalQueue: Contract;
  /** Receives the withdrawal NFT, which claims the ETH once finalized. */
  owner: Recipient;
}

export interface RocketPoolStakeAction extends Spends {
  type: "rocketPoolStake";
  /** The live RocketDepositPool — Rocket Pool upgrades move it; read it from RocketStorage. */
  depositPool: Contract;
  /** The rETH token, whose balance delta is the output. */
  rETH: TokenContract;
}

export interface RocketPoolUnstakeAction extends Spends {
  type: "rocketPoolUnstake";
  rETH: TokenContract;
}

export interface EtherFiStakeAction extends Spends {
  type: "etherFiStake";
  liquidityPool: Contract;
  /** The eETH token, whose balance delta is the output. */
  eETH: TokenContract;
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
  pool: Contract;
  token: Token;
  onBehalfOf: Recipient;
  referralCode?: number;
}

/** Withdraws from Aave V3; the output is the amount withdrawn. */
export interface AaveV3WithdrawAction extends Spends {
  type: "aaveV3Withdraw";
  pool: Contract;
  token: Token;
  recipient: Recipient;
}

/** Borrows at the variable rate, the only rate Aave V3 offers. */
export interface AaveV3BorrowAction extends Spends {
  type: "aaveV3Borrow";
  pool: Contract;
  token: Token;
  onBehalfOf: Recipient;
  referralCode?: number;
}

export interface AaveV3RepayAction extends Spends {
  type: "aaveV3Repay";
  pool: Contract;
  token: Token;
  onBehalfOf: Recipient;
}

export interface CompoundV3SupplyAction extends Spends {
  type: "compoundV3Supply";
  comet: Contract;
  token: Token;
}

export interface CompoundV3WithdrawAction extends Spends {
  type: "compoundV3Withdraw";
  comet: Contract;
  token: Token;
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
  token: Token;
  recipient: Recipient;
}

export interface ApproveAction extends Spends {
  type: "approve";
  token: Token;
  spender: Contract;
}

/**
 * A Permit2 allowance, for spenders that pull through Permit2 (Balancer V3's router, Uniswap's
 * Universal Router). The token must also be ERC-20-approved to Permit2 itself.
 */
export interface Permit2ApproveAction extends Spends {
  type: "permit2Approve";
  /** Permit2 — 0x000000000022D473030F116dDEE9F6B43aC78BA3 on every chain Uniswap deploys it. */
  permit2: Contract;
  token: Token;
  spender: Contract;
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
  token: Token;
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

/** An action program: its actions in order, and optionally the one chain it is written for. */
export interface ActionProgram {
  /** Format version; `1`. */
  version: 1;
  /**
   * The chain the document is written for; compiling it for another is refused. Leave it out of a
   * document that names its tokens and contracts: it then compiles for any chain where those names
   * exist, the chain chosen at compile time. A bridge's destination is its own field either way.
   */
  chainId?: number;
  actions: Action[];
}
