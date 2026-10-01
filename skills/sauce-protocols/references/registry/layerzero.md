<!-- Generated from the SDK's registries. Do not edit. -->

# LayerZero (`layerzero`)

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | `Layerzero` on ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Chains | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Document | [layerzero.md](../layerzero.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Layerzero` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's endpointV2, `0x1a44076050125825900e736c501f859c50fE728c`.
  require(Layerzero.EndpointV2 != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Optimism](../../../sauce-chains/references/optimism.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Polygon](../../../sauce-chains/references/polygon.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `Layerzero.EndpointV2` |
| [Arc](../../../sauce-chains/references/arc.md) | endpointV2 | `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | `Layerzero.EndpointV2` |
| [Base](../../../sauce-chains/references/base.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Linea](../../../sauce-chains/references/linea.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |
| [Scroll](../../../sauce-chains/references/scroll.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `Layerzero.EndpointV2` |

## ABI

### `LayerZeroEndpointV2ABI`

`import LayerZeroEndpointV2ABI from "./protocols/layerzero/LayerZeroEndpointV2ABI.json";` Speaks for: endpointV2.

- `send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) receipt)`
- `quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
