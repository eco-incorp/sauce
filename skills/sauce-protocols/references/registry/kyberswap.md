<!-- Generated from the SDK's registries. Do not edit. -->

# KyberSwap (`kyberswap`)

Multi-chain DEX aggregator and concentrated liquidity protocol (Elastic). Features dynamic fees and a meta-aggregation router for best execution across DEXes.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Document | [kyberswap.md](../kyberswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's elasticRouter):

```sauce chain=ethereum
import KyberSwapElasticRouterABI from "./protocols/kyberswap/KyberSwapElasticRouterABI.json";

const ELASTIC_ROUTER = 0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n;

function main() {
  const bound = KyberSwapElasticRouterABI.at(ELASTIC_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | elasticFactory | `0xC7a590291e07B9fe9E64b86c58fD8fC764308C4A` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [Optimism](../../../sauce-chains/references/optimism.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [Polygon](../../../sauce-chains/references/polygon.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Arc](../../../sauce-chains/references/arc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Base](../../../sauce-chains/references/base.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | no registry ABI |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `KyberSwapElasticRouterABI.at(0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `KyberSwapMetaAggregationRouterABI.at(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5n)` |

## ABI

### `KyberSwapElasticRouterABI`

`import KyberSwapElasticRouterABI from "./protocols/kyberswap/KyberSwapElasticRouterABI.json";` Speaks for: elasticRouter.

- `swapExactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP) params) payable returns (uint256 amountOut)`

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouterV2.

- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
