# Chainlink

Decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

## Category

oracle | Chains and addresses: [registry/chainlink.md](registry/chainlink.md)

## Key Operations

- **getLatestPrice**: Read latest price from a Chainlink price feed aggregator

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Get latest price from feed
import { AggregatorV3ABI as IAggregatorV3 } from "./abis";
function main(feedAddress: Address): {
  roundId: Uint256;
  answer: Int256;
  startedAt: Uint256;
  updatedAt: Uint256;
  answeredInRound: Uint256;
} {
  const feed = IAggregatorV3.at(feedAddress);
  return feed.latestRoundData();
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/chainlink.md](registry/chainlink.md).

## Notes

- Price feeds return answer in int256 with feed-specific decimals (usually 8 for USD pairs)
- Always check updatedAt timestamp for staleness - stale prices can cause issues
- Feed Registry is Ethereum-only; on L2s, use individual feed addresses directly
- VRF provides verifiable randomness for on-chain applications
- Common feed addresses vary by chain - check Chainlink docs for specific chain deployments
