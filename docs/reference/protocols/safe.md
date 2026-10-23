<!-- Generated from the SDK's registries. Do not edit. -->

# Safe (`safe`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Safe is a building block that other protocols are built on. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

The most trusted multi-signature smart contract wallet, securing billions in digital assets. Supports programmable account abstraction and modular security.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Safe` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |

## What it offers

- **getThreshold**: Query the signing threshold of a Safe multisig
- **execTransaction**: Execute a transaction with collected signatures

## Notes

- Secures $100B+ in assets across DeFi
- safeV141 is for Ethereum L1; safeL2V130 is the L2-optimized version (emits events for cheaper indexing)
- operation: 0 = CALL (normal), 1 = DELEGATECALL (execute in Safe context)
- signatures are sorted by owner address, packed as 65 bytes each (r, s, v)
- Modular: supports Guards (pre/post checks), Modules (extend functionality), and Fallback handlers

## Its names in a program

On Ethereum, `Safe` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's safeL2V130, `0x3E5c63644E683549055b9Be8653de26E0B4CD36E`.
  require(Safe.SafeL2V130 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Ethereum](../chains/ethereum.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Optimism](../chains/optimism.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Polygon](../chains/polygon.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../chains/arc.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../chains/arc.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Base](../chains/base.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arbitrum One](../chains/arbitrum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |

## ABI

### `SafeABI`

`import SafeABI from "./protocols/safe/SafeABI.json";` Speaks for: safeV141, safeL2V130.

- `execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)`
- `getOwners() view returns (address[])`
- `getThreshold() view returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
