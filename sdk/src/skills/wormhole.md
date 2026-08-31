# Wormhole

Generic cross-chain messaging protocol with guardian-based attestation. Supports token bridging and arbitrary message passing across 30+ chains.

## Category
cross-chain messaging + bridge | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), Avalanche (43114)

## SauceScript Functions

### bridgeTokens
Transfer tokens cross-chain via the Wormhole TokenBridge.
```typescript
import { WormholeTokenBridgeABI as ITokenBridge } from "./abis";

function main(tokenBridgeAddress: Address, token: Address, amount: Uint256, recipientChain: Uint256, recipient: Uint256): Uint256 {
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

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | coreBridge | `0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B` |
| Ethereum | tokenBridge | `0x3ee18B2214AFF97000D974cf647E7C347E8fa585` |
| Arbitrum | coreBridge | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` |
| Arbitrum | tokenBridge | `0x0b2402144Bb366A632D14B83F244D2e0e21bD39c` |
| Optimism | coreBridge | `0xEe91C335eab126dF5fDB3797EA9d6aD93aeC9722` |
| Optimism | tokenBridge | `0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b` |
| Base | coreBridge | `0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6` |
| Base | tokenBridge | `0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627` |
| Polygon | coreBridge | `0x7A4B5a56256163F07b2C80A7cA55aBE66c4ec4d7` |
| Polygon | tokenBridge | `0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE` |
| Avalanche | coreBridge | `0x54a8e5f9c4CbA08F9943965859F6c34eAF03E26c` |
| Avalanche | tokenBridge | `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052` |

## ABI Reference

### WormholeCoreBridgeABI
- `publishMessage(uint32 nonce, bytes payload, uint8 consistencyLevel) returns (uint64 sequence)` [payable] - Publish arbitrary message for guardian attestation
- `messageFee() returns (uint256)` - Get current message fee (view)

### WormholeTokenBridgeABI
- `transferTokens(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint256 arbiterFee, uint32 nonce) returns (uint64 sequence)` [payable] - Bridge tokens to destination chain. Returns sequence number for tracking
- `completeTransfer(bytes encodedVm)` - Complete transfer on destination by submitting signed VAA (Verified Action Approval)
- `wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) returns (address)` - Look up wrapped asset address on current chain (view)

## Notes
- Uses Wormhole chain IDs (NOT EVM chain IDs). E.g. Ethereum=2, BSC=4, Polygon=5, Avalanche=6, Arbitrum=23, Optimism=24, Base=30
- Two-step process: (1) `transferTokens` on source, (2) `completeTransfer` on destination with signed VAA
- If `arbiterFee` > 0, any relayer can submit the VAA and earn the fee. Otherwise, recipient must self-redeem
- Bridged tokens are wrapped versions (e.g. "Wormhole-wrapped USDC") unless using CCTP integration
- 19 guardians must reach 2/3+1 consensus for message finality (typically 1-15 minutes)
- Query `messageFee()` on CoreBridge to know how much native token to attach
- TVL: $3B+. Audited
