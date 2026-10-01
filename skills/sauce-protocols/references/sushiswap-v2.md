# SushiSwap V2

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment. Identical AMM interface to Uniswap V2 (x*y=k constant product) with broader L2 and alt-chain coverage.

## When to use it

- A Uniswap V2 fork: constant-product pairs, 0.3% fee, the same Router interface. Use it where
  its pair is deeper than Uniswap V2's on the chain.

## Pitfalls for a program

- As Uniswap V2: `amountOutMin` is the only bound, approve exactly `amountIn`, pass a deadline.

## In a Sauce program

Sell the Pot's USDC for WETH through the Router:

```sauce chain=arbitrum
function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const self = ctx.self();
  const before = WETH.balanceOf(self);
  USDC.approve(SushiswapV2.Router, amountIn);
  SushiswapV2.Router.swapExactTokensForTokens(amountIn, minOut, [USDC, WETH], self, ctx.timestamp());
  const out = WETH.balanceOf(self) - before;
  require(out >= minOut, "below minOut");
  WETH.transfer(recipient, out);
}
```

## Category

dex | Chains and addresses: [registry/sushiswap-v2.md](registry/sushiswap-v2.md)

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint SLP (SushiSwap LP) tokens
- **removeLiquidity**: Burn SLP tokens to withdraw underlying tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `routerAddress`: SushiSwap Router address for the target chain
- `path`: Ordered token address array for the swap route (e.g., `[tokenIn, WETH, tokenOut]`)
- `amountIn`: Exact input token amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `tokenA` / `tokenB`: Pair token addresses
- `amountADesired` / `amountBDesired`: Ideal deposit amounts (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum deposits (slippage protection)
- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `liquidity`: Amount of SLP tokens to burn
- SLP token must be approved to the router

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/sushiswap-v2.md](registry/sushiswap-v2.md).

## Notes

- Interface is identical to Uniswap V2; same 0.3% fee per hop
- Factory and Router addresses are consistent across Arbitrum, Polygon, BSC, Avalanche, and Fantom
- SLP tokens can be staked in SushiSwap's MasterChef/MiniChef contracts for SUSHI rewards (not in SDK)
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
- Use SushiSwap when Uniswap V2 is not deployed on the target chain, or when SUSHI farming incentives are active
