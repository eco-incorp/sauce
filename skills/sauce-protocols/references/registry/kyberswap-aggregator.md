<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap Aggregator (`kyberswap-aggregator`)

Meta aggregator that routes through multiple aggregators and DEXes for a swap.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `KyberswapAggregator` on ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Chains | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Document | [kyberswap-aggregator.md](../kyberswap-aggregator.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `KyberswapAggregator` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's metaAggregationRouter, `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`.
  require(KyberswapAggregator.MetaAggregationRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Fantom](../../../sauce-chains/references/fantom.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberswapAggregator.MetaAggregationRouter` |
| [Arc](../../../sauce-chains/references/arc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Base](../../../sauce-chains/references/base.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Linea](../../../sauce-chains/references/linea.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |
| [Scroll](../../../sauce-chains/references/scroll.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberswapAggregator.MetaAggregationRouter` |

## ABI

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap-aggregator/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouter.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
