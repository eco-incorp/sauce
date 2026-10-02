<!-- Generated from the SDK's registries. Do not edit. -->

# Velodrome (`velodrome`)

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

The central trading and liquidity marketplace on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable (correlated assets) and volatile (uncorrelated assets) pool types.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Velodrome` on optimism |
| Chains | optimism |

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- Two pool types: `stable=true` for correlated assets (uses Curve-like invariant), `stable=false` for uncorrelated (uses x*y=k)
- Fees: volatile pools typically 0.3%, stable pools typically 0.04% (set by governance)
- ve(3,3) model: VELO holders vote-lock tokens to direct gauge emissions to pools weekly
- Routes include both `stable` flag and `factory` address per hop
- Optimism-only deployment; Aerodrome is the Base equivalent (same interface)
- LP tokens can be staked in gauges for VELO emissions
- The default DEX on Optimism; preferred for stablecoin swaps (stable pools) and major volatile pairs

## Its names in a program

On Optimism, `Velodrome` is a namespace: its contracts need no import.

```ts
function main() {
  // Optimism's poolFactory, `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a`.
  require(Velodrome.PoolFactory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../chains/optimism.md) | poolFactory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | `Velodrome.PoolFactory` |
| [Optimism](../chains/optimism.md) | routerV2 | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` | `Velodrome.RouterV2` |

## ABI

### `VelodromePoolABI`

`import VelodromePoolABI from "./protocols/velodrome/VelodromePoolABI.json";`

- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stable() view returns (bool)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `VelodromePoolFactoryABI`

`import VelodromePoolFactoryABI from "./protocols/velodrome/VelodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`

### `VelodromeRouterABI`

`import VelodromeRouterABI from "./protocols/velodrome/VelodromeRouterABI.json";` Speaks for: routerV2.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
