# LI.FI

Multi-chain bridge and DEX aggregator via LiFiDiamond proxy. Routes through bridges and DEXes for cross-chain swaps.

## Category

bridge aggregator | Direction: any-to-any | Chains and addresses: [registry/lifi.md](registry/lifi.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/lifi.md](registry/lifi.md).

## Notes

- LI.FI is a bridge **aggregator** -- it routes through underlying bridges (Across, Stargate, Hop, cBridge, etc.)
- Uses a Diamond proxy pattern (EIP-2535)
- The Diamond address is the same on every chain but Arc, whose address differs
- Uses standard EVM chain IDs for `destinationChainId`
- The `bridge` field in BridgeData specifies which underlying bridge to use
- `hasSourceSwaps` / `hasDestinationCall` enable swap-then-bridge or bridge-then-execute patterns
- Requires ERC-20 approval to the LiFi Diamond address
- Finality depends on the underlying bridge selected (varies from 1 minute to 20 minutes)
- TVL: $300M+. Audited
