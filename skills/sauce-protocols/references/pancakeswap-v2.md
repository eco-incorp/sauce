# PancakeSwap V2

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

The most popular DEX on BNB Chain using the constant product AMM model (x*y=k). Forked from Uniswap V2 with additional features like yield farming and lottery. Expanded to 6 chains.

## When to use it

- A Uniswap V2 fork with a 0.25% fee, deepest on BNB Chain; the same Router interface.

## Pitfalls for a program

- As Uniswap V2: `amountOutMin` is the only bound; through the Router, approve exactly
  `amountIn` and pass a deadline.
- The 0.25% fee differs from Uniswap V2's 0.3%: quote with this protocol's Router
  (`getAmountsOut`), not Uniswap's formula, and give `uniswapV2` the pair's fee, `2500n` ppm.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```sauce chain=base,arbitrum
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = PancakeswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0n, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 2500n, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.25% fee (`2500n` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## Category

dex | Chains and addresses: [registry/pancakeswap-v2.md](registry/pancakeswap-v2.md)

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint CAKE-LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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

- `routerAddress`: PancakeSwap V2 Router for the target chain
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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

- `amountADesired` / `amountBDesired`: Ideal deposit amounts (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum deposits (slippage protection)
- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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

- `liquidity`: Amount of LP tokens to burn
- LP token must be approved to the router

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/pancakeswap-v2.md](registry/pancakeswap-v2.md).

## Notes

- Same Uniswap V2 interface; 0.25% fee per swap (0.17% to LPs, 0.03% to treasury, 0.05% to CAKE buyback)
- BSC Router address differs from other chains (BSC was the original deployment)
- Arbitrum, Base, Linea, and opBNB share the same Factory and Router addresses
- LP tokens can be staked in MasterChef for CAKE rewards
- PancakeSwap is the default choice for BSC trading; use PancakeSwap V3 for concentrated liquidity
- From a Pot program, `@sauce/router` trades a PancakeSwap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 2500n, minOut, recipient)` — 2500 ppm is PancakeSwap V2's 0.25% fee — reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0n`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call
