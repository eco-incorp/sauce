<!-- Generated from the SDK's registries. Do not edit. -->

# SpookySwap (`spookyswap`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

The largest DEX on Fantom with UniV2-style constant product pools (x*y=k). Features yield farming, cross-chain bridges, and limit orders. The default trading venue on the Fantom network.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Spookyswap` on fantom |
| Chains | fantom |

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { SpookySwapRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
```

- `routerAddress`: SpookySwap Router on Fantom (`0xF491e7B69E4244ad4002BC14e878a34207E38c29`)
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { SpookySwapRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
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
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { SpookySwapRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  liquidity: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(
    tokenA,
    tokenB,
    liquidity,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- LP token must be approved to the router

## Notes

- Standard Uniswap V2 fork interface; 0.2% fee per swap (lower than standard 0.3%)
- Fantom-only deployment; the dominant DEX on Fantom
- BOO token is the governance/staking token (stake for xBOO to earn fees)
- SushiSwap is also deployed on Fantom as an alternative
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity

## Its names in a program

On Fantom, `Spookyswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Fantom's v2Router, `0xF491e7B69E4244ad4002BC14e878a34207E38c29`.
  require(Spookyswap.V2Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Fantom](../chains/fantom.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `Spookyswap.V2Router` |

## ABI

### `SpookySwapRouterABI`

`import SpookySwapRouterABI from "./protocols/spookyswap/SpookySwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
