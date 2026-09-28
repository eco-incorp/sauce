/**
 * The JSON shape of every action — one table that both the strict parser (`program.ts`) and the
 * published JSON Schema (`schema.ts`) are generated from, so the two cannot disagree.
 *
 * ENCODING. JSON has no integer wider than 2^53, so every amount, price and any other value that can
 * exceed it is a base-10 string (`"1000000000000000000"`): digits only, no sign, no exponent, no
 * leading zeros. Addresses are `0x` + 40 hex digits (a mixed-case address must carry a valid
 * EIP-55 checksum), byte strings are `0x` + an even number of hex digits, and small enumerations —
 * fee tiers, indices, domain ids, deadlines in seconds — are JSON integers.
 */
import type { RoutingActionType } from "./types.js";

export type FieldKind =
  | { readonly k: "address" }
  /** An address, or `"self"` for the executing account. */
  | { readonly k: "recipient" }
  /** A base-10 string holding an unsigned integer of at most `bits` bits. */
  | { readonly k: "uint"; readonly bits: number }
  | { readonly k: "bytes" }
  | { readonly k: "bytes32" }
  /** A JSON integer in `[min, max]`. */
  | { readonly k: "int"; readonly min: number; readonly max: number }
  | { readonly k: "enum"; readonly values: readonly (string | number)[] }
  | { readonly k: "bool" }
  | { readonly k: "identifier" }
  | { readonly k: "array"; readonly of: FieldKind; readonly min?: number; readonly max?: number }
  /** A fixed-length JSON array whose positions have their own kinds. */
  | { readonly k: "tuple"; readonly of: readonly FieldKind[] }
  | { readonly k: "object"; readonly fields: Fields };

export interface FieldDef {
  readonly kind: FieldKind;
  readonly optional?: boolean;
  readonly doc: string;
}

export type Fields = Readonly<Record<string, FieldDef>>;

/**
 * What an action's output is — the value an implicitly chained next action, or an `amountRef`,
 * spends.
 *
 * - `realized`: what the action actually produced (a swap's received amount, an Aave withdrawal).
 * - `passThrough`: the action's own input amount, unchanged.
 * - `none`: no output in this transaction (Integral's delayed order).
 * - `value`: a source action's value (a balance, a runtime argument).
 */
export type OutputKind = "realized" | "passThrough" | "none" | "value";

export type ActionGroup = "swap" | "bridge" | "wrap" | "stake" | "lending" | "token" | "source";

export interface ActionSpec {
  readonly type: RoutingActionType;
  readonly group: ActionGroup;
  /** One sentence for the reference: what the action does. */
  readonly summary: string;
  /** The contract function it calls, as documentation. */
  readonly calls: string;
  /** `"srcChainId"` for a bridge, whose `chainId` would be ambiguous. */
  readonly chainField: "chainId" | "srcChainId";
  /** The field holding the action's own amount; absent when it has none or it is always explicit. */
  readonly amountField?: string;
  /** Whether `amountRef` is accepted. */
  readonly chainable: boolean;
  readonly output: OutputKind;
  /** Native value the call attaches, for the reference. */
  readonly value?: string;
  /** Exactly one of these two fields must be present. */
  readonly exactlyOne?: readonly [string, string];
  /** Everything but `type`, the chain field, the amount field and the chaining fields. */
  readonly fields: Fields;
}

// ---- field kinds ----------------------------------------------------------------------------

const address = { k: "address" } as const;
const recipient = { k: "recipient" } as const;
const uint256 = { k: "uint", bits: 256 } as const;
const uint128 = { k: "uint", bits: 128 } as const;
const uint160 = { k: "uint", bits: 160 } as const;
const bytes = { k: "bytes" } as const;
const bytes32 = { k: "bytes32" } as const;
const bool = { k: "bool" } as const;
const int = (min: number, max: number): FieldKind => ({ k: "int", min, max });
const uintN = (bits: number): FieldKind =>
  int(0, bits >= 53 ? Number.MAX_SAFE_INTEGER : 2 ** bits - 1);
const seconds = uintN(53);

const f = (kind: FieldKind, doc: string): FieldDef => ({ kind, doc });
const opt = (kind: FieldKind, doc: string): FieldDef => ({ kind, doc, optional: true });

const RECIPIENT_DOC =
  'receives the output when it is not chained; `"self"` keeps it in the executing account';
const MIN_OUT = "minimum output; the venue reverts below it";

// ---- the table ------------------------------------------------------------------------------

const swap = (
  type: RoutingActionType,
  summary: string,
  calls: string,
  fields: Fields,
  extra: Partial<ActionSpec> = {},
): ActionSpec => ({
  type,
  group: "swap",
  summary,
  calls,
  chainField: "chainId",
  amountField: "amountIn",
  chainable: true,
  output: "realized",
  fields,
  ...extra,
});

const simple = (
  type: RoutingActionType,
  group: ActionGroup,
  summary: string,
  calls: string,
  fields: Fields,
  extra: Partial<ActionSpec> = {},
): ActionSpec => ({
  type,
  group,
  summary,
  calls,
  chainField: "chainId",
  amountField: "amount",
  chainable: true,
  output: "passThrough",
  fields,
  ...extra,
});

const bridge = (
  type: RoutingActionType,
  summary: string,
  calls: string,
  fields: Fields,
  extra: Partial<ActionSpec> = {},
): ActionSpec => ({
  type,
  group: "bridge",
  summary,
  calls,
  chainField: "srcChainId",
  amountField: "amount",
  chainable: true,
  output: "passThrough",
  fields: { destChainId: f(uintN(53), "the destination chain id"), ...fields },
  ...extra,
});

const SPECS: readonly ActionSpec[] = [
  // -- swaps ----------------------------------------------------------------------------------
  swap(
    "uniswapV3ExactInput",
    "Swaps an exact input through one Uniswap V3 pool.",
    "SwapRouter02.exactInputSingle",
    {
      router: f(address, "the SwapRouter02"),
      tokenIn: f(address, "the token sold"),
      tokenOut: f(address, "the token bought"),
      fee: f(
        { k: "enum", values: [100, 500, 3000, 10000] },
        "the pool's fee tier, in hundredths of a bip",
      ),
      amountOutMin: opt(uint256, `${MIN_OUT}; set this or \`sqrtPriceLimitX96\``),
      sqrtPriceLimitX96: opt(uint160, "a price limit instead of a minimum output"),
      recipient: f(recipient, RECIPIENT_DOC),
      deadline: f(seconds, "unused by SwapRouter02, which takes no deadline; kept for the record"),
    },
    { exactlyOne: ["amountOutMin", "sqrtPriceLimitX96"] },
  ),
  swap(
    "uniswapV3ExactInputMultiHop",
    "Swaps an exact input along an encoded Uniswap V3 path.",
    "SwapRouter02.exactInput",
    {
      router: f(address, "the SwapRouter02"),
      path: f(bytes, "the packed path: token ++ fee (3 bytes) ++ token ++ …"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
      deadline: f(seconds, "unused by SwapRouter02; kept for the record"),
    },
  ),
  swap(
    "uniswapV4ExactInput",
    "Swaps an exact input through one Uniswap V4 pool via the Universal Router.",
    "IERC20.transfer to the router, then UniversalRouter.execute (V4_SWAP: swap, settle, take)",
    {
      router: f(address, "the Universal Router"),
      poolKey: f(
        {
          k: "object",
          fields: {
            currency0: f(address, "the pool's lower currency"),
            currency1: f(address, "the pool's higher currency"),
            fee: f(uintN(24), "the pool fee, in hundredths of a bip"),
            tickSpacing: f(int(1, 32767), "the pool's tick spacing"),
            hooks: f(address, "the pool's hooks contract, or the zero address"),
          },
        },
        "the V4 pool key",
      ),
      zeroForOne: f(bool, "true sells currency0 for currency1"),
      amountOutMin: f(uint128, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),
  swap(
    "uniswapV4ExactInputMultiHop",
    "Swaps an exact input along a Uniswap V4 path via the Universal Router.",
    "IERC20.transfer to the router, then UniversalRouter.execute (V4_SWAP: swap, settle, take)",
    {
      router: f(address, "the Universal Router"),
      currencyIn: f(address, "the currency sold"),
      path: f(
        {
          k: "array",
          min: 1,
          of: {
            k: "object",
            fields: {
              intermediateCurrency: f(address, "the currency this hop buys"),
              fee: f(uintN(24), "the hop's pool fee"),
              tickSpacing: f(int(1, 32767), "the hop's pool tick spacing"),
              hooks: f(address, "the hop's pool hooks, or the zero address"),
            },
          },
        },
        "the hops, in order; the last hop's currency is the output",
      ),
      amountOutMin: f(uint128, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),
  swap(
    "curveSwap",
    "Swaps through a Curve pool's 4-argument `exchange`; the output is a balance delta.",
    "pool.exchange(int128,int128,uint256,uint256)",
    {
      pool: f(address, "the Curve pool"),
      tokenIn: f(address, "the token sold"),
      tokenOut: f(address, "the token bought, whose balance delta is the output"),
      i: f(int(0, 7), "the pool index of the input coin"),
      j: f(int(0, 7), "the pool index of the output coin"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, `${RECIPIENT_DOC}; the output is forwarded by a transfer`),
    },
  ),
  swap(
    "curveRouterNGSwap",
    "Swaps along a Curve RouterNG route of up to five hops.",
    "RouterNG.exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)",
    {
      router: f(address, "the Curve RouterNG"),
      route: f(
        { k: "array", of: address, min: 1, max: 11 },
        "the route, padded to 11 with zero addresses",
      ),
      swapParams: f(
        {
          k: "array",
          min: 1,
          max: 5,
          of: { k: "tuple", of: [int(0, 255), int(0, 255), int(0, 255), int(0, 255), int(0, 255)] },
        },
        "per hop: [i, j, swap_type, pool_type, n_coins], padded to 5 rows",
      ),
      amountOutMin: f(uint256, MIN_OUT),
      pools: f({ k: "array", of: address, max: 5 }, "zap pools where a hop needs one, padded to 5"),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),
  swap("balancerV2Swap", "Swaps through one Balancer V2 pool.", "Vault.swap", {
    vault: f(address, "the Balancer V2 Vault"),
    poolId: f(bytes32, "the pool id"),
    tokenIn: f(address, "the token sold"),
    tokenOut: f(address, "the token bought"),
    amountOutMin: f(uint256, MIN_OUT),
    recipient: f(recipient, RECIPIENT_DOC),
    deadline: f(seconds, "Unix seconds after which the Vault reverts"),
  }),
  swap(
    "balancerV2BatchSwap",
    "Swaps along a Balancer V2 multi-pool batch; the output is a balance delta.",
    "Vault.batchSwap",
    {
      vault: f(address, "the Balancer V2 Vault"),
      steps: f(
        {
          k: "array",
          min: 1,
          of: {
            k: "object",
            fields: {
              poolId: f(bytes32, "the step's pool id"),
              assetInIndex: f(int(0, 255), "index into `assets` of the step's input"),
              assetOutIndex: f(int(0, 255), "index into `assets` of the step's output"),
              amount: f(uint256, "the step's input; 0 spends the previous step's output"),
            },
          },
        },
        "the batch's steps; the last step's output asset is the output",
      ),
      assets: f({ k: "array", of: address, min: 2 }, "every asset the steps index"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
      deadline: f(seconds, "Unix seconds after which the Vault reverts"),
    },
    { amountField: undefined, chainable: false },
  ),
  swap(
    "balancerV3Swap",
    "Swaps an exact input through one Balancer V3 pool; the router pays the executing account.",
    "Router.swapSingleTokenExactIn",
    {
      router: f(address, "the Balancer V3 Router"),
      pool: f(address, "the pool"),
      tokenIn: f(address, "the token sold"),
      tokenOut: f(address, "the token bought"),
      amountOutMin: f(uint256, MIN_OUT),
      deadline: f(seconds, "Unix seconds after which the router reverts"),
      wethIsEth: f(bool, "true to pay or receive native ETH for WETH"),
    },
  ),
  swap(
    "uniswapV2Swap",
    "Swaps an exact input along a Uniswap V2 path; the output is a balance delta.",
    "UniswapV2Router.swapExactTokensForTokens",
    {
      router: f(address, "the V2 router"),
      amountOutMin: f(uint256, MIN_OUT),
      path: f({ k: "array", of: address, min: 2 }, "the token path; the last token is the output"),
      recipient: f(recipient, RECIPIENT_DOC),
      deadline: f(seconds, "Unix seconds after which the router reverts"),
    },
  ),
  swap(
    "ambientSwap",
    "Swaps through an Ambient (CrocSwap) pool; the output is a balance delta.",
    "CrocSwapDex.userCmd(1, abi.encode(...))",
    {
      dex: f(address, "the CrocSwapDex"),
      base: f(address, "the pool's base token (numerically lower)"),
      quote: f(address, "the pool's quote token"),
      poolIdx: f(uintN(53), "the pool type index (420 is the standard pool)"),
      isBuy: f(bool, "true pays base and receives quote"),
      inBaseQty: f(bool, "true when the amount is denominated in the base token"),
      tip: f(uintN(16), "0 accepts the pool's default fee"),
      limitPrice: f(uint128, "the worst acceptable price, as a Q64.64 square-root price"),
      minOut: f(uint128, MIN_OUT),
      reserveFlags: f(uintN(8), "0x1 settles base from surplus, 0x2 quote"),
    },
  ),
  swap(
    "dodoSwap",
    "Swaps through DODO pairs via the DODO proxy.",
    "DODOProxy.dodoSwapV2TokenToToken (or dodoSwapV1)",
    {
      proxy: f(address, "the DODO proxy; approvals go to DODOApprove, not to it"),
      fromToken: f(address, "the token sold"),
      toToken: f(address, "the token bought"),
      amountOutMin: f(uint256, MIN_OUT),
      dodoPairs: f({ k: "array", of: address, min: 1 }, "the pairs to route through"),
      directions: f(uintN(53), "a bit per pair: 0 sells base, 1 sells quote"),
      deadline: f(seconds, "Unix seconds after which the proxy reverts"),
      version: opt(
        { k: "enum", values: ["v1", "v2"] },
        '"v1" routes legacy Classical pairs through `dodoSwapV1`; default "v2"',
      ),
    },
  ),
  swap(
    "maverickSwap",
    "Swaps an exact input through one Maverick V2 pool.",
    "MaverickV2Router.exactInputSingle",
    {
      router: f(address, "the Maverick V2 router"),
      pool: f(address, "the pool"),
      tokenAIn: f(bool, "true sells the pool's token A"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),
  swap(
    "maverickMultiHopSwap",
    "Swaps an exact input along an encoded Maverick V2 path.",
    "MaverickV2Router.exactInputMultiHop",
    {
      router: f(address, "the Maverick V2 router"),
      path: f(bytes, "the encoded path of pools and directions"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),
  swap(
    "carbonSwap",
    "Trades against Carbon strategies by source amount; the controller pays the executing account.",
    "CarbonController.tradeBySourceAmount",
    {
      controller: f(address, "the CarbonController"),
      sourceToken: f(address, "the token sold"),
      targetToken: f(address, "the token bought"),
      tradeActions: f(
        {
          k: "array",
          min: 1,
          of: {
            k: "object",
            fields: {
              strategyId: f(uint256, "the strategy"),
              amount: f(uint128, "source amount for it"),
            },
          },
        },
        "per-strategy source amounts; these, not `amountIn`, are traded",
      ),
      amountOutMin: f(uint128, MIN_OUT),
      deadline: f(seconds, "Unix seconds after which the controller reverts"),
    },
  ),
  swap(
    "fraxswapSwap",
    "Swaps an exact input along a Fraxswap path; the output is a balance delta.",
    "FraxswapRouter.swapExactTokensForTokens",
    {
      router: f(address, "the Fraxswap router"),
      amountOutMin: f(uint256, MIN_OUT),
      path: f({ k: "array", of: address, min: 2 }, "the token path; the last token is the output"),
      recipient: f(recipient, RECIPIENT_DOC),
      deadline: f(seconds, "Unix seconds after which the router reverts"),
    },
  ),
  swap(
    "clipperSwap",
    "Sells tokens already transferred to a Clipper exchange, against a signed quote.",
    "ClipperExchange.sellTokenForToken",
    {
      exchange: f(address, "the Clipper exchange"),
      inputToken: f(address, "the token sold"),
      outputToken: f(address, "the token bought"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
      auxiliaryData: f(bytes, "Clipper's signed quote, from its API"),
    },
  ),
  swap(
    "integralSwap",
    "Places an Integral SIZE sell order, which executes in a later transaction.",
    "TwapDelay.sell",
    {
      delay: f(address, "the TwapDelay"),
      tokenIn: f(address, "the token sold"),
      tokenOut: f(address, "the token bought"),
      amountOutMin: f(uint256, MIN_OUT),
      wrapUnwrap: f(bool, "true to wrap or unwrap native ETH"),
      recipient: f(recipient, "receives the output when the order executes"),
      gasLimit: f(uint256, "the gas the keeper may spend executing the order"),
      submitDeadline: f(uintN(32), "Unix seconds by which the order must be submitted"),
    },
    { output: "none" },
  ),
  swap("fluidDexT1Swap", "Swaps an exact input through a Fluid DEX T1 pool.", "FluidDexT1.swapIn", {
    pool: f(address, "the pool"),
    swap0to1: f(bool, "true sells token0"),
    amountOutMin: f(uint256, MIN_OUT),
    recipient: f(recipient, RECIPIENT_DOC),
  }),
  swap(
    "fluidDexLiteSwap",
    "Swaps an exact input through the Fluid DEX Lite singleton; the output is a balance delta.",
    "FluidDexLite.swapSingle",
    {
      dex: f(address, "the Fluid DEX Lite singleton"),
      token0: f(address, "the pool's lower token"),
      token1: f(address, "the pool's higher token"),
      salt: f(bytes32, "the pool's salt, from the DexLite resolver"),
      swap0To1: f(bool, "true sells token0"),
      amountOutMin: f(uint256, MIN_OUT),
      recipient: f(recipient, RECIPIENT_DOC),
    },
  ),

  // -- bridges --------------------------------------------------------------------------------
  bridge(
    "acrossBridge",
    "Deposits into an Across V3 SpokePool for the same token on the destination.",
    "SpokePool.depositV3",
    {
      spokePool: f(address, "the origin SpokePool"),
      token: f(address, "the token bridged (input and output)"),
      relayerFeePct: f(uint256, "recorded for the quote; the deposit sets input = output amount"),
      quoteTimestamp: f(uintN(32), "the quote's timestamp"),
      fillDeadline: f(uintN(32), "Unix seconds by which a relayer must fill"),
      exclusivityDeadline: f(uintN(32), "Unix seconds of relayer exclusivity (0 for none)"),
      message: f(bytes, "the message delivered with the fill; 0x for none"),
    },
  ),
  bridge(
    "stargateBridge",
    "Bridges through the Stargate V1 router, paying the LayerZero fee as value.",
    "StargateRouter.swap",
    {
      router: f(address, "the Stargate V1 router"),
      token: f(address, "the token bridged"),
      srcPoolId: f(uintN(53), "the source pool id"),
      dstPoolId: f(uintN(53), "the destination pool id"),
      amountOutMin: f(uint256, "minimum received on the destination"),
      lzFee: f(uint256, "the LayerZero fee, attached as native value"),
    },
    { value: "lzFee" },
  ),
  bridge(
    "cctpBridge",
    "Burns USDC through Circle's CCTP V1 TokenMessenger for minting on the destination.",
    "TokenMessenger.depositForBurn",
    {
      tokenMessenger: f(address, "the CCTP V1 TokenMessenger"),
      token: f(address, "the burned token (USDC)"),
      srcDomain: f(uintN(32), "the source CCTP domain (recorded, not sent)"),
      destDomain: f(uintN(32), "the destination CCTP domain"),
      mintRecipient: f(bytes32, "the destination recipient, left-padded to 32 bytes"),
    },
  ),
  bridge(
    "hyperlaneBridge",
    "Dispatches a Hyperlane message, paying interchain gas as value.",
    "Mailbox.dispatch(uint32,bytes32,bytes)",
    {
      router: f(address, "the contract `dispatch` is called on"),
      token: f(address, "sent as the message recipient, padded to 32 bytes"),
      destinationDomain: f(uintN(32), "the Hyperlane destination domain"),
      gasPayment: f(uint256, "interchain gas, attached as native value"),
    },
    { value: "gasPayment" },
  ),

  // -- wrap / unwrap --------------------------------------------------------------------------
  simple(
    "wrapETH",
    "wrap",
    "Wraps native ETH into WETH.",
    "WETH.deposit",
    { weth: f(address, "the WETH contract") },
    { value: "amount" },
  ),
  simple("unwrapETH", "wrap", "Unwraps WETH into native ETH.", "WETH.withdraw", {
    weth: f(address, "the WETH contract"),
  }),
  simple(
    "wrapStETH",
    "wrap",
    "Wraps stETH into wstETH.",
    "wstETH.wrap",
    { wstETH: f(address, "the wstETH contract") },
    { amountField: "stETHAmount" },
  ),
  simple(
    "unwrapStETH",
    "wrap",
    "Unwraps wstETH into stETH.",
    "wstETH.unwrap",
    { wstETH: f(address, "the wstETH contract") },
    { amountField: "wstETHAmount" },
  ),

  // -- staking --------------------------------------------------------------------------------
  simple(
    "lidoStake",
    "stake",
    "Stakes native ETH with Lido for stETH.",
    "stETH.submit",
    {
      stETH: f(address, "the stETH contract"),
      referral: f(address, "the referral address, or zero"),
    },
    { value: "amount" },
  ),
  simple(
    "lidoUnstake",
    "stake",
    "Requests a Lido withdrawal of stETH; the ETH is claimable later.",
    "WithdrawalQueue.requestWithdrawals",
    { withdrawalQueue: f(address, "Lido's WithdrawalQueueERC721") },
    { amountField: "stETHAmount" },
  ),
  simple(
    "rocketPoolStake",
    "stake",
    "Stakes native ETH with Rocket Pool for rETH.",
    "RocketDepositPool.deposit",
    { rETH: f(address, "the rETH token"), depositPool: f(address, "the Rocket deposit pool") },
    { value: "amount" },
  ),
  simple("rocketPoolUnstake", "stake", "Burns rETH for ETH.", "rETH.burn", {
    rETH: f(address, "the rETH token"),
  }),
  simple(
    "coinbaseStake",
    "stake",
    "Calls `deposit()` on cbETH with native value.",
    "cbETH.deposit",
    { cbETH: f(address, "the cbETH contract") },
    { value: "amount" },
  ),
  simple(
    "etherFiStake",
    "stake",
    "Stakes native ETH with ether.fi for eETH.",
    "LiquidityPool.deposit",
    { liquidityPool: f(address, "the ether.fi LiquidityPool") },
    { value: "amount" },
  ),

  // -- lending --------------------------------------------------------------------------------
  simple("aaveV3Supply", "lending", "Supplies a token to Aave V3.", "Pool.supply", {
    pool: f(address, "the Aave V3 Pool"),
    token: f(address, "the asset supplied"),
    onBehalfOf: f(recipient, 'credited with the position; `"self"` is the executing account'),
    referralCode: f(uintN(16), "Aave's referral code, usually 0"),
  }),
  simple(
    "aaveV3Withdraw",
    "lending",
    "Withdraws a token from Aave V3; the output is the amount withdrawn.",
    "Pool.withdraw",
    {
      pool: f(address, "the Aave V3 Pool"),
      token: f(address, "the asset withdrawn"),
      to: f(recipient, 'receives the asset; `"self"` is the executing account'),
    },
    { output: "realized" },
  ),
  simple(
    "aaveV3Borrow",
    "lending",
    "Borrows a token from Aave V3 at the variable rate.",
    "Pool.borrow",
    {
      pool: f(address, "the Aave V3 Pool"),
      token: f(address, "the asset borrowed"),
      interestRateMode: f(
        { k: "enum", values: [2] },
        "2 = variable rate, the only mode Aave V3 offers",
      ),
      onBehalfOf: f(
        recipient,
        'whose collateral backs the debt; `"self"` is the executing account',
      ),
      referralCode: f(uintN(16), "Aave's referral code, usually 0"),
    },
  ),
  simple("aaveV3Repay", "lending", "Repays an Aave V3 variable-rate debt.", "Pool.repay", {
    pool: f(address, "the Aave V3 Pool"),
    token: f(address, "the asset repaid"),
    interestRateMode: f({ k: "enum", values: [2] }, "2 = variable rate"),
    onBehalfOf: f(recipient, 'whose debt is repaid; `"self"` is the executing account'),
  }),
  simple(
    "compoundV3Supply",
    "lending",
    "Supplies a token to a Compound V3 (Comet) market.",
    "Comet.supply",
    {
      comet: f(address, "the Comet market"),
      token: f(address, "the asset supplied"),
    },
  ),
  simple(
    "compoundV3Withdraw",
    "lending",
    "Withdraws a token from a Compound V3 (Comet) market.",
    "Comet.withdraw",
    {
      comet: f(address, "the Comet market"),
      token: f(address, "the asset withdrawn"),
    },
  ),

  // -- tokens ---------------------------------------------------------------------------------
  simple("transfer", "token", "Transfers an ERC-20 token.", "ERC-20 transfer, decoding nothing", {
    token: f(address, "the token"),
    to: f(recipient, "the receiver"),
  }),
  simple("approve", "token", "Approves an ERC-20 spender.", "ERC-20 approve, decoding nothing", {
    token: f(address, "the token"),
    spender: f(address, "the spender"),
  }),

  // -- sources --------------------------------------------------------------------------------
  {
    type: "balanceOf",
    group: "source",
    summary: "Reads the executing account's balance of a token; the output is that balance.",
    calls: "IERC20.balanceOf(self)",
    chainField: "chainId",
    chainable: false,
    output: "value",
    fields: { token: f(address, "the token") },
  },
  {
    type: "nativeBalance",
    group: "source",
    summary: "Reads the executing account's native balance; the output is that balance.",
    calls: "ctx.selfBalance()",
    chainField: "chainId",
    chainable: false,
    output: "value",
    fields: {},
  },
  {
    type: "argument",
    group: "source",
    summary: "Declares a runtime entry argument; the output is the value supplied at execution.",
    calls: "a `main` parameter",
    chainField: "chainId",
    chainable: false,
    output: "value",
    fields: {
      name: f({ k: "identifier" }, "the parameter's name; arguments are encoded in order"),
    },
  },
];

/** Every action's specification, by `type`. */
export const ACTION_SPECS: Readonly<Record<RoutingActionType, ActionSpec>> = Object.fromEntries(
  SPECS.map((spec) => [spec.type, spec]),
) as Record<RoutingActionType, ActionSpec>;

/** Every action `type`, in reference order. */
export const ACTION_TYPES: readonly RoutingActionType[] = SPECS.map((spec) => spec.type);
