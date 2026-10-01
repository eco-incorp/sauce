# KyberSwap Aggregator

Meta aggregator that routes through multiple aggregators and DEXes for optimal swap execution.

## Category

aggregator | Chains: Ethereum, Arbitrum, BSC, Polygon, Optimism, Avalanche, Base, Fantom, Linea, Scroll, zkSync, Arc

## Key Operations

- **swap**: Execute swap via meta aggregation router

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/kyberswap-aggregator";
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
| 11 EVM chains | metaAggregationRouter | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| zkSync        | metaAggregationRouter | `0x3F95eF3f2eAca871858dbE20A93c01daF6C2e923` |

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

- TVL: $500M+. Same address on 11 of its 12 chains; zkSync's differs
- Meta-aggregates across 1inch, 0x, ParaSwap, and other aggregators
- Route computation via KyberSwap API - callTarget/targetData come from API response
- Approve srcToken to metaAggregationRouter before swapping
- On Arc (5042) the router at this address is a smaller build than Ethereum's (13724 vs 18652 bytes, a different owner, no `swapGeneric`/whitelist functions). Its `swap` has the same selector, struct and outputs (Blockscout-verified `MetaAggregationRouterV2`), and Kyber's Arc API builds calldata that decodes under this ABI. Native input uses the `0xEeee…EEeE` sentinel with `msg.value` in Arc's 18-decimal native USDC; Kyber's own routes use the ERC-20 `0x3600…0000` with 6-decimal amounts
