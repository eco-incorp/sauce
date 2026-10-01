# Thena

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

BSC-native liquidity layer with ve(3,3) tokenomics. Solidly-fork supporting both volatile (x*y=k) and stable (Curve-like) AMM pools with gauge voting for directing emissions.

## Category

dex | Chains: BSC

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/thena";
```

## SauceScript Examples

### swap

```typescript
import { ThenaRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  stable: bool,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(
    amountIn,
    amountOutMin,
    [{ from: tokenIn, to: tokenOut, stable: stable }],
    recipient,
    99999999999,
  );
}
```

- `routerAddress`: Thena RouterV2 on BSC (`0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated assets)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Thena routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Key Addresses

| Chain | Contract | Address                                      |
| ----- | -------- | -------------------------------------------- |
| BSC   | RouterV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` |

## ABI Methods

### ThenaRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: THE token holders vote-lock to direct gauge emissions weekly
- BSC-only deployment; competes with PancakeSwap on BSC
- LP tokens can be staked in gauges for THE emissions
- Input token must be ERC20-approved to the Router
