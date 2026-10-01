<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap Aggregator (`kyberswap-aggregator`)

Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, fantom, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Document | [kyberswap-aggregator.md](../kyberswap-aggregator.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's metaAggregationRouter):

```sauce chain=ethereum
import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap-aggregator/KyberSwapMetaAggregationRouterABI.json";

const META_AGGREGATION_ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n;

function main() {
  const bound = KyberSwapMetaAggregationRouterABI.at(META_AGGREGATION_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Fantom](../../../sauce-chains/references/fantom.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` | `KyberSwapMetaAggregationRouterABI.at(0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923n)` |
| [Arc](../../../sauce-chains/references/arc.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Base](../../../sauce-chains/references/base.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Linea](../../../sauce-chains/references/linea.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Scroll](../../../sauce-chains/references/scroll.md) | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |

## ABI

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap-aggregator/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouter.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
