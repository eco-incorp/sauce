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
| [Arc](../../../sauce-chains/references/arc.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2`; not on this deployment: `isWhitelist`, `swapGeneric`, `updateWhitelist` |
| [Base](../../../sauce-chains/references/base.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticFactory | `0x5F1dddbf348aC2fbe22a163e30F99F9ECE3DD50a` | `Kyberswap.ElasticFactory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | elasticRouter | `0xC1e7dFE73E1598E3910EF4C7845B68A9Ab6F4c83` | `Kyberswap.ElasticRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | metaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `Kyberswap.MetaAggregationRouterV2` |

## ABI

### `KyberSwapElasticRouterABI`

`import KyberSwapElasticRouterABI from "./protocols/kyberswap/KyberSwapElasticRouterABI.json";` Speaks for: elasticRouter. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Kyberswap` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `factory() view returns (address)`
- `multicall(bytes[] data) payable returns (bytes[] results)`
- `refundEth() payable`
- `swapCallback(int256 deltaQty0, int256 deltaQty1, bytes data)`
- `swapExactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut) params) payable returns (uint256 amountOut)`
- `swapExactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 minAmountOut, uint160 limitSqrtP) params) payable returns (uint256 amountOut)`
- `swapExactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 maxAmountIn) params) payable returns (uint256 amountIn)`
- `swapExactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 maxAmountIn, uint160 limitSqrtP) params) payable returns (uint256 amountIn)`
- `transferAllTokens(address token, uint256 minAmount, address recipient) payable`
- `transferAllTokensWithFee(address token, uint256 minAmount, address recipient, uint256 feeUnits, address feeRecipient) payable`
- `unwrapWeth(uint256 minAmount, address recipient) payable`
- `unwrapWethWithFee(uint256 minAmount, address recipient, uint256 feeUnits, address feeRecipient) payable`
- `WETH() view returns (address)`

### `KyberSwapMetaAggregationRouterABI`

`import KyberSwapMetaAggregationRouterABI from "./protocols/kyberswap/KyberSwapMetaAggregationRouterABI.json";` Speaks for: metaAggregationRouterV2. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Kyberswap` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `isWhitelist(address) view returns (bool)`
- `owner() view returns (address)`
- `renounceOwnership()`
- `rescueFunds(address token, uint256 amount)`
- `swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
- `swapGeneric((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)`
- `swapSimpleMode(address caller, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes executorData, bytes clientData) returns (uint256 returnAmount, uint256 gasUsed)`
- `transferOwnership(address newOwner)`
- `updateWhitelist(address[] addr, bool[] value)`
- `WETH() view returns (address)`

Not on Arc's metaAggregationRouterV2 (`0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`), whose code does not dispatch them or does not declare them as listed here: `isWhitelist`, `swapGeneric`, `updateWhitelist`. Do not call them there: a program compiled for Arc is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.
