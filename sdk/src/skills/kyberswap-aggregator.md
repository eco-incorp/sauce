# KyberSwap Aggregator

Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.

## Category

aggregator | Chains: Ethereum, Arbitrum, BSC, Polygon, Optimism, Avalanche, Base, Fantom, Linea, Scroll, zkSync

## Key Operations

- **swap**: Execute swap via meta aggregation router

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce/protocols/kyberswap-aggregator";
```

## SauceScript Examples

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

## Key Addresses

| Chain         | Contract              | Address                                      |
| ------------- | --------------------- | -------------------------------------------- |
| All 11 chains | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |

## ABI Methods

### KyberSwapMetaAggregationRouterABI

- `swap(tuple)` - Execute meta-aggregated swap. Payable. Returns (returnAmount, gasUsed). Execution tuple:
  - `callTarget` (address) - Underlying aggregator/DEX contract to call
  - `approveTarget` (address) - Contract to approve tokens to (may differ from callTarget)
  - `targetData` (bytes) - Calldata for the underlying aggregator
  - `desc` (tuple) - Swap description:
    - `srcToken`, `dstToken` - Token addresses
    - `srcReceivers` (address[]), `srcAmounts` (uint256[]) - Fee split receivers/amounts
    - `feeReceivers` (address[]), `feeAmounts` (uint256[]) - Additional fee receivers
    - `dstReceiver` - Output token recipient
    - `amount` - Input amount
    - `minReturnAmount` - Minimum output (slippage protection)
    - `flags` - Behavior flags
    - `permit` (bytes) - EIP-2612 permit data
  - `clientData` (bytes) - Client tracking data

## Notes

- TVL: $500M+. Same address on all 11 chains
- Meta-aggregates across 1inch, 0x, ParaSwap, and other aggregators
- Route computation via KyberSwap API - callTarget/targetData come from API response
- Approve srcToken to metaAggregationRouter before swapping
