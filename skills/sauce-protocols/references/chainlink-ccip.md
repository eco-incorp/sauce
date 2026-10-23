# Chainlink CCIP

Cross-Chain Interoperability Protocol by Chainlink. Enterprise-grade cross-chain messaging with DON (Decentralized Oracle Network) security and token transfers.

## Category

cross-chain messaging + token transfer | Direction: any-to-any | Chains and addresses: [registry/chainlink-ccip.md](registry/chainlink-ccip.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
    extraArgs: hex``,
  });
}
```

- `destinationChainSelector`: CCIP chain selector (NOT EVM chain ID). These are unique uint64 identifiers per chain
- `receiver`: ABI-encoded destination address (bytes, not raw address)
- `data`: Arbitrary message payload (bytes)
- `tokenAmounts`: Array of `{token, amount}` tuples for cross-chain token transfers. Empty array `[]` for message-only
- `feeToken`: Address of token to pay fees in. `address(0)` = pay in native token (ETH). Can also use LINK token address
- `extraArgs`: Optional encoded extra arguments (gas limits, etc.). ` hex`` ` for defaults
- Requires native token (ETH) as msg.value when `feeToken` is `address(0)`
- Requires ERC-20 approval to the Router for any tokens in `tokenAmounts`

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/chainlink-ccip.md](registry/chainlink-ccip.md).

## Notes

- Uses CCIP chain selectors (uint64), NOT EVM chain IDs. Each supported chain has a unique selector
- Fees can be paid in native token (ETH) or LINK token
- Use `getFee()` to estimate costs before sending
- Supports both message-only and message+token transfers in a single call
- DON-based security with Chainlink oracle network -- no external validators needed
- Finality: typically 5-20 minutes depending on source chain finality
- Rate limits apply per lane (source-destination pair)
- TVL: $1B+. Audited
- On Arc (5042) a native-paid fee is USDC at 18 decimals, from the same balance as the USDC ERC-20 `0x3600…0000`. The router's `getWrappedNative()` is `0x8DFa585699CB46ca2a5fA649700f09839B4b8743` (`CCIP_USDC`, a WETH9-style wrapper over native USDC), CCIP's own fee token rather than a canonical wrapped native
