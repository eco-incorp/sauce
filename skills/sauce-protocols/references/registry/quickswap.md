<!-- Generated from the SDK's registries. Do not edit. -->

# QuickSwap (`quickswap`)

DEX on Polygon with V2 (constant product) and V3 (Algebra concentrated liquidity) pools. Low-fee trading powered by Polygon's infrastructure.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Quickswap` on polygon |
| Chains | polygon |
| Document | [quickswap.md](../quickswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Polygon, `Quickswap` is a namespace: its contracts need no import.

```sauce chain=polygon
function main() {
  // Polygon's v2Factory, `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32`.
  require(Quickswap.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../../../sauce-chains/references/polygon.md) | v2Factory | `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` | `Quickswap.V2Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v2Router | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` | `Quickswap.V2Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v3Factory | `0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28` | `Quickswap.V3Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v3SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168E12` | `Quickswap.V3SwapRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `QuickSwapV2FactoryABI`

`import QuickSwapV2FactoryABI from "./protocols/quickswap/QuickSwapV2FactoryABI.json";` Speaks for: v2Factory.

- `allPairs(uint256) view returns (address)`
- `allPairsLength() view returns (uint256)`
- `createPair(address tokenA, address tokenB) returns (address pair)`
- `feeTo() view returns (address)`
- `feeToSetter() view returns (address)`
- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `Quickswap.V2Pair`
- `setFeeTo(address _feeTo)`
- `setFeeToSetter(address _feeToSetter)`

### `QuickSwapV2PairABI`

`import QuickSwapV2PairABI from "./protocols/quickswap/QuickSwapV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `QuickSwapV2RouterABI`

`import QuickSwapV2RouterABI from "./protocols/quickswap/QuickSwapV2RouterABI.json";` Speaks for: v2Router.

- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)`
- `factory() view returns (address)`
- `getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountIn)`
- `getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256 amountOut)`
- `getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
- `quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256 amountB)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountETH)`
- `removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)`
- `removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountETH)`
- `removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountA, uint256 amountB)`
- `swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)`
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable`
- `swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)`
- `swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `WETH() view returns (address)`

### `QuickSwapV3FactoryABI`

`import QuickSwapV3FactoryABI from "./protocols/quickswap/QuickSwapV3FactoryABI.json";` Speaks for: v3Factory.

- `baseFeeConfiguration() view returns (uint16 alpha1, uint16 alpha2, uint32 beta1, uint32 beta2, uint16 gamma1, uint16 gamma2, uint32 volumeBeta, uint16 volumeGamma, uint16 baseFee)`
- `createPool(address tokenA, address tokenB) returns (address pool)`
- `farmingAddress() view returns (address)`
- `owner() view returns (address)`
- `poolByPair(address tokenA, address tokenB) view returns (address pool)`: the address is a `Quickswap.V3Pool`
- `poolDeployer() view returns (address)`
- `setBaseFeeConfiguration(uint16 alpha1, uint16 alpha2, uint32 beta1, uint32 beta2, uint16 gamma1, uint16 gamma2, uint32 volumeBeta, uint16 volumeGamma, uint16 baseFee)`
- `setFarmingAddress(address _farmingAddress)`
- `setOwner(address _owner)`
- `setVaultAddress(address _vaultAddress)`
- `vaultAddress() view returns (address)`

### `QuickSwapV3PoolABI`

`import QuickSwapV3PoolABI from "./protocols/quickswap/QuickSwapV3PoolABI.json";`

- `activeIncentive() view returns (address)`
- `burn(int24 bottomTick, int24 topTick, uint128 amount) returns (uint256 amount0, uint256 amount1)`
- `collect(address recipient, int24 bottomTick, int24 topTick, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `dataStorageOperator() view returns (address)`
- `factory() view returns (address)`
- `flash(address recipient, uint256 amount0, uint256 amount1, bytes data)`
- `getInnerCumulatives(int24 bottomTick, int24 topTick) view returns (int56 innerTickCumulative, uint160 innerSecondsSpentPerLiquidity, uint32 innerSecondsSpent)`
- `getTimepoints(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulatives, uint112[] volatilityCumulatives, uint256[] volumePerAvgLiquiditys)`
- `globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `initialize(uint160 initialPrice)`
- `liquidity() view returns (uint128)`
- `liquidityCooldown() view returns (uint32)`
- `maxLiquidityPerTick() pure returns (uint128)`
- `mint(address sender, address recipient, int24 bottomTick, int24 topTick, uint128 liquidityDesired, bytes data) returns (uint256 amount0, uint256 amount1, uint128 liquidityActual)`
- `positions(bytes32) view returns (uint128 liquidity, uint32 lastLiquidityAddTimestamp, uint256 innerFeeGrowth0Token, uint256 innerFeeGrowth1Token, uint128 fees0, uint128 fees1)`
- `setCommunityFee(uint8 communityFee0, uint8 communityFee1)`
- `setIncentive(address virtualPoolAddress)`
- `setLiquidityCooldown(uint32 newLiquidityCooldown)`
- `swap(address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice, bytes data) returns (int256 amount0, int256 amount1)`
- `swapSupportingFeeOnInputTokens(address sender, address recipient, bool zeroToOne, int256 amountRequired, uint160 limitSqrtPrice, bytes data) returns (int256 amount0, int256 amount1)`
- `ticks(int24) view returns (uint128 liquidityTotal, int128 liquidityDelta, uint256 outerFeeGrowth0Token, uint256 outerFeeGrowth1Token, int56 outerTickCumulative, uint160 outerSecondsPerLiquidity, uint32 outerSecondsSpent, bool initialized)`
- `tickSpacing() pure returns (int24)`
- `tickTable(int16) view returns (uint256)`
- `timepoints(uint256 index) view returns (bool initialized, uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulative, uint88 volatilityCumulative, int24 averageTick, uint144 volumePerLiquidityCumulative)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `totalFeeGrowth0Token() view returns (uint256)`
- `totalFeeGrowth1Token() view returns (uint256)`

### `QuickSwapV3SwapRouterABI`

`import QuickSwapV3SwapRouterABI from "./protocols/quickswap/QuickSwapV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

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
