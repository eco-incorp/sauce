# Velodrome

The central trading and liquidity marketplace on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable (correlated assets) and volatile (uncorrelated assets) pool types.

## Category

dex | Chains: Optimism

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/velodrome";
```

## SauceScript Examples

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
- `factory`: Pool factory address (`0x8134a2fdc127549480865fb8e5a9e8a8a95a54c5` on Optimism)
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

## Key Addresses

| Chain    | Contract    | Address                                      |
| -------- | ----------- | -------------------------------------------- |
| Optimism | RouterV2    | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` |
| Optimism | PoolFactory | `0x8134a2fdc127549480865fb8e5a9e8a8a95a54c5` |

## ABI Methods

### VelodromeRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable, address factory) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Remove liquidity from a pool

### VelodromePoolFactoryABI

- `getPool(address tokenA, address tokenB, bool stable) -> address pool` - Look up pool address (view)

## Notes

- Two pool types: `stable=true` for correlated assets (uses Curve-like invariant), `stable=false` for uncorrelated (uses x*y=k)
- Fees: volatile pools typically 0.3%, stable pools typically 0.04% (set by governance)
- ve(3,3) model: VELO holders vote-lock tokens to direct gauge emissions to pools weekly
- Routes include both `stable` flag and `factory` address per hop
- Optimism-only deployment; Aerodrome is the Base equivalent (same interface)
- LP tokens can be staked in gauges for VELO emissions
- The default DEX on Optimism; preferred for stablecoin swaps (stable pools) and major volatile pairs
