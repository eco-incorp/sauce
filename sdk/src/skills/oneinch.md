# 1inch

Leading DEX aggregator that finds optimal swap routes across multiple liquidity sources. Supports limit orders and Fusion mode for gasless swaps.

## Category

aggregator | Chains: Ethereum, Arbitrum, Optimism, Base, Polygon, BSC, Avalanche

## Key Operations

- **unoswap**: Single-source optimized swap via AggregationRouter
- **swap**: Multi-source aggregated swap with custom routing

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/oneinch";
```

## SauceScript Examples

```typescript
// Unoswap (single-source swap)
import { AggregationRouterV6ABI as IAggregationRouterV6 } from "./abis";
function main(
  routerAddress: Address,
  srcToken: Address,
  amount: Uint256,
  minReturn: Uint256,
): Uint256 {
  const router = IAggregationRouterV6.at(routerAddress);
  return router.unoswap(srcToken, amount, minReturn, []);
}
```

## Key Addresses

| Chain     | Contract            | Address                                      |
| --------- | ------------------- | -------------------------------------------- |
| Ethereum  | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Arbitrum  | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Optimism  | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Base      | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Polygon   | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| BSC       | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |
| Avalanche | aggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` |

## ABI Methods

### AggregationRouterV6ABI

- `swap(address,tuple,bytes)` - Multi-source swap. Params: executor, desc (SwapDescription tuple: srcToken, dstToken, srcReceiver, dstReceiver, amount, minReturnAmount, flags), data (executor calldata). Payable. Returns (returnAmount, spentAmount)
  - SwapDescription tuple: `{ srcToken, dstToken, srcReceiver, dstReceiver, amount, minReturnAmount, flags }`
- `unoswap(address,uint256,uint256,uint256[])` - Single-source optimized swap. Params: srcToken, amount, minReturn, pools (encoded pool addresses with direction flags). Payable. Returns returnAmount

## Notes

- Same contract address across all 7 chains
- V6 router is the latest version
- unoswap is gas-efficient for single-pool swaps; swap handles complex multi-hop routes
- pools[] in unoswap encodes pool addresses with swap direction in high bits
- Fusion mode enables gasless swaps via order matching (off-chain, not in ABI)
- Approve srcToken to aggregationRouterV6 before swapping
