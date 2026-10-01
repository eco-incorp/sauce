<!-- Generated from the SDK's registries. Do not edit. -->

# Polygon Native Bridge (`polygon-bridge`)

Official Polygon PoS bridge via RootChainManager. Supports ETH, ERC-20, ERC-721, and ERC-1155 deposits with checkpoint-based withdrawals.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `PolygonBridge` on ethereum, polygon |
| Chains | ethereum, polygon |
| Document | [polygon-bridge.md](../polygon-bridge.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `PolygonBridge` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's erc20Predicate, `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf`.
  require(PolygonBridge.Erc20Predicate != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | erc20Predicate | `0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf` | `PolygonBridge.Erc20Predicate` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | etherPredicate | `0x8484Ef722627bf18ca5Ae6BcF031c23E6e922B30` | `PolygonBridge.EtherPredicate` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rootChainManager | `0xA0c68C638235ee32657e8f720a23ceC1bFc77C77` | `PolygonBridge.RootChainManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | childChainManager | `0xA6FA4fB5f76172d178d61B04b0ecd319C5d1C0aa` | `PolygonBridge.ChildChainManager` |

## ABI

### `PolygonRootChainManagerABI`

`import PolygonRootChainManagerABI from "./protocols/polygon-bridge/PolygonRootChainManagerABI.json";` Speaks for: rootChainManager.

- `depositEtherFor(address user) payable`
- `depositFor(address user, address rootToken, bytes depositData)`
- `exit(bytes inputData)`
