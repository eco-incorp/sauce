<!-- Generated from the SDK's registries. Do not edit. -->

# QuickSwap (`quickswap`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> QuickSwap is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

The leading DEX on Polygon with V2 (constant product, x*y=k) and V3 (Algebra-based concentrated liquidity with dynamic fees) pools. Low-fee trading powered by Polygon's infrastructure.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Quickswap` on polygon |
| Chains | polygon |

## What it offers

- **swapV2**: Swap via V2 router with path routing
- **swapV3**: Swap via V3 router with concentrated liquidity (Algebra, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## Notes

- V3 uses Algebra protocol (same as Camelot V3): dynamic fees that adjust based on volatility, NOT fixed fee tiers
- V3 uses `limitSqrtPrice` instead of `sqrtPriceLimitX96`
- Polygon-only deployment; the dominant DEX on Polygon alongside Uniswap V3
- V2 uses standard Uniswap V2 interface with 0.3% fee
- Prefer V3 for major pairs (better capital efficiency with dynamic fees)

## Its names in a program

On Polygon, `Quickswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Polygon's v2Factory, `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32`.
  require(Quickswap.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../chains/polygon.md) | v2Factory | `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` | `Quickswap.V2Factory` |
| [Polygon](../chains/polygon.md) | v2Router | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` | `Quickswap.V2Router` |
| [Polygon](../chains/polygon.md) | v3Factory | `0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28` | `Quickswap.V3Factory` |
| [Polygon](../chains/polygon.md) | v3SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168e12` | `Quickswap.V3SwapRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `QuickSwapV2FactoryABI`

`import QuickSwapV2FactoryABI from "./protocols/quickswap/QuickSwapV2FactoryABI.json";` Speaks for: v2Factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `Quickswap.V2Pair`

### `QuickSwapV2PairABI`

`import QuickSwapV2PairABI from "./protocols/quickswap/QuickSwapV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `QuickSwapV2RouterABI`

`import QuickSwapV2RouterABI from "./protocols/quickswap/QuickSwapV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `QuickSwapV3FactoryABI`

`import QuickSwapV3FactoryABI from "./protocols/quickswap/QuickSwapV3FactoryABI.json";` Speaks for: v3Factory.

- `poolByPair(address tokenA, address tokenB) view returns (address pool)`: the address is a `Quickswap.V3Pool`

### `QuickSwapV3PoolABI`

`import QuickSwapV3PoolABI from "./protocols/quickswap/QuickSwapV3PoolABI.json";`

- `globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `liquidity() view returns (uint128)`
- `tickSpacing() pure returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `QuickSwapV3SwapRouterABI`

`import QuickSwapV3SwapRouterABI from "./protocols/quickswap/QuickSwapV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
