<!-- Generated from the SDK's registries. Do not edit. -->

# CCTP (`cctp`)

Circle's Cross-Chain Transfer Protocol (v2) — permissionless native USDC bridging that burns on the source chain and mints on the destination domain, with configurable finality and fee.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Cctp` on ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |
| Chains | ethereum, optimism, unichain, polygon, monad, sonic, arc, base, arbitrum, avalanche, linea, base-sepolia, arc-testnet, sepolia |
| Document | [cctp.md](../cctp.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cctp` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's tokenMessenger, `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`.
  require(Cctp.TokenMessenger != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Optimism](../../../sauce-chains/references/optimism.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Unichain](../../../sauce-chains/references/unichain.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Polygon](../../../sauce-chains/references/polygon.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Monad](../../../sauce-chains/references/monad.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Sonic](../../../sauce-chains/references/sonic.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Arc](../../../sauce-chains/references/arc.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Base](../../../sauce-chains/references/base.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Linea](../../../sauce-chains/references/linea.md) | tokenMessenger | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `Cctp.TokenMessenger` |
| [Base Sepolia](../../../sauce-chains/references/base-sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Arc Testnet](../../../sauce-chains/references/arc-testnet.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |
| [Ethereum Sepolia](../../../sauce-chains/references/sepolia.md) | tokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `Cctp.TokenMessenger` |

## ABI

### `TokenMessengerABI`

`import TokenMessengerABI from "./protocols/cctp/TokenMessengerABI.json";` Speaks for: tokenMessenger.

- `depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)`
