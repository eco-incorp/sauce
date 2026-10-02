<!-- Generated from the SDK's registries. Do not edit. -->

# Fenix (`fenix`)

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Blast-native ve(3,3) DEX and liquidity hub. Solidly-fork with concentrated liquidity and gauge voting, leveraging Blast's native yield on ETH and USDB for enhanced LP returns.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Fenix` on blast |
| Chains | blast |

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: FNX token holders vote-lock to direct gauge emissions
- Blast-only deployment; leverages Blast's native yield on ETH and USDB for additional LP returns
- For concentrated liquidity swaps on Blast, consider Thruster (Uniswap V3 fork)
- LP tokens can be staked in gauges for FNX emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On Blast, `Fenix` is a namespace: its contracts need no import.

```ts
function main() {
  // Blast's router, `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE`.
  require(Fenix.Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../chains/blast.md) | router | `0xbD571125856975DBfC2E9b6d1DE496D614D7BAEE` | `Fenix.Router` |

## ABI

### `FenixRouterABI`

`import FenixRouterABI from "./protocols/fenix/FenixRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
