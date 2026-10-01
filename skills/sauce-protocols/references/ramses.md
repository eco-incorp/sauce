# Ramses

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Arbitrum-native ve(3,3) DEX with concentrated liquidity support. Features gauge voting, bribes, and protocol-owned liquidity mechanisms. Solidly-fork architecture.

## Category

dex | Chains: Arbitrum

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/ramses";
```

## SauceScript Examples

### swap

```typescript
import { RamsesRouterABI as IRouter } from "./abis";

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

- `routerAddress`: Ramses Router on Arbitrum (`0xAAA87963EFeB6f7E0a2711F397663105Acb1805e`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Ramses routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Arbitrum | Router   | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` |

## ABI Methods

### RamsesRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple[](address from, address to, bool stable) routes, address to, uint256 deadline) -> uint256[] amounts` - Swap with route tuples specifying pool type per hop
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a stable or volatile pool

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: RAM token holders vote-lock to direct gauge emissions and receive bribes
- Arbitrum-only deployment; competes with Camelot on Arbitrum
- Ramses also has concentrated liquidity pools (CL) but the SDK currently exposes the V2 Solidly interface
- LP tokens can be staked in gauges for RAM emissions
- Input token must be ERC20-approved to the Router
