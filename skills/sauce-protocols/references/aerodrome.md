# Aerodrome

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

The central trading and liquidity marketplace on Base. Fork of Velodrome with ve(3,3) tokenomics, the largest DEX on Base by TVL ($1B+). Supports both stable and volatile pool types.

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

```sauce chain=base
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

## Category

dex | Chains and addresses: [registry/aerodrome.md](registry/aerodrome.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aerodrome.md](registry/aerodrome.md).

## Notes

- Same interface as Velodrome (forked codebase); Aerodrome is Velodrome's Base deployment
- Two pool types: `stable=true` (Curve-like invariant for pegged assets), `stable=false` (x*y=k for uncorrelated)
- Fees: volatile pools ~0.3%, stable pools ~0.04% (governance-controlled)
- ve(3,3) model: AERO holders vote-lock tokens to direct gauge emissions weekly
- The dominant DEX on Base by TVL and volume; preferred for most Base swaps
- LP tokens can be staked in gauges for AERO emissions
- Routes include both `stable` flag and `factory` address per hop
- This module is the basic (stable/volatile) pools only. Aerodrome's concentrated-liquidity Slipstream pools are the `aerodrome-slipstream` module
