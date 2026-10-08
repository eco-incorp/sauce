<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink (`chainlink`)

Industry-standard decentralized oracle network providing price feeds, VRF randomness, automation, and cross-chain interoperability (CCIP).

| Fact | Value |
| --- | --- |
| Category | Oracles |
| Family | none |
| Namespace | `Chainlink` on ethereum, arc, base |
| Chains | ethereum, arc, base |

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
  answer: Uint256;
  startedAt: Uint256;
  updatedAt: Uint256;
  answeredInRound: Uint256;
} {
  const feed = IAggregatorV3.at(feedAddress);
  return feed.latestRoundData();
}
```

## CRE: a workflow's report, delivered to a contract

- Chainlink's Runtime Environment (CRE) runs **workflows**: code an owner deploys to Chainlink's
  network, triggered by a cron schedule, an HTTP request or an on-chain log, which fetches APIs and
  reads chains, reaches consensus across a DON, and writes a signed **report** on chain.
- A report reaches a contract through the **KeystoneForwarder** (`Chainlink.KeystoneForwarder` in a
  program, on Ethereum and Base). The forwarder checks the DON's signatures, asks the receiver over
  ERC-165 whether it supports `IReceiver` (three static calls of 30,000 gas each), and calls its
  `onReport(bytes metadata, bytes report)`.
- `metadata` is 64 bytes: the workflow id (32), the workflow name (10), the **workflow owner** (20)
  and the report id (2). `report` is whatever the workflow encoded.
- The forwarder authenticates the DON, not the workflow: any workflow's report can reach any
  receiver. A receiver checks the workflow owner in `metadata`, and the name or id where it pins
  one.
- A report is attempted once per receiver, workflow execution and report id. When `onReport`
  reverts, the DON may retry it. A receiver that fails the ERC-165 check is marked invalid for that
  report, and it is never delivered.
- Chainlink Functions, the older request-and-callback product (a consumer called the Functions
  router's `sendRequest` with inline JavaScript and was called back with `handleOracleFulfillment`),
  no longer answers on mainnet: its routers still accept a request, and its LINK stays locked until
  the request times out. CRE replaces it: an EVM Log trigger takes the place of `sendRequest`, and
  `onReport` the place of the callback.

## Notes

- Price feeds return answer in int256 with feed-specific decimals (usually 8 for USD pairs)
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
| [Ethereum](../chains/ethereum.md) | keystoneForwarder | `0x0b93082D9b3C7C97fAcd250082899BAcf3af3885` | `Chainlink.KeystoneForwarder` |
| [Ethereum](../chains/ethereum.md) | vrfV2Coordinator | `0x271682DEB8C4E0901D1a1550aD2e64D568E69909` | `Chainlink.VrfV2Coordinator` |
| [Arc](../chains/arc.md) | ethUsdFeed | `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` | `Chainlink.EthUsdFeed` |
| [Base](../chains/base.md) | keystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `Chainlink.KeystoneForwarder` |

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
