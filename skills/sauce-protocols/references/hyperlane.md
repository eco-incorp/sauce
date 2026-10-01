# Hyperlane

Permissionless interchain messaging protocol. Supports modular security with ISMs (Interchain Security Modules) across 150+ chains.

## Category

cross-chain messaging | Direction: any-to-any | Chains and addresses: [registry/hyperlane.md](registry/hyperlane.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/hyperlane.md](registry/hyperlane.md).

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
