<!-- Generated from the SDK's registries. Do not edit. -->

# Synthetix V3 (`synthetix-v3`)

Modular liquidity protocol powering perpetual futures and synthetic assets on Base and Optimism. Provides liquidity infrastructure for derivative protocols.

| Fact | Value |
| --- | --- |
| Category | Synthetics |
| Family | `Synthetix`: `synthetix-v3` |
| Namespace | `SynthetixV3` on base |
| Chains | base |
| Document | [synthetix-v3.md](../synthetix-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `SynthetixV3` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's coreProxy, `0x32C222A9A159782aFD7529c87FA34b96CA72C696`.
  require(SynthetixV3.CoreProxy != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | coreProxy | `0x32C222A9A159782aFD7529c87FA34b96CA72C696` | `SynthetixV3.CoreProxy` |
| [Base](../../../sauce-chains/references/base.md) | perpsMarketProxy | `0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce` | `SynthetixV3.PerpsMarketProxy` |

## ABI

### `CoreProxyABI`

`import CoreProxyABI from "./protocols/synthetix-v3/CoreProxyABI.json";` Speaks for: coreProxy.

- `deposit(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `withdraw(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `delegateCollateral(uint128 accountId, uint128 poolId, address collateralType, uint256 amount, uint256 leverage)`

### `PerpsMarketProxyABI`

`import PerpsMarketProxyABI from "./protocols/synthetix-v3/PerpsMarketProxyABI.json";` Speaks for: perpsMarketProxy.

- `commitOrder((uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) commitment) returns ((uint256 commitmentTime, (uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) request) retOrder, uint256 fees)`
- `modifyCollateral(uint128 accountId, uint128 collateralId, int256 amountDelta)`
