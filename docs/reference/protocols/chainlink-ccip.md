<!-- Generated from the SDK's registries. Do not edit. -->

# Chainlink CCIP (`chainlink-ccip`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Chainlink CCIP is a messenger between chains: it carries messages and tokens from one to another.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Cross-Chain Interoperability Protocol by Chainlink. Cross-chain messaging with DON (Decentralized Oracle Network) security and token transfers.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `ChainlinkCcip` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |

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

## Its names in a program

On Ethereum, `ChainlinkCcip` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's router, `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D`.
  require(ChainlinkCcip.Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | router | `0x80226fc0Ee2b096224EeAc085Bb9a8cba1146f7D` | `ChainlinkCcip.Router` |
| [Optimism](../chains/optimism.md) | router | `0x3206695CaE29952f4b0c22a169725a865bc8Ce0f` | `ChainlinkCcip.Router` |
| [Polygon](../chains/polygon.md) | router | `0x849c5ED5a80F5B408Dd4969b78c2C8fdf0565Bfe` | `ChainlinkCcip.Router` |
| [Arc](../chains/arc.md) | router | `0xB79791184973589c38e114D43Eb8E4588C283A18` | `ChainlinkCcip.Router` |
| [Base](../chains/base.md) | router | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `ChainlinkCcip.Router` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x141fa059441E0ca23ce184B6A78bafD2A517DdE8` | `ChainlinkCcip.Router` |

## ABI

### `CCIPRouterABI`

`import CCIPRouterABI from "./protocols/chainlink-ccip/CCIPRouterABI.json";` Speaks for: router.

- `ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32 messageId)`
- `getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256 fee)`
- `isChainSupported(uint64 chainSelector) view returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
