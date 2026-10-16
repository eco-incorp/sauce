<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome (`aerodrome`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aerodrome is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

The central trading and liquidity marketplace on Base. Fork of Velodrome with ve(3,3) tokenomics, the largest DEX on Base by TVL ($1B+). Supports both stable and volatile pool types.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Aerodrome` on base |
| Chains | base |

## When to use it

- Solidly-style pools on Base, two per pair: **volatile** (constant product) and **stable** (a
  curve for assets meant to trade near 1:1). Its concentrated-liquidity pools are Aerodrome
  Slipstream (`aerodrome-slipstream`).

## Pitfalls for a program

- Pick the pool type: `getPool(a, b, stable)` and each route's `stable` flag must agree.
- Each route names the factory (`Aerodrome.PoolFactory`).
- `amountOutMin` is the only bound; approve exactly `amountIn` and pass a deadline.
- Fees are set per pool by the factory, not fixed by the pool type.

## In a Sauce program

Sell the Pot's USDC for WETH on the volatile pool:

```ts
function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const self = ctx.self();
  require(Aerodrome.PoolFactory.getPool(USDC, WETH, false) != 0, "no volatile USDC/WETH pool");
  const routes = [{ from: USDC, to: WETH, stable: false, factory: Aerodrome.PoolFactory }];
  const before = WETH.balanceOf(self);
  USDC.approve(Aerodrome.Router, amountIn);
  Aerodrome.Router.swapExactTokensForTokens(amountIn, minOut, routes, self, ctx.timestamp());
  const out = WETH.balanceOf(self) - before;
  require(out >= minOut, "below minOut");
  WETH.transfer(recipient, out);
}
```

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { AerodromeRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  stable: bool,
  factory: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [{ from: tokenIn, to: tokenOut, stable: stable, factory: factory }],
    recipient,
    99999999999,
  );
}
```

- `routerAddress`: Aerodrome Router address on Base
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated assets)
- `factory`: Pool factory address (`0x420DD381b31aEf6683db6B902084cB0FFECe40Da` on Base)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Supports multi-hop routes array

### addLiquidity

```typescript
import { AerodromeRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  stable: bool,
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
    stable,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- `stable`: Must match the pool type you want to provide liquidity to
- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { AerodromeRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  stable: bool,
  liquidity: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(
    tokenA,
    tokenB,
    stable,
    liquidity,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- `liquidity`: Amount of LP tokens to burn
- LP token must be approved to the router

## Notes

- Same interface as Velodrome (forked codebase); Aerodrome is Velodrome's Base deployment
- Two pool types: `stable=true` (Curve-like invariant for pegged assets), `stable=false` (x*y=k for uncorrelated)
- Fees: volatile pools ~0.3%, stable pools ~0.04% (governance-controlled)
- ve(3,3) model: AERO holders vote-lock tokens to direct gauge emissions weekly
- The dominant DEX on Base by TVL and volume; preferred for most Base swaps
- LP tokens can be staked in gauges for AERO emissions
- Routes include both `stable` flag and `factory` address per hop
- This module is the basic (stable/volatile) pools only. Aerodrome's concentrated-liquidity Slipstream pools are the `aerodrome-slipstream` module

## Its names in a program

On Base, `Aerodrome` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's poolFactory, `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`.
  require(Aerodrome.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | poolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | `Aerodrome.PoolFactory` |
| [Base](../chains/base.md) | router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | `Aerodrome.Router` |

## ABI

### `AerodromePoolABI`

`import AerodromePoolABI from "./protocols/aerodrome/AerodromePoolABI.json";`

- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stable() view returns (bool)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `AerodromePoolFactoryABI`

`import AerodromePoolFactoryABI from "./protocols/aerodrome/AerodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`

### `AerodromeRouterABI`

`import AerodromeRouterABI from "./protocols/aerodrome/AerodromeRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
