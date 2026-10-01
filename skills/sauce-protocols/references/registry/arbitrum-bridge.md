<!-- Generated from the SDK's registries. Do not edit. -->

# Arbitrum Native Bridge (`arbitrum-bridge`)

Official Arbitrum L1-L2 gateway bridge. Routes tokens through the canonical Arbitrum rollup bridge with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arbitrum |
| Document | [arbitrum-bridge.md](../arbitrum-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's l1GatewayRouter):

```sauce chain=ethereum
import ArbitrumL1GatewayRouterABI from "./protocols/arbitrum-bridge/ArbitrumL1GatewayRouterABI.json";

const L1_GATEWAY_ROUTER = 0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031efn;

function main() {
  const bound = ArbitrumL1GatewayRouterABI.at(L1_GATEWAY_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1GatewayRouter | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` | `ArbitrumL1GatewayRouterABI.at(0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031efn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | l2GatewayRouter | `0x5288c571Fd7aD117beA99bF60FE0846C4E84F933` | no registry ABI |

## ABI

### `ArbitrumL1GatewayRouterABI`

`import ArbitrumL1GatewayRouterABI from "./protocols/arbitrum-bridge/ArbitrumL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter.

- `outboundTransfer(address _token, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes _data) payable returns (bytes)`
- `getGateway(address _token) view returns (address)`
