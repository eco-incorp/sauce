<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap (`kyberswap`)

Multi-chain DEX aggregator and concentrated liquidity protocol (Elastic). Features dynamic fees and a meta-aggregation router that routes across DEXes.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kyberswap` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Document | [kyberswap.md](../kyberswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Kyberswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's elasticFactory, `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A`.
  require(Kyberswap.ElasticFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | elasticFactory | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` | `Kyberswap.ElasticFactory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Arc](../../../sauce-chains/references/arc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Base](../../../sauce-chains/references/base.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |

## ABI

### `KyberSwapElasticRouterABI`

`import KyberSwapElasticRouterABI from "./protocols/kyberswap/KyberSwapElasticRouterABI.json";` Speaks for: elasticRouter.

- `swapExactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP) params) payable returns (uint256 amountOut)`

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouterV2.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
