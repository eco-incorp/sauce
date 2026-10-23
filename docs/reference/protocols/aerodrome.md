<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome (`aerodrome`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aerodrome is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

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
  require(Aerodrome.PoolFactory.getPool(USDC, WETH, false) != 0, "no volatile USDC/WETH pool");
  const routes = [{ from: USDC, to: WETH, stable: false, factory: Aerodrome.PoolFactory }];
  const before = WETH.balanceOf(pot);
  USDC.approve(Aerodrome.Router, amountIn);
  Aerodrome.Router.swapExactTokensForTokens(amountIn, minOut, routes, pot, ctx.timestamp());
  const out = WETH.balanceOf(pot) - before;
  require(out >= minOut, "below minOut");
  WETH.transfer(recipient, out);
}
```

## What it offers

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

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

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `AerodromePoolABI`

`import AerodromePoolABI from "./protocols/aerodrome/AerodromePoolABI.json";`

- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stable() view returns (bool)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `AerodromePoolFactoryABI`

`import AerodromePoolFactoryABI from "./protocols/aerodrome/AerodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`: the address is a `Aerodrome.Pool`

### `AerodromeRouterABI`

`import AerodromeRouterABI from "./protocols/aerodrome/AerodromeRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
