<!-- Generated from the SDK's registries. Do not edit. -->

# Lynex (`lynex`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Linea-native ve(3,3) DEX and liquidity marketplace. Solidly-fork with gauge voting and support for both stable and volatile pool types on the Linea zkEVM network.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Lynex` on linea |
| Chains | linea |

## Key Operations

- **swap**: Swap tokens with route-based routing specifying stable or volatile pool type

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { LynexRouterABI as IRouter } from "./abis";

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

- `routerAddress`: Lynex Router on Linea (`0x610D2f07b7EdC67565160F587F37636194C34E74`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `stable`: `true` for stable pools (pegged assets), `false` for volatile pools (uncorrelated)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Routes support multi-hop: `[{from: A, to: B, stable: false}, {from: B, to: C, stable: true}]`
- Note: Lynex routes do NOT include a `factory` field (unlike Velodrome/Aerodrome)

## Notes

- Solidly-fork routes contain `{from, to, stable}` tuples (NO `factory` field)
- Two pool types: `stable=true` for correlated assets, `stable=false` for uncorrelated
- ve(3,3) model: LYNX token holders vote-lock to direct gauge emissions
- Linea-only deployment; the dominant DEX on Linea zkEVM
- LP tokens can be staked in gauges for LYNX emissions
- Input token must be ERC20-approved to the Router

## Its names in a program

On Linea, `Lynex` is a namespace: its contracts need no import.

```ts
function main() {
  // Linea's router, `0x610D2f07b7EdC67565160F587F37636194C34E74`.
  require(Lynex.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Linea](../chains/linea.md) | router | `0x610D2f07b7EdC67565160F587F37636194C34E74` | `Lynex.Router` |

## ABI

### `LynexRouterABI`

`import LynexRouterABI from "./protocols/lynex/LynexRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
