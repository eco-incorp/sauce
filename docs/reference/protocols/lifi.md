<!-- Generated from the SDK's registries. Do not edit. -->

# LI.FI (`lifi`)

> LI.FI is a bridge: it moves tokens from one chain to another. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through optimal bridges and DEXes for cross-chain swaps.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Lifi` on ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, gnosis, polygon, fantom, arc, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Its names in a program

On Ethereum, `Lifi` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lifiDiamond, `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`.
  require(Lifi.LiFiDiamond != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Optimism](../chains/optimism.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [BNB Chain](../chains/bsc.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Gnosis](../chains/gnosis.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Polygon](../chains/polygon.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Fantom](../chains/fantom.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Arc](../chains/arc.md) | lifiDiamond | `0xA4072583658Fae592A3506A42431cb6316a8d40b` | `Lifi.LiFiDiamond` |
| [Base](../chains/base.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Arbitrum One](../chains/arbitrum.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |
| [Avalanche C-Chain](../chains/avalanche.md) | lifiDiamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` | `Lifi.LiFiDiamond` |

## ABI

### `LiFiDiamondABI`

`import LiFiDiamondABI from "./protocols/lifi/LiFiDiamondABI.json";` Speaks for: lifiDiamond.

- `startBridgeTokensViaAcrossV4((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData, (bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) acrossData) payable`
- `extractBridgeData(bytes data) pure returns ((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) bridgeData)`
