# Chainlink

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

## Category

oracle | Chains: Ethereum

## Key Operations

- **getLatestPrice**: Read latest price from a Chainlink price feed aggregator

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/chainlink";
```

## SauceScript Examples

```typescript
// Get latest price from feed
import { AggregatorV3ABI as IAggregatorV3 } from "./abis";
function main(feedAddress: Address): {
  roundId: Uint256;
  answer: Uint256;
  startedAt: Uint256;
  updatedAt: Uint256;
  answeredInRound: Uint256;
} {
  const feed = IAggregatorV3.at(feedAddress);
  return feed.latestRoundData();
}
```

## Key Addresses

| Chain    | Contract         | Address                                      |
| -------- | ---------------- | -------------------------------------------- |
| Ethereum | ethUsdFeed       | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` |
| Ethereum | feedRegistry     | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` |
| Ethereum | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` |

## ABI Methods

### AggregatorV3ABI

- `latestRoundData()` - Get latest price data. Returns tuple: (roundId uint80, answer int256, startedAt uint256, updatedAt uint256, answeredInRound uint80). answer is the price with feed-specific decimals
- `decimals()` - Get price feed decimal precision. Returns uint8 (usually 8 for USD feeds, 18 for ETH feeds)

### FeedRegistryABI

- `latestRoundData(address,address)` - Get latest price for a base/quote pair. Params: base (token address), quote (denomination address, use 0x348... for USD). Returns same tuple as AggregatorV3
- `getFeed(address,address)` - Look up aggregator address for a pair. Params: base, quote. Returns aggregator address

## Notes

- Price feeds return answer in int256 with feed-specific decimals (usually 8 for USD pairs)
- Always check updatedAt timestamp for staleness - stale prices can cause issues
- Feed Registry is Ethereum-only; on L2s, use individual feed addresses directly
- VRF provides verifiable randomness for on-chain applications
- Common feed addresses vary by chain - check Chainlink docs for specific chain deployments
