<!-- Generated from the SDK's registries. Do not edit. -->

# Silo (`silo`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Silo is a lending market: deposit tokens to earn interest, or borrow against them. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Silo` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Notes

- Each Silo is an isolated two-asset market -- risk from one market cannot spread to others
- `collateralOnly = true` gives higher LTV but your deposit cannot be lent out to borrowers
- Use `SiloRepository.getSilo(assetAddress)` to find the Silo contract for any asset
- The SiloRepository address differs on Ethereum and Arbitrum
- All deposit/repay operations require ERC-20 approval
- TVL: $200M+. Audited

## Its names in a program

On Ethereum, `Silo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's siloRepository, `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49`.
  require(Silo.SiloRepository != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `Silo.SiloRepository` |
| [Arbitrum One](../chains/arbitrum.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `Silo.SiloRepository` |

## ABI

### `SiloABI`

`import SiloABI from "./protocols/silo/SiloABI.json";`

- `accrueInterest(address _asset) returns (uint256 interest)`
- `assetStorage(address _asset) view returns ((address collateralToken, address collateralOnlyToken, address debtToken, uint256 totalDeposits, uint256 collateralOnlyDeposits, uint256 totalBorrowAmount))`
- `borrow(address asset, uint256 amount) returns (uint256 debtAmount, uint256 debtShare)`
- `borrowFor(address _asset, address _borrower, address _receiver, uint256 _amount) returns (uint256 debtAmount, uint256 debtShare)`
- `borrowPossible(address _asset, address _borrower) view returns (bool)`
- `deposit(address asset, uint256 amount, bool collateralOnly) returns (uint256 collateralAmount, uint256 collateralShare)`
- `depositFor(address _asset, address _depositor, uint256 _amount, bool _collateralOnly) returns (uint256 collateralAmount, uint256 collateralShare)`
- `depositPossible(address _asset, address _depositor) view returns (bool)`
- `flashLiquidate(address[] _users, bytes _flashReceiverData) returns (address[] assets, uint256[][] receivedCollaterals, uint256[][] shareAmountsToRepay)`
- `getAssets() view returns (address[] assets)`
- `getAssetsWithState() view returns (address[] assets, (address collateralToken, address collateralOnlyToken, address debtToken, uint256 totalDeposits, uint256 collateralOnlyDeposits, uint256 totalBorrowAmount)[] assetsStorage)`
- `harvestProtocolFees() returns (uint256[] harvestedAmounts)`
- `initAssetsTokens()`
- `interestData(address _asset) view returns ((uint256 harvestedProtocolFees, uint256 protocolFees, uint64 interestRateTimestamp, uint8 status))`
- `isSolvent(address _user) view returns (bool)`
- `liquidity(address _asset) view returns (uint256)`
- `repay(address asset, uint256 amount) returns (uint256 repaidAmount, uint256 repaidShare)`
- `repayFor(address _asset, address _borrower, uint256 _amount) returns (uint256 repaidAmount, uint256 repaidShare)`
- `siloAsset() view returns (address)`
- `siloRepository() view returns (address)`
- `syncBridgeAssets()`
- `utilizationData(address _asset) view returns ((uint256 totalDeposits, uint256 totalBorrowAmount, uint64 interestRateTimestamp) data)`
- `VERSION() view returns (uint128)`
- `withdraw(address asset, uint256 amount, bool collateralOnly) returns (uint256 withdrawnAmount, uint256 withdrawnShare)`
- `withdrawFor(address _asset, address _depositor, address _receiver, uint256 _amount, bool _collateralOnly) returns (uint256 withdrawnAmount, uint256 withdrawnShare)`

### `SiloRepositoryABI`

`import SiloRepositoryABI from "./protocols/silo/SiloRepositoryABI.json";` Speaks for: siloRepository.

- `acceptOwnership()`
- `addBridgeAsset(address _newBridgeAsset)`
- `assetConfigs(address, address) view returns (uint64 maxLoanToValue, uint64 liquidationThreshold, address interestRateModel)`
- `bridgePool() view returns (address)`
- `changeManager(address _manager)`
- `defaultAssetConfig() view returns (uint64 maxLoanToValue, uint64 liquidationThreshold, address interestRateModel)`
- `ensureCanCreateSiloFor(address _asset, bool _assetIsABridge) view`
- `entryFee() view returns (uint256)`
- `fees() view returns (uint64 entryFee, uint64 protocolShareFee, uint64 protocolLiquidationFee)`
- `getBridgeAssets() view returns (address[])`
- `getInterestRateModel(address _silo, address _asset) view returns (address model)`
- `getLiquidationThreshold(address _silo, address _asset) view returns (uint256)`
- `getMaximumLTV(address _silo, address _asset) view returns (uint256)`
- `getMaxSiloDepositsValue(address _silo, address _asset) view returns (uint256)`
- `getNotificationReceiver(address) view returns (address)`
- `getRemovedBridgeAssets() view returns (address[])`
- `getSilo(address asset) view returns (address silo)`
- `getVersionForAsset(address) view returns (uint128)`
- `isPaused() view returns (bool globalPause)`
- `isSilo(address _silo) view returns (bool)`
- `isSiloPaused(address _silo, address _asset) view returns (bool)`
- `manager() view returns (address)`
- `maxLiquidity() view returns (bool globalLimit, uint256 defaultMaxLiquidity)`
- `newSilo(address _siloAsset, bytes _siloData) returns (address)`
- `owner() view returns (address)`
- `pendingOwner() view returns (address)`
- `priceProvidersRepository() view returns (address)`
- `protocolLiquidationFee() view returns (uint256)`
- `protocolShareFee() view returns (uint256)`
- `registerSiloVersion(address _factory, bool _isDefault)`
- `removeBridgeAsset(address _bridgeAssetToRemove)`
- `removePendingOwnership()`
- `renounceOwnership()`
- `replaceSilo(address _siloAsset, uint128 _siloVersion, bytes _siloData) returns (address)`
- `router() view returns (address)`
- `setAssetConfig(address _silo, address _asset, (uint64 maxLoanToValue, uint64 liquidationThreshold, address interestRateModel) _assetConfig)`
- `setDefaultInterestRateModel(address _defaultInterestRateModel)`
- `setDefaultLiquidationThreshold(uint64 _defaultLiquidationThreshold)`
- `setDefaultMaximumLTV(uint64 _defaultMaxLTV)`
- `setDefaultSiloMaxDepositsLimit(uint256 _maxDeposits)`
- `setDefaultSiloVersion(uint128 _defaultVersion)`
- `setFees((uint64 entryFee, uint64 protocolShareFee, uint64 protocolLiquidationFee) _fees)`
- `setGlobalPause(bool _globalPause)`
- `setLimitedMaxLiquidity(bool _globalLimit)`
- `setNotificationReceiver(address _silo, address _newNotificationReceiver)`
- `setPriceProvidersRepository(address _repository)`
- `setRouter(address _router)`
- `setSiloMaxDepositsLimit(address _silo, address _asset, uint256 _maxDeposits)`
- `setSiloPause(address _silo, address _asset, bool _pauseValue)`
- `setTokensFactory(address _tokensFactory)`
- `setVersionForAsset(address _siloAsset, uint128 _version)`
- `siloFactory(uint256) view returns (address)`
- `siloRepositoryPing() pure returns (bytes4)`
- `siloReverse(address) view returns (address)`
- `siloVersion() view returns (uint128 byDefault, uint128 latest)`
- `tokensFactory() view returns (address)`
- `transferOwnership(address newOwner)`
- `transferPendingOwnership(address newPendingOwner)`
- `unregisterSiloVersion(uint128 _siloVersion)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
