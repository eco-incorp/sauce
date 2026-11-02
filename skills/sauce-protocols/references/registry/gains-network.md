<!-- Generated from the SDK's registries. Do not edit. -->

# Gains Network (`gains-network`)

Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `GainsNetwork` on polygon, arbitrum |
| Chains | polygon, arbitrum |
| Document | [gains-network.md](../gains-network.md): what it is for, how to choose it, its pitfalls |

## In a program

On Polygon, `GainsNetwork` is a namespace: its contracts need no import.

```sauce chain=polygon
function main() {
  // Polygon's diamond, `0x209A9A01980377916851af2cA075C2b170452018`.
  require(GainsNetwork.Diamond != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../../../sauce-chains/references/polygon.md) | diamond | `0x209A9A01980377916851af2cA075C2b170452018` | `GainsNetwork.Diamond` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | diamond | `0xFF162c694eAA571f685030649814282eA457f169` | `GainsNetwork.Diamond` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gns | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` | `GainsNetwork.Gns` |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/gains-network/DiamondABI.json";` Speaks for: diamond. The import is the contract's full ABI across every deployment; call it through the `GainsNetwork` namespace to have a function a chain's deployment does not run refused.

- `addOtcCollateralBalance(uint8 _collateralIndex, uint256 _collateralAmount)`
- `addPriceImpactOpenInterest(address _trader, uint32 _index, uint256 _oiDeltaCollateral, bool _open, bool _isPnlPositive)`
- `addTradersUnclaimedPoints(address[] _traders, uint8[] _creditTypes, uint224[] _points)`
- `borrowingParamUpdateCallback((uint8 collateralIndex, uint16 pairIndex, uint8 updateType, uint224 newValue) _paramUpdate, uint256 _currentPairPrice)`
- `calculateFeeAmount(address _trader, uint256 _normalFeeAmountCollateral) view returns (uint256)`
- `cancelOpenOrder(uint32 _index)`
- `cancelOrderAfterTimeout(uint32 _orderIndex)`
- `claimAllyRewards()`
- `claimPendingTriggerRewards(address _oracle)`
- `claimReferrerRewards()`
- `closeTradeMarket(uint32 index, uint64 expectedPrice)`
- `decreasePositionSize(uint32 _index, uint120 _collateralDelta, uint24 _leverageDelta, uint64 _expectedPrice)`
- `delegatedTradingAction(address _trader, bytes _callData) returns (bytes)`
- `diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _faceCut, address _init, bytes _calldata)`
- `distributeReferralReward(address _trader, uint256 _volumeUsd, uint256 _referrerFeeUsd, uint256 _gnsPriceUsd)`
- `distributeTriggerReward(uint256 _rewardGns)`
- `downscaleTradeFeesData(address _trader, uint32 _index, uint256 _positionSizeCollateralDelta, uint256 _existingPositionSizeCollateral, uint256 _newCollateralAmount)`
- `facetAddress(bytes4 _functionSelector) view returns (address facetAddress_)`
- `facetAddresses() view returns (address[] facetAddresses_)`
- `facetFunctionSelectors(address _facet) view returns (bytes4[] facetFunctionSelectors_)`
- `facets() view returns ((address facetAddress, bytes4[] functionSelectors)[] facets_)`
- `getAddresses() view returns ((address gns, address gnsStaking, address treasury))`
- `getAllBorrowingPairs(uint8 _collateralIndex) view returns ((uint32 feePerBlock, uint64 accFeeLong, uint64 accFeeShort, uint48 accLastUpdatedBlock, uint48 feeExponent)[], (uint72 long, uint72 short, uint72 max, uint40 __placeholder)[], (uint16 groupIndex, uint48 block, uint64 initialAccFeeLong, uint64 initialAccFeeShort, uint64 prevGroupAccFeeLong, uint64 prevGroupAccFeeShort, uint64 pairAccFeeLong, uint64 pairAccFeeShort, uint64 __placeholder)[][])`
- `getAllyDetails(address _ally) view returns ((address[] referrersReferred, uint256 volumeReferredUsd, uint256 pendingRewardsGns, uint256 totalRewardsGns, uint256 totalRewardsValueUsd, bool active))`
- `getBorrowingFeePerBlockCap() view returns ((uint32 minP, uint32 maxP))`
- `getBorrowingGroup(uint8 _collateralIndex, uint16 _groupIndex) view returns ((uint32 feePerBlock, uint64 accFeeLong, uint64 accFeeShort, uint48 accLastUpdatedBlock, uint48 feeExponent))`
- `getBorrowingGroupOi(uint8 _collateralIndex, uint16 _groupIndex) view returns ((uint72 long, uint72 short, uint72 max, uint40 __placeholder))`
- `getBorrowingGroupPendingAccFees(uint8 _collateralIndex, uint16 _groupIndex, uint256 _currentBlock) view returns (uint64 accFeeLong, uint64 accFeeShort, uint64 groupAccFeeLongDelta, uint64 groupAccFeeShortDelta)`
- `getBorrowingGroups(uint8 _collateralIndex, uint16[] _indices) view returns ((uint32 feePerBlock, uint64 accFeeLong, uint64 accFeeShort, uint48 accLastUpdatedBlock, uint48 feeExponent)[], (uint72 long, uint72 short, uint72 max, uint40 __placeholder)[])`
- `getBorrowingInitialAccFees(uint8 _collateralIndex, address _trader, uint32 _index) view returns ((uint64 accPairFee, uint64 accGroupFee, uint48 block, uint80 __placeholder))`
- `getBorrowingPair(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint32 feePerBlock, uint64 accFeeLong, uint64 accFeeShort, uint48 accLastUpdatedBlock, uint48 feeExponent))`
- `getBorrowingPairFeePerBlockCap(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint32 minP, uint32 maxP))`
- `getBorrowingPairFeePerBlockCaps(uint8 _collateralIndex, uint16[] _indices) view returns ((uint32 minP, uint32 maxP)[])`
- `getBorrowingPairGroupIndex(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint16 groupIndex)`
- `getBorrowingPairGroups(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint16 groupIndex, uint48 block, uint64 initialAccFeeLong, uint64 initialAccFeeShort, uint64 prevGroupAccFeeLong, uint64 prevGroupAccFeeShort, uint64 pairAccFeeLong, uint64 pairAccFeeShort, uint64 __placeholder)[])`
- `getBorrowingPairOiBeforeV10(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint72 long, uint72 short, uint72 max, uint40 __placeholder))`
- `getBorrowingPairPendingAccFees(uint8 _collateralIndex, uint16 _pairIndex, uint256 _currentBlock, uint256 _currentPairPrice) view returns (uint64 accFeeLong, uint64 accFeeShort, uint64 pairAccFeeLongDelta, uint64 pairAccFeeShortDelta)`
- `getByPassTriggerLink(address _user) view returns (bool)`
- `getDepthBandsMapping() view returns (uint256 slot1, uint256 slot2)`
- `getDepthBandsMappingDecoded() view returns (uint16[] bands)`
- `getFeeTier(uint256 _feeTierIndex) view returns ((uint32 feeMultiplier, uint32 pointsThreshold))`
- `getFeeTiers() view returns ((uint32 feeMultiplier, uint32 pointsThreshold)[])`
- `getFeeTiersCount() view returns (uint256)`
- `getFeeTiersTraderDailyInfo(address _trader, uint32 _day) view returns ((uint32 feeMultiplierCache, uint224 points))`
- `getFeeTiersTraderDailyInfoArray(address _trader, uint32[] _days) view returns ((uint32 feeMultiplierCache, uint224 points)[])`
- `getFeeTiersTraderInfo(address _trader) view returns ((uint32 lastDayUpdated, uint224 trailingPoints))`
- `getGnsStakingInfo(address _trader) view returns ((uint88 stakedGns, uint88 stakedVaultGns, uint24 bonusAmount, uint32 stakeTimestamp, uint32 feeMultiplierCache))`
- `getGnsStakingInfos(address[] _traders) view returns ((uint88 stakedGns, uint88 stakedVaultGns, uint24 bonusAmount, uint32 stakeTimestamp, uint32 feeMultiplierCache)[])`
- `getGnsStakingTier(uint256 _tierIndex) view returns ((uint32 feeMultiplier, uint32 pointsThreshold))`
- `getGnsStakingTiers() view returns ((uint32 feeMultiplier, uint32 pointsThreshold)[])`
- `getGnsStakingTiersCount() view returns (uint256)`
- `getGnsVaultAddress() view returns (address)`
- `getGroupVolumeMultiplier(uint256 _groupIndex) view returns (uint256)`
- `getGroupVolumeMultipliers(uint256[] _groupIndices) view returns (uint256[])`
- `getMarketOrdersTimeoutBlocks() view returns (uint16)`
- `getMaxSkewCollateral(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint80)`
- `getNativeTransferEnabled() view returns (bool)`
- `getNativeTransferGasLimit() view returns (uint16)`
- `getNegPnlCumulVolMultiplier() view returns (uint48)`
- `getOiWindow(uint48 _windowsDuration, uint256 _pairIndex, uint256 _windowId) view returns ((uint128 oiLongUsd, uint128 oiShortUsd))`
- `getOiWindows(uint48 _windowsDuration, uint256 _pairIndex, uint256[] _windowIds) view returns ((uint128 oiLongUsd, uint128 oiShortUsd)[])`
- `getOiWindowsSettings() view returns ((uint48 startTs, uint48 windowsDuration, uint48 windowsCount))`
- `getOtcBalance(uint8 _collateralIndex) view returns (uint256)`
- `getOtcConfig() view returns ((address gnsTreasury, uint64 treasuryShareP, uint64 stakingShareP, uint64 burnShareP, uint64 premiumP))`
- `getOtcRate(uint8 _collateralIndex) view returns (uint256)`
- `getPairBorrowingFeeData(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint128 accBorrowingFeeP, uint32 lastBorrowingUpdateTs, uint96 __placeholder)[])`
- `getPairBorrowingFeeParams(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint24 borrowingRatePerSecondP, uint232 __placeholder)[])`
- `getPairDepthBands(uint256 _pairIndex) view returns ((uint256 aboveSlot1, uint256 aboveSlot2, uint256 belowSlot1, uint256 belowSlot2))`
- `getPairDepthBandsArray(uint256[] _indices) view returns ((uint256 aboveSlot1, uint256 aboveSlot2, uint256 belowSlot1, uint256 belowSlot2)[])`
- `getPairDepthBandsDecoded(uint256 _pairIndex) view returns (uint256 totalDepthAboveUsd, uint256 totalDepthBelowUsd, uint16[] bandsAbove, uint16[] bandsBelow)`
- `getPairDepthBandsDecodedArray(uint256[] _indices) view returns (uint256[] totalDepthAboveUsd, uint256[] totalDepthBelowUsd, uint16[][] bandsAbove, uint16[][] bandsBelow)`
- `getPairFactors(uint256[] _indices) view returns ((uint40 protectionCloseFactor, uint32 protectionCloseFactorBlocks, uint40 cumulativeFactor, bool exemptOnOpen, bool exemptAfterProtectionCloseFactor, uint128 __placeholder)[])`
- `getPairFundingFeeData(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((int128 accFundingFeeLongP, int128 accFundingFeeShortP, int56 lastFundingRatePerSecondP, uint32 lastFundingUpdateTs, uint168 __placeholder)[])`
- `getPairFundingFeeParams(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint112 skewCoefficientPerYear, uint24 absoluteVelocityPerYearCap, uint24 absoluteRatePerSecondCap, uint32 thetaThresholdUsd, bool fundingFeesEnabled, bool aprMultiplierEnabled, uint48 __placeholder)[])`
- `getPairGlobalParamsArray(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint80 maxSkewCollateral, uint176 __placeholder)[])`
- `getPairMaxOi(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint256)`
- `getPairMaxOiCollateral(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint256)`
- `getPairOiAfterV10Collateral(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint128 oiLongCollateral, uint128 oiShortCollateral))`
- `getPairOiAfterV10Token(uint8 _collateralIndex, uint16 _pairIndex) view returns ((uint128 oiLongToken, uint128 oiShortToken))`
- `getPairOiBeforeV10Collateral(uint8 _collateralIndex, uint16 _pairIndex, bool _long) view returns (uint256)`
- `getPairOisAfterV10Collateral(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint128 oiLongCollateral, uint128 oiShortCollateral)[])`
- `getPairOisAfterV10Token(uint8[] _collateralIndex, uint16[] _pairIndex) view returns ((uint128 oiLongToken, uint128 oiShortToken)[])`
- `getPairOisBeforeV10Collateral(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint256 longOi, uint256 shortOi)`
- `getPairPendingAccBorrowingFees(uint8 _collateralIndex, uint16 _pairIndex, uint64 _currentPairPrice) view returns (uint128 accBorrowingFeeP)`
- `getPairPendingAccFundingFees(uint8 _collateralIndex, uint16 _pairIndex, uint64 _currentPairPrice) view returns (int128 accFundingFeeLongP, int128 accFundingFeeShortP, int56 currentFundingRatePerSecondP)`
- `getPairSkewDepth(uint8 _collateralIndex, uint16 _pairIndex) view returns (uint256)`
- `getPairSkewDepths(uint8[] _collateralIndices, uint16[] _pairIndices) view returns (uint256[])`
- `getPendingParamUpdates(uint32[] _index) view returns ((uint8 collateralIndex, uint16 pairIndex, uint8 updateType, uint224 newValue)[])`
- `getPriceImpactOi(uint256 _pairIndex, bool _long) view returns (uint256 activeOi)`
- `getProtectionCloseFactorWhitelist(address _trader) view returns (bool)`
- `getReentrancyLock() view returns (uint256)`
- `getReferralsAllyFeeP() view returns (uint256)`
- `getReferralSettingsOverrides(address _address) view returns ((uint24 referralFeeOverrideP, uint24 allyFeeOverrideP, uint208 __placeholder))`
- `getReferralsStartReferrerFeeP() view returns (uint256)`
- `getReferralsTargetVolumeUsd() view returns (uint256)`
- `getReferrerDetails(address _referrer) view returns ((address ally, address[] tradersReferred, uint256 volumeReferredUsd, uint256 pendingRewardsGns, uint256 totalRewardsGns, uint256 totalRewardsValueUsd, bool active))`
- `getReferrerFeeProgressP(address _referrer) view returns (uint256)`
- `getReferrersReferred(address _ally) view returns (address[])`
- `getStakedVaultGnsValue(uint88 _stakedVaultGns) view returns (uint256)`
- `getTradeBorrowingFee((uint8 collateralIndex, address trader, uint16 pairIndex, uint32 index, bool long, uint256 collateral, uint256 leverage, uint256 currentPairPrice) _input) view returns (uint256 feeAmountCollateral)`
- `getTradeBorrowingFeesCollateral(address _trader, uint32 _index, uint64 _currentPairPrice) view returns (uint256)`
- `getTradeCumulVolPriceImpactP(address _trader, uint16 _pairIndex, bool _long, uint256 _tradeOpenInterestUsd, bool _isPnlPositive, bool _open, uint256 _lastPosIncreaseBlock) view returns (int256 priceImpactP)`
- `getTradeFeesData(address _trader, uint32 _index) view returns ((uint128 realizedTradingFeesCollateral, int128 realizedPnlCollateral, uint128 manuallyRealizedNegativePnlCollateral, uint128 alreadyTransferredNegativePnlCollateral, uint128 virtualAvailableCollateralInDiamond, uint128 __placeholder, int128 initialAccFundingFeeP, uint128 initialAccBorrowingFeeP))`
- `getTradeFeesDataArray(address[] _trader, uint32[] _index) view returns ((uint128 realizedTradingFeesCollateral, int128 realizedPnlCollateral, uint128 manuallyRealizedNegativePnlCollateral, uint128 alreadyTransferredNegativePnlCollateral, uint128 virtualAvailableCollateralInDiamond, uint128 __placeholder, int128 initialAccFundingFeeP, uint128 initialAccBorrowingFeeP)[])`
- `getTradeFundingFeesCollateral(address _trader, uint32 _index, uint64 _currentPairPrice) view returns (int256)`
- `getTradeLiquidationPrice((uint8 collateralIndex, address trader, uint16 pairIndex, uint32 index, uint64 openPrice, bool long, uint256 collateral, uint256 leverage, int256 additionalFeeCollateral, (uint40 maxLiqSpreadP, uint40 startLiqThresholdP, uint40 endLiqThresholdP, uint24 startLeverage, uint24 endLeverage) liquidationParams, uint64 currentPairPrice, bool isCounterTrade, uint256 partialCloseMultiplier, bool beforeOpened) _input) view returns (uint256)`
- `getTradeManuallyRealizedNegativePnlCollateral(address _trader, uint32 _index) view returns (uint256)`
- `getTradePendingHoldingFeesCollateral(address _trader, uint32 _index, uint64 _currentPairPrice) view returns ((int256 fundingFeeCollateral, uint256 borrowingFeeCollateral, uint256 borrowingFeeCollateral_old, int256 totalFeeCollateral) tradeHoldingFees)`
- `getTraderActiveReferrer(address _trader) view returns (address)`
- `getTradeRealizedPnlCollateral(address _trader, uint32 _index) view returns (int256 realizedPnlCollateral, uint256 realizedTradingFeesCollateral, int256 totalRealizedPnlCollateral)`
- `getTradeRealizedTradingFeesCollateral(address _trader, uint32 _index) view returns (uint256)`
- `getTraderFeeTiersEnrollment(address _trader) view returns ((uint8 status, uint248 __placeholder))`
- `getTraderLastReferrer(address _trader) view returns (address)`
- `getTradersReferred(address _referrer) view returns (address[])`
- `getTraderUnclaimedPoints(address _trader) view returns (uint224)`
- `getTradeSkewPriceImpactP(uint8 _collateralIndex, uint16 _pairIndex, bool _long, uint256 _positionSizeToken, bool _open) view returns (int256 priceImpactP)`
- `getTradeUiRealizedPnlDataArray(address[] _trader, uint32[] _index) view returns ((uint128 realizedTradingFeesCollateral, uint128 realizedOldBorrowingFeesCollateral, uint128 realizedNewBorrowingFeesCollateral, int128 realizedFundingFeesCollateral, int128 realizedPnlPartialCloseCollateral, uint128 pnlWithdrawnCollateral)[])`
- `getTradingDelegate(address _trader) view returns (address)`
- `getTriggerPendingRewardsGns(address _oracle) view returns (uint256)`
- `getTriggerTimeoutBlocks() view returns (uint16)`
- `getUseGnsVaultBalance() view returns (bool)`
- `getUserPriceImpact(address _trader, uint256 _pairIndex) view returns ((uint16 cumulVolPriceImpactMultiplier, uint16 fixedSpreadP, uint224 __placeholder))`
- `getUserPriceImpactArray(address _trader, uint256[] _pairIndices) view returns ((uint16 cumulVolPriceImpactMultiplier, uint16 fixedSpreadP, uint224 __placeholder)[])`
- `getWrappedNativeToken() view returns (address)`
- `handleTradeBorrowingCallback(uint8 _collateralIndex, address _trader, uint16 _pairIndex, uint32 _index, uint256 _positionSizeCollateral, bool _open, bool _long, uint256 _currentPairPrice)`
- `hasActiveOrder(uint256 _orderBlock) view returns (bool)`
- `hasRole(address _account, uint8 _role) view returns (bool)`
- `hasRoles(address _account, uint8 _roleA, uint8 _roleB) view returns (bool)`
- `increasePositionSize(uint32 _index, uint120 _collateralDelta, uint24 _leverageDelta, uint64 _expectedPrice, uint16 _maxSlippageP)`
- `increasePositionSizeNative(uint32 _index, uint120 _collateralDelta, uint24 _leverageDelta, uint64 _expectedPrice, uint16 _maxSlippageP) payable`
- `initialize(address _govTimelock)`
- `initializeBorrowingFeePerBlockCap((uint32 minP, uint32 maxP) _feePerBlockCap)`
- `initializeChainConfig(uint16 _nativeTransferGasLimit, bool _nativeTransferEnabled)`
- `initializeDepthBandsMapping(uint256 _slot1, uint256 _slot2)`
- `initializeFeeTiers(uint256[] _groupIndices, uint256[] _groupVolumeMultipliers, uint256[] _feeTiersIndices, (uint32 feeMultiplier, uint32 pointsThreshold)[] _feeTiers)`
- `initializeGnsStakingTiers(uint256[] _tierIndices, (uint32 feeMultiplier, uint32 pointsThreshold)[] _tiers, address _gnsVaultAddress, bool _useGnsVaultBalance)`
- `initializeGovEmergencyTimelock(address _govEmergencyTimelock)`
- `initializeNegPnlCumulVolMultiplier(uint40 _negPnlCumulVolMultiplier)`
- `initializeOtc((address gnsTreasury, uint64 treasuryShareP, uint64 stakingShareP, uint64 burnShareP, uint64 premiumP) _config)`
- `initializePairFactors(uint16[] _pairIndices, uint40[] _protectionCloseFactors, uint32[] _protectionCloseFactorBlocks, uint40[] _cumulativeFactors)`
- `initializePriceImpact(uint48 _windowsDuration, uint48 _windowsCount)`
- `initializeReferrals(uint256 _allyFeeP, uint256 _startReferrerFeeP, uint256 _targetVolumeUsd)`
- `initializeTrading(uint16 _marketOrdersTimeoutBlocks, address[] _usersByPassTriggerLink)`
- `initializeTriggerRewards(uint16 _timeoutBlocks)`
- `initiateManualNegativePnlRealization(address _trader, uint32 _index, bool _isHoldingFees)`
- `isWrappedNativeToken(address _token) view returns (bool)`
- `multicall(bytes[] data) returns (bytes[] results)`
- `openTrade((address user, uint32 index, uint16 pairIndex, uint24 leverage, bool long, bool isOpen, uint8 collateralIndex, uint8 tradeType, uint120 collateralAmount, uint64 openPrice, uint64 tp, uint64 sl, bool isCounterTrade, uint160 positionSizeToken, uint24 __placeholder) trade, uint16 maxSlippageP, address referrer)`
- `openTradeNative((address user, uint32 index, uint16 pairIndex, uint24 leverage, bool long, bool isOpen, uint8 collateralIndex, uint8 tradeType, uint120 collateralAmount, uint64 openPrice, uint64 tp, uint64 sl, bool isCounterTrade, uint160 positionSizeToken, uint24 __placeholder) _trade, uint16 _maxSlippageP, address _referrer) payable`
- `overrideAllyFeeP(address[] _allies, uint24[] _allyFeeP)`
- `overrideReferralFeeP(address[] _referrers, uint24[] _referralFeeP)`
- `paramUpdateCallbackWithSignedPrices((uint8 collateralIndex, uint16 pairIndex, uint8 updateType, uint224 newValue) _paramUpdate)`
- `realizeHoldingFeesOnOpenTrade(address _trader, uint32 _index, uint64 _currentPairPrice)`
- `realizePnlOnOpenTrade(address _trader, uint32 _index, int256 _pnlCollateral)`
- `realizeTradingFeesOnOpenTrade(address _trader, uint32 _index, uint256 _feesCollateral, uint64 _currentPairPrice) returns (uint256 finalFeesCollateral)`
- `registerPotentialReferrer(address _trader, address _referrer)`
- `removeTradingDelegate()`
- `sellGnsForCollateral(uint8 _collateralIndex, uint256 _collateralAmount)`
- `setAbsoluteRatePerSecondCap(uint8[] _collateralIndex, uint16[] _pairIndex, uint24[] _absoluteRatePerSecondCap, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setAbsoluteVelocityPerYearCap(uint8[] _collateralIndex, uint16[] _pairIndex, uint24[] _absoluteVelocityPerYearCap, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setAprMultiplierEnabled(uint8[] _collateralIndex, uint16[] _pairIndex, bool[] _aprMultiplierEnabled, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setBorrowingFeePerBlockCap((uint32 minP, uint32 maxP) _feePerBlockCap)`
- `setBorrowingGroupParams(uint8 _collateralIndex, uint16 _groupIndex, (uint32 feePerBlock, uint72 maxOi, uint48 feeExponent) _value)`
- `setBorrowingGroupParamsArray(uint8 _collateralIndex, uint16[] _indices, (uint32 feePerBlock, uint72 maxOi, uint48 feeExponent)[] _values)`
- `setBorrowingPairFeePerBlockCapArray(uint8 _collateralIndex, uint16[] _indices, (uint32 minP, uint32 maxP)[] _values)`
- `setBorrowingPairParams(uint8 _collateralIndex, uint16 _pairIndex, (uint16 groupIndex, uint32 feePerBlock, uint48 feeExponent, uint72 maxOi) _value, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setBorrowingPairParamsArray(uint8 _collateralIndex, uint16[] _indices, (uint16 groupIndex, uint32 feePerBlock, uint48 feeExponent, uint72 maxOi)[] _values, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setBorrowingRatePerSecondP(uint8[] _collateralIndex, uint16[] _pairIndex, uint24[] _borrowingRatePerSecondP, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setCumulativeFactors(uint16[] _pairIndices, uint40[] _cumulativeFactors)`
- `setDepthBandsMapping(uint256 _slot1, uint256 _slot2)`
- `setExemptAfterProtectionCloseFactor(uint16[] _pairIndices, bool[] _exemptAfterProtectionCloseFactor)`
- `setExemptOnOpen(uint16[] _pairIndices, bool[] _exemptOnOpen)`
- `setFeeTiers(uint256[] _feeTiersIndices, (uint32 feeMultiplier, uint32 pointsThreshold)[] _feeTiers)`
- `setFundingFeesEnabled(uint8[] _collateralIndex, uint16[] _pairIndex, bool[] _fundingFeesEnabled, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setGnsStakingBonusAmounts(address[] _traders, uint24[] _bonusAmounts)`
- `setGnsStakingTiers(uint256[] _tierIndices, (uint32 feeMultiplier, uint32 pointsThreshold)[] _tiers)`
- `setGroupVolumeMultipliers(uint256[] _groupIndices, uint256[] _groupVolumeMultipliers)`
- `setMaxSkewCollateral(uint8[] _collateralIndex, uint16[] _pairIndex, uint80[] _maxSkewCollateral)`
- `setNegPnlCumulVolMultiplier(uint40 _negPnlCumulVolMultiplier)`
- `setPairDepthBands(uint256[] _indices, (uint256 aboveSlot1, uint256 aboveSlot2, uint256 belowSlot1, uint256 belowSlot2)[] _depthBands)`
- `setPairSkewDepths(uint8[] _collateralIndices, uint16[] _pairIndices, uint256[] _depths)`
- `setPriceImpactWindowsCount(uint48 _newWindowsCount)`
- `setPriceImpactWindowsDuration(uint48 _newWindowsDuration)`
- `setProtectionCloseFactorBlocks(uint16[] _pairIndices, uint32[] _protectionCloseFactorBlocks)`
- `setProtectionCloseFactors(uint16[] _pairIndices, uint40[] _protectionCloseFactors)`
- `setProtectionCloseFactorWhitelist(address[] _traders, bool[] _whitelisted)`
- `setRoles(address[] _accounts, uint8[] _roles, bool[] _values)`
- `setSkewCoefficientPerYear(uint8[] _collateralIndex, uint16[] _pairIndex, uint112[] _skewCoefficientPerYear, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setThetaThresholdUsd(uint8[] _collateralIndex, uint16[] _pairIndex, uint32[] _thetaThresholdUsd, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `setTradersFeeTiersEnrollment(address[] _traders, (uint8 status, uint248 __placeholder)[] _values)`
- `setTradingDelegate(address _delegate)`
- `setUseGnsVaultBalance(bool _useGnsVaultBalance)`
- `setUserPriceImpact(address[] _traders, uint16[] _pairIndices, uint16[] _cumulVolPriceImpactMultipliers, uint16[] _fixedSpreadPs)`
- `stakeGns(uint88 _amountGns, uint88 _amountVaultGns)`
- `storeAlreadyTransferredNegativePnl(address _trader, uint32 _index, uint256 _deltaCollateral)`
- `storeManuallyRealizedNegativePnlCollateral(address _trader, uint32 _index, uint256 _amountCollateral)`
- `storeTradeInitialAccFees(address _trader, uint32 _index, uint8 _collateralIndex, uint16 _pairIndex, bool _long, uint64 _currentPairPrice)`
- `storeUiPnlWithdrawnCollateral(address _trader, uint32 _index, uint256 _deltaCollateral)`
- `storeUiRealizedPnlPartialCloseCollateral(address _trader, uint32 _index, int256 _deltaCollateral)`
- `storeUiRealizedTradingFeesCollateral(address _trader, uint32 _index, uint256 _deltaCollateral)`
- `storeVirtualAvailableCollateralInDiamond(address _trader, uint32 _index, uint256 _newTradeCollateralAmount)`
- `syncGnsStakingTiers(address[] _traders)`
- `triggerOrder(uint256 _packed)`
- `triggerOrderWithSignatures(uint256 _packed, (uint8 signerId, uint32 expiryTs, bool isLookback, uint32 fromBlock, bytes signature, uint16[] pairIndices, (uint56 open, uint56 high, uint56 low, uint56 current, uint32 ts)[] prices)[] _signedPairPrices)`
- `unsetTradersReferrers(address[] _traders)`
- `unstakeGns(uint88 _amountGns, uint88 _amountVaultGns)`
- `unwhitelistAllies(address[] _allies)`
- `unwhitelistReferrers(address[] _referrers)`
- `updateAllyFeeP(uint256 _value)`
- `updateByPassTriggerLink(address[] _users, bool[] _shouldByPass)`
- `updateLeverage(uint32 _index, uint24 _newLeverage)`
- `updateLeverageNative(uint32 _index, uint24 _newLeverage) payable`
- `updateMarketOrdersTimeoutBlocks(uint16 _valueBlocks)`
- `updateMaxClosingSlippageP(uint32 _index, uint16 _maxSlippageP)`
- `updateNativeTransferEnabled(bool _nativeTransferEnabled)`
- `updateNativeTransferGasLimit(uint16 _nativeTransferGasLimit)`
- `updateOpenOrder(uint32 _index, uint64 _triggerPrice, uint64 _tp, uint64 _sl, uint16 _maxSlippageP)`
- `updateOtcConfig((address gnsTreasury, uint64 treasuryShareP, uint64 stakingShareP, uint64 burnShareP, uint64 premiumP) _config)`
- `updatePairOiAfterV10(uint8 _collateralIndex, uint16 _pairIndex, uint256 _oiDeltaCollateral, uint256 _oiDeltaToken, bool _open, bool _long)`
- `updatePairOiBeforeV10(uint8 _collateralIndex, uint16 _pairIndex, bool _long, bool _increase, uint256 _amountCollateral)`
- `updateReferralsTargetVolumeUsd(uint256 _value)`
- `updateSl(uint32 index, uint64 newSl)`
- `updateStartReferrerFeeP(uint256 _value)`
- `updateTp(uint32 index, uint64 newTp)`
- `updateTraderPoints(address _trader, uint256 _volumeUsd, uint256 _pairIndex)`
- `updateTriggerTimeoutBlocks(uint16 _timeoutBlocks)`
- `whitelistAllies(address[] _allies)`
- `whitelistReferrers(address[] _referrers, address[] _allies)`
- `withdrawPositivePnl(uint32 _index, uint120 _amountCollateral)`
- `withinMaxBorrowingGroupOi(uint8 _collateralIndex, uint16 _pairIndex, bool _long, uint256 _positionSizeCollateral) view returns (bool)`

Left out of this ABI, though its deployments declare them:

- `error AlreadyActive` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AlreadyBeingMarketClosed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AlreadyExists` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BlockOrder` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowingWrongExponent` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowingZeroGroup` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralNotActive` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DepthBandsAboveMax` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DoesntExist` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InitError` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientBalance` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAddresses` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAmount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidCollateralIndex` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDecreasePositionSizeInput` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidFacetCutAction` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidShareSum` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NewPositionSizeSmaller` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NoPendingRewards` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NoSl` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotYourOrder` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Overflow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Paused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PendingTrigger` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PointsOverflow` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PriceImpactTooHigh` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error PriceZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StakingCooldownActive` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WaitTimeout` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongAccess` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongDepthBandsOrder` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongFromBlock` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongIndex` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongLength` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongOrder` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongSl` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongTp` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongWindowsCount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WrongWindowsDuration` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event CouldNotCloseTrade` taking `(address,uint16,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event OnePercentDepthUpdated` taking `(uint256,uint128,uint128)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ParamUpdateRequested` taking `(uint8,uint16,uint8,uint224)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event UpdatedOpenFeeP` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
