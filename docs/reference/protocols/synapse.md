<!-- Generated from the SDK's registries. Do not edit. -->

# Synapse Protocol (`synapse`)

Cross-chain bridge and DEX with multi-chain AMM pools. Supports token swaps and bridging via SynapseBridge and CCTP router.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Synapse` on ethereum, optimism, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, polygon, base, arbitrum, avalanche |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### bridge

Deposit tokens for cross-chain transfer via SynapseBridge.

```typescript
import { SynapseBridgeABI as ISynapseBridge } from "./abis";

function main(
  bridgeAddress: Address,
  recipient: Address,
  chainId: Uint256,
  token: Address,
  amount: Uint256,
): Uint256 {
  const bridge = ISynapseBridge.at(bridgeAddress);
  bridge.deposit(recipient, chainId, token, amount);
  return 1;
}
```

- `chainId`: Destination EVM chain ID
- `token`: ERC-20 token to bridge
- Requires ERC-20 approval to the SynapseBridge

## Notes

- `deposit`: For canonical tokens supported directly by the bridge
- `depositAndSwap`: For bridging with an automatic swap on destination (e.g. bridge nUSD, swap to USDC on arrival)
- `redeem`: For synthetic bridge tokens (nUSD, nETH) -- burns on source, mints on destination
- Also supports CCTP-based USDC bridging via separate cctpRouter contract
- Finality: typically 5-15 minutes depending on route
- Requires ERC-20 approval to the SynapseBridge
- TVL: $100M+. Audited

## Its names in a program

On Ethereum, `Synapse` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cctpRouter, `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E`.
  require(Synapse.CctpRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cctpRouter | `0x12715a66773BD9C54534a01aBF01d05F6B4Bd35E` | `Synapse.CctpRouter` |
| [Ethereum](../chains/ethereum.md) | synapseBridge | `0x2796317b0fF8538F253012862c06787Adfb8cEB6` | `Synapse.SynapseBridge` |
| [Optimism](../chains/optimism.md) | synapseBridge | `0xAf41a65F786339e7911F4acDAD6BD49426F2Dc6b` | `Synapse.SynapseBridge` |
| [Polygon](../chains/polygon.md) | synapseBridge | `0x8F5BBB2BB8c2Ee94639E55d5F41de9b4839C1280` | `Synapse.SynapseBridge` |
| [Base](../chains/base.md) | synapseBridge | `0xf07d1C752fAb503E47FEF309bf14fbDD3E867089` | `Synapse.SynapseBridge` |
| [Arbitrum One](../chains/arbitrum.md) | synapseBridge | `0x6F4e8eba4d337f874AB57478AcC2Cb5BacDc19c9` | `Synapse.SynapseBridge` |
| [Avalanche C-Chain](../chains/avalanche.md) | synapseBridge | `0xC05e61d0E7a63D27546389B7aD62FdFf5A91aACE` | `Synapse.SynapseBridge` |

## ABI

### `SynapseBridgeABI`

`import SynapseBridgeABI from "./protocols/synapse/SynapseBridgeABI.json";` Speaks for: synapseBridge.

- `deposit(address to, uint256 chainId, address token, uint256 amount)`
- `depositAndSwap(address to, uint256 chainId, address token, uint256 amount, uint8 tokenIndexFrom, uint8 tokenIndexTo, uint256 minDy, uint256 deadline)`
- `redeem(address to, uint256 chainId, address token, uint256 amount)`
