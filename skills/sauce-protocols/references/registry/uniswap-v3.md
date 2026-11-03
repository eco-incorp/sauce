<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V3 (`uniswap-v3`)

Concentrated liquidity AMM allowing LPs to allocate capital within custom price ranges for higher capital efficiency.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV3` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, celo, avalanche |
| Document | [uniswap-v3.md](../uniswap-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `UniswapV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0x1F98431c8aD98523631AE4a59f267346ea31F984`.
  require(UniswapV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Optimism](../../../sauce-chains/references/optimism.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7` | `UniswapV3.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | nonfungiblePositionManager | `0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613` | `UniswapV3.NonfungiblePositionManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | quoterV2 | `0x78D78E420Da98ad378D7799bE8f4AF69033EB077` | `UniswapV3.QuoterV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | swapRouter02 | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | `UniswapV3.SwapRouter02` |
| [Polygon](../../../sauce-chains/references/polygon.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Monad](../../../sauce-chains/references/monad.md) | factory | `0x204FAca1764B154221e35c0d20aBb3c525710498` | `UniswapV3.Factory` |
| [Monad](../../../sauce-chains/references/monad.md) | nonfungiblePositionManager | `0x7197E214c0b767cFB76Fb734ab638E2c192F4E53` | `UniswapV3.NonfungiblePositionManager` |
| [Monad](../../../sauce-chains/references/monad.md) | quoterV2 | `0x661E93cca42AfacB172121EF892830cA3b70F08d` | `UniswapV3.QuoterV2` |
| [Monad](../../../sauce-chains/references/monad.md) | swapRouter02 | `0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900` | `UniswapV3.SwapRouter02` |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0xf0db7b58379503491d857dB50AC9ece64c653918` | `UniswapV3.Factory` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377` | `UniswapV3.NonfungiblePositionManager` |
| [Arc](../../../sauce-chains/references/arc.md) | quoterV2 | `0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468` | `UniswapV3.QuoterV2` |
| [Arc](../../../sauce-chains/references/arc.md) | swapRouter02 | `0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77` | `UniswapV3.SwapRouter02` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `UniswapV3.Factory` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | `UniswapV3.NonfungiblePositionManager` |
| [Base](../../../sauce-chains/references/base.md) | quoterV2 | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | `UniswapV3.QuoterV2` |
| [Base](../../../sauce-chains/references/base.md) | swapRouter02 | `0x2626664c2603336E57B271c5C0b26F421741e481` | `UniswapV3.SwapRouter02` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` | `UniswapV3.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | nonfungiblePositionManager | `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` | `UniswapV3.NonfungiblePositionManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | quoterV2 | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` | `UniswapV3.QuoterV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | swapRouter | `0xE592427A0AEce92De3Edee1F18E0157C05861564` | `UniswapV3.SwapRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | swapRouter02 | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `UniswapV3.SwapRouter02` |
| [Celo](../../../sauce-chains/references/celo.md) | factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` | `UniswapV3.Factory` |
| [Celo](../../../sauce-chains/references/celo.md) | nonfungiblePositionManager | `0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A` | `UniswapV3.NonfungiblePositionManager` |
| [Celo](../../../sauce-chains/references/celo.md) | quoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` | `UniswapV3.QuoterV2` |
| [Celo](../../../sauce-chains/references/celo.md) | swapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` | `UniswapV3.SwapRouter02` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | factory | `0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD` | `UniswapV3.Factory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | nonfungiblePositionManager | `0x655C406EBFa14EE2006250925e54ec43AD184f8B` | `UniswapV3.NonfungiblePositionManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | quoterV2 | `0xbe0F5544EC67e9B3b2D979aaA43f18Fd87E6257F` | `UniswapV3.QuoterV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | swapRouter02 | `0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE` | `UniswapV3.SwapRouter02` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UniswapV3FactoryABI`

`import UniswapV3FactoryABI from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";` Speaks for: factory. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`
- `enableFeeAmount(uint24 fee, int24 tickSpacing)`
- `feeAmountTickSpacing(uint24) view returns (int24)`
- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `UniswapV3.Pool`
- `owner() view returns (address)`
- `parameters() view returns (address factory, address token0, address token1, uint24 fee, int24 tickSpacing)`
- `setOwner(address _owner)`

### `UniswapV3NonfungiblePositionManagerABI`

`import UniswapV3NonfungiblePositionManagerABI from "./protocols/uniswap-v3/UniswapV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `approve(address to, uint256 tokenId)`
- `balanceOf(address owner) view returns (uint256)`
- `baseURI() pure returns (string)`
- `burn(uint256 tokenId) payable`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`
- `createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `factory() view returns (address)`
- `getApproved(uint256 tokenId) view returns (address)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `name() view returns (string)`
- `ownerOf(uint256 tokenId) view returns (address)`
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
- `uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes data)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `WETH9() view returns (address)`

### `UniswapV3PoolABI`

`import UniswapV3PoolABI from "./protocols/uniswap-v3/UniswapV3PoolABI.json";`

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
- `maxLiquidityPerTick() view returns (uint128)`
- `mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes data) returns (uint256 amount0, uint256 amount1)`
- `observations(uint256) view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)`
- `observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)`
- `positions(bytes32) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `protocolFees() view returns (uint128 token0, uint128 token1)`
- `setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1)`
- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `snapshotCumulativesInside(int24 tickLower, int24 tickUpper) view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside)`
- `swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data) returns (int256 amount0, int256 amount1)`
- `tickBitmap(int16) view returns (uint256)`
- `ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `UniswapV3QuoterV2ABI`

`import UniswapV3QuoterV2ABI from "./protocols/uniswap-v3/UniswapV3QuoterV2ABI.json";` Speaks for: quoterV2. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `factory() view returns (address)`
- `quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`
- `quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
- `quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes path) view`
- `WETH9() view returns (address)`

### `UniswapV3SwapRouter02ABI`

`import UniswapV3SwapRouter02ABI from "./protocols/uniswap-v3/UniswapV3SwapRouter02ABI.json";` Speaks for: swapRouter02. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `approveMax(address token) payable`
- `approveMaxMinusOne(address token) payable`
- `approveZeroThenMax(address token) payable`
- `approveZeroThenMaxMinusOne(address token) payable`
- `callPositionManager(bytes data) payable returns (bytes result)`
- `checkOracleSlippage(bytes path, uint24 maximumTickDivergence, uint32 secondsAgo) view`
- `checkOracleSlippage(bytes[] paths, uint128[] amounts, uint24 maximumTickDivergence, uint32 secondsAgo) view`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `factory() view returns (address)`
- `factoryV2() view returns (address)`
- `getApprovalType(address token, uint256 amount) returns (uint8)`
- `increaseLiquidity((address token0, address token1, uint256 tokenId, uint256 amount0Min, uint256 amount1Min) params) payable returns (bytes result)`
- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Min, uint256 amount1Min, address recipient) params) payable returns (bytes result)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `multicall(uint256 deadline, bytes[] data) payable returns (bytes[])`
- `positionManager() view returns (address)`
- `pull(address token, uint256 value) payable`
- `refundETH() payable`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to) payable returns (uint256 amountOut)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to) payable returns (uint256 amountIn)`
- `sweepToken(address token, uint256 amountMinimum) payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `unwrapWETH9(uint256 amountMinimum) payable`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `WETH9() view returns (address)`
- `wrapETH(uint256 value) payable`

Left out of this ABI, though its deployments declare them:

- `multicall` taking `(bytes32,bytes[])`: an overload of multicall(uint256,bytes[]), which takes as many arguments: a call picks its overload by argument count.

### `UniswapV3SwapRouterABI`

`import UniswapV3SwapRouterABI from "./protocols/uniswap-v3/UniswapV3SwapRouterABI.json";` Speaks for: swapRouter. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UniswapV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `factory() view returns (address)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `refundETH() payable`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `WETH9() view returns (address)`
