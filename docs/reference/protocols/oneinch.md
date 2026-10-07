<!-- Generated from the SDK's registries. Do not edit. -->

# 1inch (`oneinch`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Leading DEX aggregator that finds optimal swap routes across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Oneinch` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |

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

```ts
function main(amountIn: Uint256, minOut: Uint256, call: bytes, recipient: Address) {
  const self = ctx.self();
  const before = WETH.balanceOf(self);
  USDC.approve(Oneinch.AggregationRouterV6, amountIn);
  evm.call(Oneinch.AggregationRouterV6, 0, call);
  const out = WETH.balanceOf(self) - before;
  require(out >= minOut, "below minOut");
  USDC.approve(Oneinch.AggregationRouterV6, 0);
  WETH.transfer(recipient, out);
}
```

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

## Notes

- Same contract address across all 7 chains
- V6 router is the latest version
- unoswap is gas-efficient for single-pool swaps; swap handles complex multi-hop routes
- `dex` in unoswap packs the pool address with its protocol and swap-direction flags in the high bits
- Fusion mode enables gasless swaps via order matching (off-chain, not in ABI)
- Approve srcToken to aggregationRouterV6 before swapping

## Its names in a program

On Ethereum, `Oneinch` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's aggregationRouterV6, `0x111111125421cA6dc452d289314280a0f8842A65`.
  require(Oneinch.AggregationRouterV6 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Optimism](../chains/optimism.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [BNB Chain](../chains/bsc.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Polygon](../chains/polygon.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Base](../chains/base.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Arbitrum One](../chains/arbitrum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Avalanche C-Chain](../chains/avalanche.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |

## ABI

### `AggregationRouterV6ABI`

`import AggregationRouterV6ABI from "./protocols/oneinch/AggregationRouterV6ABI.json";` Speaks for: aggregationRouterV6.

- `swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)`
- `unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)`
