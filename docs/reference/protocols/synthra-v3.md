<!-- Generated from the SDK's registries. Do not edit. -->

# Synthra V3 (`synthra-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Synthra V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Concentrated-liquidity spot DEX on Arc: a Uniswap V3 fork with renamed pool callbacks.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Synthra`: `synthra-v3` |
| Namespace | `SynthraV3` on arc |
| Chains | arc |

## Notes

- The external ABIs are Uniswap V3's (`getPool`, `exactInputSingle`, `quoteExactInputSingle`, `mint`, …), and the Arc bytecode dispatches every one of them
- Pools call back `synthraV3SwapCallback` (`0x13abb0ca`) and `synthraV3MintCallback`, not the `uniswapV3*` callbacks, so a contract that swaps or mints against a Synthra pool directly must implement the renamed callbacks
- On Arc there is no wrapped native token; pools pair against USDC's ERC-20 interface `0x3600…0000`
- Addresses come from docs.synthra.org's contract-addresses page
- From a Pot program, `@sauce/router`'s `uniswapV3` uses the paired execution Router's `swapV3` and `synthraV3SwapCallback`. `potRouterUpdate(client, pot)` returns an owner-signed update when the Pot differs from its Kitchen's current Router. Compare addresses with `v12RouterAddress()`; Router releases are content-addressed, not generation-numbered.
- `uniswapV3` is exact input: the Router caps what the callback may take at `amountIn`

## Its names in a program

On Arc, `SynthraV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Arc's factory, `0x6307fc239C7964942c1BfFE51930E55606619c74`.
  require(SynthraV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../chains/arc.md) | factory | `0x6307fc239C7964942c1BfFE51930E55606619c74` | `SynthraV3.Factory` |
| [Arc](../chains/arc.md) | nonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` | `SynthraV3.NonfungiblePositionManager` |
| [Arc](../chains/arc.md) | quoterV2 | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` | `SynthraV3.QuoterV2` |
| [Arc](../chains/arc.md) | swapRouter02 | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` | `SynthraV3.SwapRouter02` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `SynthraV3FactoryABI`

`import SynthraV3FactoryABI from "./protocols/synthra-v3/SynthraV3FactoryABI.json";` Speaks for: factory. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthraV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`
- `enableFeeAmount(uint24 fee, int24 tickSpacing)`
- `feeAmountTickSpacing(uint24) view returns (int24)`
- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `SynthraV3.Pool`
- `owner() view returns (address)`
- `parameters() view returns (address factory, address token0, address token1, uint24 fee, int24 tickSpacing)`
- `setOwner(address _owner)`

### `SynthraV3NonfungiblePositionManagerABI`

`import SynthraV3NonfungiblePositionManagerABI from "./protocols/synthra-v3/SynthraV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthraV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `WETH9() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `uniswapV3MintCallback` taking `(uint256,uint256,bytes)`: no captured deployment dispatches it.

### `SynthraV3PoolABI`

`import SynthraV3PoolABI from "./protocols/synthra-v3/SynthraV3PoolABI.json";`

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

### `SynthraV3QuoterV2ABI`

`import SynthraV3QuoterV2ABI from "./protocols/synthra-v3/SynthraV3QuoterV2ABI.json";` Speaks for: quoterV2. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthraV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `factory() view returns (address)`
- `quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`
- `quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
- `quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`
- `WETH9() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `uniswapV3SwapCallback` taking `(int256,int256,bytes)`: no captured deployment dispatches it.

### `SynthraV3SwapRouter02ABI`

`import SynthraV3SwapRouter02ABI from "./protocols/synthra-v3/SynthraV3SwapRouter02ABI.json";` Speaks for: swapRouter02. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthraV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
- `unwrapWETH9(uint256 amountMinimum) payable`
- `unwrapWETH9(uint256 amountMinimum, address recipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, uint256 feeBips, address feeRecipient) payable`
- `unwrapWETH9WithFee(uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `WETH9() view returns (address)`
- `wrapETH(uint256 value) payable`

Left out of this ABI by name, and called by their signature through the namespace:

- `SynthraV3.SwapRouter02["multicall(bytes32,bytes[])"](…)`: `multicall(bytes32 previousBlockhash, bytes[] data) payable returns (bytes[])`; an overload of multicall(uint256,bytes[]), which takes as many arguments: a call by name picks its overload by argument count, so this one is called by its signature.

Left out of this ABI, though its deployments declare them:

- `uniswapV3SwapCallback` taking `(int256,int256,bytes)`: no captured deployment dispatches it.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
