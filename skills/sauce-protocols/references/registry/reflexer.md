<!-- Generated from the SDK's registries. Do not edit. -->

# Reflexer (`reflexer`)

Non-pegged stablecoin protocol issuing RAI. Uses a PID controller to dampen RAI price volatility against ETH collateral.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Reflexer` on ethereum |
| Chains | ethereum |
| Document | [reflexer.md](../reflexer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Reflexer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's coinJoin, `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45`.
  require(Reflexer.CoinJoin != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coinJoin | `0x0A5653CCa4DB1B6E265F47CAf6969e64f1CFdC45` | `Reflexer.CoinJoin` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethJoin | `0x2D3cD7b81c93f188F3CB8aD87c8Acc73d6226e3A` | `Reflexer.ETHJoin` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rai | `0x03ab458634910AaD20eF5f1C8ee96F1D6ac54919` | `Reflexer.Rai` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | safeEngine | `0xCC88a9d330da1133Df3A7bD823B95e52511A6962` | `Reflexer.SAFEEngine` |

## ABI

### `CoinJoinABI`

`import CoinJoinABI from "./protocols/reflexer/CoinJoinABI.json";` Speaks for: coinJoin. The import is the contract's full ABI across every deployment; call it through the `Reflexer` namespace to have a function a chain's deployment does not run refused.

- `addAuthorization(address account)`
- `authorizedAccounts(address) view returns (uint256)`
- `contractEnabled() view returns (uint256)`
- `decimals() view returns (uint256)`
- `disableContract()`
- `exit(address account, uint256 wad)`
- `join(address account, uint256 wad)`
- `removeAuthorization(address account)`
- `safeEngine() view returns (address)`
- `systemCoin() view returns (address)`

### `ETHJoinABI`

`import ETHJoinABI from "./protocols/reflexer/ETHJoinABI.json";` Speaks for: ethJoin. The import is the contract's full ABI across every deployment; call it through the `Reflexer` namespace to have a function a chain's deployment does not run refused.

- `addAuthorization(address account)`
- `authorizedAccounts(address) view returns (uint256)`
- `collateral() view returns (address)`
- `collateralType() view returns (bytes32)`
- `contractEnabled() view returns (uint256)`
- `decimals() view returns (uint256)`
- `disableContract()`
- `exit(address account, uint256 wad)`
- `join(address account, uint256 wad)`
- `removeAuthorization(address account)`
- `safeEngine() view returns (address)`

### `SAFEEngineABI`

`import SAFEEngineABI from "./protocols/reflexer/SAFEEngineABI.json";` Speaks for: safeEngine. The import is the contract's full ABI across every deployment; call it through the `Reflexer` namespace to have a function a chain's deployment does not run refused.

- `addAuthorization(address account)`
- `approveSAFEModification(address account)`
- `authorizedAccounts(address) view returns (uint256)`
- `canModifySAFE(address safe, address account) view returns (bool)`
- `coinBalance(address) view returns (uint256)`
- `collateralTypes(bytes32) view returns (uint256 debtAmount, uint256 accumulatedRate, uint256 safetyPrice, uint256 debtCeiling, uint256 debtFloor, uint256 liquidationPrice)`
- `confiscateSAFECollateralAndDebt(bytes32 collateralType, address safe, address collateralCounterparty, address debtCounterparty, int256 deltaCollateral, int256 deltaDebt)`
- `contractEnabled() view returns (uint256)`
- `createUnbackedDebt(address debtDestination, address coinDestination, uint256 rad)`
- `debtBalance(address) view returns (uint256)`
- `denySAFEModification(address account)`
- `disableContract()`
- `globalDebt() view returns (uint256)`
- `globalDebtCeiling() view returns (uint256)`
- `globalUnbackedDebt() view returns (uint256)`
- `initializeCollateralType(bytes32 collateralType)`
- `modifyCollateralBalance(bytes32 collateralType, address account, int256 wad)`
- `modifyParameters(bytes32 parameter, uint256 data)`
- `modifyParameters(bytes32 collateralType, bytes32 parameter, uint256 data)`
- `modifySAFECollateralization(bytes32 collateralType, address safe, address collateralSource, address debtDestination, int256 deltaCollateral, int256 deltaDebt)`
- `removeAuthorization(address account)`
- `safeDebtCeiling() view returns (uint256)`
- `safeRights(address, address) view returns (uint256)`
- `safes(bytes32 collateralType, address safe) view returns (uint256 lockedCollateral, uint256 generatedDebt)`
- `settleDebt(uint256 rad)`
- `tokenCollateral(bytes32, address) view returns (uint256)`
- `transferCollateral(bytes32 collateralType, address src, address dst, uint256 wad)`
- `transferInternalCoins(address src, address dst, uint256 rad)`
- `transferSAFECollateralAndDebt(bytes32 collateralType, address src, address dst, int256 deltaCollateral, int256 deltaDebt)`
- `updateAccumulatedRate(bytes32 collateralType, address surplusDst, int256 rateMultiplier)`
