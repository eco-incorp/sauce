# Hyperlane

Permissionless interchain messaging protocol. Supports modular security with ISMs (Interchain Security Modules) across 150+ chains.

## Category

cross-chain messaging | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137), Avalanche (43114), BSC (56), Arc (5042)

## SauceScript Functions

### dispatch

Send a cross-chain message via Hyperlane Mailbox.

```typescript
import { HyperlaneMailboxABI as IMailbox } from "./abis";

function main(
  mailboxAddress: Address,
  destinationDomain: Uint256,
  recipientAddress: Uint256,
  messageBody: bytes,
): Uint256 {
  const mailbox = IMailbox.at(mailboxAddress);
  return mailbox.dispatch(destinationDomain, recipientAddress, messageBody);
}
```

- `destinationDomain`: Hyperlane domain ID (NOT EVM chain ID). Each chain has a unique uint32 domain identifier
- `recipientAddress`: Destination contract address as bytes32 (left-padded with zeros)
- `messageBody`: Arbitrary message payload (bytes)
- Requires native token (ETH) as msg.value for interchain gas payment
- Use `quoteDispatch()` to estimate fees before sending

## Deployed Addresses

| Chain     | Contract | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | mailbox  | `0xc005dc82818d67AF737725bD4bf75435d065D239` |
| Arbitrum  | mailbox  | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` |
| Optimism  | mailbox  | `0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D` |
| Base      | mailbox  | `0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D` |
| Polygon   | mailbox  | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` |
| Avalanche | mailbox  | `0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6` |
| BSC       | mailbox  | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` |

## ABI Reference

### HyperlaneMailboxABI

- `dispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) returns (bytes32)` [payable] - Send interchain message. Returns message ID
- `quoteDispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) returns (uint256)` - Quote fee for dispatching a message (view)
- `process(bytes _metadata, bytes _message)` [payable] - Process an inbound message on the destination chain (called by relayers)
- `delivered(bytes32 _id) returns (bool)` - Check if a message has been delivered (view)

## Notes

- This is a messaging protocol, not a direct token bridge. Token bridging uses Warp Routes built on top of Hyperlane
- Uses domain IDs (uint32), NOT EVM chain IDs. Common domains: Ethereum=1, Arbitrum=42161, Optimism=10 (may differ from EVM chain IDs)
- Permissionless: anyone can deploy Hyperlane to a new chain without governance approval
- Modular security via ISMs (Interchain Security Modules) -- apps choose their own security model
- Use `quoteDispatch()` to estimate fees before sending
- `delivered()` to check if a message has already been processed on the destination
- Finality: depends on ISM configuration, typically 1-5 minutes
- TVL: $200M+. Audited
- On Arc (5042) interchain gas is paid in native USDC at 18 decimals, from the same balance as the USDC ERC-20 `0x3600…0000`. A transfer of the whole USDC balance cannot also pay its gas. Hyperlane's CCTP-backed USDC warp route on Arc is `0x16BF93e259ee7f7074453a2948379C35C6851b71` (its `quoteGasPayment(8453)` was about 0.054 USDC on 2026-09-28)
