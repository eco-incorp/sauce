<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink (`chainlink`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Chainlink is a price oracle: it publishes prices on chain for programs to read. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Chainlink` on ethereum, arc |
| Chains | ethereum, arc |

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

## Notes

- Price feeds return `answer` as `Int256` (ABI `int256`), with feed-specific decimals (usually 8 for USD pairs); keep it signed for arithmetic and comparisons. Round IDs and timestamps remain `Uint256`
- Always check updatedAt timestamp for staleness - stale prices can cause issues
- Feed Registry is Ethereum-only; on L2s, use individual feed addresses directly
- VRF provides verifiable randomness for on-chain applications
- Common feed addresses vary by chain - check Chainlink docs for specific chain deployments

## Its names in a program

On Ethereum, `Chainlink` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ethUsdFeed, `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`.
  require(Chainlink.EthUsdFeed != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ethUsdFeed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | `Chainlink.EthUsdFeed` |
| [Ethereum](../chains/ethereum.md) | feedRegistry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | `Chainlink.FeedRegistry` |
| [Ethereum](../chains/ethereum.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Arc](../chains/arc.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `Chainlink.EthUsdFeed` |

## ABI

### `AggregatorV3ABI`

`import AggregatorV3ABI from "./protocols/chainlink/AggregatorV3ABI.json";` Speaks for: ethUsdFeed.

- `latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `decimals() view returns (uint8)`

### `FeedRegistryABI`

`import FeedRegistryABI from "./protocols/chainlink/FeedRegistryABI.json";` Speaks for: feedRegistry.

- `latestRoundData(address base, address quote) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `getFeed(address base, address quote) view returns (address aggregator)`
