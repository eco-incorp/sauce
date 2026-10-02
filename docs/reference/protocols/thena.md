<!-- Generated from the SDK's registries. Do not edit. -->

# Thena (`thena`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

BSC-native liquidity layer with ve(3,3) tokenomics. Solidly-fork supporting both volatile (x*y=k) and stable (Curve-like) AMM pools with gauge voting for directing emissions.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thena` on bsc |
| Chains | bsc |

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field, unlike Velodrome/Aerodrome)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: THE token holders vote-lock to direct gauge emissions weekly
- BSC-only deployment; competes with PancakeSwap on BSC
- LP tokens can be staked in gauges for THE emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On BNB Chain, `Thena` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's routerV2, `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109`.
  require(Thena.RouterV2 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | routerV2 | `0xd4ae6eCA985340Dd434D38F470aCCce4DC78D109` | `Thena.RouterV2` |

## ABI

### `ThenaRouterABI`

`import ThenaRouterABI from "./protocols/thena/ThenaRouterABI.json";` Speaks for: routerV2.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
