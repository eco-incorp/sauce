<!-- Generated from the SDK's registries. Do not edit. -->

# Ramses (`ramses`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Arbitrum-native ve(3,3) DEX with concentrated liquidity support. Features gauge voting, bribes, and protocol-owned liquidity mechanisms. Solidly-fork architecture.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Ramses` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: RAM token holders vote-lock to direct gauge emissions and receive bribes
- Arbitrum-only deployment; competes with Camelot on Arbitrum
- Ramses also has concentrated liquidity pools (CL) but the SDK currently exposes the V2 Solidly interface
- LP tokens can be staked in gauges for RAM emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On Arbitrum One, `Ramses` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's router, `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e`.
  require(Ramses.Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | router | `0xAAA87963EFeB6f7E0a2711F397663105Acb1805e` | `Ramses.Router` |

## ABI

### `RamsesRouterABI`

`import RamsesRouterABI from "./protocols/ramses/RamsesRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
