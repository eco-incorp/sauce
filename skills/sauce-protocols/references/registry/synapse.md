<!-- Generated from the SDK's registries. Do not edit. -->

# Synapse Protocol (`synapse`)

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Synapse` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |
| Document | [synapse.md](../synapse.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Synapse` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cctpRouter, `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E`.
  require(Synapse.CctpRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | `Synapse.CctpRouter` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` | `Synapse.SynapseBridge` |
| [Optimism](../../../sauce-chains/references/optimism.md) | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` | `Synapse.SynapseBridge` |
| [Polygon](../../../sauce-chains/references/polygon.md) | synapseBridge | `0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280` | `Synapse.SynapseBridge` |
| [Base](../../../sauce-chains/references/base.md) | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` | `Synapse.SynapseBridge` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | synapseBridge | `0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9` | `Synapse.SynapseBridge` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` | `Synapse.SynapseBridge` |

## ABI

### `SynapseBridgeABI`

`import SynapseBridgeABI from "./protocols/synapse/SynapseBridgeABI.json";` Speaks for: synapseBridge.

- `deposit(address to, uint256 chainId, address token, uint256 amount)`
- `depositAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)`
- `redeem(address to, uint256 chainId, address token, uint256 amount)`
