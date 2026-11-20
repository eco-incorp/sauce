<!-- Generated from the SDK's registries. Do not edit. -->

# UnitFlow V3 (`unitflow-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> UnitFlow V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Unitflow`: `unitflow-v3` |
| Namespace | `UnitflowV3` on arc |
| Chains | arc |

## Notes

- Pools call back `unitFlowV3SwapCallback`, not `uniswapV3SwapCallback`, so a contract that swaps against a pool directly must implement the renamed callback
- The GitHub README lists testnet addresses; these mainnet addresses are the defaults in UnitFlow's own app build
- From a Pot program, `@sauce/router`'s `uniswapV3` uses the paired execution Router's `swapV3` and `unitFlowV3SwapCallback`. `potRouterUpdate(client, pot)` returns an owner-signed update when the Pot differs from its Kitchen's current Router. Compare addresses with `v12RouterAddress()`; Router releases are content-addressed, not generation-numbered.
- `uniswapV3` is exact input: the Router caps what the callback may take at `amountIn`

## Its names in a program

On Arc, `UnitflowV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Arc's factory, `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d`.
  require(UnitflowV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../chains/arc.md) | factory | `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d` | `UnitflowV3.Factory` |
| [Arc](../chains/arc.md) | quoter | `0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34` | `UnitflowV3.Quoter` |
| [Arc](../chains/arc.md) | router | `0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410` | `UnitflowV3.Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UnitFlowV3FactoryABI`

`import UnitFlowV3FactoryABI from "./protocols/unitflow-v3/UnitFlowV3FactoryABI.json";` Speaks for: factory. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UnitflowV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`
- `enableFeeAmount(uint24 fee, int24 tickSpacing)`
- `feeAmountTickSpacing(uint24 fee) view returns (int24)`
- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `UnitflowV3.Pool`
- `owner() view returns (address)`
- `parameters() view returns (address factory, address token0, address token1, uint24 fee, int24 tickSpacing)`
- `setOwner(address _owner)`

### `UnitFlowV3PoolABI`

`import UnitFlowV3PoolABI from "./protocols/unitflow-v3/UnitFlowV3PoolABI.json";`

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
- `observations(uint256 index) view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized)`
- `observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)`
- `positions(bytes32 key) view returns (uint128 _liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)`
- `protocolFees() view returns (uint128 token0, uint128 token1)`
- `setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1)`
- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `snapshotCumulativesInside(int24 tickLower, int24 tickUpper) view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside)`
- `swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes data) returns (int256 amount0, int256 amount1)`
- `tickBitmap(int16 wordPosition) view returns (uint256)`
- `ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `UnitFlowV3QuoterABI`

`import UnitFlowV3QuoterABI from "./protocols/unitflow-v3/UnitFlowV3QuoterABI.json";` Speaks for: quoter. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UnitflowV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `factory() view returns (address)`
- `quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut)`
- `quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)`
- `quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn)`
- `quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) returns (uint256 amountIn)`
- `unitFlowV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes path) view`
- `USDC() view returns (address)`

### `UnitFlowV3RouterABI`

`import UnitFlowV3RouterABI from "./protocols/unitflow-v3/UnitFlowV3RouterABI.json";` Speaks for: router. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `UnitflowV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `factory() view returns (address)`: the address is a `UnitflowV3.Factory`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `name() view returns (string)`
- `refund(address token, uint256 amountMinimum, address recipient) payable`
- `refundWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowed(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitAllowedIfNecessary(address token, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) payable`
- `selfPermitIfNecessary(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable`
- `sweepToken(address token, uint256 amountMinimum, address recipient) payable`
- `sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable`
- `unitFlowV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes _data)`
- `USDC() view returns (address)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
