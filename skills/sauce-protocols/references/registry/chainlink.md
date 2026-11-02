<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink (`chainlink`)

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Chainlink` on ethereum, arc |
| Chains | ethereum, arc |
| Document | [chainlink.md](../chainlink.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Chainlink` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ethUsdFeed, `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`.
  require(Chainlink.EthUsdFeed != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethUsdFeed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | `Chainlink.EthUsdFeed` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | feedRegistry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | `Chainlink.FeedRegistry` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Arc](../../../sauce-chains/references/arc.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `Chainlink.EthUsdFeed` |

## ABI

### `AggregatorV3ABI`

`import AggregatorV3ABI from "./protocols/chainlink/AggregatorV3ABI.json";` Speaks for: ethUsdFeed. The import is the contract's full ABI across every deployment; call it through the `Chainlink` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `accessController() view returns (address)`
- `aggregator() view returns (address)`
- `confirmAggregator(address _aggregator)`
- `decimals() view returns (uint8)`
- `description() view returns (string)`
- `getAnswer(uint256 _roundId) view returns (int256)`
- `getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `getTimestamp(uint256 _roundId) view returns (uint256)`
- `latestAnswer() view returns (int256)`
- `latestRound() view returns (uint256)`
- `latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `latestTimestamp() view returns (uint256)`
- `owner() view returns (address)`
- `phaseAggregators(uint16) view returns (address)`
- `phaseId() view returns (uint16)`
- `proposeAggregator(address _aggregator)`
- `proposedAggregator() view returns (address)`
- `proposedGetRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `proposedLatestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `setController(address _accessController)`
- `transferOwnership(address _to)`
- `version() view returns (uint256)`

### `FeedRegistryABI`

`import FeedRegistryABI from "./protocols/chainlink/FeedRegistryABI.json";` Speaks for: feedRegistry. The import is the contract's full ABI across every deployment; call it through the `Chainlink` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `confirmFeed(address base, address quote, address aggregator)`
- `decimals(address base, address quote) view returns (uint8)`
- `description(address base, address quote) view returns (string)`
- `getAccessController() view returns (address)`
- `getAnswer(address base, address quote, uint256 roundId) view returns (int256 answer)`
- `getCurrentPhaseId(address base, address quote) view returns (uint16 currentPhaseId)`
- `getFeed(address base, address quote) view returns (address aggregator)`
- `getNextRoundId(address base, address quote, uint80 roundId) view returns (uint80 nextRoundId)`
- `getPhase(address base, address quote, uint16 phaseId) view returns ((uint16 phaseId, uint80 startingAggregatorRoundId, uint80 endingAggregatorRoundId) phase)`
- `getPhaseFeed(address base, address quote, uint16 phaseId) view returns (address aggregator)`
- `getPhaseRange(address base, address quote, uint16 phaseId) view returns (uint80 startingRoundId, uint80 endingRoundId)`
- `getPreviousRoundId(address base, address quote, uint80 roundId) view returns (uint80 previousRoundId)`
- `getProposedFeed(address base, address quote) view returns (address proposedAggregator)`
- `getRoundData(address base, address quote, uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `getRoundFeed(address base, address quote, uint80 roundId) view returns (address aggregator)`
- `getTimestamp(address base, address quote, uint256 roundId) view returns (uint256 timestamp)`
- `isFeedEnabled(address aggregator) view returns (bool)`
- `latestAnswer(address base, address quote) view returns (int256 answer)`
- `latestRound(address base, address quote) view returns (uint256 roundId)`
- `latestRoundData(address base, address quote) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `latestTimestamp(address base, address quote) view returns (uint256 timestamp)`
- `owner() view returns (address)`
- `proposedGetRoundData(address base, address quote, uint80 roundId) view returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `proposedLatestRoundData(address base, address quote) view returns (uint80 id, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `proposeFeed(address base, address quote, address aggregator)`
- `setAccessController(address _accessController)`
- `transferOwnership(address to)`
- `typeAndVersion() pure returns (string)`
- `version(address base, address quote) view returns (uint256)`
