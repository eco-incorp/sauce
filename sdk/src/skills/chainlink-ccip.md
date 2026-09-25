# Chainlink CCIP

Cross-Chain Interoperability Protocol by Chainlink. Enterprise-grade cross-chain messaging with DON (Decentralized Oracle Network) security and token transfers.

## Category

cross-chain messaging + token transfer | Direction: any-to-any | Chains: Ethereum (1), Arbitrum (42161), Optimism (10), Base (8453), Polygon (137)

## SauceScript Functions

### sendMessage

Send a cross-chain message via CCIP Router.

```typescript
import { CCIPRouterABI as ICCIPRouter } from "./abis";

function main(
  routerAddress: Address,
  destinationChainSelector: Uint256,
  receiver: bytes,
  data: bytes,
): Uint256 {
  const router = ICCIPRouter.at(routerAddress);
  return router.ccipSend(destinationChainSelector, {
    receiver: receiver,
    data: data,
    tokenAmounts: [],
    feeToken: 0x0000000000000000000000000000000000000000,
    extraArgs: 0x00,
  });
}
```

- `destinationChainSelector`: CCIP chain selector (NOT EVM chain ID). These are unique uint64 identifiers per chain
- `receiver`: ABI-encoded destination address (bytes, not raw address)
- `data`: Arbitrary message payload (bytes)
- `tokenAmounts`: Array of `{token, amount}` tuples for cross-chain token transfers. Empty array `[]` for message-only
- `feeToken`: Address of token to pay fees in. `address(0)` = pay in native token (ETH). Can also use LINK token address
- `extraArgs`: Optional encoded extra arguments (gas limits, etc.). `0x00` for defaults
- Requires native token (ETH) as msg.value when `feeToken` is `address(0)`
- Requires ERC-20 approval to the Router for any tokens in `tokenAmounts`

## Deployed Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | router   | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` |
| Arbitrum | router   | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` |
| Optimism | router   | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` |
| Base     | router   | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` |
| Polygon  | router   | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` |

## ABI Reference

### CCIPRouterABI

- `ccipSend(uint64 destinationChainSelector, EVM2AnyMessage message) returns (uint256 messageId)` [payable] - Send cross-chain message and/or tokens. Returns message ID for tracking
- `getFee(uint64 destinationChainSelector, EVM2AnyMessage message) returns (uint256 fee)` - Estimate fee for a CCIP message before sending (view)
- `isChainSupported(uint64 chainSelector) returns (bool)` - Check if a destination chain selector is supported (view)

EVM2AnyMessage tuple: `(bytes receiver, bytes data, EVMTokenAmount[] tokenAmounts, address feeToken, bytes extraArgs)`
EVMTokenAmount tuple: `(address token, uint256 amount)`

## Notes

- Uses CCIP chain selectors (uint64), NOT EVM chain IDs. Each supported chain has a unique selector
- Fees can be paid in native token (ETH) or LINK token
- Use `getFee()` to estimate costs before sending
- Supports both message-only and message+token transfers in a single call
- DON-based security with Chainlink oracle network -- no external validators needed
- Finality: typically 5-20 minutes depending on source chain finality
- Rate limits apply per lane (source-destination pair)
- TVL: $1B+. Audited
