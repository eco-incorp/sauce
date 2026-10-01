<!-- Generated from the SDK's registries. Do not edit. -->

# Safe (`safe`)

The most trusted multi-signature smart contract wallet, securing billions in digital assets. Supports programmable account abstraction and modular security.

| Fact | Value |
| --- | --- |
| Category | Infrastructure and standards |
| Family | none |
| Namespace | `Safe` on ethereum, optimism, polygon, arc, base, arbitrum |
| Chains | ethereum, optimism, polygon, arc, base, arbitrum |
| Document | [safe.md](../safe.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Safe` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's safeL2V130, `0x3E5c63644E683549055b9Be8653de26E0B4CD36E`.
  require(Safe.SafeL2V130 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Optimism](../../../sauce-chains/references/optimism.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Polygon](../../../sauce-chains/references/polygon.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../../../sauce-chains/references/arc.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arc](../../../sauce-chains/references/arc.md) | safeV141 | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `Safe.SafeV141` |
| [Base](../../../sauce-chains/references/base.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | safeL2V130 | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `Safe.SafeL2V130` |

## ABI

### `SafeABI`

`import SafeABI from "./protocols/safe/SafeABI.json";` Speaks for: safeV141, safeL2V130.

- `execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)`
- `getOwners() view returns (address[])`
- `getThreshold() view returns (uint256)`
