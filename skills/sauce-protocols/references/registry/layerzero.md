<!-- Generated from the SDK's registries. Do not edit. -->

# LayerZero (`layerzero`)

Omnichain interoperability protocol enabling cross-chain messaging. Powers OFT tokens and arbitrary message passing across 50+ chains.

| Fact | Value |
| --- | --- |
| Category | Cross-chain messaging |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, zksync, arc, base, arbitrum, avalanche, linea, scroll |
| Document | [layerzero.md](../layerzero.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's endpointV2):

```sauce chain=ethereum
import LayerZeroEndpointV2ABI from "./protocols/layerzero/LayerZeroEndpointV2ABI.json";

const ENDPOINT_V2 = 0x1a44076050125825900e736c501f859c50fE728cn;

function main() {
  const bound = LayerZeroEndpointV2ABI.at(ENDPOINT_V2);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | endpointV2 | `0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBF` | `LayerZeroEndpointV2ABI.at(0xd07C30aF3Ff30D96BDc9c6044958230Eb797DDBFn)` |
| [Arc](../../../sauce-chains/references/arc.md) | endpointV2 | `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B` | `LayerZeroEndpointV2ABI.at(0x6F475642a6e85809B1c36Fa62763669b1b48DD5Bn)` |
| [Base](../../../sauce-chains/references/base.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Linea](../../../sauce-chains/references/linea.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |
| [Scroll](../../../sauce-chains/references/scroll.md) | endpointV2 | `0x1a44076050125825900e736c501f859c50fE728c` | `LayerZeroEndpointV2ABI.at(0x1a44076050125825900e736c501f859c50fE728cn)` |

## ABI

### `LayerZeroEndpointV2ABI`

`import LayerZeroEndpointV2ABI from "./protocols/layerzero/LayerZeroEndpointV2ABI.json";` Speaks for: endpointV2.

- `send((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee) receipt)`
- `quote((uint32 dstEid, bytes32 receiver, bytes message, bytes options, bool payInLzToken) _params, address _sender) view returns ((uint256 nativeFee, uint256 lzTokenFee) fee)`
