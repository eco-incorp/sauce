<!-- Generated from the SDK's registries. Do not edit. -->

# QuickSwap (`quickswap`)

> QuickSwap is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

The leading DEX on Polygon with V2 (constant product, x*y=k) and V3 (Algebra-based concentrated liquidity with dynamic fees) pools. Low-fee trading powered by Polygon's infrastructure.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Quickswap` on polygon |
| Chains | polygon |

## Key Operations

- **swapV2**: Swap via V2 router with path routing
- **swapV3**: Swap via V3 router with concentrated liquidity (Algebra, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swapV2

```typescript
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
```

- `routerAddress`: QuickSwap V2 Router on Polygon
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### swapV3

```typescript
import { QuickSwapV3SwapRouterABI as ISwapRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    limitSqrtPrice: 0,
  });
}
```

- No `fee` parameter: QuickSwap V3 uses Algebra protocol with dynamic fees (not fixed fee tiers)
- `limitSqrtPrice`: `0` in this template, no price limit, so `amountOutMin` is the only bound. QuickSwap V3 is an Algebra pool, which `@sauce/router`'s `uniswapV3` drives with a real limit through the Pot's Router ([the `@sauce/router` reference](../../api/router.md))

### addLiquidity

```typescript
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  amountADesired: Uint256,
  amountBDesired: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256; liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(
    tokenA,
    tokenB,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- Both tokens must be approved to the V2 router

### removeLiquidity

```typescript
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  liquidity: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(
    tokenA,
    tokenB,
    liquidity,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- LP token must be approved to the V2 router

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

### `QuickSwapV2FactoryABI`

`import QuickSwapV2FactoryABI from "./protocols/quickswap/QuickSwapV2FactoryABI.json";` Speaks for: v2Factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`

### `QuickSwapV2PairABI`

`import QuickSwapV2PairABI from "./protocols/quickswap/QuickSwapV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `QuickSwapV2RouterABI`

`import QuickSwapV2RouterABI from "./protocols/quickswap/QuickSwapV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `QuickSwapV3FactoryABI`

`import QuickSwapV3FactoryABI from "./protocols/quickswap/QuickSwapV3FactoryABI.json";` Speaks for: v3Factory.

- `poolByPair(address tokenA, address tokenB) view returns (address pool)`

### `QuickSwapV3PoolABI`

`import QuickSwapV3PoolABI from "./protocols/quickswap/QuickSwapV3PoolABI.json";`

- `globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `liquidity() view returns (uint128)`
- `tickSpacing() pure returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `QuickSwapV3SwapRouterABI`

`import QuickSwapV3SwapRouterABI from "./protocols/quickswap/QuickSwapV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`
