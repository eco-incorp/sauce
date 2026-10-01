# Instadapp

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources to find the cheapest flash loan.

## Category

infrastructure | Chains and addresses: [registry/instadapp.md](registry/instadapp.md)

## Key Operations

- **getRoutes**: Query available flash loan routes and their IDs
- **flashLoan**: Execute a flash loan via optimal route

## SauceScript Examples

```typescript
// Get available flash loan routes
import { FlashAggregatorABI as IFlashAggregator } from "./abis";
function main(aggregatorAddress: Address): Uint256 {
  const aggregator = IFlashAggregator.at(aggregatorAddress);
  aggregator.getRoutes();
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/instadapp.md](registry/instadapp.md).

## Notes

- Aggregates flash loans from: Aave V2/V3, Maker, Balancer, Compound, and others
- Each route has a different fee structure - use getRoutes to find available options
- route parameter selects which underlying protocol to borrow from
- Callback pattern: your contract must implement the receiver interface to repay
- Flash loans must be repaid within the same transaction (atomic)
