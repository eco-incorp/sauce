# Velodrome

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

DEX on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable (correlated assets) and volatile (uncorrelated assets) pool types.

## Category

dex | Chains and addresses: [registry/velodrome.md](registry/velodrome.md)

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
import { VelodromeRouterABI as IRouter } from "./abis";

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

- `routerAddress`: Velodrome RouterV2 address on Optimism
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets like USDC/USDT), `false` for volatile pools (uncorrelated like ETH/USDC)
- `factory`: Pool factory address (`0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` on Optimism)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes array supports multi-hop: `[{from: A, to: B, stable: false, factory: f}, {from: B, to: C, stable: true, factory: f}]`

### addLiquidity

```typescript
import { VelodromeRouterABI as IRouter } from "./abis";

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
import { VelodromeRouterABI as IRouter } from "./abis";

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
[registry/velodrome.md](registry/velodrome.md).

## Notes

- Two pool types: `stable=true` for correlated assets (uses Curve-like invariant), `stable=false` for uncorrelated (uses x*y=k)
- Fees: volatile pools typically 0.3%, stable pools typically 0.04% (set by governance)
- ve(3,3) model: VELO holders vote-lock tokens to direct gauge emissions to pools weekly
- Routes include both `stable` flag and `factory` address per hop
- Optimism-only deployment; Aerodrome is the Base equivalent (same interface)
- LP tokens can be staked in gauges for VELO emissions
