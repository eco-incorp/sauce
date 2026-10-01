# LI.FI

Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through optimal bridges and DEXes for cross-chain swaps.

## Category

bridge aggregator | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), BSC (56), Avalanche (43114), Gnosis (100), Fantom (250), Arc (5042)

## SauceScript Functions

### bridge

Bridge tokens cross-chain via the LI.FI Diamond's Across V4 facet. Each underlying bridge has its own facet entry point (`startBridgeTokensVia<Bridge>`), with a bridge-specific second struct.

```typescript
import { LiFiDiamondABI as ILiFiDiamond } from "./abis";

function main(
  diamondAddress: Address,
  transactionId: Uint256,
  sendingAsset: Address,
  receivingAsset: Address,
  receiver: Address,
  amount: Uint256,
  outputAmount: Uint256,
  destinationChainId: Uint256,
  quoteTimestamp: Uint256,
  fillDeadline: Uint256,
): Uint256 {
  const lifi = ILiFiDiamond.at(diamondAddress);
  lifi.startBridgeTokensViaAcrossV4(
    {
      transactionId: transactionId,
      bridge: "acrossV4",
      integrator: "sauce",
      referrer: 0x0000000000000000000000000000000000000000,
      sendingAssetId: sendingAsset,
      receiver: receiver,
      minAmount: amount,
      destinationChainId: destinationChainId,
      hasSourceSwaps: false,
      hasDestinationCall: false,
    },
    {
      receiverAddress: receiver,
      refundAddress: receiver,
      sendingAssetId: sendingAsset,
      receivingAssetId: receivingAsset,
      outputAmount: outputAmount,
      outputAmountMultiplier: 0,
      exclusiveRelayer: 0,
      quoteTimestamp: quoteTimestamp,
      fillDeadline: fillDeadline,
      exclusivityParameter: 0,
      message: "",
    },
  );
  return 1;
}
```

- `transactionId`: Unique identifier for tracking this bridge transaction (bytes32)
- `integrator`: Integration partner identifier (e.g. "sauce")
- `referrer`: Referral address for fee sharing. `address(0)` for none
- `sendingAssetId` / `receivingAssetId`: token sent, and token received on the destination
- `minAmount` / `outputAmount`: amount bridged, and the amount the Across relayer delivers
- `quoteTimestamp` / `fillDeadline`: the Across quote's timestamp and fill deadline
- `hasSourceSwaps` / `hasDestinationCall`: `true` only with pre-bridge swaps or a destination call
- Requires ERC-20 approval to the LiFi Diamond

## Deployed Addresses

| Chain     | Contract    | Address                                      |
| --------- | ----------- | -------------------------------------------- |
| Ethereum  | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Arbitrum  | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Optimism  | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Base      | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Polygon   | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| BSC       | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Avalanche | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Gnosis    | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Fantom    | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |

## ABI Reference

### LiFiDiamondABI

- `startBridgeTokensViaAcrossV4(BridgeData _bridgeData, AcrossV4Data _acrossData)` [payable] - Bridge through Across V4 (AcrossFacetV4)
- `extractBridgeData(bytes data) returns (BridgeData bridgeData)` - Decode bridge data from raw calldata (pure)

AcrossV4Data tuple: `(bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)`

BridgeData tuple: `(bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall)`

## Notes

- LI.FI is a bridge **aggregator** -- it routes through underlying bridges (Across, Stargate, Hop, cBridge, etc.)
- Uses a Diamond proxy pattern (EIP-2535) so the contract address is the same across all chains
- Same Diamond address (`0x1231DEB6...`) deployed on all supported chains
- Uses standard EVM chain IDs for `destinationChainId`
- The `bridge` field in BridgeData specifies which underlying bridge to use
- `hasSourceSwaps` / `hasDestinationCall` enable swap-then-bridge or bridge-then-execute patterns
- Requires ERC-20 approval to the LiFi Diamond address
- Finality depends on the underlying bridge selected (varies from 1 minute to 20 minutes)
- TVL: $300M+. Audited
