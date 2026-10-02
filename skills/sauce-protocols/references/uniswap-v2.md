# Uniswap V2

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi, deployed across 9 chains with identical interfaces.

## When to use it

- Constant-product pairs, one per token pair, with a 0.3% fee. Simple and everywhere, but with
  more price impact than a V3 pool for the same trade.
- The pair fills in full or reverts, so its Router, with an exact approval and `amountOutMin`,
  strands nothing. A Sauce program trades the pair itself with `@sauce/router`'s `uniswapV2`, with
  no Router and no approval.

## Pitfalls for a program

- `amountOutMin` is the only bound: there is no price limit.
- Through the Router, approve it for exactly `amountIn`, and give a `deadline`
  (`ctx.timestamp()` is this block). `uniswapV2` needs neither: it pushes the input to the pair.
- A fee-on-transfer token needs the `...SupportingFeeOnTransferTokens` variants, which the
  registry ABI does not declare.
- The pair must exist: `Factory.getPair` returns `0` where it does not.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```sauce chain=base,arbitrum
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = UniswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0n, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 3000n, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.3% fee (`3000n` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## Category

dex | Chains and addresses: [registry/uniswap-v2.md](registry/uniswap-v2.md)

## Key Operations

- **swap**: Swap an exact amount of input tokens for as many output tokens as possible, routed through a path of pairs
- **addLiquidity**: Deposit two tokens into a pair to mint LP tokens proportional to pool share
- **removeLiquidity**: Burn LP tokens to withdraw both underlying tokens from a pair

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

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

- `routerAddress`: The Uniswap V2 Router contract address for the target chain
- `path`: Ordered array of token addresses defining the swap route (e.g., `[tokenIn, WETH, tokenOut]` for multi-hop)
- `amountIn`: Exact amount of input token to swap (in wei)
- `amountOutMin`: Minimum acceptable output amount, used for slippage protection
- `recipient`: Address to receive the output tokens
- Deadline is hardcoded to `99999999999` (far future) since Sauce executes atomically

### addLiquidity

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

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

- `tokenA` / `tokenB`: The two token addresses forming the pair
- `amountADesired` / `amountBDesired`: Ideal amounts to deposit (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum amounts to deposit (slippage protection)
- `recipient`: Address to receive the LP tokens
- Both tokens must be approved to the router before calling

### removeLiquidity

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

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
- `amountAMin` / `amountBMin`: Minimum amounts of each token to receive (slippage protection)
- LP token must be approved to the router before calling

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/uniswap-v2.md](registry/uniswap-v2.md).

## Notes

- Path array defines the swap route: `[tokenIn, tokenOut]` for direct swaps, `[tokenIn, WETH, tokenOut]` for multi-hop through WETH
- 0.3% fee per hop, taken from input amount before swap
- Both tokens must be ERC20-approved to the Router before addLiquidity/swap
- LP tokens must be ERC20-approved to the Router before removeLiquidity
- For tokens with transfer taxes (fee-on-transfer), use `swapExactTokensForTokensSupportingFeeOnTransferTokens` instead (not in SDK but available on-chain)
- Uniswap V2 is the simplest and most battle-tested DEX model; prefer V3 for better capital efficiency, but V2 for maximum compatibility and simplicity
- On Arc (5042) the router's `WETH()` is a stub that always reverts with `UnsupportedProtocolError()`, so the ETH paths (`swapExactETHForTokens`, `addLiquidityETH`, …) revert. Trade USDC's ERC-20 `0x3600000000000000000000000000000000000000`; Arc's native coin is USDC and it has no canonical wrapped native
- From a Pot program, `@sauce/router` trades a Uniswap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000n, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0n`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call
