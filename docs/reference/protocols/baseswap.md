<!-- Generated from the SDK's registries. Do not edit. -->

# BaseSwap (`baseswap`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Base-native DEX with UniV2-style constant product pools (x*y=k). Features yield farming, launchpad, and NFT marketplace. A simple and straightforward fork of Uniswap V2 on Base.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Baseswap` on base |
| Chains | base |

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { BaseSwapRouterABI as IRouter } from "./abis";

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

- `routerAddress`: BaseSwap V2 Router on Base (`0x327Df1E6de05895d2ab08513aaDD9313Fe505d86`)
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { BaseSwapRouterABI as IRouter } from "./abis";

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
import { BaseSwapRouterABI as IRouter } from "./abis";

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

- Standard Uniswap V2 fork interface; 0.3% fee per swap
- Base-only deployment
- For most Base swaps, Aerodrome has higher liquidity; use BaseSwap for pairs where Aerodrome has less depth or when BSWAP farming rewards are active
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity

## Its names in a program

On Base, `Baseswap` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's v2Router, `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86`.
  require(Baseswap.V2Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | v2Router | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` | `Baseswap.V2Router` |

## ABI

### `BaseSwapRouterABI`

`import BaseSwapRouterABI from "./protocols/baseswap/BaseSwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
