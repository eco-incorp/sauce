<!-- Generated from the SDK's registries. Do not edit. -->

# PancakeSwap V3 (`pancakeswap-v3`)

Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Pancakeswap`: `pancakeswap-v2`, `pancakeswap-v3` |
| Namespace | `PancakeswapV3` on ethereum, bsc, base, arbitrum, linea |
| Chains | ethereum, bsc, base, arbitrum, linea |
| Document | [pancakeswap-v3.md](../pancakeswap-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `PancakeswapV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`.
  require(PancakeswapV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | smartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | `PancakeswapV3.SmartRouter` |
| [Linea](../../../sauce-chains/references/linea.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Linea](../../../sauce-chains/references/linea.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Linea](../../../sauce-chains/references/linea.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `PancakeSwapV3FactoryABI`

`import PancakeSwapV3FactoryABI from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";` Speaks for: factory. The import is the contract's full ABI across every deployment; call it through the `PancakeswapV3` namespace to have a function a chain's deployment does not run refused.

- `collectProtocol(address pool, address recipient, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`
- `enableFeeAmount(uint24 fee, int24 tickSpacing)`
- `feeAmountTickSpacing(uint24) view returns (int24)`
- `feeAmountTickSpacingExtraInfo(uint24) view returns (bool whitelistRequested, bool enabled)`
- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `PancakeswapV3.Pool`
- `lmPoolDeployer() view returns (address)`
- `owner() view returns (address)`
- `poolDeployer() view returns (address)`
- `setFeeAmountExtraInfo(uint24 fee, bool whitelistRequested, bool enabled)`
- `setFeeProtocol(address pool, uint32 feeProtocol0, uint32 feeProtocol1)`
- `setLmPool(address pool, address lmPool)`
- `setLmPoolDeployer(address _lmPoolDeployer)`
- `setOwner(address _owner)`
- `setWhiteListAddress(address user, bool verified)`

### `PancakeSwapV3NFPMABI`

`import PancakeSwapV3NFPMABI from "./protocols/pancakeswap-v3/PancakeSwapV3NFPMABI.json";` Speaks for: nonfungiblePositionManager. The import is the contract's full ABI across every deployment; call it through the `PancakeswapV3` namespace to have a function a chain's deployment does not run refused.

- `approve(address to, uint256 tokenId)`
- `balanceOf(address owner) view returns (uint256)`
- `baseURI() pure returns (string)`
- `burn(uint256 tokenId) payable`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`
- `createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `deployer() view returns (address)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `factory() view returns (address)`
- `getApproved(uint256 tokenId) view returns (address)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `name() view returns (string)`
- `ownerOf(uint256 tokenId) view returns (address)`
- `pancakeV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes data)`
- `permit(address spender, uint256 tokenId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `PERMIT_TYPEHASH() view returns (bytes32)`
- `positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `refundETH() payable`
- `safeTransferFrom(address from, address to, uint256 tokenId)`
- `safeTransferFrom(address from, address to, uint256 tokenId, bytes _data)`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `setApprovalForAll(address operator, bool approved)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `symbol() view returns (string)`
- `tokenByIndex(uint256 index) view returns (uint256)`
- `tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)`
- `tokenURI(uint256 tokenId) view returns (string)`
- `totalSupply() view returns (uint256)`
- `transferFrom(address from, address to, uint256 tokenId)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `WETH9() view returns (address)`

### `PancakeSwapV3PoolABI`

`import PancakeSwapV3PoolABI from "./protocols/pancakeswap-v3/PancakeSwapV3PoolABI.json";`

- `burn(int24 tickLower, int24 tickUpper, uint128 amount) returns (uint256 amount0, uint256 amount1)`
- `collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `collectProtocol(address recipient, uint128 amount0Requested, uint128 amount1Requested) returns (uint128 amount0, uint128 amount1)`
- `factory() view returns (address)`
- `fee() view returns (uint24)`
- `feeGrowthGlobal0X128() view returns (uint256)`
- `feeGrowthGlobal1X128() view returns (uint256)`
- `flash(address recipient, uint256 amount0, uint256 amount1, bytes data)`
- `increaseObservationCardinalityNext(uint16 observationCardinalityNext)`
- `initialize(uint160 sqrtPriceX96)`
- `liquidity() view returns (uint128)`
- `lmPool() view returns (address)`
- `maxLiquidityPerTick() view returns (uint128)`
- `mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes data) returns (uint256 amount0, uint256 amount1)`
- `observations(uint256) view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)`
- `observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)`
- `positions(bytes32) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `protocolFees() view returns (uint128 token0, uint128 token1)`
- `setFeeProtocol(uint32 feeProtocol0, uint32 feeProtocol1)`
- `setLmPool(address _lmPool)`
- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)`
- `snapshotCumulativesInside(int24 tickLower, int24 tickUpper) view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside)`
- `swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data) returns (int256 amount0, int256 amount1)`
- `tickBitmap(int16) view returns (uint256)`
- `ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `PancakeSwapV3SmartRouterABI`

`import PancakeSwapV3SmartRouterABI from "./protocols/pancakeswap-v3/PancakeSwapV3SmartRouterABI.json";` Speaks for: smartRouter. The import is the contract's full ABI across every deployment; call it through the `PancakeswapV3` namespace to have a function a chain's deployment does not run refused.

- `approveMax(address token) payable`
- `approveMaxMinusOne(address token) payable`
- `approveZeroThenMax(address token) payable`
- `approveZeroThenMaxMinusOne(address token) payable`
- `callPositionManager(bytes data) payable returns (bytes result)`
- `checkOracleSlippage(bytes path, uint24 maximumTickDivergence, uint32 secondsAgo) view`
- `checkOracleSlippage(bytes[] paths, uint128[] amounts, uint24 maximumTickDivergence, uint32 secondsAgo) view`
- `deployer() view returns (address)`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInputStableSwap(address[] path, uint256[] flag, uint256 amountIn, uint256 amountOutMin, address to) payable returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutputStableSwap(address[] path, uint256[] flag, uint256 amountOut, uint256 amountInMax, address to) payable returns (uint256 amountIn)`
- `factory() view returns (address)`
- `factoryV2() view returns (address)`
- `getApprovalType(address token, uint256 amount) returns (uint8)`
- `increaseLiquidity((address token0, address token1, uint256 tokenId, uint256 amount0Min, uint256 amount1Min) params) payable returns (bytes result)`
- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Min, uint256 amount1Min, address recipient) params) payable returns (bytes result)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `multicall(uint256 deadline, bytes[] data) payable returns (bytes[])`
- `owner() view returns (address)`
- `pancakeV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `positionManager() view returns (address)`
- `pull(address token, uint256 value) payable`
- `refundETH() payable`
- `renounceOwnership()`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `setStableSwap(address _factory, address _info)`
- `stableSwapFactory() view returns (address)`
- `stableSwapInfo() view returns (address)`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable returns (uint256 amountIn)`
- `sweepToken(address token, uint256 amountMinimum) payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `transferOwnership(address newOwner)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `WETH9() view returns (address)`
- `wrapETH(uint256 value) payable`

Left out of this ABI, though its deployments declare them:

- `multicall` taking `(bytes32,bytes[])`: an overload of multicall(uint256,bytes[]), which takes as many arguments: a call picks its overload by argument count.
