<!-- Generated from the SDK's registries. Do not edit. -->

# Arbitrum Native Bridge (`arbitrum-bridge`)

Official Arbitrum L1-L2 gateway bridge. Routes tokens through the canonical Arbitrum rollup bridge with 7-day withdrawal finality.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `ArbitrumBridge` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [arbitrum-bridge.md](../arbitrum-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `ArbitrumBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1GatewayRouter, `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef`.
  require(ArbitrumBridge.L1GatewayRouter != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1GatewayRouter | `0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef` | `ArbitrumBridge.L1GatewayRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | l2GatewayRouter | `0x5288c571Fd7aD117beA99bF60FE0846C4E84F933` | `ArbitrumBridge.L2GatewayRouter` |

## ABI

### `ArbitrumL1GatewayRouterABI`

`import ArbitrumL1GatewayRouterABI from "./protocols/arbitrum-bridge/ArbitrumL1GatewayRouterABI.json";` Speaks for: l1GatewayRouter. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `ArbitrumBridge` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `calculateL2TokenAddress(address l1ERC20) view returns (address)`
- `counterpartGateway() view returns (address)`
- `defaultGateway() view returns (address)`
- `finalizeInboundTransfer(address, address, address, uint256, bytes) payable`
- `getGateway(address _token) view returns (address)`
- `getOutboundCalldata(address _token, address _from, address _to, uint256 _amount, bytes _data) view returns (bytes)`
- `inbox() view returns (address)`
- `initialize(address _owner, address _defaultGateway, address, address _counterpartGateway, address _inbox)`
- `l1TokenToGateway(address) view returns (address)`
- `outboundTransfer(address _token, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes _data) payable returns (bytes)`
- `outboundTransferCustomRefund(address _token, address _refundTo, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes _data) payable returns (bytes)`
- `owner() view returns (address)`
- `postUpgradeInit()`
- `router() view returns (address)`
- `setDefaultGateway(address newL1DefaultGateway, uint256 _maxGas, uint256 _gasPriceBid, uint256 _maxSubmissionCost) payable returns (uint256)`
- `setGateway(address _gateway, uint256 _maxGas, uint256 _gasPriceBid, uint256 _maxSubmissionCost) payable returns (uint256)`
- `setGateway(address _gateway, uint256 _maxGas, uint256 _gasPriceBid, uint256 _maxSubmissionCost, address _creditBackAddress) payable returns (uint256)`
- `setGateways(address[] _token, address[] _gateway, uint256 _maxGas, uint256 _gasPriceBid, uint256 _maxSubmissionCost) payable returns (uint256)`
- `setOwner(address newOwner)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `updateWhitelistSource(address newSource)`
- `whitelist() view returns (address)`
