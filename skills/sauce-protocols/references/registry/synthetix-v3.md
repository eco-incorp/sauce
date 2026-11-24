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
  require(SynthetixV3.CoreProxy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | coreProxy | `0x32C222A9A159782aFD7529c87FA34b96CA72C696` | `SynthetixV3.CoreProxy` |
| [Base](../../../sauce-chains/references/base.md) | perpsMarketProxy | `0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce` | `SynthetixV3.PerpsMarketProxy` |

## ABI

### `CoreProxyABI`

`import CoreProxyABI from "./protocols/synthetix-v3/CoreProxyABI.json";` Speaks for: coreProxy. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthetixV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptOwnership()`
- `acceptPoolOwnership(uint128 poolId)`
- `addApprovedPool(uint128 poolId)`
- `addToFeatureFlagAllowlist(bytes32 feature, address account)`
- `associateDebt(uint128 marketId, uint128 poolId, address collateralType, uint128 accountId, uint256 amount) returns (int256)`
- `ccipReceive((bytes32 messageId, uint64 sourceChainSelector, bytes sender, bytes data, (address token, uint256 amount)[] tokenAmounts) message)`
- `claimPoolRewards(uint128 accountId, uint128 poolId, address collateralType, address distributor) returns (uint256)`
- `claimRewards(uint128 accountId, uint128 poolId, address collateralType, address distributor) returns (uint256)`
- `cleanExpiredLocks(uint128 accountId, address collateralType, uint256 offset, uint256 count) returns (uint256 cleared, uint256 remainingLockAmountD18)`
- `configureChainlinkCrossChain(address ccipRouter, address ccipTokenPool)`
- `configureCollateral((bool depositingEnabled, uint256 issuanceRatioD18, uint256 liquidationRatioD18, uint256 liquidationRewardD18, bytes32 oracleNodeId, address tokenAddress, uint256 minDelegationD18) config)`
- `configureMaximumMarketCollateral(uint128 marketId, address collateralType, uint256 amount)`
- `configureOracleManager(address oracleManagerAddress)`
- `createAccount() returns (uint128 accountId)`
- `createAccount(uint128 requestedAccountId)`
- `createLock(uint128 accountId, address collateralType, uint256 amount, uint64 expireTimestamp)`
- `createPool(uint128 requestedPoolId, address owner)`
- `delegateCollateral(uint128 accountId, uint128 poolId, address collateralType, uint256 amount, uint256 leverage)`
- `deposit(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `depositMarketCollateral(uint128 marketId, address collateralType, uint256 tokenAmount)`
- `depositMarketUsd(uint128 marketId, address target, uint256 amount) returns (uint256 feeAmount)`
- `deprecateCollateral(address deprecatedCollateral, address deprecationReceiver)`
- `distributeDebtToPools(uint128 marketId, uint256 maxIter) returns (bool)`
- `distributeRewards(uint128 poolId, address collateralType, uint256 amount, uint64 start, uint32 duration) returns (int256)`
- `distributeRewardsByOwner(uint128 poolId, address collateralType, address rewardsDistributor, uint256 amount, uint64 start, uint32 duration) returns (int256)`
- `getAccountAvailableCollateral(uint128 accountId, address collateralType) view returns (uint256)`
- `getAccountCollateral(uint128 accountId, address collateralType) view returns (uint256 totalDeposited, uint256 totalAssigned, uint256 totalLocked)`
- `getAccountLastInteraction(uint128 accountId) view returns (uint256)`
- `getAccountOwner(uint128 accountId) view returns (address)`
- `getAccountPermissions(uint128 accountId) view returns ((address user, bytes32[] permissions)[] accountPerms)`
- `getAccountTokenAddress() view returns (address)`
- `getApprovedPools() view returns (uint256[])`
- `getAssociatedSystem(bytes32 id) view returns (address addr, bytes32 kind)`
- `getAvailablePoolRewards(uint128 accountId, uint128 poolId, address collateralType, address distributor) returns (uint256)`
- `getAvailableRewards(uint128 accountId, uint128 poolId, address collateralType, address distributor) returns (uint256)`
- `getCollateralConfiguration(address collateralType) pure returns ((bool depositingEnabled, uint256 issuanceRatioD18, uint256 liquidationRatioD18, uint256 liquidationRewardD18, bytes32 oracleNodeId, address tokenAddress, uint256 minDelegationD18))`
- `getCollateralConfigurations(bool hideDisabled) view returns ((bool depositingEnabled, uint256 issuanceRatioD18, uint256 liquidationRatioD18, uint256 liquidationRewardD18, bytes32 oracleNodeId, address tokenAddress, uint256 minDelegationD18)[])`
- `getCollateralPrice(address collateralType) view returns (uint256)`
- `getConfig(bytes32 k) view returns (bytes32 v)`
- `getConfigAddress(bytes32 k) view returns (address v)`
- `getConfigUint(bytes32 k) view returns (uint256 v)`
- `getDeniers(bytes32 feature) view returns (address[])`
- `getFeatureFlagAllowAll(bytes32 feature) view returns (bool)`
- `getFeatureFlagAllowlist(bytes32 feature) view returns (address[])`
- `getFeatureFlagDenyAll(bytes32 feature) view returns (bool)`
- `getImplementation() view returns (address)`
- `getLastDelegationTime(uint128 accountId, uint128 poolId, address collateralType) view returns (uint256 lastDelegationTime)`
- `getLocks(uint128 accountId, address collateralType, uint256 offset, uint256 count) view returns ((uint128 amountD18, uint64 lockExpirationTime)[] locks)`
- `getMarketAddress(uint128 marketId) view returns (address)`
- `getMarketCapacityContributionFromPool(uint128 marketId, uint128 poolId) view returns (uint256)`
- `getMarketCollateral(uint128 marketId) view returns (uint256)`
- `getMarketCollateralAmount(uint128 marketId, address collateralType) view returns (uint256 collateralAmountD18)`
- `getMarketCollateralValue(uint128 marketId) view returns (uint256)`
- `getMarketDebtPerShare(uint128 marketId) returns (int256)`
- `getMarketFees(uint128, uint256 amount) view returns (uint256 depositFeeAmount, uint256 withdrawFeeAmount)`
- `getMarketMinDelegateTime(uint128 marketId) view returns (uint32)`
- `getMarketNetIssuance(uint128 marketId) view returns (int128)`
- `getMarketPoolDebtDistribution(uint128 marketId, uint128 poolId) returns (uint256 sharesD18, uint128 totalSharesD18, int128 valuePerShareD27)`
- `getMarketPoolMaxDebtPerShare(uint128 marketId, uint128 poolId) view returns (int256)`
- `getMarketPools(uint128 marketId) returns (uint128[] inRangePoolIds, uint128[] outRangePoolIds)`
- `getMarketReportedDebt(uint128 marketId) view returns (uint256)`
- `getMarketTotalDebt(uint128 marketId) view returns (int256)`
- `getMaximumMarketCollateral(uint128 marketId, address collateralType) view returns (uint256)`
- `getMinLiquidityRatio() view returns (uint256)`
- `getMinLiquidityRatio(uint128 marketId) view returns (uint256)`
- `getNominatedPoolOwner(uint128 poolId) view returns (address)`
- `getOracleManager() view returns (address)`
- `getPoolCollateralConfiguration(uint128 poolId, address collateralType) view returns ((uint256 collateralLimitD18, uint256 issuanceRatioD18) config)`
- `getPoolCollateralIssuanceRatio(uint128 poolId, address collateral) view returns (uint256)`
- `getPoolConfiguration(uint128 poolId) view returns ((uint128 marketId, uint128 weightD18, int128 maxDebtShareValueD18)[])`
- `getPoolDebtPerShare(uint128 poolId) returns (int256 debtPerShareD18)`
- `getPoolName(uint128 poolId) view returns (string poolName)`
- `getPoolOwner(uint128 poolId) view returns (address)`
- `getPoolTotalDebt(uint128 poolId) returns (int256 totalDebtD18)`
- `getPosition(uint128 accountId, uint128 poolId, address collateralType) returns (uint256 collateralAmount, uint256 collateralValue, int256 debt, uint256 collateralizationRatio)`
- `getPositionCollateral(uint128 accountId, uint128 poolId, address collateralType) view returns (uint256 amount)`
- `getPositionCollateralRatio(uint128 accountId, uint128 poolId, address collateralType) returns (uint256)`
- `getPositionDebt(uint128 accountId, uint128 poolId, address collateralType) returns (int256 debt)`
- `getPreferredPool() view returns (uint128)`
- `getRewardRate(uint128 poolId, address collateralType, address distributor) view returns (uint256)`
- `getTrustedForwarder() pure returns (address)`
- `getUsdToken() view returns (address)`
- `getVaultCollateral(uint128 poolId, address collateralType) view returns (uint256 amount, uint256 value)`
- `getVaultCollateralRatio(uint128 poolId, address collateralType) returns (uint256)`
- `getVaultDebt(uint128 poolId, address collateralType) returns (int256)`
- `getWithdrawableMarketUsd(uint128 marketId) view returns (uint256)`
- `grantPermission(uint128 accountId, bytes32 permission, address user)`
- `hasPermission(uint128 accountId, bytes32 permission, address user) view returns (bool)`
- `initOrUpgradeNft(bytes32 id, string name, string symbol, string uri, address impl)`
- `initOrUpgradeToken(bytes32 id, string name, string symbol, uint8 decimals, address impl)`
- `isAuthorized(uint128 accountId, bytes32 permission, address user) view returns (bool)`
- `isFeatureAllowed(bytes32 feature, address account) view returns (bool)`
- `isMarketCapacityLocked(uint128 marketId) view returns (bool)`
- `isPositionLiquidatable(uint128 accountId, uint128 poolId, address collateralType) returns (bool)`
- `isTrustedForwarder(address forwarder) pure returns (bool)`
- `isVaultLiquidatable(uint128 poolId, address collateralType) returns (bool)`
- `liquidate(uint128 accountId, uint128 poolId, address collateralType, uint128 liquidateAsAccountId) returns ((uint256 debtLiquidated, uint256 collateralLiquidated, uint256 amountRewarded) liquidationData)`
- `liquidateToTreasury(uint128 accountId, uint128 poolId, address collateralType) returns ((uint256 debtLiquidated, uint256 collateralLiquidated, uint256 amountRewarded) liquidationData)`
- `liquidateVault(uint128 poolId, address collateralType, uint128 liquidateAsAccountId, uint256 maxUsd) returns ((uint256 debtLiquidated, uint256 collateralLiquidated, uint256 amountRewarded) liquidationData)`
- `migrateDelegation(uint128 accountId, uint128 oldPoolId, address collateralType, uint128 newPoolId)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address newNominatedOwner)`
- `nominatePoolOwner(address nominatedOwner, uint128 poolId)`
- `notifyAccountTransfer(address to, uint128 accountId)`
- `owner() view returns (address)`
- `rebalancePool(uint128 poolId, address optionalCollateralType)`
- `registerMarket(address market) returns (uint128 marketId)`
- `registerRewardsDistributor(uint128 poolId, address collateralType, address distributor)`
- `registerUnmanagedSystem(bytes32 id, address endpoint)`
- `removeApprovedPool(uint128 poolId)`
- `removeFromFeatureFlagAllowlist(bytes32 feature, address account)`
- `removeRewardsDistributor(uint128 poolId, address collateralType, address distributor)`
- `renounceNomination()`
- `renouncePermission(uint128 accountId, bytes32 permission)`
- `renouncePoolNomination(uint128 poolId)`
- `renouncePoolOwnership(uint128 poolId)`
- `revokePermission(uint128 accountId, bytes32 permission, address user)`
- `revokePoolNomination(uint128 poolId)`
- `setConfig(bytes32 k, bytes32 v)`
- `setDeniers(bytes32 feature, address[] deniers)`
- `setFeatureFlagAllowAll(bytes32 feature, bool allowAll)`
- `setFeatureFlagDenyAll(bytes32 feature, bool denyAll)`
- `setMarketMinDelegateTime(uint128 marketId, uint32 minDelegateTime)`
- `setMinLiquidityRatio(uint256 minLiquidityRatio)`
- `setMinLiquidityRatio(uint128 marketId, uint256 minLiquidityRatio)`
- `setPoolCollateralConfiguration(uint128 poolId, address collateralType, (uint256 collateralLimitD18, uint256 issuanceRatioD18) newConfig)`
- `setPoolCollateralDisabledByDefault(uint128 poolId, bool disabled)`
- `setPoolConfiguration(uint128 poolId, (uint128 marketId, uint128 weightD18, int128 maxDebtShareValueD18)[] newMarketConfigurations)`
- `setPoolName(uint128 poolId, string name)`
- `setPreferredPool(uint128 poolId)`
- `setSupportedCrossChainNetworks(uint64[] supportedNetworks, uint64[] ccipSelectors) returns (uint256 numRegistered)`
- `simulateUpgradeTo(address newImplementation)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `transferCrossChain(uint64 destChainId, uint256 amount) payable returns (uint256 gasTokenUsed)`
- `updateRewards(uint128 poolId, address collateralType, uint128 accountId) returns (uint256[], address[], uint256)`
- `upgradeTo(address newImplementation)`
- `withdraw(uint128 accountId, address collateralType, uint256 tokenAmount)`
- `withdrawMarketCollateral(uint128 marketId, address collateralType, uint256 tokenAmount)`
- `withdrawMarketUsd(uint128 marketId, address target, uint256 amount) returns (uint256 feeAmount)`

Left out of this ABI, though its deployments declare them:

- `error AccountActivityTimeoutPending` taking `(uint128,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AccountNotFound` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CannotScaleEmptyMapping` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralDepositDisabled` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralNotFound` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DeprecatedDeposit` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IncorrectMarketInterface` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error IneligibleForLiquidation` taking `(uint256,int256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAccountCollateral` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAllowance` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientAvailableCollateral` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientCcipFee` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientDelegation` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientMarketCollateralDepositable` taking `(uint128,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAccountId` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidParameter` taking `(string,string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPermission` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MarketNotFound` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MinDelegationTimeoutPending` taking `(uint128,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchAssociatedSystemKind` taking `(bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MissingAssociatedSystem` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotAContract` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotCcipRouter` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEnoughLiquidity` taking `(uint128,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotFundedByPool` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyAccountTokenProxy` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowInt128ToUint128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowInt256ToUint256` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint128ToInt128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint256ToInt256` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint256ToUint128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint64ToInt64` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PermissionDenied` taking `(uint128,bytes32,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PermissionNotGranted` taking `(uint128,bytes32,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PoolAlreadyExists` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PoolCollateralLimitExceeded` taking `(uint128,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PrecisionLost` taking `(uint256,uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Unauthorized` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error UpgradeSimulationFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `PerpsMarketProxyABI`

`import PerpsMarketProxyABI from "./protocols/synthetix-v3/PerpsMarketProxyABI.json";` Speaks for: perpsMarketProxy. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `SynthetixV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `acceptOwnership()`
- `addSettlementStrategy(uint128 marketId, (uint8 strategyType, uint256 settlementDelay, uint256 settlementWindowDuration, address priceVerificationContract, bytes32 feedId, uint256 settlementReward, bool disabled, uint256 commitmentPriceDelay) strategy) returns (uint256 strategyId)`
- `cancelOrder(uint128 accountId)`
- `canLiquidate(uint128 accountId) view returns (bool isEligible)`
- `canLiquidateMarginOnly(uint128 accountId) view returns (bool isEligible)`
- `commitOrder((uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) commitment) returns ((uint256 commitmentTime, (uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) request) retOrder, uint256 fees)`
- `computeOrderFees(uint128 marketId, int128 sizeDelta) view returns (uint256 orderFees, uint256 fillPrice)`
- `computeOrderFeesWithPrice(uint128 marketId, int128 sizeDelta, uint256 price) view returns (uint256 orderFees, uint256 fillPrice)`
- `createAccount() returns (uint128 accountId)`
- `createAccount(uint128 requestedAccountId)`
- `createMarket(uint128 requestedMarketId, string marketName, string marketSymbol) returns (uint128)`
- `currentFundingRate(uint128 marketId) view returns (int256)`
- `currentFundingVelocity(uint128 marketId) view returns (int256)`
- `debt(uint128 accountId) view returns (uint256 accountDebt)`
- `fillPrice(uint128 marketId, int128 orderSize, uint256 price) view returns (uint256)`
- `flaggedAccounts() view returns (uint256[] accountIds)`
- `getAccountCollateralIds(uint128 accountId) view returns (uint256[])`
- `getAccountLastInteraction(uint128 accountId) view returns (uint256)`
- `getAccountOpenPositions(uint128 accountId) view returns (uint256[])`
- `getAccountOwner(uint128 accountId) view returns (address)`
- `getAccountPermissions(uint128 accountId) view returns ((address user, bytes32[] permissions)[] accountPerms)`
- `getAccountTokenAddress() view returns (address)`
- `getAssociatedSystem(bytes32 id) view returns (address addr, bytes32 kind)`
- `getAvailableMargin(uint128 accountId) view returns (int256 availableMargin)`
- `getCollateralAmount(uint128 accountId, uint128 collateralId) view returns (uint256)`
- `getCollateralConfiguration(uint128 collateralId) view returns (uint256 maxCollateralAmount)`
- `getCollateralConfigurationFull(uint128 collateralId) view returns (uint256 maxCollateralAmount, uint256 upperLimitDiscount, uint256 lowerLimitDiscount, uint256 discountScalar)`
- `getCollateralLiquidateRewardRatio() view returns (uint128 collateralLiquidateRewardRatioD18)`
- `getFeeCollector() view returns (address feeCollector)`
- `getFundingParameters(uint128 marketId) view returns (uint256 skewScale, uint256 maxFundingVelocity)`
- `getImplementation() view returns (address)`
- `getInterestRateParameters() view returns (uint128 lowUtilizationInterestRateGradient, uint128 interestRateGradientBreakpoint, uint128 highUtilizationInterestRateGradient)`
- `getKeeperCostNodeId() view returns (bytes32 keeperCostNodeId)`
- `getKeeperRewardGuards() view returns (uint256 minKeeperRewardUsd, uint256 minKeeperProfitRatioD18, uint256 maxKeeperRewardUsd, uint256 maxKeeperScalingRatioD18)`
- `getLiquidationParameters(uint128 marketId) view returns (uint256 initialMarginRatioD18, uint256 minimumInitialMarginRatioD18, uint256 maintenanceMarginScalarD18, uint256 flagRewardRatioD18, uint256 minimumPositionMargin)`
- `getLockedOiRatio(uint128 marketId) view returns (uint256)`
- `getMarkets() view returns (uint256[] marketIds)`
- `getMarketSummary(uint128 marketId) view returns ((int256 skew, uint256 size, uint256 maxOpenInterest, int256 currentFundingRate, int256 currentFundingVelocity, uint256 indexPrice) summary)`
- `getMaxLiquidationParameters(uint128 marketId) view returns (uint256 maxLiquidationLimitAccumulationMultiplier, uint256 maxSecondsInLiquidationWindow, uint256 maxLiquidationPd, address endorsedLiquidator)`
- `getMaxMarketSize(uint128 marketId) view returns (uint256 maxMarketSize)`
- `getMaxMarketValue(uint128 marketId) view returns (uint256 maxMarketValue)`
- `getOpenPosition(uint128 accountId, uint128 marketId) view returns (int256 totalPnl, int256 accruedFunding, int128 positionSize, uint256 owedInterest)`
- `getOpenPositionSize(uint128 accountId, uint128 marketId) view returns (int128 positionSize)`
- `getOrder(uint128 accountId) view returns ((uint256 commitmentTime, (uint128 marketId, uint128 accountId, int128 sizeDelta, uint128 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) request) order)`
- `getOrderFees(uint128 marketId) view returns (uint256 makerFee, uint256 takerFee)`
- `getPerAccountCaps() view returns (uint128 maxPositionsPerAccount, uint128 maxCollateralsPerAccount)`
- `getPriceData(uint128 perpsMarketId) view returns (bytes32 feedId, uint256 strictStalenessTolerance)`
- `getReferrerShare(address referrer) view returns (uint256 shareRatioD18)`
- `getRegisteredDistributor(uint128 collateralId) view returns (address distributor, address[] poolDelegatedCollateralTypes)`
- `getRequiredMargins(uint128 accountId) view returns (uint256 requiredInitialMargin, uint256 requiredMaintenanceMargin, uint256 maxLiquidationReward)`
- `getSettlementRewardCost(uint128 marketId, uint128 settlementStrategyId) view returns (uint256)`
- `getSettlementStrategy(uint128 marketId, uint256 strategyId) view returns ((uint8 strategyType, uint256 settlementDelay, uint256 settlementWindowDuration, address priceVerificationContract, bytes32 feedId, uint256 settlementReward, bool disabled, uint256 commitmentPriceDelay) settlementStrategy)`
- `getSupportedCollaterals() view returns (uint256[] supportedCollaterals)`
- `getWithdrawableMargin(uint128 accountId) view returns (int256 withdrawableMargin)`
- `globalCollateralValue(uint128 collateralId) view returns (uint256 collateralValue)`
- `grantPermission(uint128 accountId, bytes32 permission, address user)`
- `hasPermission(uint128 accountId, bytes32 permission, address user) view returns (bool)`
- `indexPrice(uint128 marketId) view returns (uint256)`
- `initializeFactory(address synthetix, address spotMarket) returns (uint128)`
- `initOrUpgradeNft(bytes32 id, string name, string symbol, string uri, address impl)`
- `initOrUpgradeToken(bytes32 id, string name, string symbol, uint8 decimals, address impl)`
- `interestRate() view returns (uint128)`
- `isAuthorized(uint128 accountId, bytes32 permission, address user) view returns (bool)`
- `isRegistered(address distributor) view returns (bool)`
- `liquidate(uint128 accountId) returns (uint256 liquidationReward)`
- `liquidateFlagged(uint256 maxNumberOfAccounts) returns (uint256 liquidationReward)`
- `liquidateFlaggedAccounts(uint128[] accountIds) returns (uint256 liquidationReward)`
- `liquidateMarginOnly(uint128 accountId) returns (uint256 liquidationReward)`
- `liquidationCapacity(uint128 marketId) view returns (uint256 capacity, uint256 maxLiquidationInWindow, uint256 latestLiquidationTimestamp)`
- `maxOpenInterest(uint128 marketId) view returns (uint256)`
- `metadata(uint128 marketId) view returns (string name, string symbol)`
- `minimumCredit(uint128 perpsMarketId) view returns (uint256)`
- `modifyCollateral(uint128 accountId, uint128 collateralId, int256 amountDelta)`
- `name(uint128 perpsMarketId) view returns (string)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address newNominatedOwner)`
- `notifyAccountTransfer(address to, uint128 accountId)`
- `owner() view returns (address)`
- `payDebt(uint128 accountId, uint256 amount)`
- `registerDistributor(address token, address distributor, uint128 collateralId, address[] poolDelegatedCollateralTypes)`
- `registerUnmanagedSystem(bytes32 id, address endpoint)`
- `renounceNomination()`
- `renouncePermission(uint128 accountId, bytes32 permission)`
- `reportedDebt(uint128 perpsMarketId) view returns (uint256)`
- `requiredMarginForOrder(uint128 accountId, uint128 marketId, int128 sizeDelta) view returns (uint256 requiredMargin)`
- `requiredMarginForOrderWithPrice(uint128 accountId, uint128 marketId, int128 sizeDelta, uint256 price) view returns (uint256 requiredMargin)`
- `revokePermission(uint128 accountId, bytes32 permission, address user)`
- `setCollateralConfiguration(uint128 collateralId, uint256 maxCollateralAmount, uint256 upperLimitDiscount, uint256 lowerLimitDiscount, uint256 discountScalar)`
- `setCollateralLiquidateRewardRatio(uint128 collateralLiquidateRewardRatioD18)`
- `setFeeCollector(address feeCollector)`
- `setFundingParameters(uint128 marketId, uint256 skewScale, uint256 maxFundingVelocity)`
- `setInterestRateParameters(uint128 lowUtilizationInterestRateGradient, uint128 interestRateGradientBreakpoint, uint128 highUtilizationInterestRateGradient)`
- `setKeeperRewardGuards(uint256 minKeeperRewardUsd, uint256 minKeeperProfitRatioD18, uint256 maxKeeperRewardUsd, uint256 maxKeeperScalingRatioD18)`
- `setLiquidationParameters(uint128 marketId, uint256 initialMarginRatioD18, uint256 minimumInitialMarginRatioD18, uint256 maintenanceMarginScalarD18, uint256 flagRewardRatioD18, uint256 minimumPositionMargin)`
- `setLockedOiRatio(uint128 marketId, uint256 lockedOiRatioD18)`
- `setMaxLiquidationParameters(uint128 marketId, uint256 maxLiquidationLimitAccumulationMultiplier, uint256 maxSecondsInLiquidationWindow, uint256 maxLiquidationPd, address endorsedLiquidator)`
- `setMaxMarketSize(uint128 marketId, uint256 maxMarketSize)`
- `setMaxMarketValue(uint128 marketId, uint256 maxMarketValue)`
- `setOrderFees(uint128 marketId, uint256 makerFeeRatio, uint256 takerFeeRatio)`
- `setPerAccountCaps(uint128 maxPositionsPerAccount, uint128 maxCollateralsPerAccount)`
- `setPerpsMarketName(string marketName)`
- `setSettlementStrategy(uint128 marketId, uint256 strategyId, (uint8 strategyType, uint256 settlementDelay, uint256 settlementWindowDuration, address priceVerificationContract, bytes32 feedId, uint256 settlementReward, bool disabled, uint256 commitmentPriceDelay) strategy)`
- `setSettlementStrategyEnabled(uint128 marketId, uint256 strategyId, bool enabled)`
- `settleOrder(uint128 accountId)`
- `simulateUpgradeTo(address newImplementation)`
- `size(uint128 marketId) view returns (uint256)`
- `skew(uint128 marketId) view returns (int256)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `totalAccountOpenInterest(uint128 accountId) view returns (uint256)`
- `totalCollateralValue(uint128 accountId) view returns (uint256)`
- `totalGlobalCollateralValue() view returns (uint256 totalCollateralValue)`
- `updateInterestRate()`
- `updateKeeperCostNodeId(bytes32 keeperCostNodeId)`
- `updatePriceData(uint128 perpsMarketId, bytes32 feedId, uint256 strictStalenessTolerance)`
- `updateReferrerShare(address referrer, uint256 shareRatioD18)`
- `upgradeTo(address newImplementation)`
- `utilizationRate() view returns (uint256 rate, uint256 delegatedCollateral, uint256 lockedCredit)`

Left out of this ABI, though its deployments declare them:

- `error AccountLiquidatable` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AccountNotFound` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientCollateral` taking `(uint128,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAccountId` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAmountDelta` taking `(int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDistributor` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDistributorContract` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidFeeCollectorInterface` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidId` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidInterestRateParameters` taking `(uint128,uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMarket` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidParameter` taking `(string,string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPermission` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidSettlementWindowDuration` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxCollateralExceeded` taking `(uint128,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxOpenInterestReached` taking `(uint128,uint256,int256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxUSDOpenInterestReached` taking `(uint128,uint256,int256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchAssociatedSystemKind` taking `(bytes32,bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MissingAssociatedSystem` taking `(bytes32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NonexistentDebt` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEligibleForLiquidation` taking `(uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyAccountTokenProxy` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowInt128ToUint128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowInt256ToUint256` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint128ToInt128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint256ToInt256` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OverflowUint256ToUint128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PendingOrderExists` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PermissionDenied` taking `(uint128,bytes32,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PermissionNotGranted` taking `(uint128,bytes32,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PerpsMarketAlreadyInitialized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SettlementStrategyNotFound` taking `(uint8)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SettlementWindowExpired` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
