# Fenix

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Blast-native ve(3,3) DEX and liquidity hub. Solidly-fork with concentrated liquidity and gauge voting, leveraging Blast's native yield on ETH and USDB for enhanced LP returns.

## Category

dex | Chains and addresses: [registry/fenix.md](registry/fenix.md)

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## SauceScript Examples

### swap

```typescript
import { FenixRouterABI as IRouter } from "./abis";

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

- `routerAddress`: Fenix Router on Blast (`0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets like USDB/USDC), `false` for volatile pools
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Fenix routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/fenix.md](registry/fenix.md).

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: FNX token holders vote-lock to direct gauge emissions
- Blast-only deployment; leverages Blast's native yield on ETH and USDB for additional LP returns
- For concentrated liquidity swaps on Blast, consider Thruster (Uniswap V3 fork)
- LP tokens can be staked in gauges for FNX emissions
- Input token must be ERC20-approved to the Router
