# QuickSwap

The leading DEX on Polygon with V2 (constant product, x*y=k) and V3 (Algebra-based concentrated liquidity with dynamic fees) pools. Low-fee trading powered by Polygon's infrastructure.

## Category

dex | Chains: Polygon

## Key Operations

- **swapV2**: Swap via V2 router with path routing
- **swapV3**: Swap via V3 router with concentrated liquidity (Algebra, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/quickswap";
```

## SauceScript Examples

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
- `limitSqrtPrice`: Set to `0` for no price limit

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

## Key Addresses

| Chain   | Contract      | Address                                      |
| ------- | ------------- | -------------------------------------------- |
| Polygon | V2 Factory    | `0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32` |
| Polygon | V2 Router     | `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff` |
| Polygon | V3 Factory    | `0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28` |
| Polygon | V3 SwapRouter | `0xf5b509bB0909a69B1c207E495f687a596C168e12` |

## ABI Methods

### QuickSwapV2RouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - V2 swap exact input along path
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add V2 LP
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Remove V2 LP

### QuickSwapV3SwapRouterABI

- `exactInputSingle(tuple(address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) -> uint256 amountOut` - V3 concentrated liquidity swap with dynamic fees

## Notes

- V3 uses Algebra protocol (same as Camelot V3): dynamic fees that adjust based on volatility, NOT fixed fee tiers
- V3 uses `limitSqrtPrice` instead of `sqrtPriceLimitX96`
- Polygon-only deployment; the dominant DEX on Polygon alongside Uniswap V3
- V2 uses standard Uniswap V2 interface with 0.3% fee
- Prefer V3 for major pairs (better capital efficiency with dynamic fees)
