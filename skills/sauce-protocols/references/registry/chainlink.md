<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink (`chainlink`)

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Chainlink` on ethereum, arc, base |
| Chains | ethereum, arc, base |
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
| [Ethereum](../../../sauce-chains/references/ethereum.md) | keystoneForwarder | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` | `Chainlink.KeystoneForwarder` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Arc](../../../sauce-chains/references/arc.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `Chainlink.EthUsdFeed` |
| [Base](../../../sauce-chains/references/base.md) | keystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `Chainlink.KeystoneForwarder` |

## ABI

### `AggregatorV3ABI`

`import AggregatorV3ABI from "./protocols/chainlink/AggregatorV3ABI.json";` Speaks for: ethUsdFeed.

- `latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `decimals() view returns (uint8)`

### `FeedRegistryABI`

`import FeedRegistryABI from "./protocols/chainlink/FeedRegistryABI.json";` Speaks for: feedRegistry.

- `latestRoundData(address base, address quote) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- `getFeed(address base, address quote) view returns (address aggregator)`

### `KeystoneForwarderABI`

`import KeystoneForwarderABI from "./protocols/chainlink/KeystoneForwarderABI.json";` Speaks for: keystoneForwarder.

- `typeAndVersion() pure returns (string)`
- `isForwarder(address forwarder) view returns (bool)`
- `getTransmissionId(address receiver, bytes32 workflowExecutionId, bytes2 reportId) pure returns (bytes32)`
- `getTransmissionInfo(address receiver, bytes32 workflowExecutionId, bytes2 reportId) view returns ((bytes32 transmissionId, uint8 state, address transmitter, bool invalidReceiver, bool success, uint80 gasLimit))`
- `getTransmitter(address receiver, bytes32 workflowExecutionId, bytes2 reportId) view returns (address)`
- `report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)`
