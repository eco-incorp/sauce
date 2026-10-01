<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink (`chainlink`)

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arc |
| Document | [chainlink.md](../chainlink.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's ethUsdFeed):

```sauce chain=ethereum
import AggregatorV3ABI from "./protocols/chainlink/AggregatorV3ABI.json";

const ETH_USD_FEED = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419n;

function main() {
  const bound = AggregatorV3ABI.at(ETH_USD_FEED);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethUsdFeed | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | `AggregatorV3ABI.at(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | feedRegistry | `0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf` | `FeedRegistryABI.at(0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDfn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | no registry ABI |
| [Arc](../../../sauce-chains/references/arc.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `AggregatorV3ABI.at(0x50FCDD99D6762D1C170DC6A9111db944AEE6D364n)` |

## ABI

### `AggregatorV3ABI`

`import AggregatorV3ABI from "./protocols/chainlink/AggregatorV3ABI.json";` Speaks for: ethUsdFeed.

- `latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `decimals() view returns (uint8)`

### `FeedRegistryABI`

`import FeedRegistryABI from "./protocols/chainlink/FeedRegistryABI.json";` Speaks for: feedRegistry.

- `latestRoundData(address base, address quote) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `getFeed(address base, address quote) view returns (address aggregator)`
