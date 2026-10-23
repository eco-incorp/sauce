<!-- Generated from the SDK's registries. Do not edit. -->

# 1inch (`oneinch`)

DEX aggregator that routes swaps across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Oneinch` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [oneinch.md](../oneinch.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Oneinch` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's aggregationRouterV6, `0x111111125421cA6dc452d289314280a0f8842A65`.
  require(Oneinch.AggregationRouterV6 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Optimism](../../../sauce-chains/references/optimism.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Polygon](../../../sauce-chains/references/polygon.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Base](../../../sauce-chains/references/base.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | `Oneinch.AggregationRouterV6` |

## ABI

### `AggregationRouterV6ABI`

`import AggregationRouterV6ABI from "./protocols/oneinch/AggregationRouterV6ABI.json";` Speaks for: aggregationRouterV6.

- `swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)`
- `unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)`
