<!-- Generated from the SDK's registries. Do not edit. -->

# LI.FI (`lifi`)

Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through optimal bridges and DEXes for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| Document | [lifi.md](../lifi.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's lifiDiamond):

```sauce chain=ethereum
import LiFiDiamondABI from "./protocols/lifi/LiFiDiamondABI.json";

const LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn;

function main() {
  const bound = LiFiDiamondABI.at(LIFI_DIAMOND);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Fantom](../../../sauce-chains/references/fantom.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Arc](../../../sauce-chains/references/arc.md) | lifiDiamond | `0xA4072583658Fae592A3506A42431cb6316a8d40b` | `LiFiDiamondABI.at(0xA4072583658Fae592A3506A42431cb6316a8d40bn)` |
| [Base](../../../sauce-chains/references/base.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `LiFiDiamondABI.at(0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaEn)` |

## ABI

### `LiFiDiamondABI`

`import LiFiDiamondABI from "./protocols/lifi/LiFiDiamondABI.json";` Speaks for: lifiDiamond.

- `startBridgeTokensViaAcrossV4((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData, (bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) acrossData) payable`
- `extractBridgeData(bytes data) pure returns ((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData)`
