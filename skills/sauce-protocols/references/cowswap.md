# CoW Swap

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) to find optimal prices while protecting users from frontrunning.

## Category

aggregator | Chains and addresses: [registry/cowswap.md](registry/cowswap.md)

## Key Operations

- **preSignOrder**: Pre-sign an order on-chain for execution by solvers
- **invalidateOrder**: Cancel/invalidate a pending order

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/cowswap.md](registry/cowswap.md).

## Notes

- MEV-protected: batch auctions match Coincidence of Wants (overlapping orders) first
- Orders are typically signed off-chain and submitted to CoW Protocol API
- setPreSignature is for smart contracts/multisigs that cannot produce ECDSA signatures
- orderUid encodes: order hash + owner address + validTo timestamp
- Same settlement contract on both Ethereum and Arbitrum
- Approve tokens to the GPv2VaultRelayer (not settlement contract) before trading
