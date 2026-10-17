<!-- Generated from the SDK's registries. Do not edit. -->

# Synthra V3 (`synthra-v3`)

Concentrated-liquidity spot DEX on Arc and Robinhood Chain: a Uniswap V3 fork whose pool callbacks are renamed (synthraV3SwapCallback / synthraV3MintCallback).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Synthra`: `synthra-v3` |
| Namespace | `SynthraV3` on arc |
| Chains | arc |
| Document | [synthra-v3.md](../synthra-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arc, `SynthraV3` is a namespace: its contracts need no import.

```sauce chain=arc
function main() {
  // Arc's factory, `0x6307fc239C7964942c1BfFE51930E55606619c74`.
  require(SynthraV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0x6307fc239C7964942c1BfFE51930E55606619c74` | `SynthraV3.Factory` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` | `SynthraV3.NonfungiblePositionManager` |
| [Arc](../../../sauce-chains/references/arc.md) | quoterV2 | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` | `SynthraV3.QuoterV2` |
| [Arc](../../../sauce-chains/references/arc.md) | swapRouter02 | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` | `SynthraV3.SwapRouter02` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `SynthraV3FactoryABI`

`import SynthraV3FactoryABI from "./protocols/synthra-v3/SynthraV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `SynthraV3.Pool`
- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`

### `SynthraV3NonfungiblePositionManagerABI`

`import SynthraV3NonfungiblePositionManagerABI from "./protocols/synthra-v3/SynthraV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`

### `SynthraV3PoolABI`

`import SynthraV3PoolABI from "./protocols/synthra-v3/SynthraV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `SynthraV3QuoterV2ABI`

`import SynthraV3QuoterV2ABI from "./protocols/synthra-v3/SynthraV3QuoterV2ABI.json";` Speaks for: quoterV2.

- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`

### `SynthraV3SwapRouter02ABI`

`import SynthraV3SwapRouter02ABI from "./protocols/synthra-v3/SynthraV3SwapRouter02ABI.json";` Speaks for: swapRouter02.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
