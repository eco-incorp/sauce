<!-- Generated from the actions JSON Schema the package ships: every action `sauce actions` takes. Do not edit. -->

# Every action

A sequence of protocol actions that compiles to one Sauce program executing on one chain. Amounts are base-10 strings. A token is a registry symbol ("USDC", or a tokenized stock's, its issuer's ticker: "SPCXc") or an address, and a protocol contract a namespace reference ("UniswapV3.Factory") or an address; a name resolves on the chain the program is compiled for, so a document with no chainId compiles for any chain where its names exist. Beyond this schema, a program must satisfy: every address with mixed-case hex carries a valid EIP-55 checksum; every amount fits its declared width; a first action that takes an amount sets `amount`; an amountRef names a saveOutputAs set by an earlier action, and is not combined with `amount`; argument names are unique; the value of every balanceOf/nativeBalance/argument action is read; and every token symbol and namespace reference exists on the chain it is compiled for.

## The document

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `$schema` | string | no | The schema this document declares; ignored. |
| `version` | `1` | yes |  |
| `chainId` | chain id, an integer ≥ 1 | no | The chain the document is written for; compiling it for another is refused. Leave it out of a document that names its tokens and contracts: it then compiles for any chain where those names exist, the chain chosen when it is compiled. |
| `actions` | array of action (at least 1) | yes | The actions, in execution order. |

## Values

| Value | Takes |
| --- | --- |
| token | A token: a registry symbol, or an address. |
| token or `"native"` | A token: a registry symbol, an address, or "native" for the native currency, which the venue keys as the zero address. |
| contract | A protocol contract: a namespace reference, or an address. |
| token or contract | A contract that is also a token (WETH, wstETH): a registry symbol, a namespace reference, or an address. |
| address | An address: 0x + 40 hex digits. A mixed-case address must carry a valid EIP-55 checksum. |
| address or `"pot"` | An address, or "pot" for the executing Pot. |
| address or 32-byte account | An address, or a 32-byte account on a non-EVM destination (0x + 64 hex digits). |
| hex bytes | 0x-prefixed hex bytes, an even number of digits. |
| 32 bytes | 32 bytes: 0x + 64 hex digits. |
| name | A name that becomes a local variable in the emitted SauceScript. |
| base-10 integer string | Digits only: no sign, exponent or leading zeros. `uint<N>` is the width it must fit. |

## The actions

| Action | Does |
| --- | --- |
| [`uniswapV2Swap`](#uniswapv2swap) | Swaps through one Uniswap V2 pair (or a fork's), priced from its reserves and paid by a push. |
| [`uniswapV3Swap`](#uniswapv3swap) | Swaps through one Uniswap V3 pool (or a fork's), through the Pot's Router, which answers its callback. |
| [`uniswapV4Swap`](#uniswapv4swap) | Swaps through one Uniswap V4 pool, named by its key, through the Pot's Router, which settles with the PoolManager. |
| [`curveSwap`](#curveswap) | Swaps through a Curve pool's 4-argument `exchange`, approving exactly the input; the output is a balance delta. |
| [`balancerV2Swap`](#balancerv2swap) | Swaps through one Balancer V2 pool, approving the Vault for exactly the input. |
| [`dodoV2Swap`](#dodov2swap) | Swaps through one DODO V2 pool (DVM, DPP or DSP), paid by a push. |
| [`traderJoeLBSwap`](#traderjoelbswap) | Swaps through one Trader Joe Liquidity Book pair, paid by a push. |
| [`woofiSwap`](#woofiswap) | Swaps through WOOFi's WooPPV2, paid by a push. |
| [`maverickV2Swap`](#maverickv2swap) | Swaps through one Maverick V2 pool, through the Pot's Router, which pays what the pool asks for. |
| [`curveRouterNGSwap`](#curverouterngswap) | Swaps along a Curve RouterNG route of up to five hops. |
| [`balancerV2BatchSwap`](#balancerv2batchswap) | Swaps along Balancer V2 pools in one batch; the output is a balance delta. |
| [`balancerV3Swap`](#balancerv3swap) | Swaps an exact input through one Balancer V3 pool; the router pays the Pot and pulls through Permit2, or takes a WETH input as native ETH under `wethIsEth`. |
| [`ambientSwap`](#ambientswap) | Swaps through an Ambient (CrocSwap) pool; the dex pays the Pot, and the output is a balance delta. |
| [`dodoV1Swap`](#dodov1swap) | Swaps through legacy DODO V1 (Classical) pairs via the DODO proxy, which pays the Pot. |
| [`carbonSwap`](#carbonswap) | Trades against Carbon strategies by source amount; the controller pays the Pot. |
| [`fraxswapSwap`](#fraxswapswap) | Swaps an exact input along a Fraxswap path; the output is a balance delta. |
| [`fluidDexT1Swap`](#fluiddext1swap) | Swaps an exact ERC-20 input through a Fluid DEX T1 pool. |
| [`acrossBridge`](#acrossbridge) | Deposits into an Across SpokePool for the same token on the destination, less the relayer fee. |
| [`stargateBridge`](#stargatebridge) | Sends through a Stargate V2 ERC-20 pool (taxi), paying the LayerZero fee it quotes. |
| [`cctpBridge`](#cctpbridge) | Burns USDC through Circle's CCTP V2 TokenMessenger for minting on the destination. |
| [`hyperlaneBridge`](#hyperlanebridge) | Transfers through a Hyperlane ERC-20 warp route, paying the interchain gas it quotes. |
| [`wrapETH`](#wrapeth) | Wraps native ETH into WETH. |
| [`unwrapETH`](#unwrapeth) | Unwraps WETH into native ETH. |
| [`wrapStETH`](#wrapsteth) | Wraps stETH into wstETH; the output is the wstETH minted. |
| [`unwrapStETH`](#unwrapsteth) | Unwraps wstETH; the output is the stETH returned. |
| [`lidoStake`](#lidostake) | Stakes native ETH with Lido; the output is the stETH received. |
| [`lidoUnstake`](#lidounstake) | Requests a Lido withdrawal of stETH; the ETH is claimed later with the withdrawal NFT. |
| [`rocketPoolStake`](#rocketpoolstake) | Stakes native ETH with Rocket Pool; the output is the rETH received. |
| [`rocketPoolUnstake`](#rocketpoolunstake) | Burns rETH; the output is the ETH received. |
| [`etherFiStake`](#etherfistake) | Stakes native ETH with ether.fi; the output is the eETH received. |
| [`aaveV3Supply`](#aavev3supply) | Supplies a token to Aave V3. |
| [`aaveV3Withdraw`](#aavev3withdraw) | Withdraws a token from Aave V3; the output is the amount withdrawn. |
| [`aaveV3Borrow`](#aavev3borrow) | Borrows a token from Aave V3 at the variable rate, the only rate it offers. |
| [`aaveV3Repay`](#aavev3repay) | Repays an Aave V3 variable-rate debt. |
| [`compoundV3Supply`](#compoundv3supply) | Supplies a token to a Compound V3 (Comet) market. |
| [`compoundV3Withdraw`](#compoundv3withdraw) | Withdraws a token from a Compound V3 (Comet) market. |
| [`transfer`](#transfer) | Transfers an ERC-20 token. |
| [`approve`](#approve) | Approves an ERC-20 spender, resetting a non-zero allowance first. |
| [`permit2Approve`](#permit2approve) | Grants a spender a Permit2 allowance; the token must also be approved to Permit2. |
| [`balanceOf`](#balanceof) | Reads the Pot's balance of a token; the output is that balance. |
| [`nativeBalance`](#nativebalance) | Reads the Pot's native balance; the output is that balance. |
| [`argument`](#argument) | Declares a runtime argument of the compiled program; the output is the value supplied. |

### uniswapV2Swap

Swaps through one Uniswap V2 pair (or a fork's), priced from its reserves and paid by a push. Calls @sauce/router uniswapV2: pair.getReserves, an ERC-20 transfer to the pair, pair.swap. Give exactly one of: pool; factory.

It names its pool one of 2 ways: `pool`, or `factory`.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"uniswapV2Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | one form (above) | the pair; or leave it out and give `factory` |
| `factory` | contract | one form (above) | instead of `pool`: a Uniswap V2-style factory ("UniswapV2.Factory"), whose getPair(tokenIn, tokenOut) is the pair; the program reads it from the factory on chain and reverts if there is none |
| `tokenIn` | token | yes | the token sold, pushed to the pair |
| `tokenOut` | token | yes | the token bought; the direction is the pair's sort order |
| `feePpm` | integer 0–999999 | no | the pair's LP fee in parts per million; absent or 0 is 3000 (0.30%), PancakeSwap V2 is 2500 |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### uniswapV3Swap

Swaps through one Uniswap V3 pool (or a fork's), through the Pot's Router, which answers its callback. Calls @sauce/router uniswapV3: Router.swapV3. Give exactly one of: pool; factory + fee; factory + tickSpacing.

It names its pool one of 3 ways: `pool`, or `factory` + `fee`, or `factory` + `tickSpacing`.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"uniswapV3Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | one form (above) | the pool; or leave it out and give `factory` with `fee` or `tickSpacing` |
| `factory` | contract | one form (above) | instead of `pool`: the factory whose getPool(tokenIn, tokenOut, key) is the pool — a Uniswap V3-style factory with `fee` ("UniswapV3.Factory", "PancakeswapV3.Factory"), or Aerodrome Slipstream's with `tickSpacing` ("AerodromeSlipstream.CLFactory"); the program reads it from the factory on chain and reverts if there is none |
| `fee` | integer 0–16777215 | one form (above) | with `factory`: the pool's fee tier, in hundredths of a bip (500 is 0.05%) |
| `tickSpacing` | integer 1–8388607 | one form (above) | with a Slipstream `factory`: the pool's tick spacing |
| `tokenIn` | token | yes | the token sold |
| `tokenOut` | token | yes | the token bought |
| `sqrtPriceLimitX96` | base-10 integer string, uint160 | no | a price at which the swap stops, leaving the rest of the input in the Pot; absent or 0 for none |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### uniswapV4Swap

Swaps through one Uniswap V4 pool, named by its key, through the Pot's Router, which settles with the PoolManager. Calls @sauce/router uniswapV4: Router.swapV4.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"uniswapV4Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `poolManager` | contract | yes | the PoolManager ("UniswapV4.PoolManager") |
| `tokenIn` | token or `"native"` | yes | the token sold; "native" is the native currency |
| `tokenOut` | token or `"native"` | yes | the token bought; "native" is the native currency |
| `fee` | integer 0–16777215 | yes | the pool key's fee, in hundredths of a bip |
| `tickSpacing` | integer 1–32767 | yes | the pool key's tick spacing |
| `hooks` | contract | no | the pool key's hooks contract; absent for a pool with none |
| `sqrtPriceLimitX96` | base-10 integer string, uint160 | no | a price at which the swap stops, leaving the rest of the input in the Pot; absent or 0 for none |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### curveSwap

Swaps through a Curve pool's 4-argument `exchange`, approving exactly the input; the output is a balance delta. Calls @sauce/router curve: an exact ERC-20 approval, then pool.exchange(int128|uint256 i, j, dx, min_dy).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"curveSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the Curve pool |
| `tokenIn` | token | yes | the token sold, approved to the pool for exactly the amount |
| `tokenOut` | token | yes | the token bought, whose balance delta is the output |
| `i` | integer 0–7 | yes | the pool index of the coin sold |
| `j` | integer 0–7 | yes | the pool index of the coin bought |
| `indexType` | `"int128"` or `"uint256"` | yes | the pool's index type: int128 for StableSwap and NG pools, uint256 for CryptoSwap |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot; the pool pays the Pot, which forwards it with a transfer |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### balancerV2Swap

Swaps through one Balancer V2 pool, approving the Vault for exactly the input. Calls @sauce/router balancerV2: an exact ERC-20 approval, then Vault.swap (GIVEN_IN).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"balancerV2Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `vault` | contract | yes | the Balancer V2 Vault |
| `poolId` | 32 bytes | yes | the pool id |
| `tokenIn` | token | yes | the token sold, approved to the Vault for exactly the amount |
| `tokenOut` | token | yes | the token bought |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### dodoV2Swap

Swaps through one DODO V2 pool (DVM, DPP or DSP), paid by a push. Calls @sauce/router dodoV2: an ERC-20 transfer to the pool, then sellBase(to) or sellQuote(to).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"dodoV2Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the pool |
| `tokenIn` | token | yes | the token sold, pushed to the pool |
| `tokenOut` | token | yes | the token bought |
| `baseToken` | token | yes | the pool's base token; tokenIn and tokenOut must be base and quote |
| `quoteToken` | token | yes | the pool's quote token |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### traderJoeLBSwap

Swaps through one Trader Joe Liquidity Book pair, paid by a push. Calls @sauce/router traderJoeLB: an ERC-20 transfer to the pair, then pair.swap(swapForY, to). Give exactly one of: pool; factory + binStep. Give tokenX + tokenY together or not at all.

It names its pool one of 2 ways: `pool`, or `factory` + `binStep`.
Give `tokenX` and `tokenY` together or not at all.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"traderJoeLBSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | one form (above) | the pair; or leave it out and give `factory` with `binStep` |
| `factory` | contract | one form (above) | instead of `pool`: the LBFactory ("TraderJoe.LBFactory"), whose getLBPairInformation(tokenIn, tokenOut, binStep) names the pair; the program reads it from the factory on chain and reverts if there is none |
| `binStep` | integer 1–65535 | one form (above) | with `factory`: the pair's bin step |
| `tokenIn` | token | yes | the token sold, pushed to the pair |
| `tokenOut` | token | yes | the token bought |
| `tokenX` | token | no | the pair's token X; tokenIn and tokenOut must be X and Y. Leave tokenX and tokenY out to read them from the pair |
| `tokenY` | token | no | the pair's token Y |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### woofiSwap

Swaps through WOOFi's WooPPV2, paid by a push. Calls @sauce/router woofi: an ERC-20 transfer to the pool, then WooPPV2.swap.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"woofiSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the WooPPV2 itself, not the WooRouterV2 |
| `tokenIn` | token | yes | the token sold, pushed to the pool |
| `tokenOut` | token | yes | the token bought |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted, as the pool's own minToAmount; required and positive, because the pool prices from an oracle |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### maverickV2Swap

Swaps through one Maverick V2 pool, through the Pot's Router, which pays what the pool asks for. Calls @sauce/router maverickV2: Router.swapMaverickV2.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"maverickV2Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the pool |
| `tokenIn` | token | yes | the token sold |
| `tokenOut` | token | yes | the token bought |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### curveRouterNGSwap

Swaps along a Curve RouterNG route of up to five hops. Calls RouterNG.exchange(address[11],uint256[5][5],uint256,uint256,address[5],address).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"curveRouterNGSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `router` | contract | yes | the Curve RouterNG |
| `route` | array of token or contract (at least 1, at most 11) | yes | the route, tokens and pools alternating; padded to 11 with zero addresses |
| `swapParams` | array of [integer 0–255, integer 0–255, integer 0–255, integer 0–255, integer 0–255] (at least 1, at most 5) | yes | per hop: [i, j, swap_type, pool_type, n_coins]; padded to 5 rows |
| `pools` | array of contract (at most 5) | yes | a zap pool where a hop needs one; padded to 5 |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### balancerV2BatchSwap

Swaps along Balancer V2 pools in one batch; the output is a balance delta. Calls Vault.batchSwap.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"balancerV2BatchSwap"` | yes | the action |
| `vault` | contract | yes | the Balancer V2 Vault |
| `steps` | array of objects (below) (at least 1) | yes | the batch's steps; the last step's output asset is the output |
| `assets` | array of token or `"native"` (at least 2) | yes | each asset the steps index, once only (including symbol/address aliases); "native" and the zero address are the same native currency |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least net payout of the last step's output asset; at most 2^255 inclusive, so its negative Vault limit fits int256 |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `deadline` | integer ≥ 0 | yes | Unix seconds after which the venue reverts |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

Each `steps` entry:

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `poolId` | 32 bytes | yes | the step's pool id |
| `assetInIndex` | integer 0–255 | yes | index into `assets` of the step's input |
| `assetOutIndex` | integer 0–255 | yes | index into `assets` of the step's output |
| `amount` | base-10 integer string, uint256 | yes | the step's input; 0 spends the previous step's output |

### balancerV3Swap

Swaps an exact input through one Balancer V3 pool; the router pays the Pot and pulls through Permit2, or takes a WETH input as native ETH under `wethIsEth`. Calls Router.swapSingleTokenExactIn.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"balancerV3Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `router` | contract | yes | the Balancer V3 Router |
| `pool` | contract | yes | the pool |
| `tokenIn` | token | yes | the token sold |
| `tokenOut` | token | yes | the token bought |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `deadline` | integer ≥ 0 | yes | Unix seconds after which the venue reverts |
| `wethIsEth` | true or false | yes | true to trade the router's WETH as native ETH: a WETH input is paid from the Pot's ETH, sent as the call's value, and needs no Permit2 allowance; a WETH output is paid to the Pot as ETH |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### ambientSwap

Swaps through an Ambient (CrocSwap) pool; the dex pays the Pot, and the output is a balance delta. Calls CrocSwapDex.userCmd(1, abi.encode(...)).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"ambientSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `dex` | contract | yes | the CrocSwapDex |
| `base` | token or `"native"` | yes | the pool's base token (numerically lower) |
| `quote` | token | yes | the pool's quote token |
| `poolIdx` | integer ≥ 0 | yes | the pool type index (420 is the standard pool) |
| `isBuy` | true or false | yes | true pays base and receives quote |
| `inBaseQty` | true or false | yes | true when the amount is denominated in the base token; it must equal `isBuy`, so the amount is what the swap spends |
| `tip` | integer 0–65535 | yes | 0 accepts the pool's default fee |
| `limitPrice` | base-10 integer string, uint128 | yes | the worst acceptable price, as a Q64.64 square-root price |
| `amountOutMin` | base-10 integer string, uint128 | yes | the least output accepted; the dex reverts below it |
| `reserveFlags` | integer 0–255 | yes | 0x1 settles base from surplus, 0x2 quote |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### dodoV1Swap

Swaps through legacy DODO V1 (Classical) pairs via the DODO proxy, which pays the Pot. Calls DODOProxy.dodoSwapV1.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"dodoV1Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `proxy` | contract | yes | the DODO proxy; approvals go to DODOApprove, not to it |
| `tokenIn` | token | yes | the token sold |
| `tokenOut` | token | yes | the token bought |
| `pairs` | array of contract (at least 1) | yes | the V1 pairs to route through |
| `directions` | integer ≥ 0 | yes | a bit per pair: 0 sells base, 1 sells quote |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `deadline` | integer ≥ 0 | yes | Unix seconds after which the venue reverts |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### carbonSwap

Trades against Carbon strategies by source amount; the controller pays the Pot. Calls CarbonController.tradeBySourceAmount.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"carbonSwap"` | yes | the action |
| `controller` | contract | yes | the CarbonController |
| `sourceToken` | token | yes | the token sold |
| `targetToken` | token | yes | the token bought |
| `tradeActions` | array of objects (below) (at least 1) | yes | the source amount per strategy; together they are the trade |
| `amountOutMin` | base-10 integer string, uint128 | yes | the least output accepted; the controller reverts below it |
| `deadline` | integer ≥ 0 | yes | Unix seconds after which the venue reverts |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

Each `tradeActions` entry:

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `strategyId` | base-10 integer string, uint256 | yes | the strategy |
| `amount` | base-10 integer string, uint128 | yes | the source amount traded against it |

### fraxswapSwap

Swaps an exact input along a Fraxswap path; the output is a balance delta. Calls FraxswapRouter.swapExactTokensForTokens.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"fraxswapSwap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `router` | contract | yes | the Fraxswap router |
| `path` | array of token (at least 2) | yes | the token path; the last token is the output |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `deadline` | integer ≥ 0 | yes | Unix seconds after which the venue reverts |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### fluidDexT1Swap

Swaps an exact ERC-20 input through a Fluid DEX T1 pool. Calls FluidDexT1.swapIn.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"fluidDexT1Swap"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the pool |
| `swap0to1` | true or false | yes | true sells token0 |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least output accepted; the venue reverts below it |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### acrossBridge

Deposits into an Across SpokePool for the same token on the destination, less the relayer fee. Calls SpokePool.depositV3.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"acrossBridge"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `spokePool` | contract | yes | the origin SpokePool; it pulls the token, so approve it first |
| `token` | token | yes | the token bridged (input and output) |
| `destChainId` | integer ≥ 1 | yes | the destination chain id |
| `recipient` | address | yes | receives on the destination |
| `relayerFee` | base-10 integer string, uint256 | yes | kept by the relayer: the destination receives `amount - relayerFee` |
| `quoteTimestamp` | integer 0–4294967295 | yes | the timestamp the fee was quoted at |
| `fillDeadline` | integer 0–4294967295 | yes | Unix seconds by which a relayer must fill |
| `exclusivityDeadline` | integer 0–4294967295 | yes | Unix seconds of relayer exclusivity; 0 for none |
| `message` | hex bytes | yes | delivered with the fill; 0x for none |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### stargateBridge

Sends through a Stargate V2 ERC-20 pool (taxi), paying the LayerZero fee it quotes. Calls StargatePool.quoteSend, then StargatePool.send.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"stargateBridge"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the StargatePool; it pulls the token, so approve it first |
| `dstEid` | integer 0–4294967295 | yes | the destination's LayerZero endpoint id |
| `recipient` | address or 32-byte account | yes | receives on the destination |
| `amountOutMin` | base-10 integer string, uint256 | yes | the least the destination may receive |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### cctpBridge

Burns USDC through Circle's CCTP V2 TokenMessenger for minting on the destination. Calls TokenMessengerV2.depositForBurn.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"cctpBridge"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `tokenMessenger` | contract | yes | the CCTP V2 TokenMessenger; it pulls the token, so approve it first |
| `token` | token | yes | the burned token (USDC) |
| `destinationDomain` | integer 0–4294967295 | yes | the destination's CCTP domain |
| `recipient` | address or 32-byte account | yes | receives the mint on the destination |
| `maxFee` | base-10 integer string, uint256 | no | the most the transfer may pay in fees, from the amount; default "0" |
| `minFinalityThreshold` | integer 0–4294967295 | no | 2000 waits for finality (standard, the default); 1000 is fast |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### hyperlaneBridge

Transfers through a Hyperlane ERC-20 warp route, paying the interchain gas it quotes. Calls TokenRouter.quoteGasPayment, then TokenRouter.transferRemote.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"hyperlaneBridge"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `router` | contract | yes | the warp route; it pulls the amount plus any fee it charges |
| `destinationDomain` | integer 0–4294967295 | yes | the destination's Hyperlane domain |
| `recipient` | address or 32-byte account | yes | receives on the destination |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### wrapETH

Wraps native ETH into WETH. Calls WETH.deposit.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"wrapETH"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `weth` | token or contract | yes | the WETH contract ("WETH") |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### unwrapETH

Unwraps WETH into native ETH. Calls WETH.withdraw.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"unwrapETH"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `weth` | token or contract | yes | the WETH contract ("WETH") |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### wrapStETH

Wraps stETH into wstETH; the output is the wstETH minted. Calls wstETH.wrap.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"wrapStETH"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `wstETH` | token or contract | yes | the wstETH contract; it pulls the stETH, so approve it first |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### unwrapStETH

Unwraps wstETH; the output is the stETH returned. Calls wstETH.unwrap.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"unwrapStETH"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `wstETH` | token or contract | yes | the wstETH contract |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### lidoStake

Stakes native ETH with Lido; the output is the stETH received. Calls stETH.submit.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"lidoStake"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `stETH` | token or contract | yes | the stETH contract |
| `referral` | address | no | Lido's referral; default the zero address |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### lidoUnstake

Requests a Lido withdrawal of stETH; the ETH is claimed later with the withdrawal NFT. Calls WithdrawalQueueERC721.requestWithdrawals.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"lidoUnstake"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `withdrawalQueue` | contract | yes | Lido's withdrawal queue; it pulls the stETH, so approve it first |
| `owner` | address or `"pot"` | yes | receives the withdrawal NFT; `"pot"` is the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### rocketPoolStake

Stakes native ETH with Rocket Pool; the output is the rETH received. Calls RocketDepositPool.deposit.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"rocketPoolStake"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `depositPool` | contract | yes | the live RocketDepositPool, which upgrades move; read it from RocketStorage |
| `rETH` | token or contract | yes | the rETH token, whose balance delta is the output |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### rocketPoolUnstake

Burns rETH; the output is the ETH received. Calls rETH.burn.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"rocketPoolUnstake"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `rETH` | token or contract | yes | the rETH token |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### etherFiStake

Stakes native ETH with ether.fi; the output is the eETH received. Calls LiquidityPool.deposit.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"etherFiStake"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `liquidityPool` | contract | yes | the ether.fi LiquidityPool |
| `eETH` | token or contract | yes | the eETH token, whose balance delta is the output |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### aaveV3Supply

Supplies a token to Aave V3. Calls Pool.supply.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"aaveV3Supply"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the Aave V3 Pool; it pulls the token, so approve it first |
| `token` | token | yes | the asset supplied |
| `onBehalfOf` | address or `"pot"` | yes | credited with the position; `"pot"` is the Pot |
| `referralCode` | integer 0–65535 | no | Aave's referral code; default 0 |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### aaveV3Withdraw

Withdraws a token from Aave V3; the output is the amount withdrawn. Calls Pool.withdraw.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"aaveV3Withdraw"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the Aave V3 Pool |
| `token` | token | yes | the asset withdrawn |
| `recipient` | address or `"pot"` | yes | receives the output when no later action spends it; `"pot"` keeps it in the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### aaveV3Borrow

Borrows a token from Aave V3 at the variable rate, the only rate it offers. Calls Pool.borrow.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"aaveV3Borrow"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the Aave V3 Pool |
| `token` | token | yes | the asset borrowed |
| `onBehalfOf` | address or `"pot"` | yes | whose collateral backs the debt; `"pot"` is the Pot |
| `referralCode` | integer 0–65535 | no | Aave's referral code; default 0 |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### aaveV3Repay

Repays an Aave V3 variable-rate debt. Calls Pool.repay.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"aaveV3Repay"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `pool` | contract | yes | the Aave V3 Pool; it pulls the token, so approve it first |
| `token` | token | yes | the asset repaid |
| `onBehalfOf` | address or `"pot"` | yes | whose debt is repaid; `"pot"` is the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### compoundV3Supply

Supplies a token to a Compound V3 (Comet) market. Calls Comet.supply.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"compoundV3Supply"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `comet` | contract | yes | the Comet market; it pulls the token, so approve it first |
| `token` | token | yes | the asset supplied |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### compoundV3Withdraw

Withdraws a token from a Compound V3 (Comet) market. Calls Comet.withdraw.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"compoundV3Withdraw"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `comet` | contract | yes | the Comet market |
| `token` | token | yes | the asset withdrawn |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### transfer

Transfers an ERC-20 token. Calls ERC-20 transfer, checked like SafeERC20.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"transfer"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `token` | token | yes | the token |
| `recipient` | address or `"pot"` | yes | the receiver; `"pot"` is the Pot |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### approve

Approves an ERC-20 spender, resetting a non-zero allowance first. Calls ERC-20 approve, checked and reset like SafeERC20.forceApprove.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"approve"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `token` | token | yes | the token |
| `spender` | contract | yes | the spender |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### permit2Approve

Grants a spender a Permit2 allowance; the token must also be approved to Permit2. Calls Permit2.approve(address,address,uint160,uint48).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"permit2Approve"` | yes | the action |
| `amount` | base-10 integer string, uint256 | no | The amount this action spends. Omit it (and amountRef) to spend the previous action's output. |
| `permit2` | contract | yes | Permit2 ("Permit2.Permit2") |
| `token` | token | yes | the token |
| `spender` | contract | yes | the spender, such as Balancer V3's router |
| `expiration` | integer 0–281474976710655 | yes | Unix seconds after which the allowance lapses |
| `amountRef` | name | no | Spend the output an earlier action saved under this name. |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### balanceOf

Reads the Pot's balance of a token; the output is that balance. Calls IERC20.balanceOf(pot).

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"balanceOf"` | yes | the action |
| `token` | token | yes | the token |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### nativeBalance

Reads the Pot's native balance; the output is that balance. Calls pot.balance.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"nativeBalance"` | yes | the action |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |

### argument

Declares a runtime argument of the compiled program; the output is the value supplied. Calls a `main` parameter.

| Field | Value | Required | Meaning |
| --- | --- | --- | --- |
| `type` | `"argument"` | yes | the action |
| `name` | name | yes | the argument's name; arguments are encoded in order |
| `saveOutputAs` | name | no | Save this action's output under a name later actions can reference. |
