# 1inch

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

DEX aggregator that routes swaps across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

## When to use it

- An aggregator: its router fills a swap across many venues along a route its off-chain API
  quotes. Use it for a route the program does not want to choose itself.

## Pitfalls for a program

- The calldata is quoted for one sender, amount and moment: quote it for the Pot (the swap's
  sender) and send it soon.
- Approve the router for exactly `amountIn`, and clear the allowance after.
- The calldata's own minimum is not yours: check the output as a balance delta against your
  `minOut`.

## In a Sauce program

Forward a 1inch quote for the Pot, checked by the WETH received:

```sauce chain=base,arbitrum
function main(amountIn: Uint256, minOut: Uint256, call: bytes, recipient: Address) {
  const before = WETH.balanceOf(pot);
  USDC.approve(Oneinch.AggregationRouterV6, amountIn);
  evm.call(Oneinch.AggregationRouterV6, 0, call);
  const out = WETH.balanceOf(pot) - before;
  require(out >= minOut, "below minOut");
  USDC.approve(Oneinch.AggregationRouterV6, 0);
  WETH.transfer(recipient, out);
}
```

## Category

aggregator | Chains and addresses: [registry/oneinch.md](registry/oneinch.md)

## Key Operations

- **unoswap**: Single-source optimized swap via AggregationRouter
- **swap**: Multi-source aggregated swap with custom routing

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Unoswap (single-source swap)
import { AggregationRouterV6ABI as IAggregationRouterV6 } from "./abis";
function main(
  routerAddress: Address,
  srcToken: Address,
  amount: Uint256,
  minReturn: Uint256,
  dex: Uint256,
): Uint256 {
  const router = IAggregationRouterV6.at(routerAddress);
  return router.unoswap(srcToken, amount, minReturn, dex);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/oneinch.md](registry/oneinch.md).

## Notes

- Same contract address across all 7 chains
- V6 router is the latest version
- unoswap is gas-efficient for single-pool swaps; swap handles complex multi-hop routes
- `dex` in unoswap packs the pool address with its protocol and swap-direction flags in the high bits
- Fusion mode enables gasless swaps via order matching (off-chain, not in ABI)
- Approve srcToken to aggregationRouterV6 before swapping
