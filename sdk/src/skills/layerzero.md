# LayerZero

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

## Category
cross-chain messaging | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), BSC (56), Avalanche (43114), zkSync (324), Linea (59144), Scroll (534352)

## SauceScript Functions

### sendMessage
Send a cross-chain message via LayerZero Endpoint V2.
```typescript
import { LayerZeroEndpointV2ABI as IEndpointV2 } from "./abis";

function main(endpointAddress: Address, dstEid: Uint256, receiver: Uint256, message: bytes): { guid: Uint256, nonce: Uint256, fee: { nativeFee: Uint256, lzTokenFee: Uint256 } } {
  const endpoint = IEndpointV2.at(endpointAddress);
  return endpoint.send({dstEid: dstEid, receiver: receiver, message: message, options: 0x00, payInLzToken: false}, ctx.msgSender());
}
```
- `dstEid`: LayerZero endpoint ID for destination chain (NOT the EVM chain ID)
- `receiver`: Destination contract address as bytes32 (left-padded)
- `message`: Arbitrary message payload
- `options`: Execution options (gas limits, etc.). Use `0x00` for defaults
- `payInLzToken`: false = pay fees in native token, true = pay in ZRO token
- Requires native token (ETH) for messaging fees (sent as msg.value)

## Deployed Addresses

| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Arbitrum | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Optimism | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Base | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Polygon | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| BSC | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Avalanche | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| zkSync | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb5b32e1D` |
| Linea | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |
| Scroll | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` |

## ABI Reference

### LayerZeroEndpointV2ABI
- `send(MessagingParams _params, address _refundAddress) returns (MessagingReceipt receipt)` [payable] - Send omnichain message. Pay fees as msg.value (native token)
- `quote(MessagingParams _params, address _sender) returns (MessagingFee fee)` - Quote messaging fee before sending (view)

MessagingParams tuple: `(uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken)`
MessagingFee tuple: `(uint256 nativeFee, uint256 lzTokenFee)`

## Notes
- This is a messaging protocol, not a direct token bridge. Token bridging is done via OFT (Omnichain Fungible Token) contracts built on top of LayerZero
- Uses endpoint IDs (dstEid) for chain identification, NOT EVM chain IDs
- Same endpoint address across most chains (except zkSync)
- Use `quote` to estimate fees before sending
- Finality: depends on DVN (Decentralized Verifier Network) configuration, typically 1-5 minutes
- Powers Stargate V2, OFT tokens, and many cross-chain dApps
- TVL: $5B+ (across protocols built on LayerZero). Audited
