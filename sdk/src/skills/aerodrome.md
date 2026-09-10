# Aerodrome

The central trading and liquidity marketplace on Base. Fork of Velodrome with ve(3,3) tokenomics, the largest DEX on Base by TVL ($1B+). Supports both stable and volatile pool types.

## Category

dex | Chains: Base

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type
- **addLiquidity**: Add liquidity to a stable or volatile pool
- **removeLiquidity**: Remove liquidity from a stable or volatile pool

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/aerodrome";
```

## SauceScript Examples

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

## Key Addresses

| Chain | Contract    | Address                                      |
| ----- | ----------- | -------------------------------------------- |
| Base  | Router      | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` |
| Base  | PoolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` |

## ABI Methods

### AerodromeRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable, address factory) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Remove liquidity from a pool

### AerodromePoolFactoryABI

- `getPool(address tokenA, address tokenB, bool stable) -> address pool` - Look up pool address (view)

## Notes

- Same interface as Velodrome (forked codebase); Aerodrome is Velodrome's Base deployment
- Two pool types: `stable=true` (Curve-like invariant for pegged assets), `stable=false` (x*y=k for uncorrelated)
- Fees: volatile pools ~0.3%, stable pools ~0.04% (governance-controlled)
- ve(3,3) model: AERO holders vote-lock tokens to direct gauge emissions weekly
- The dominant DEX on Base by TVL and volume; preferred for most Base swaps
- LP tokens can be staked in gauges for AERO emissions
- Routes include both `stable` flag and `factory` address per hop
