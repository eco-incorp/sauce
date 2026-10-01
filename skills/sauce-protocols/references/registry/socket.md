<!-- Generated from the SDK's registries. Do not edit. -->

# Socket (`socket`)

Cross-chain bridge aggregator that finds optimal routes across multiple bridges and DEXes for token transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [socket.md](../socket.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's socketGateway):

```sauce chain=ethereum
import SocketGatewayABI from "./protocols/socket/SocketGatewayABI.json";

const SOCKET_GATEWAY = 0x3a23F943181408EAC424116Af7b7790c94Cb97a5n;

function main() {
  const bound = SocketGatewayABI.at(SOCKET_GATEWAY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Polygon](../../../sauce-chains/references/polygon.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Base](../../../sauce-chains/references/base.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `SocketGatewayABI.at(0x3a23F943181408EAC424116Af7b7790c94Cb97a5n)` |

## ABI

### `SocketGatewayABI`

`import SocketGatewayABI from "./protocols/socket/SocketGatewayABI.json";` Speaks for: socketGateway.

- `executeRoute(uint32 routeId, bytes routeData) payable returns (bytes result)`
