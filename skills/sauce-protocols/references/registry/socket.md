<!-- Generated from the SDK's registries. Do not edit. -->

# Socket (`socket`)

Cross-chain bridge aggregator that routes transfers across multiple bridges and DEXes for token transfers.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Socket` on ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, base, arbitrum, avalanche |
| Document | [socket.md](../socket.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Socket` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's socketGateway, `0x3a23F943181408EAC424116Af7b7790c94Cb97a5`.
  require(Socket.SocketGateway != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Optimism](../../../sauce-chains/references/optimism.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Polygon](../../../sauce-chains/references/polygon.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Base](../../../sauce-chains/references/base.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | socketGateway | `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` | `Socket.SocketGateway` |

## ABI

### `SocketGatewayABI`

`import SocketGatewayABI from "./protocols/socket/SocketGatewayABI.json";` Speaks for: socketGateway.

- `addController(address controllerAddress) returns (uint32)`
- `addressAt(uint32 routeId) view returns (address)`
- `addRoute(address routeAddress) returns (uint32)`
- `BRIDGE_AFTER_SWAP_SELECTOR() view returns (bytes4)`
- `CENT_PERCENT() view returns (uint256)`
- `claimOwner()`
- `controllerCount() view returns (uint32)`
- `controllers(uint32) view returns (address)`
- `disableController(uint32 controllerId)`
- `disabledRouteAddress() view returns (address)`
- `disableRoute(uint32 routeId)`
- `executeController((uint32 controllerId, bytes data) socketControllerRequest) payable returns (bytes)`
- `executeControllers((uint32 controllerId, bytes data)[] controllerRequests) payable`
- `executeRoute(uint32 routeId, bytes routeData) payable returns (bytes result)`
- `executeRoutes(uint32[] routeIds, bytes[] dataItems) payable`
- `getController(uint32 controllerId) view returns (address)`
- `getRoute(uint32 routeId) view returns (address)`
- `nominateOwner(address nominee_)`
- `nominee() view returns (address)`
- `owner() view returns (address)`
- `rescueEther(address userAddress, uint256 amount)`
- `rescueFunds(address token, address userAddress, uint256 amount)`
- `routes(uint32) view returns (address)`
- `routesCount() view returns (uint32)`
- `setApprovalForRouters(address[] routeAddresses, address[] tokenAddresses, bool isMax)`
- `swapAndMultiBridge((uint32 swapRouteId, bytes swapImplData, uint32[] bridgeRouteIds, bytes[] bridgeImplDataItems, uint256[] bridgeRatios, bytes[] eventDataItems) swapMultiBridgeRequest) payable`
