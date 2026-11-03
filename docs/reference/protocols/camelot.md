<!-- Generated from the SDK's registries. Do not edit. -->

# Camelot (`camelot`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Camelot is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Native Arbitrum DEX with dual AMM: V2 constant product pools (with native fee-on-transfer token support) and V3 concentrated liquidity pools (Algebra-based with dynamic fees, no fixed fee tiers).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Camelot` on arbitrum |
| Chains | arbitrum |

## What it offers

- **swapV2**: Swap via V2 router with fee-on-transfer token support and referral tracking
- **swapV3**: Swap via V3 concentrated liquidity router (Algebra-based, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## Notes

- V2 router uses `swapExactTokensForTokensSupportingFeeOnTransferTokens` (not standard `swapExactTokensForTokens`) which natively handles rebasing/tax tokens
- V2 router includes a `referrer` parameter for referral fee sharing
- V3 uses Algebra protocol (dynamic fees that adjust based on volatility, NOT fixed fee tiers like Uniswap V3)
- V3 uses `limitSqrtPrice` instead of `sqrtPriceLimitX96`
- Arbitrum-only deployment

## Its names in a program

On Arbitrum One, `Camelot` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's v2Factory, `0x6EcCab422D763aC031210895C81787E87B43A652`.
  require(Camelot.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | `Camelot.V2Factory` |
| [Arbitrum One](../chains/arbitrum.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `Camelot.V2Router` |
| [Arbitrum One](../chains/arbitrum.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | `Camelot.V3Factory` |
| [Arbitrum One](../chains/arbitrum.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `Camelot.V3SwapRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `CamelotV2FactoryABI`

`import CamelotV2FactoryABI from "./protocols/camelot/CamelotV2FactoryABI.json";` Speaks for: v2Factory. The import is the contract's full ABI across every deployment; call it through the `Camelot` namespace to have a function a chain's deployment does not run refused.

- `allPairs(uint256) view returns (address)`
- `allPairsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB) returns (address pair)`
- `feeInfo() view returns (uint256 _ownerFeeShare, address _feeTo)`
- `feePercentOwner() view returns (address)`
- `feeTo() view returns (address)`
- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `Camelot.V2Pair`
- `owner() view returns (address)`
- `OWNER_FEE_SHARE_MAX() view returns (uint256)`
- `ownerFeeShare() view returns (uint256)`
- `REFERER_FEE_SHARE_MAX() view returns (uint256)`
- `referrersFeeShare(address) view returns (uint256)`
- `setFeePercentOwner(address _feePercentOwner)`
- `setFeeTo(address _feeTo)`
- `setOwner(address _owner)`
- `setOwnerFeeShare(uint256 newOwnerFeeShare)`
- `setReferrerFeeShare(address referrer, uint256 referrerFeeShare)`
- `setSetStableOwner(address _setStableOwner)`
- `setStableOwner() view returns (address)`

### `CamelotV2PairABI`

`import CamelotV2PairABI from "./protocols/camelot/CamelotV2PairABI.json";`

- `allowance(address, address) view returns (uint256)`
- `approve(address spender, uint256 value) returns (bool)`
- `balanceOf(address) view returns (uint256)`
- `burn(address to) returns (uint256 amount0, uint256 amount1)`
- `decimals() view returns (uint8)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `drainWrongToken(address token, address to)`
- `factory() view returns (address)`
- `FEE_DENOMINATOR() view returns (uint256)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint16 _token0FeePercent, uint16 _token1FeePercent)`
- `initialize(address _token0, address _token1)`
- `initialized() view returns (bool)`
- `kLast() view returns (uint256)`
- `MAX_FEE_PERCENT() view returns (uint256)`
- `MINIMUM_LIQUIDITY() view returns (uint256)`
- `mint(address to) returns (uint256 liquidity)`
- `name() view returns (string)`
- `nonces(address) view returns (uint256)`
- `pairTypeImmutable() view returns (bool)`
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `precisionMultiplier0() view returns (uint256)`
- `precisionMultiplier1() view returns (uint256)`
- `setFeePercent(uint16 newToken0FeePercent, uint16 newToken1FeePercent)`
- `setPairTypeImmutable()`
- `setStableSwap(bool stable, uint112 expectedReserve0, uint112 expectedReserve1)`
- `skim(address to)`
- `stableSwap() view returns (bool)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data, address referrer)`
- `symbol() view returns (string)`
- `sync()`
- `token0() view returns (address)`: the address is a token
- `token0FeePercent() view returns (uint16)`
- `token1() view returns (address)`: the address is a token
- `token1FeePercent() view returns (uint16)`
- `totalSupply() view returns (uint256)`
- `transfer(address to, uint256 value) returns (bool)`
- `transferFrom(address from, address to, uint256 value) returns (bool)`

### `CamelotV2RouterABI`

`import CamelotV2RouterABI from "./protocols/camelot/CamelotV2RouterABI.json";` Speaks for: v2Router. The import is the contract's full ABI across every deployment; call it through the `Camelot` namespace to have a function a chain's deployment does not run refused.

- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `factory() view returns (address)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
- `getPair(address token1, address token2) view returns (address)`
- `quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)`
- `removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)`
- `removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline) payable`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `WETH() view returns (address)`

### `CamelotV3FactoryABI`

`import CamelotV3FactoryABI from "./protocols/camelot/CamelotV3FactoryABI.json";` Speaks for: v3Factory. The import is the contract's full ABI across every deployment; call it through the `Camelot` namespace to have a function a chain's deployment does not run refused.

- `baseFeeConfiguration() view returns (uint16 alpha1, uint16 alpha2, uint32 beta1, uint32 beta2, uint16 gamma1, uint16 gamma2, uint32 volumeBeta, uint16 volumeGamma, uint16 baseFee)`
- `createPool(address tokenA, address tokenB) returns (address pool)`
- `defaultCommunityFee() view returns (uint8)`
- `farmingAddress() view returns (address)`
- `owner() view returns (address)`
- `poolByPair(address tokenA, address tokenB) view returns (address pool)`: the address is a `Camelot.V3Pool`
- `poolDeployer() view returns (address)`
- `setBaseFeeConfiguration(uint16 alpha1, uint16 alpha2, uint32 beta1, uint32 beta2, uint16 gamma1, uint16 gamma2, uint32 volumeBeta, uint16 volumeGamma, uint16 baseFee)`
- `setDefaultCommunityFee(uint8 newDefaultCommunityFee)`
- `setFarmingAddress(address _farmingAddress)`
- `setOwner(address _owner)`
- `setVaultAddress(address _vaultAddress)`
- `vaultAddress() view returns (address)`

### `CamelotV3PoolABI`

`import CamelotV3PoolABI from "./protocols/camelot/CamelotV3PoolABI.json";`

- `activeIncentive() view returns (address)`
- `burn(int24 bottomTick, int24 topTick, uint128 amount) returns (uint256 amount0, uint256 amount1)`
- `collect(address recipient, int24 bottomTick, int24 topTick, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `dataStorageOperator() view returns (address)`
- `factory() view returns (address)`
- `flash(address recipient, uint256 amount0, uint256 amount1, bytes data)`
- `getInnerCumulatives(int24 bottomTick, int24 topTick) view returns (int56 innerTickCumulative, uint160 innerSecondsSpentPerLiquidity, uint32 innerSecondsSpent)`
- `getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulatives, uint112[] volatilityCumulatives, uint256[] volumePerAvgLiquiditys)`
- `globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `initialize(uint160 initialPrice)`
- `liquidity() view returns (uint128)`
- `liquidityCooldown() view returns (uint32)`
- `maxLiquidityPerTick() pure returns (uint128)`
- `mint(address sender, address recipient, int24 bottomTick, int24 topTick, uint128 liquidityDesired, bytes data) returns (uint256 amount0, uint256 amount1, uint128 liquidityActual)`
- `positions(bytes32) view returns (uint128 liquidity, uint32 lastLiquidityAddTimestamp, uint256 innerFeeGrowth0Token, uint256 innerFeeGrowth1Token, uint128 fees0, uint128 fees1)`
- `setCommunityFee(uint8 communityFee0, uint8 communityFee1)`
- `setIncentive(address virtualPoolAddress)`
- `setLiquidityCooldown(uint32 newLiquidityCooldown)`
- `setTickSpacing(int24 newTickSpacing)`
- `swap(address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice, bytes data) returns (int256 amount0, int256 amount1)`
- `swapSupportingFeeOnInputTokens(address sender, address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice, bytes data) returns (int256 amount0, int256 amount1)`
- `ticks(int24) view returns (uint128 liquidityTotal, int128 liquidityDelta, uint256 outerFeeGrowth0Token, uint256 outerFeeGrowth1Token, int56 outerTickCumulative, uint160 outerSecondsPerLiquidity, uint32 outerSecondsSpent, bool initialized)`
- `tickSpacing() view returns (int24)`
- `tickTable(int16) view returns (uint256)`
- `timepoints(uint256 index) view returns (bool initialized, uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulative, uint88 volatilityCumulative, int24 averageTick, uint144 volumePerLiquidityCumulative)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `totalFeeGrowth0Token() view returns (uint256)`
- `totalFeeGrowth1Token() view returns (uint256)`

### `CamelotV3SwapRouterABI`

`import CamelotV3SwapRouterABI from "./protocols/camelot/CamelotV3SwapRouterABI.json";` Speaks for: v3SwapRouter. The import is the contract's full ABI across every deployment; call it through the `Camelot` namespace to have a function a chain's deployment does not run refused.

- `algebraSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`
- `exactInputSingleSupportingFeeOnTransferTokens((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 limitSqrtPrice) params) payable returns (uint256 amountIn)`
- `factory() view returns (address)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `poolDeployer() view returns (address)`
- `refundNativeToken() payable`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `unwrapWNativeToken(uint256 amountMinimum, address recipient) payable`
- `unwrapWNativeTokenWithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `WNativeToken() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
