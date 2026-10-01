<!-- Generated from the SDK's registries. Do not edit. -->

# Hyperlane (`hyperlane`)

Permissionless interchain messaging protocol. Supports modular security with ISMs (Interchain Security Modules) across 150+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche |
| Document | [hyperlane.md](../hyperlane.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's mailbox):

```sauce chain=ethereum
import HyperlaneMailboxABI from "./protocols/hyperlane/HyperlaneMailboxABI.json";

const MAILBOX = 0xc005dc82818d67AF737725bD4bf75435d065D239n;

function main() {
  const bound = HyperlaneMailboxABI.at(MAILBOX);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mailbox | `0xc005dc82818d67AF737725bD4bf75435d065D239` | `HyperlaneMailboxABI.at(0xc005dc82818d67AF737725bD4bf75435d065D239n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | mailbox | `0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D` | `HyperlaneMailboxABI.at(0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80Dn)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | mailbox | `0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4` | `HyperlaneMailboxABI.at(0x2971b9Aec44bE4eb673DF1B88cDB57b96eefe8a4n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | mailbox | `0x5d934f4e2f797775e53561bB72aca21ba36B96BB` | `HyperlaneMailboxABI.at(0x5d934f4e2f797775e53561bB72aca21ba36B96BBn)` |
| [Arc](../../../sauce-chains/references/arc.md) | mailbox | `0x7f50C5776722630a0024fAE05fDe8b47571D7B39` | `HyperlaneMailboxABI.at(0x7f50C5776722630a0024fAE05fDe8b47571D7B39n)` |
| [Base](../../../sauce-chains/references/base.md) | mailbox | `0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D` | `HyperlaneMailboxABI.at(0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1Dn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | mailbox | `0x979Ca5202784112f4738403dBec5D0F3B9daabB9` | `HyperlaneMailboxABI.at(0x979Ca5202784112f4738403dBec5D0F3B9daabB9n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | mailbox | `0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6` | `HyperlaneMailboxABI.at(0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6n)` |

## ABI

### `HyperlaneMailboxABI`

`import HyperlaneMailboxABI from "./protocols/hyperlane/HyperlaneMailboxABI.json";` Speaks for: mailbox.

- `dispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) payable returns (bytes32)`
- `quoteDispatch(uint32 _destinationDomain, bytes32 _recipientAddress, bytes _messageBody) view returns (uint256)`
- `process(bytes _metadata, bytes _message) payable`
- `delivered(bytes32 _id) view returns (bool)`
