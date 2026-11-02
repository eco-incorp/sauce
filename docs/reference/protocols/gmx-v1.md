<!-- Generated from the SDK's registries. Do not edit. -->

# GMX V1 (`gmx-v1`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> GMX V1 is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page lists
> the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading up to 50x.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | `Gmx`: `gmx-v1`, `gmx-v2` |
| Namespace | `GmxV1` on arbitrum, avalanche |
| Chains | arbitrum, avalanche |

## What it offers

- **openPosition**: Open/increase leveraged position via PositionRouter
- **closePosition**: Close/decrease leveraged position
- **swap**: Swap tokens via GMX Router

## Notes

- Execution fee: each request's `msg.value` must equal its `_executionFee`, which must be at least the PositionRouter's `minExecutionFee()` (read it). The fee goes to whoever executes or cancels the request
- Must call router.approvePlugin(positionRouter) once before using position operations
- Path: for longs, path=[collateral]. For shorts, path=[stablecoin]. For swaps, path=[tokenIn, tokenOut]
- sizeDelta is position size in USD with 30 decimals
- `acceptablePrice` (USD, 30 decimals) bounds the mark price at execution, and its direction depends on the request; there is no market-price sentinel, and 0 is not one. A long increase or a short decrease executes only while the mark price is at most `acceptablePrice` (pass the highest price you accept); a short increase or a long decrease only while it is at least `acceptablePrice` (pass the lowest). When the mark price is outside the bound, the execution reverts and the keeper cancels the request, so 0 never executes a long increase or a short decrease

## Its names in a program

On Arbitrum One, `GmxV1` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's glp, `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258`.
  require(GmxV1.Glp != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | glp | `0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258` | `GmxV1.Glp` |
| [Arbitrum One](../chains/arbitrum.md) | positionRouter | `0xb87a436B93fFE9D75c5cFA7bAcFff96430b09868` | `GmxV1.PositionRouter` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064` | `GmxV1.Router` |
| [Arbitrum One](../chains/arbitrum.md) | vault | `0x489ee077994B6658eAfA855C308275EAd8097C4A` | `GmxV1.Vault`; not on this deployment: `getEntryFundingRate`, `getFundingFee`, `getPositionFee`, `maxGlobalShortSizes`, `setMaxGlobalShortSize`, `setVaultUtils`, `updateCumulativeFundingRate`, `vaultUtils` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x5F719c2F1095F7B9fc68a68e35B51194f4b6abe8` | `GmxV1.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | vault | `0x9ab2De34A33fB459b538c43f251eB825645e8595` | `GmxV1.Vault`; not on this deployment: `getFundingFee`, `getPositionFee`, `updateCumulativeFundingRate` |

## ABI

### `PositionRouterABI`

`import PositionRouterABI from "./protocols/gmx-v1/PositionRouterABI.json";` Speaks for: positionRouter. The import is the contract's full ABI across every deployment; call it through the `GmxV1` namespace to have a function a chain's deployment does not run refused.

- `admin() view returns (address)`
- `approve(address _token, address _spender, uint256 _amount)`
- `BASIS_POINTS_DIVISOR() view returns (uint256)`
- `callbackGasLimit() view returns (uint256)`
- `cancelDecreasePosition(bytes32 _key, address _executionFeeReceiver) returns (bool)`
- `cancelIncreasePosition(bytes32 _key, address _executionFeeReceiver) returns (bool)`
- `createDecreasePosition(address[] _path, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _acceptablePrice, uint256 _minOut, uint256 _executionFee, bool _withdrawETH, address _callbackTarget) payable returns (bytes32 requestKey)`
- `createIncreasePosition(address[] _path, address _indexToken, uint256 _amountIn, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _acceptablePrice, uint256 _executionFee, bytes32 _referralCode, address _callbackTarget) payable returns (bytes32 requestKey)`
- `createIncreasePositionETH(address[] _path, address _indexToken, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _acceptablePrice, uint256 _executionFee, bytes32 _referralCode, address _callbackTarget) payable returns (bytes32)`
- `decreasePositionRequestKeys(uint256) view returns (bytes32)`
- `decreasePositionRequestKeysStart() view returns (uint256)`
- `decreasePositionRequests(bytes32) view returns (address account, address indexToken, uint256 collateralDelta, uint256 sizeDelta, bool isLong, address receiver, uint256 acceptablePrice, uint256 minOut, uint256 executionFee, uint256 blockNumber, uint256 blockTime, bool withdrawETH, address callbackTarget)`
- `decreasePositionsIndex(address) view returns (uint256)`
- `depositFee() view returns (uint256)`
- `executeDecreasePosition(bytes32 _key, address _executionFeeReceiver) returns (bool)`
- `executeDecreasePositions(uint256 _endIndex, address _executionFeeReceiver)`
- `executeIncreasePosition(bytes32 _key, address _executionFeeReceiver) returns (bool)`
- `executeIncreasePositions(uint256 _endIndex, address _executionFeeReceiver)`
- `feeReserves(address) view returns (uint256)`
- `getDecreasePositionRequestPath(bytes32 _key) view returns (address[])`
- `getIncreasePositionRequestPath(bytes32 _key) view returns (address[])`
- `getRequestKey(address _account, uint256 _index) pure returns (bytes32)`
- `getRequestQueueLengths() view returns (uint256, uint256, uint256, uint256)`
- `gov() view returns (address)`
- `increasePositionBufferBps() view returns (uint256)`
- `increasePositionRequestKeys(uint256) view returns (bytes32)`
- `increasePositionRequestKeysStart() view returns (uint256)`
- `increasePositionRequests(bytes32) view returns (address account, address indexToken, uint256 amountIn, uint256 minOut, uint256 sizeDelta, bool isLong, uint256 acceptablePrice, uint256 executionFee, uint256 blockNumber, uint256 blockTime, bool hasCollateralInETH, address callbackTarget)`
- `increasePositionsIndex(address) view returns (uint256)`
- `isLeverageEnabled() view returns (bool)`
- `isPositionKeeper(address) view returns (bool)`
- `maxGlobalLongSizes(address) view returns (uint256)`
- `maxGlobalShortSizes(address) view returns (uint256)`
- `maxTimeDelay() view returns (uint256)`
- `minBlockDelayKeeper() view returns (uint256)`
- `minExecutionFee() view returns (uint256)`
- `minTimeDelayPublic() view returns (uint256)`
- `referralStorage() view returns (address)`
- `router() view returns (address)`
- `sendValue(address _receiver, uint256 _amount)`
- `setAdmin(address _admin)`
- `setCallbackGasLimit(uint256 _callbackGasLimit)`
- `setDelayValues(uint256 _minBlockDelayKeeper, uint256 _minTimeDelayPublic, uint256 _maxTimeDelay)`
- `setDepositFee(uint256 _depositFee)`
- `setGov(address _gov)`
- `setIncreasePositionBufferBps(uint256 _increasePositionBufferBps)`
- `setIsLeverageEnabled(bool _isLeverageEnabled)`
- `setMaxGlobalSizes(address[] _tokens, uint256[] _longSizes, uint256[] _shortSizes)`
- `setMinExecutionFee(uint256 _minExecutionFee)`
- `setPositionKeeper(address _account, bool _isActive)`
- `setReferralStorage(address _referralStorage)`
- `setRequestKeysStartValues(uint256 _increasePositionRequestKeysStart, uint256 _decreasePositionRequestKeysStart)`
- `shortsTracker() view returns (address)`
- `vault() view returns (address)`
- `weth() view returns (address)`
- `withdrawFees(address _token, address _receiver)`

### `RouterABI`

`import RouterABI from "./protocols/gmx-v1/RouterABI.json";` Speaks for: router. The import is the contract's full ABI across every deployment; call it through the `GmxV1` namespace to have a function a chain's deployment does not run refused.

- `addPlugin(address _plugin)`
- `approvedPlugins(address, address) view returns (bool)`
- `approvePlugin(address _plugin)`
- `decreasePosition(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price)`
- `decreasePositionAndSwap(address[] _path, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price, uint256 _minOut)`
- `decreasePositionAndSwapETH(address[] _path, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price, uint256 _minOut)`
- `decreasePositionETH(address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver, uint256 _price)`
- `denyPlugin(address _plugin)`
- `directPoolDeposit(address _token, uint256 _amount)`
- `gov() view returns (address)`
- `increasePosition(address[] _path, address _indexToken, uint256 _amountIn, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _price)`
- `increasePositionETH(address[] _path, address _indexToken, uint256 _minOut, uint256 _sizeDelta, bool _isLong, uint256 _price) payable`
- `pluginDecreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) returns (uint256)`
- `pluginIncreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong)`
- `plugins(address) view returns (bool)`
- `pluginTransfer(address _token, address _account, address _receiver, uint256 _amount)`
- `removePlugin(address _plugin)`
- `setGov(address _gov)`
- `swap(address[] _path, uint256 _amountIn, uint256 _minOut, address _receiver)`
- `swapETHToTokens(address[] _path, uint256 _minOut, address _receiver) payable`
- `swapTokensToETH(address[] _path, uint256 _amountIn, uint256 _minOut, address _receiver)`
- `usdg() view returns (address)`
- `vault() view returns (address)`
- `weth() view returns (address)`

### `VaultABI`

`import VaultABI from "./protocols/gmx-v1/VaultABI.json";` Speaks for: vault. The import is the contract's full ABI across every deployment; call it through the `GmxV1` namespace to have a function a chain's deployment does not run refused.

- `addRouter(address _router)`
- `adjustForDecimals(uint256 _amount, address _tokenDiv, address _tokenMul) view returns (uint256)`
- `allWhitelistedTokens(uint256) view returns (address)`
- `allWhitelistedTokensLength() view returns (uint256)`
- `approvedRouters(address, address) view returns (bool)`
- `BASIS_POINTS_DIVISOR() view returns (uint256)`
- `bufferAmounts(address) view returns (uint256)`
- `buyUSDG(address _token, address _receiver) returns (uint256)`
- `clearTokenConfig(address _token)`
- `cumulativeFundingRates(address) view returns (uint256)`
- `decreasePosition(address _account, address _collateralToken, address _indexToken, uint256 _collateralDelta, uint256 _sizeDelta, bool _isLong, address _receiver) returns (uint256)`
- `directPoolDeposit(address _token)`
- `errorController() view returns (address)`
- `errors(uint256) view returns (string)`
- `feeReserves(address) view returns (uint256)`
- `FUNDING_RATE_PRECISION() view returns (uint256)`
- `fundingInterval() view returns (uint256)`
- `fundingRateFactor() view returns (uint256)`
- `getDelta(address _indexToken, uint256 _size, uint256 _averagePrice, bool _isLong, uint256 _lastIncreasedTime) view returns (bool, uint256)`
- `getEntryFundingRate(address _collateralToken, address _indexToken, bool _isLong) view returns (uint256)`
- `getFeeBasisPoints(address _token, uint256 _usdgDelta, uint256 _feeBasisPoints, uint256 _taxBasisPoints, bool _increment) view returns (uint256)`
- `getFundingFee(address _token, uint256 _size, uint256 _entryFundingRate) view returns (uint256)`
- `getFundingFee(address _account, address _collateralToken, address _indexToken, bool _isLong, uint256 _size, uint256 _entryFundingRate) view returns (uint256)`
- `getGlobalShortDelta(address _token) view returns (bool, uint256)`
- `getMaxPrice(address _token) view returns (uint256)`
- `getMinPrice(address _token) view returns (uint256)`
- `getNextAveragePrice(address _indexToken, uint256 _size, uint256 _averagePrice, bool _isLong, uint256 _nextPrice, uint256 _sizeDelta, uint256 _lastIncreasedTime) view returns (uint256)`
- `getNextFundingRate(address _token) view returns (uint256)`
- `getNextGlobalShortAveragePrice(address _indexToken, uint256 _nextPrice, uint256 _sizeDelta) view returns (uint256)`
- `getPosition(address _account, address _collateralToken, address _indexToken, bool _isLong) view returns (uint256, uint256, uint256, uint256, uint256, uint256, bool, uint256)`
- `getPositionDelta(address _account, address _collateralToken, address _indexToken, bool _isLong) view returns (bool, uint256)`
- `getPositionFee(uint256 _sizeDelta) view returns (uint256)`
- `getPositionFee(address _account, address _collateralToken, address _indexToken, bool _isLong, uint256 _sizeDelta) view returns (uint256)`
- `getPositionKey(address _account, address _collateralToken, address _indexToken, bool _isLong) pure returns (bytes32)`
- `getPositionLeverage(address _account, address _collateralToken, address _indexToken, bool _isLong) view returns (uint256)`
- `getRedemptionAmount(address _token, uint256 _usdgAmount) view returns (uint256)`
- `getRedemptionCollateral(address _token) view returns (uint256)`
- `getRedemptionCollateralUsd(address _token) view returns (uint256)`
- `getTargetUsdgAmount(address _token) view returns (uint256)`
- `getUtilisation(address _token) view returns (uint256)`
- `globalShortAveragePrices(address) view returns (uint256)`
- `globalShortSizes(address) view returns (uint256)`
- `gov() view returns (address)`
- `guaranteedUsd(address) view returns (uint256)`
- `hasDynamicFees() view returns (bool)`
- `includeAmmPrice() view returns (bool)`
- `increasePosition(address _account, address _collateralToken, address _indexToken, uint256 _sizeDelta, bool _isLong)`
- `initialize(address _router, address _usdg, address _priceFeed, uint256 _liquidationFeeUsd, uint256 _fundingRateFactor, uint256 _stableFundingRateFactor)`
- `inManagerMode() view returns (bool)`
- `inPrivateLiquidationMode() view returns (bool)`
- `isInitialized() view returns (bool)`
- `isLeverageEnabled() view returns (bool)`
- `isLiquidator(address) view returns (bool)`
- `isManager(address) view returns (bool)`
- `isSwapEnabled() view returns (bool)`
- `lastFundingTimes(address) view returns (uint256)`
- `liquidatePosition(address _account, address _collateralToken, address _indexToken, bool _isLong, address _feeReceiver)`
- `liquidationFeeUsd() view returns (uint256)`
- `marginFeeBasisPoints() view returns (uint256)`
- `MAX_FEE_BASIS_POINTS() view returns (uint256)`
- `MAX_FUNDING_RATE_FACTOR() view returns (uint256)`
- `MAX_LIQUIDATION_FEE_USD() view returns (uint256)`
- `maxGasPrice() view returns (uint256)`
- `maxGlobalShortSizes(address) view returns (uint256)`
- `maxLeverage() view returns (uint256)`
- `maxUsdgAmounts(address) view returns (uint256)`
- `MIN_FUNDING_RATE_INTERVAL() view returns (uint256)`
- `MIN_LEVERAGE() view returns (uint256)`
- `minProfitBasisPoints(address) view returns (uint256)`
- `minProfitTime() view returns (uint256)`
- `mintBurnFeeBasisPoints() view returns (uint256)`
- `poolAmounts(address) view returns (uint256)`
- `positions(bytes32) view returns (uint256 size, uint256 collateral, uint256 averagePrice, uint256 entryFundingRate, uint256 reserveAmount, int256 realisedPnl, uint256 lastIncreasedTime)`
- `PRICE_PRECISION() view returns (uint256)`
- `priceFeed() view returns (address)`
- `removeRouter(address _router)`
- `reservedAmounts(address) view returns (uint256)`
- `router() view returns (address)`
- `sellUSDG(address _token, address _receiver) returns (uint256)`
- `setBufferAmount(address _token, uint256 _amount)`
- `setError(uint256 _errorCode, string _error)`
- `setErrorController(address _errorController)`
- `setFees(uint256 _taxBasisPoints, uint256 _stableTaxBasisPoints, uint256 _mintBurnFeeBasisPoints, uint256 _swapFeeBasisPoints, uint256 _stableSwapFeeBasisPoints, uint256 _marginFeeBasisPoints, uint256 _liquidationFeeUsd, uint256 _minProfitTime, bool _hasDynamicFees)`
- `setFundingRate(uint256 _fundingInterval, uint256 _fundingRateFactor, uint256 _stableFundingRateFactor)`
- `setGov(address _gov)`
- `setInManagerMode(bool _inManagerMode)`
- `setInPrivateLiquidationMode(bool _inPrivateLiquidationMode)`
- `setIsLeverageEnabled(bool _isLeverageEnabled)`
- `setIsSwapEnabled(bool _isSwapEnabled)`
- `setLiquidator(address _liquidator, bool _isActive)`
- `setManager(address _manager, bool _isManager)`
- `setMaxGasPrice(uint256 _maxGasPrice)`
- `setMaxGlobalShortSize(address _token, uint256 _amount)`
- `setMaxLeverage(uint256 _maxLeverage)`
- `setPriceFeed(address _priceFeed)`
- `setTokenConfig(address _token, uint256 _tokenDecimals, uint256 _tokenWeight, uint256 _minProfitBps, uint256 _maxUsdgAmount, bool _isStable, bool _isShortable)`
- `setUsdgAmount(address _token, uint256 _amount)`
- `setVaultUtils(address _vaultUtils)`
- `shortableTokens(address) view returns (bool)`
- `stableFundingRateFactor() view returns (uint256)`
- `stableSwapFeeBasisPoints() view returns (uint256)`
- `stableTaxBasisPoints() view returns (uint256)`
- `stableTokens(address) view returns (bool)`
- `swap(address _tokenIn, address _tokenOut, address _receiver) returns (uint256)`
- `swapFeeBasisPoints() view returns (uint256)`
- `taxBasisPoints() view returns (uint256)`
- `tokenBalances(address) view returns (uint256)`
- `tokenDecimals(address) view returns (uint256)`
- `tokenToUsdMin(address _token, uint256 _tokenAmount) view returns (uint256)`
- `tokenWeights(address) view returns (uint256)`
- `totalTokenWeights() view returns (uint256)`
- `updateCumulativeFundingRate(address _token)`
- `updateCumulativeFundingRate(address _collateralToken, address _indexToken)`
- `upgradeVault(address _newVault, address _token, uint256 _amount)`
- `usdg() view returns (address)`
- `USDG_DECIMALS() view returns (uint256)`
- `usdgAmounts(address) view returns (uint256)`
- `usdToToken(address _token, uint256 _usdAmount, uint256 _price) view returns (uint256)`
- `usdToTokenMax(address _token, uint256 _usdAmount) view returns (uint256)`
- `usdToTokenMin(address _token, uint256 _usdAmount) view returns (uint256)`
- `useSwapPricing() view returns (bool)`
- `validateLiquidation(address _account, address _collateralToken, address _indexToken, bool _isLong, bool _raise) view returns (uint256, uint256)`
- `vaultUtils() view returns (address)`
- `whitelistedTokenCount() view returns (uint256)`
- `whitelistedTokens(address) view returns (bool)`
- `withdrawFees(address _token, address _receiver) returns (uint256)`

Not on Arbitrum One's vault (`0x489ee077994B6658eAfA855C308275EAd8097C4A`), whose code does not dispatch them or declares them otherwise: `getEntryFundingRate`, `getFundingFee`, `getPositionFee`, `maxGlobalShortSizes`, `setMaxGlobalShortSize`, `setVaultUtils`, `updateCumulativeFundingRate`, `vaultUtils`. Do not call them there: a program compiled for Arbitrum One is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's vault (`0x9ab2De34A33fB459b538c43f251eB825645e8595`), whose code does not dispatch them or declares them otherwise: `getFundingFee`, `getPositionFee`, `updateCumulativeFundingRate`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
