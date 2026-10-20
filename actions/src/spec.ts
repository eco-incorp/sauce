/**
 * The JSON shape of every action — one table that the strict parser (`program.ts`), the published
 * JSON Schema (`schema.ts`) and the guide's reference are all generated from, so none can disagree.
 *
 * ENCODING. JSON has no integer wider than 2^53, so every amount, price and any other value that can
 * exceed it is a base-10 string (`"1000000000000000000"`): digits only, no sign, no exponent, no
 * leading zeros. Addresses are `0x` + 40 hex digits (a mixed-case address must carry a valid
 * EIP-55 checksum), byte strings are `0x` + an even number of hex digits, and small enumerations —
 * fee tiers, indices, domain ids, deadlines in seconds — are JSON integers.
 *
 * NAMES. A token field takes a registry token symbol (`"USDC"`) as well as an address, and a
 * protocol-contract field a namespace reference (`"UniswapV3.Factory"`), in the spelling a Sauce
 * program uses. A name is not resolved here: it lowers to the program global of that name, which
 * resolves on the chain the program is compiled for (`names.ts`), so a document that names
 * everything compiles for any chain where its names exist.
 */
import type { ActionType } from "./types.js";

export type FieldKind =
  | { readonly k: "address" }
  /**
   * A token: a registry symbol (`"USDC"`) or an address. With `native`, also `"native"`: the
   * venue's own marker for the chain's native currency, the zero address.
   */
  | { readonly k: "token"; readonly native?: boolean }
  /** A protocol contract: a namespace reference (`"UniswapV3.Factory"`) or an address. */
  | { readonly k: "contract" }
  /** A contract that is also a token (WETH, wstETH): a symbol, a namespace reference or an address. */
  | { readonly k: "tokenContract" }
  /** An address, or `"self"` for the executing Pot. */
  | { readonly k: "recipient" }
  /** An address, or a 32-byte account on a non-EVM destination. */
  | { readonly k: "remoteRecipient" }
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
 * - `realized`: what the action delivered to the Pot (a swap's received amount, a staking token,
 *   an Aave withdrawal).
 * - `passThrough`: the action's own amount, unchanged.
 * - `value`: a source action's value (a balance, a runtime argument).
 */
export type OutputKind = "realized" | "passThrough" | "value";

export type ActionGroup = "swap" | "bridge" | "wrap" | "stake" | "lending" | "token" | "source";

export interface ActionSpec {
  readonly type: ActionType;
  readonly group: ActionGroup;
  /** One sentence for the reference: what the action does. */
  readonly summary: string;
  /** The contract function it calls, as documentation. */
  readonly calls: string;
  /**
   * Whether the action takes `amount`/`amountRef`, and so spends the previous action's output when
   * both are absent. False for a source, and for an action whose amounts are its own fields.
   */
  readonly spends: boolean;
  readonly output: OutputKind;
  /** Native value the call attaches, for the reference. */
  readonly value?: string;
  /** Everything but `type`, `amount`, `amountRef` and `saveOutputAs`. */
  readonly fields: Fields;
  /**
   * The ways the action may name what it trades on, exactly one of which it uses — a pool by its
   * address, or by the key its factory finds it under. Each is a set of fields; every field any of
   * them names is optional in `fields`, and an action carries exactly the fields of one.
   */
  readonly oneOf?: readonly (readonly string[])[];
  /** Fields given together or not at all. */
  readonly together?: readonly (readonly string[])[];
}

// ---- field kinds ----------------------------------------------------------------------------

const address = { k: "address" } as const;
/** A token: a registry symbol or an address. */
const token = { k: "token" } as const;
/** A token, or `"native"` for the chain's native currency where the venue takes it. */
const tokenOrNative = { k: "token", native: true } as const;
/** A protocol contract: a namespace reference or an address. */
const contract = { k: "contract" } as const;
/** A token that is its own contract: a symbol, a namespace reference or an address. */
const tokenContract = { k: "tokenContract" } as const;
const recipient = { k: "recipient" } as const;
const remoteRecipient = { k: "remoteRecipient" } as const;
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

const RECIPIENT = f(
  recipient,
  'receives the output when no later action spends it; `"self"` keeps it in the Pot',
);
const MIN_OUT = f(uint256, "the least output accepted; the venue reverts below it");
const DEADLINE = f(seconds, "Unix seconds after which the venue reverts");

// ---- the table ------------------------------------------------------------------------------

type Extra = Partial<Pick<ActionSpec, "spends" | "output" | "value" | "oneOf" | "together">>;

const spec =
  (group: ActionGroup, defaults: Pick<ActionSpec, "output">) =>
  (type: ActionType, summary: string, calls: string, fields: Fields, extra: Extra = {}) =>
    ({ type, group, summary, calls, spends: true, ...defaults, fields, ...extra }) as ActionSpec;

const swap = spec("swap", { output: "realized" });
const bridge = spec("bridge", { output: "passThrough" });
const wrap = spec("wrap", { output: "realized" });
const stake = spec("stake", { output: "realized" });
const lending = spec("lending", { output: "passThrough" });
const tokens = spec("token", { output: "passThrough" });
const source = spec("source", { output: "value" });

/** Where a pool given by its key is found, said once for every swap that takes one. */
const BY_KEY = "the program reads it from the factory on chain and reverts if there is none";

const SPECS: readonly ActionSpec[] = [
  // -- swaps through @sauce/router ------------------------------------------------------------
  swap(
    "uniswapV2Swap",
    "Swaps through one Uniswap V2 pair (or a fork's), priced from its reserves and paid by a push.",
    "@sauce/router uniswapV2: pair.getReserves, an ERC-20 transfer to the pair, pair.swap",
    {
      pool: opt(contract, "the pair; or leave it out and give `factory`"),
      factory: opt(
        contract,
        `instead of \`pool\`: a Uniswap V2-style factory ("UniswapV2.Factory"), whose ` +
          `getPair(tokenIn, tokenOut) is the pair; ${BY_KEY}`,
      ),
      tokenIn: f(token, "the token sold, pushed to the pair"),
      tokenOut: f(token, "the token bought; the direction is the pair's sort order"),
      feePpm: opt(
        int(0, 999_999),
        "the pair's LP fee in parts per million; absent or 0 is 3000 (0.30%), PancakeSwap V2 is 2500",
      ),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
    { oneOf: [["pool"], ["factory"]] },
  ),
  swap(
    "uniswapV3Swap",
    "Swaps through one Uniswap V3 pool (or a fork's), through the Pot's Router, which answers its callback.",
    "@sauce/router uniswapV3: Router.swapV3",
    {
      pool: opt(
        contract,
        "the pool; or leave it out and give `factory` with `fee` or `tickSpacing`",
      ),
      factory: opt(
        contract,
        "instead of `pool`: the factory whose getPool(tokenIn, tokenOut, key) is the pool — a " +
          'Uniswap V3-style factory with `fee` ("UniswapV3.Factory", "PancakeswapV3.Factory"), or ' +
          `Aerodrome Slipstream's with \`tickSpacing\` ("AerodromeSlipstream.CLFactory"); ${BY_KEY}`,
      ),
      fee: opt(
        uintN(24),
        "with `factory`: the pool's fee tier, in hundredths of a bip (500 is 0.05%)",
      ),
      tickSpacing: opt(int(1, 8_388_607), "with a Slipstream `factory`: the pool's tick spacing"),
      tokenIn: f(token, "the token sold"),
      tokenOut: f(token, "the token bought"),
      sqrtPriceLimitX96: opt(
        uint160,
        "a price at which the swap stops, leaving the rest of the input in the Pot; absent or 0 for none",
      ),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
    { oneOf: [["pool"], ["factory", "fee"], ["factory", "tickSpacing"]] },
  ),
  swap(
    "uniswapV4Swap",
    "Swaps through one Uniswap V4 pool, named by its key, through the Pot's Router, which settles " +
      "with the PoolManager.",
    "@sauce/router uniswapV4: Router.swapV4",
    {
      poolManager: f(contract, 'the PoolManager ("UniswapV4.PoolManager")'),
      tokenIn: f(tokenOrNative, 'the token sold; "native" is the native currency'),
      tokenOut: f(tokenOrNative, 'the token bought; "native" is the native currency'),
      fee: f(uintN(24), "the pool key's fee, in hundredths of a bip"),
      tickSpacing: f(int(1, 32767), "the pool key's tick spacing"),
      hooks: opt(contract, "the pool key's hooks contract; absent for a pool with none"),
      sqrtPriceLimitX96: opt(
        uint160,
        "a price at which the swap stops, leaving the rest of the input in the Pot; absent or 0 for none",
      ),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),
  swap(
    "curveSwap",
    "Swaps through a Curve pool's 4-argument `exchange`, approving exactly the input; the output " +
      "is a balance delta.",
    "@sauce/router curve: an exact ERC-20 approval, then pool.exchange(int128|uint256 i, j, dx, min_dy)",
    {
      pool: f(contract, "the Curve pool"),
      tokenIn: f(token, "the token sold, approved to the pool for exactly the amount"),
      tokenOut: f(token, "the token bought, whose balance delta is the output"),
      i: f(int(0, 7), "the pool index of the coin sold"),
      j: f(int(0, 7), "the pool index of the coin bought"),
      indexType: f(
        { k: "enum", values: ["int128", "uint256"] },
        "the pool's index type: int128 for StableSwap and NG pools, uint256 for CryptoSwap",
      ),
      amountOutMin: MIN_OUT,
      recipient: f(
        recipient,
        `${RECIPIENT.doc}; the pool pays the Pot, which forwards it with a transfer`,
      ),
    },
  ),
  swap(
    "balancerV2Swap",
    "Swaps through one Balancer V2 pool, approving the Vault for exactly the input.",
    "@sauce/router balancerV2: an exact ERC-20 approval, then Vault.swap (GIVEN_IN)",
    {
      vault: f(contract, "the Balancer V2 Vault"),
      poolId: f(bytes32, "the pool id"),
      tokenIn: f(token, "the token sold, approved to the Vault for exactly the amount"),
      tokenOut: f(token, "the token bought"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),
  swap(
    "dodoV2Swap",
    "Swaps through one DODO V2 pool (DVM, DPP or DSP), paid by a push.",
    "@sauce/router dodoV2: an ERC-20 transfer to the pool, then sellBase(to) or sellQuote(to)",
    {
      pool: f(contract, "the pool"),
      tokenIn: f(token, "the token sold, pushed to the pool"),
      tokenOut: f(token, "the token bought"),
      baseToken: f(token, "the pool's base token; tokenIn and tokenOut must be base and quote"),
      quoteToken: f(token, "the pool's quote token"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),
  swap(
    "traderJoeLBSwap",
    "Swaps through one Trader Joe Liquidity Book pair, paid by a push.",
    "@sauce/router traderJoeLB: an ERC-20 transfer to the pair, then pair.swap(swapForY, to)",
    {
      pool: opt(contract, "the pair; or leave it out and give `factory` with `binStep`"),
      factory: opt(
        contract,
        'instead of `pool`: the LBFactory ("TraderJoe.LBFactory"), whose ' +
          `getLBPairInformation(tokenIn, tokenOut, binStep) names the pair; ${BY_KEY}`,
      ),
      binStep: opt(int(1, 65_535), "with `factory`: the pair's bin step"),
      tokenIn: f(token, "the token sold, pushed to the pair"),
      tokenOut: f(token, "the token bought"),
      tokenX: opt(
        token,
        "the pair's token X; tokenIn and tokenOut must be X and Y. Leave tokenX and tokenY out " +
          "to read them from the pair",
      ),
      tokenY: opt(token, "the pair's token Y"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
    { oneOf: [["pool"], ["factory", "binStep"]], together: [["tokenX", "tokenY"]] },
  ),
  swap(
    "woofiSwap",
    "Swaps through WOOFi's WooPPV2, paid by a push.",
    "@sauce/router woofi: an ERC-20 transfer to the pool, then WooPPV2.swap",
    {
      pool: f(contract, "the WooPPV2 itself, not the WooRouterV2"),
      tokenIn: f(token, "the token sold, pushed to the pool"),
      tokenOut: f(token, "the token bought"),
      amountOutMin: f(
        uint256,
        "the least output accepted, as the pool's own minToAmount; required and positive, because the pool prices from an oracle",
      ),
      recipient: RECIPIENT,
    },
  ),
  swap(
    "maverickV2Swap",
    "Swaps through one Maverick V2 pool, through the Pot's Router, which pays what the pool asks for.",
    "@sauce/router maverickV2: Router.swapMaverickV2",
    {
      pool: f(contract, "the pool"),
      tokenIn: f(token, "the token sold"),
      tokenOut: f(token, "the token bought"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),

  // -- swaps at venues @sauce/router does not cover -------------------------------------------
  swap(
    "curveRouterNGSwap",
    "Swaps along a Curve RouterNG route of up to five hops.",
    "RouterNG.exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)",
    {
      router: f(contract, "the Curve RouterNG"),
      route: f(
        { k: "array", of: tokenContract, min: 1, max: 11 },
        "the route, tokens and pools alternating; padded to 11 with zero addresses",
      ),
      swapParams: f(
        {
          k: "array",
          min: 1,
          max: 5,
          of: { k: "tuple", of: [int(0, 255), int(0, 255), int(0, 255), int(0, 255), int(0, 255)] },
        },
        "per hop: [i, j, swap_type, pool_type, n_coins]; padded to 5 rows",
      ),
      pools: f(
        { k: "array", of: contract, max: 5 },
        "a zap pool where a hop needs one; padded to 5",
      ),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),
  swap(
    "balancerV2BatchSwap",
    "Swaps along Balancer V2 pools in one batch; the output is a balance delta.",
    "Vault.batchSwap",
    {
      vault: f(contract, "the Balancer V2 Vault"),
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
      assets: f(
        { k: "array", of: tokenOrNative, min: 2 },
        'each asset the steps index, once only (including symbol/address aliases); "native" and the zero address are the same native currency',
      ),
      amountOutMin: f(
        uint256,
        "the least net payout of the last step's output asset; at most 2^255 inclusive, so its negative Vault limit fits int256",
      ),
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
    { spends: false },
  ),
  swap(
    "balancerV3Swap",
    "Swaps an exact input through one Balancer V3 pool; the router pays the Pot and pulls " +
      "through Permit2.",
    "Router.swapSingleTokenExactIn",
    {
      router: f(contract, "the Balancer V3 Router"),
      pool: f(contract, "the pool"),
      tokenIn: f(token, "the token sold"),
      tokenOut: f(token, "the token bought"),
      amountOutMin: MIN_OUT,
      deadline: DEADLINE,
      wethIsEth: f(bool, "true to pay or receive native ETH for WETH"),
    },
  ),

  swap(
    "ambientSwap",
    "Swaps through an Ambient (CrocSwap) pool; the dex pays the Pot, and the output is a balance delta.",
    "CrocSwapDex.userCmd(1, abi.encode(...))",
    {
      dex: f(contract, "the CrocSwapDex"),
      base: f(tokenOrNative, "the pool's base token (numerically lower)"),
      quote: f(token, "the pool's quote token"),
      poolIdx: f(uintN(53), "the pool type index (420 is the standard pool)"),
      isBuy: f(bool, "true pays base and receives quote"),
      inBaseQty: f(bool, "true when the amount is denominated in the base token"),
      tip: f(uintN(16), "0 accepts the pool's default fee"),
      limitPrice: f(uint128, "the worst acceptable price, as a Q64.64 square-root price"),
      amountOutMin: f(uint128, "the least output accepted; the dex reverts below it"),
      reserveFlags: f(uintN(8), "0x1 settles base from surplus, 0x2 quote"),
    },
  ),
  swap(
    "dodoV1Swap",
    "Swaps through legacy DODO V1 (Classical) pairs via the DODO proxy, which pays the Pot.",
    "DODOProxy.dodoSwapV1",
    {
      proxy: f(contract, "the DODO proxy; approvals go to DODOApprove, not to it"),
      tokenIn: f(token, "the token sold"),
      tokenOut: f(token, "the token bought"),
      pairs: f({ k: "array", of: contract, min: 1 }, "the V1 pairs to route through"),
      directions: f(uintN(53), "a bit per pair: 0 sells base, 1 sells quote"),
      amountOutMin: MIN_OUT,
      deadline: DEADLINE,
    },
  ),

  swap(
    "carbonSwap",
    "Trades against Carbon strategies by source amount; the controller pays the Pot.",
    "CarbonController.tradeBySourceAmount",
    {
      controller: f(contract, "the CarbonController"),
      sourceToken: f(token, "the token sold"),
      targetToken: f(token, "the token bought"),
      tradeActions: f(
        {
          k: "array",
          min: 1,
          of: {
            k: "object",
            fields: {
              strategyId: f(uint256, "the strategy"),
              amount: f(uint128, "the source amount traded against it"),
            },
          },
        },
        "the source amount per strategy; together they are the trade",
      ),
      amountOutMin: f(uint128, "the least output accepted; the controller reverts below it"),
      deadline: DEADLINE,
    },
    { spends: false },
  ),
  swap(
    "fraxswapSwap",
    "Swaps an exact input along a Fraxswap path; the output is a balance delta.",
    "FraxswapRouter.swapExactTokensForTokens",
    {
      router: f(contract, "the Fraxswap router"),
      path: f({ k: "array", of: token, min: 2 }, "the token path; the last token is the output"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
      deadline: DEADLINE,
    },
  ),
  swap(
    "fluidDexT1Swap",
    "Swaps an exact ERC-20 input through a Fluid DEX T1 pool.",
    "FluidDexT1.swapIn",
    {
      pool: f(contract, "the pool"),
      swap0to1: f(bool, "true sells token0"),
      amountOutMin: MIN_OUT,
      recipient: RECIPIENT,
    },
  ),

  // -- bridges --------------------------------------------------------------------------------
  bridge(
    "acrossBridge",
    "Deposits into an Across SpokePool for the same token on the destination, less the relayer fee.",
    "SpokePool.depositV3",
    {
      spokePool: f(contract, "the origin SpokePool; it pulls the token, so approve it first"),
      token: f(token, "the token bridged (input and output)"),
      destChainId: f(int(1, Number.MAX_SAFE_INTEGER), "the destination chain id"),
      recipient: f(address, "receives on the destination"),
      relayerFee: f(uint256, "kept by the relayer: the destination receives `amount - relayerFee`"),
      quoteTimestamp: f(uintN(32), "the timestamp the fee was quoted at"),
      fillDeadline: f(uintN(32), "Unix seconds by which a relayer must fill"),
      exclusivityDeadline: f(uintN(32), "Unix seconds of relayer exclusivity; 0 for none"),
      message: f(bytes, "delivered with the fill; 0x for none"),
    },
  ),
  bridge(
    "stargateBridge",
    "Sends through a Stargate V2 ERC-20 pool (taxi), paying the LayerZero fee it quotes.",
    "StargatePool.quoteSend, then StargatePool.send",
    {
      pool: f(contract, "the StargatePool; it pulls the token, so approve it first"),
      dstEid: f(uintN(32), "the destination's LayerZero endpoint id"),
      recipient: f(remoteRecipient, "receives on the destination"),
      amountOutMin: f(uint256, "the least the destination may receive"),
    },
    { value: "the quoted native fee, from the Pot" },
  ),
  bridge(
    "cctpBridge",
    "Burns USDC through Circle's CCTP V2 TokenMessenger for minting on the destination.",
    "TokenMessengerV2.depositForBurn",
    {
      tokenMessenger: f(
        contract,
        "the CCTP V2 TokenMessenger; it pulls the token, so approve it first",
      ),
      token: f(token, "the burned token (USDC)"),
      destinationDomain: f(uintN(32), "the destination's CCTP domain"),
      recipient: f(remoteRecipient, "receives the mint on the destination"),
      maxFee: opt(uint256, 'the most the transfer may pay in fees, from the amount; default "0"'),
      minFinalityThreshold: opt(
        uintN(32),
        "2000 waits for finality (standard, the default); 1000 is fast",
      ),
    },
  ),
  bridge(
    "hyperlaneBridge",
    "Transfers through a Hyperlane ERC-20 warp route, paying the interchain gas it quotes.",
    "TokenRouter.quoteGasPayment, then TokenRouter.transferRemote",
    {
      router: f(contract, "the warp route; it pulls the amount plus any fee it charges"),
      destinationDomain: f(uintN(32), "the destination's Hyperlane domain"),
      recipient: f(remoteRecipient, "receives on the destination"),
    },
    { value: "the quoted gas payment, from the Pot" },
  ),

  // -- wrapping -------------------------------------------------------------------------------
  wrap(
    "wrapETH",
    "Wraps native ETH into WETH.",
    "WETH.deposit",
    { weth: f(tokenContract, 'the WETH contract ("WETH")') },
    { output: "passThrough", value: "amount" },
  ),
  wrap(
    "unwrapETH",
    "Unwraps WETH into native ETH.",
    "WETH.withdraw",
    { weth: f(tokenContract, 'the WETH contract ("WETH")') },
    { output: "passThrough" },
  ),
  wrap("wrapStETH", "Wraps stETH into wstETH; the output is the wstETH minted.", "wstETH.wrap", {
    wstETH: f(tokenContract, "the wstETH contract; it pulls the stETH, so approve it first"),
  }),
  wrap("unwrapStETH", "Unwraps wstETH; the output is the stETH returned.", "wstETH.unwrap", {
    wstETH: f(tokenContract, "the wstETH contract"),
  }),

  // -- staking --------------------------------------------------------------------------------
  stake(
    "lidoStake",
    "Stakes native ETH with Lido; the output is the stETH received.",
    "stETH.submit",
    {
      stETH: f(tokenContract, "the stETH contract"),
      referral: opt(address, "Lido's referral; default the zero address"),
    },
    { value: "amount" },
  ),
  stake(
    "lidoUnstake",
    "Requests a Lido withdrawal of stETH; the ETH is claimed later with the withdrawal NFT.",
    "WithdrawalQueueERC721.requestWithdrawals",
    {
      withdrawalQueue: f(
        contract,
        "Lido's withdrawal queue; it pulls the stETH, so approve it first",
      ),
      owner: f(recipient, 'receives the withdrawal NFT; `"self"` is the Pot'),
    },
    { output: "passThrough" },
  ),
  stake(
    "rocketPoolStake",
    "Stakes native ETH with Rocket Pool; the output is the rETH received.",
    "RocketDepositPool.deposit",
    {
      depositPool: f(
        contract,
        "the live RocketDepositPool, which upgrades move; read it from RocketStorage",
      ),
      rETH: f(tokenContract, "the rETH token, whose balance delta is the output"),
    },
    { value: "amount" },
  ),
  stake("rocketPoolUnstake", "Burns rETH; the output is the ETH received.", "rETH.burn", {
    rETH: f(tokenContract, "the rETH token"),
  }),
  stake(
    "etherFiStake",
    "Stakes native ETH with ether.fi; the output is the eETH received.",
    "LiquidityPool.deposit",
    {
      liquidityPool: f(contract, "the ether.fi LiquidityPool"),
      eETH: f(tokenContract, "the eETH token, whose balance delta is the output"),
    },
    { value: "amount" },
  ),

  // -- lending --------------------------------------------------------------------------------
  lending("aaveV3Supply", "Supplies a token to Aave V3.", "Pool.supply", {
    pool: f(contract, "the Aave V3 Pool; it pulls the token, so approve it first"),
    token: f(token, "the asset supplied"),
    onBehalfOf: f(recipient, 'credited with the position; `"self"` is the Pot'),
    referralCode: opt(uintN(16), "Aave's referral code; default 0"),
  }),
  lending(
    "aaveV3Withdraw",
    "Withdraws a token from Aave V3; the output is the amount withdrawn.",
    "Pool.withdraw",
    {
      pool: f(contract, "the Aave V3 Pool"),
      token: f(token, "the asset withdrawn"),
      recipient: f(recipient, 'receives the asset; `"self"` is the Pot'),
    },
    { output: "realized" },
  ),
  lending(
    "aaveV3Borrow",
    "Borrows a token from Aave V3 at the variable rate, the only rate it offers.",
    "Pool.borrow",
    {
      pool: f(contract, "the Aave V3 Pool"),
      token: f(token, "the asset borrowed"),
      onBehalfOf: f(recipient, 'whose collateral backs the debt; `"self"` is the Pot'),
      referralCode: opt(uintN(16), "Aave's referral code; default 0"),
    },
  ),
  lending("aaveV3Repay", "Repays an Aave V3 variable-rate debt.", "Pool.repay", {
    pool: f(contract, "the Aave V3 Pool; it pulls the token, so approve it first"),
    token: f(token, "the asset repaid"),
    onBehalfOf: f(recipient, 'whose debt is repaid; `"self"` is the Pot'),
  }),
  lending("compoundV3Supply", "Supplies a token to a Compound V3 (Comet) market.", "Comet.supply", {
    comet: f(contract, "the Comet market; it pulls the token, so approve it first"),
    token: f(token, "the asset supplied"),
  }),
  lending(
    "compoundV3Withdraw",
    "Withdraws a token from a Compound V3 (Comet) market.",
    "Comet.withdraw",
    {
      comet: f(contract, "the Comet market"),
      token: f(token, "the asset withdrawn"),
    },
  ),

  // -- tokens ---------------------------------------------------------------------------------
  tokens("transfer", "Transfers an ERC-20 token.", "ERC-20 transfer, checked like SafeERC20", {
    token: f(token, "the token"),
    recipient: f(recipient, 'the receiver; `"self"` is the Pot'),
  }),
  tokens(
    "approve",
    "Approves an ERC-20 spender, resetting a non-zero allowance first.",
    "ERC-20 approve, checked and reset like SafeERC20.forceApprove",
    { token: f(token, "the token"), spender: f(contract, "the spender") },
  ),
  tokens(
    "permit2Approve",
    "Grants a spender a Permit2 allowance; the token must also be approved to Permit2.",
    "Permit2.approve(address,address,uint160,uint48)",
    {
      permit2: f(contract, 'Permit2 ("Permit2.Permit2")'),
      token: f(token, "the token"),
      spender: f(contract, "the spender, such as Balancer V3's router"),
      expiration: f(uintN(48), "Unix seconds after which the allowance lapses"),
    },
  ),

  // -- sources --------------------------------------------------------------------------------
  source(
    "balanceOf",
    "Reads the Pot's balance of a token; the output is that balance.",
    "IERC20.balanceOf(pot)",
    { token: f(token, "the token") },
    { spends: false },
  ),
  source(
    "nativeBalance",
    "Reads the Pot's native balance; the output is that balance.",
    "ctx.selfBalance()",
    {},
    { spends: false },
  ),
  source(
    "argument",
    "Declares a runtime argument of the compiled program; the output is the value supplied.",
    "a `main` parameter",
    { name: f({ k: "identifier" }, "the argument's name; arguments are encoded in order") },
    { spends: false },
  ),
];

/** Every action's specification, by `type`. */
export const ACTION_SPECS: Readonly<Record<ActionType, ActionSpec>> = Object.fromEntries(
  SPECS.map((s) => [s.type, s]),
) as Record<ActionType, ActionSpec>;

/** Every action `type`, in reference order. */
export const ACTION_TYPES: readonly ActionType[] = SPECS.map((s) => s.type);
