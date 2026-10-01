# Wormhole

Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.

## Category

cross-chain messaging + bridge | Direction: any-to-any | Chains and addresses: [registry/wormhole.md](registry/wormhole.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### bridgeTokens

Transfer tokens cross-chain via the Wormhole TokenBridge.

```typescript
import { WormholeTokenBridgeABI as ITokenBridge } from "./abis";

function main(
  tokenBridgeAddress: Address,
  token: Address,
  amount: Uint256,
  recipientChain: Uint256,
  recipient: Uint256,
): Uint256 {
  const bridge = ITokenBridge.at(tokenBridgeAddress);
  return bridge.transferTokens(token, amount, recipientChain, recipient, 0, 0);
}
```

- `token`: ERC-20 token to bridge
- `recipientChain`: Wormhole chain ID (NOT EVM chain ID). E.g. Ethereum=2, Arbitrum=23, Base=30
- `recipient`: Destination address as bytes32 (left-padded)
- `arbiterFee`: Fee for relayer (set to 0 for self-redemption)
- `nonce`: Unique identifier (set to 0)
- Requires ERC-20 approval to the TokenBridge
- Requires native token for Wormhole message fee (sent as msg.value, use `coreBridge.messageFee()` to query)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/wormhole.md](registry/wormhole.md).

## Notes

- Uses Wormhole chain IDs (NOT EVM chain IDs). E.g. Ethereum=2, BSC=4, Polygon=5, Avalanche=6, Arbitrum=23, Optimism=24, Base=30
- Two-step process: (1) `transferTokens` on source, (2) `completeTransfer` on destination with signed VAA
- If `arbiterFee` > 0, any relayer can submit the VAA and earn the fee. Otherwise, recipient must self-redeem
- Bridged tokens are wrapped versions (e.g. "Wormhole-wrapped USDC") unless using CCTP integration
- 19 guardians must reach 2/3+1 consensus for message finality (typically 1-15 minutes)
- Query `messageFee()` on CoreBridge to know how much native token to attach
- TVL: $3B+. Audited
