<!-- Generated from the SDK's registries. Do not edit. -->

# QuickSwap (`quickswap`)

The leading DEX on Polygon with V2 (constant product) and V3 (Algebra concentrated liquidity) pools. Low-fee trading powered by Polygon's infrastructure.

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
  require(Quickswap.V2Factory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../../../sauce-chains/references/polygon.md) | v2Factory | `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` | `Quickswap.V2Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v2Router | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` | `Quickswap.V2Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v3Factory | `0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28` | `Quickswap.V3Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | v3SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168e12` | `Quickswap.V3SwapRouter` |

## ABI

### `QuickSwapV2RouterABI`

`import QuickSwapV2RouterABI from "./protocols/quickswap/QuickSwapV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `QuickSwapV3SwapRouterABI`

`import QuickSwapV3SwapRouterABI from "./protocols/quickswap/QuickSwapV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`
