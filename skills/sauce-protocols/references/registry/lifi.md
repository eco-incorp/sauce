<!-- Generated from the SDK's registries. Do not edit. -->

# LI.FI (`lifi`)

Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through optimal bridges and DEXes for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Lifi` on ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| Document | [lifi.md](../lifi.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Lifi` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's lifiDiamond, `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`.
  require(Lifi.LiFiDiamond != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Optimism](../../../sauce-chains/references/optimism.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Gnosis](../../../sauce-chains/references/gnosis.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Polygon](../../../sauce-chains/references/polygon.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Fantom](../../../sauce-chains/references/fantom.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Arc](../../../sauce-chains/references/arc.md) | lifiDiamond | `0xA4072583658Fae592A3506A42431cb6316a8d40b` | `Lifi.LiFiDiamond` |
| [Base](../../../sauce-chains/references/base.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |

## ABI

### `LiFiDiamondABI`

`import LiFiDiamondABI from "./protocols/lifi/LiFiDiamondABI.json";` Speaks for: lifiDiamond.

- `startBridgeTokensViaAcrossV4((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData, (bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) acrossData) payable`
- `extractBridgeData(bytes data) pure returns ((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData)`
