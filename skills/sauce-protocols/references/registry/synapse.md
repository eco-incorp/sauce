<!-- Generated from the SDK's registries. Do not edit. -->

# Synapse Protocol (`synapse`)

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |
| Document | [synapse.md](../synapse.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's synapseBridge):

```sauce chain=ethereum
import SynapseBridgeABI from "./protocols/synapse/SynapseBridgeABI.json";

const SYNAPSE_BRIDGE = 0x2796317b0fF8538F253012862c06787Adfb8cEB6n;

function main() {
  const bound = SynapseBridgeABI.at(SYNAPSE_BRIDGE);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | no registry ABI |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` | `SynapseBridgeABI.at(0x2796317b0fF8538F253012862c06787Adfb8cEB6n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` | `SynapseBridgeABI.at(0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6bn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | synapseBridge | `0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280` | `SynapseBridgeABI.at(0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280n)` |
| [Base](../../../sauce-chains/references/base.md) | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` | `SynapseBridgeABI.at(0xf07d1C752fAb503E47FEF309bf14fbDD3E867089n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | synapseBridge | `0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9` | `SynapseBridgeABI.at(0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` | `SynapseBridgeABI.at(0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACEn)` |

## ABI

### `SynapseBridgeABI`

`import SynapseBridgeABI from "./protocols/synapse/SynapseBridgeABI.json";` Speaks for: synapseBridge.

- `deposit(address to, uint256 chainId, address token, uint256 amount)`
- `depositAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)`
- `redeem(address to, uint256 chainId, address token, uint256 amount)`
