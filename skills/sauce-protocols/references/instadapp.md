# Instadapp

Flash loan aggregator that routes across Aave, Maker, Balancer and other sources.

## Category

infrastructure | Chains and addresses: [registry/instadapp.md](registry/instadapp.md)

## Key Operations

- **getRoutes**: Query available flash loan routes and their IDs
- **flashLoan**: Execute a flash loan through a route

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
