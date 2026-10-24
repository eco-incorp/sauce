<!-- Generated from the SDK's registries. Do not edit. -->

# Hyperlane (`hyperlane`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Hyperlane is a messenger between chains: it carries messages and tokens from one to another. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Permissionless interchain messaging protocol. Supports modular security with ISMs (Interchain Security Modules).

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Hyperlane` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |

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

## Its names in a program

On Ethereum, `Hyperlane` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's mailbox, `0xc005dc82818d67AF737725bD4bf75435d065D239`.
  require(Hyperlane.Mailbox != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | mailbox | `0xc005dc82818d67AF737725bD4bf75435d065D239` | `Hyperlane.Mailbox` |
| [Optimism](../chains/optimism.md) | mailbox | `0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D` | `Hyperlane.Mailbox` |
| [BNB Chain](../chains/bsc.md) | mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `Hyperlane.Mailbox` |
| [Polygon](../chains/polygon.md) | mailbox | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` | `Hyperlane.Mailbox` |
| [Arc](../chains/arc.md) | mailbox | `0x7f50C5776722630a0024fAE05fDe8b47571D7B39` | `Hyperlane.Mailbox` |
| [Base](../chains/base.md) | mailbox | `0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D` | `Hyperlane.Mailbox` |
| [Arbitrum One](../chains/arbitrum.md) | mailbox | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `Hyperlane.Mailbox` |
| [Avalanche C-Chain](../chains/avalanche.md) | mailbox | `0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6` | `Hyperlane.Mailbox` |

## ABI

### `HyperlaneMailboxABI`

`import HyperlaneMailboxABI from "./protocols/hyperlane/HyperlaneMailboxABI.json";` Speaks for: mailbox.

- `dispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) payable returns (bytes32)`
- `quoteDispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) view returns (uint256)`
- `process(bytes _metadata, bytes _message) payable`
- `delivered(bytes32 _id) view returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
