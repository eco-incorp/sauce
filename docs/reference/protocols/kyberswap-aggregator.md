<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap Aggregator (`kyberswap-aggregator`)

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `KyberswapAggregator` on ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Chains | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |

## Key Operations

- **swap**: Execute swap via meta aggregation router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Swap via KyberSwap meta aggregator
import { KyberSwapMetaAggregationRouterABI as IMetaAggregationRouter } from "./abis";
function main(
  routerAddress: Address,
  callTarget: Address,
  approveTarget: Address,
  targetData: bytes,
  srcToken: Address,
  dstToken: Address,
  dstReceiver: Address,
  amount: Uint256,
  minReturnAmount: Uint256,
  clientData: bytes,
): { returnAmount: Uint256; gasUsed: Uint256 } {
  const router = IMetaAggregationRouter.at(routerAddress);
  return router.swap({
    callTarget: callTarget,
    approveTarget: approveTarget,
    targetData: targetData,
    desc: {
      srcToken: srcToken,
      dstToken: dstToken,
      srcReceivers: [],
      srcAmounts: [],
      feeReceivers: [],
      feeAmounts: [],
      dstReceiver: dstReceiver,
      amount: amount,
      minReturnAmount: minReturnAmount,
      flags: 0,
      permit: 0x00,
    },
    clientData: clientData,
  });
}
```

## Notes

- TVL: $500M+. Same address on 11 of its 12 chains; zkSync's differs
- Meta-aggregates across 1inch, 0x, ParaSwap, and other aggregators
- Route computation via KyberSwap API - callTarget/targetData come from API response
- Approve srcToken to metaAggregationRouter before swapping
- On Arc (5042) the router at this address is a smaller build than Ethereum's (13724 vs 18652 bytes, a different owner, no `swapGeneric`/whitelist functions). Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts

## Its names in a program

On Ethereum, `KyberswapAggregator` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's metaAggregationRouter, `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`.
  require(KyberswapAggregator.MetaAggregationRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Optimism](../chains/optimism.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [BNB Chain](../chains/bsc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Polygon](../chains/polygon.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Fantom](../chains/fantom.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [zkSync Era](../chains/zksync.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberswapAggregator.MetaAggregationRouter` |
| [Arc](../chains/arc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Base](../chains/base.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Arbitrum One](../chains/arbitrum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Avalanche C-Chain](../chains/avalanche.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Linea](../chains/linea.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Scroll](../chains/scroll.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |

## ABI

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap-aggregator/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouter.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
