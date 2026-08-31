# CoW Swap

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) to find optimal prices while protecting users from frontrunning.

## Category
aggregator | Chains: Ethereum, Arbitrum

## Key Operations
- **preSignOrder**: Pre-sign an order on-chain for execution by solvers
- **invalidateOrder**: Cancel/invalidate a pending order

## SDK Usage
```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/cowswap";
```

## SauceScript Examples
```typescript
// Pre-sign order on-chain
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";
function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.setPreSignature(orderUid, true);
  return 1;
}

// Invalidate/cancel order
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";
function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.invalidateOrder(orderUid);
  return 1;
}
```

## Key Addresses
| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` |
| Arbitrum | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` |

## ABI Methods
### GPv2SettlementABI
- `setPreSignature(bytes,bool)` - Pre-sign order on-chain. Params: orderUid (unique order identifier bytes), signed (true to sign, false to unsign). Used for smart contract wallets that cannot sign off-chain
- `invalidateOrder(bytes)` - Invalidate/cancel a pending order. Params: orderUid (order to cancel)

## Notes
- MEV-protected: batch auctions match Coincidence of Wants (overlapping orders) first
- Orders are typically signed off-chain and submitted to CoW Protocol API
- setPreSignature is for smart contracts/multisigs that cannot produce ECDSA signatures
- orderUid encodes: order hash + owner address + validTo timestamp
- Same settlement contract on both Ethereum and Arbitrum
- Approve tokens to the GPv2VaultRelayer (not settlement contract) before trading
