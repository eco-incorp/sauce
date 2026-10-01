<!-- Generated from the SDK's registries. Do not edit. -->

# Synthra V3 (`synthra-v3`)

Concentrated-liquidity spot DEX on Arc and Robinhood Chain: a Uniswap V3 fork whose pool callbacks are renamed (synthraV3SwapCallback / synthraV3MintCallback).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arc |
| Document | [synthra-v3.md](../synthra-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arc's factory):

```sauce chain=arc
import SynthraV3FactoryABI from "./protocols/synthra-v3/SynthraV3FactoryABI.json";

const FACTORY = 0x6307fc239C7964942c1BfFE51930E55606619c74n;

function main() {
  const bound = SynthraV3FactoryABI.at(FACTORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0x6307fc239C7964942c1BfFE51930E55606619c74` | `SynthraV3FactoryABI.at(0x6307fc239C7964942c1BfFE51930E55606619c74n)` |
| [Arc](../../../sauce-chains/references/arc.md) | nonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` | `SynthraV3NonfungiblePositionManagerABI.at(0x2743b771659fD9CE13970d7367e7e84AF6a31049n)` |
| [Arc](../../../sauce-chains/references/arc.md) | quoterV2 | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` | `SynthraV3QuoterV2ABI.at(0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7n)` |
| [Arc](../../../sauce-chains/references/arc.md) | swapRouter02 | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` | `SynthraV3SwapRouter02ABI.at(0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828n)` |

## ABI

### `SynthraV3FactoryABI`

`import SynthraV3FactoryABI from "./protocols/synthra-v3/SynthraV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`
- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`

### `SynthraV3NonfungiblePositionManagerABI`

`import SynthraV3NonfungiblePositionManagerABI from "./protocols/synthra-v3/SynthraV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`

### `SynthraV3QuoterV2ABI`

`import SynthraV3QuoterV2ABI from "./protocols/synthra-v3/SynthraV3QuoterV2ABI.json";` Speaks for: quoterV2.

- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`

### `SynthraV3SwapRouter02ABI`

`import SynthraV3SwapRouter02ABI from "./protocols/synthra-v3/SynthraV3SwapRouter02ABI.json";` Speaks for: swapRouter02.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`
