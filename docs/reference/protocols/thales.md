<!-- Generated from the SDK's registries. Do not edit. -->

# Thales (`thales`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Thales is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Thales` on optimism |
| Chains | optimism |

## What it offers

- **exerciseMarket**: Exercise a matured market position to claim payout
- **buyFromAMM**: Buy positional tokens (UP/DOWN) from the Thales AMM
- **createSpeedMarket**: Create a speed market position

## Notes

- Position 0 = UP (price goes up), Position 1 = DOWN (price goes down)
- Markets expire at set times - exercise only after maturation
- Speed markets have short durations (minutes to hours)
- Binary outcome: winning position gets payout, losing gets nothing
- Approve sUSD/USDC to thalesAMM before buying

## Its names in a program

On Optimism, `Thales` is a namespace: its contracts need no import.

```ts
function main() {
  // Optimism's speedMarketsAMM, `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001`.
  require(Thales.SpeedMarketsAMM != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../chains/optimism.md) | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` | `Thales.SpeedMarketsAMM` |
| [Optimism](../chains/optimism.md) | thalesAMM | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` | `Thales.ThalesAMM` |

## ABI

### `PositionalMarketABI`

`import PositionalMarketABI from "./protocols/thales/PositionalMarketABI.json";`

- `acceptOwnership()`
- `balancesOf(address account) view returns (uint256 up, uint256 down)`
- `burnOptions(uint256 amount)`
- `burnOptionsMaximum()`
- `canResolve() view returns (bool)`
- `creator() view returns (address)`
- `customMarket() view returns (bool)`
- `deposited() view returns (uint256)`
- `exerciseOptions() returns (uint256)`
- `expire(address beneficiary)`
- `fees() view returns (uint256 poolFee, uint256 creatorFee)`
- `getMaximumBurnable(address account) view returns (uint256 amount)`
- `getOptions() view returns (address up, address down)`
- `getOracleDetails() view returns (bytes32 key, uint256 strikePrice, uint256 finalPrice)`
- `initialize((address owner, address sUSD, address priceFeed, address creator, bytes32 oracleKey, uint256 strikePrice, uint256[2] times, uint256 deposit, bool customMarket, address iOracleInstanceAddress, address up, address down, address limitOrderProvider, address thalesAMM) _parameters)`
- `initialized() view returns (bool)`
- `initialMint() view returns (uint256)`
- `iOracleInstance() view returns (address)`
- `mint(uint256 value)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address _owner)`
- `options() view returns (address up, address down)`
- `oracleDetails() view returns (bytes32 key, uint256 strikePrice, uint256 finalPrice, bool customMarket, address iOracleInstanceAddress)`
- `oraclePrice() view returns (uint256 price)`
- `oraclePriceAndTimestamp() view returns (uint256 price, uint256 updatedAt)`
- `owner() view returns (address)`
- `phase() view returns (uint8)`
- `priceFeed() view returns (address)`
- `requireUnpaused() view`
- `resolve()`
- `resolved() view returns (bool)`
- `result() view returns (uint8)`
- `setIOracleInstance(address _address)`
- `setPriceFeed(address _address)`
- `setsUSD(address _address)`
- `sUSD() view returns (address)`
- `times() view returns (uint256 maturity, uint256 expiry)`
- `totalSupplies() view returns (uint256 up, uint256 down)`

Left out of this ABI, though its deployments declare them:

- `event SetZeroExAddress` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event SetZeroExAddressAtInit` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `SpeedMarketsAMMABI`

`import SpeedMarketsAMMABI from "./protocols/thales/SpeedMarketsAMMABI.json";` Speaks for: speedMarketsAMM. The import is the contract's full ABI across every deployment; call it through the `Thales` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `activeMarkets(uint256 index, uint256 pageSize) view returns (address[])`
- `activeMarketsPerUser(uint256 index, uint256 pageSize, address user) view returns (address[])`
- `addressManager() view returns (address)`
- `addToWhitelist(address _whitelistAddress, bool _flag)`
- `assetToChainlinkId(bytes32) view returns (bytes32)`
- `assetToPythId(bytes32) view returns (bytes32)`
- `bonusPerCollateral(address) view returns (uint256)`
- `canResolveMarket(address market) view returns (bool)`
- `createNewMarket((address user, bytes32 asset, uint64 strikeTime, uint64 delta, int64 strikePrice, uint64 strikePricePublishTime, uint8 oracleSource, uint8 direction, address collateral, uint256 collateralAmount, address referrer, uint256 skewImpact) params) returns (address marketAddress)`
- `currentRiskPerAsset(bytes32) view returns (uint256)`
- `currentRiskPerAssetAndDirection(bytes32, uint8) view returns (uint256)`
- `getLengths(address user) view returns (uint256[5])`
- `getParams(bytes32 asset) view returns ((bool supportedAsset, uint256 safeBoxImpact, uint64 maximumPriceDelay))`
- `initialize(address _owner, address _sUSD)`
- `initNonReentrant()`
- `lastPauseTime() view returns (uint256)`
- `lpFee() view returns (uint256)`
- `lpFees(uint256) view returns (uint256)`
- `marketHasCreatedAtAttribute(address) view returns (bool)`
- `marketHasFeeAttribute(address) view returns (bool)`
- `maturedMarkets(uint256 index, uint256 pageSize) view returns (address[])`
- `maturedMarketsPerUser(uint256 index, uint256 pageSize, address user) view returns (address[])`
- `maxBuyinAmount() view returns (uint256)`
- `maximalTimeToMaturity() view returns (uint256)`
- `maximumPriceDelay() view returns (uint64)`
- `maximumPriceDelayForResolving() view returns (uint64)`
- `maxRiskPerAsset(bytes32) view returns (uint256)`
- `maxRiskPerAssetAndDirection(bytes32, uint8) view returns (uint256)`
- `maxSkewImpact() view returns (uint256)`
- `minBuyinAmount() view returns (uint256)`
- `minimalTimeToMaturity() view returns (uint256)`
- `multicollateralEnabled() view returns (bool)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address _owner)`
- `offrampHelper(address user, uint256 amount)`
- `owner() view returns (address)`
- `paused() view returns (bool)`
- `resolveMarketWithPrice(address _market, int64 _finalPrice)`
- `safeBoxImpact() view returns (uint256)`
- `setAMMAddresses(address _mastercopy, address _speedMarketsAMMUtils, address _addressManager)`
- `setAssetToPriceOracleID(bytes32 asset, bytes32 pythId, bytes32 chainlinkId)`
- `setLimitParams(uint256 _minBuyinAmount, uint256 _maxBuyinAmount, uint256 _minimalTimeToMaturity, uint256 _maximalTimeToMaturity, uint64 _maximumPriceDelay, uint64 _maximumPriceDelayForResolving)`
- `setLPFeeParams(uint256[] _timeThresholds, uint256[] _lpFees, uint256 _lpFee)`
- `setMaxRisks(bytes32 asset, uint256 _maxRiskPerAsset, uint256 _maxRiskPerAssetAndDirection)`
- `setMultiCollateralOnOffRampEnabled(bool _enabled)`
- `setOwner(address _owner)`
- `setPaused(bool _paused)`
- `setSafeBoxAndMaxSkewImpact(uint256 _safeBoxImpact, uint256 _maxSkewImpact, uint256 _skewSlippage)`
- `setSupportedAsset(bytes32 asset, bool _supported)`
- `setSupportedNativeCollateralAndBonus(address _collateral, bool _supported, uint256 _bonus, bytes32 _collateralKey)`
- `setSusdAddress(address _sUSD)`
- `skewSlippage() view returns (uint256)`
- `speedMarketMastercopy() view returns (address)`
- `speedMarketsAMMUtils() view returns (address)`
- `supportedAsset(bytes32) view returns (bool)`
- `supportedNativeCollateral(address) view returns (bool)`
- `sUSD() view returns (address)`
- `timeThresholdsForFees(uint256) view returns (uint256)`
- `transferAmount(address _collateral, address _destination, uint256 _amount)`
- `transferOwnershipAtInit(address proxyAddress)`
- `whitelistedAddresses(address) view returns (bool)`

Left out of this ABI, though its deployments declare them:

- `error BonusTooHigh` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CanNotResolve` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralNotSupported` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error EtherTransferFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidOffRampCollateral` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidPrice` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidStrikeTime` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MismatchedLengths` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MulticollateralOnrampDisabled` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotEnoughReceivedViaOnramp` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyCreatorAllowed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyMarketOwner` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error RiskPerAssetExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SkewSlippageExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TimeTooFarIntoFuture` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `ThalesAMMABI`

`import ThalesAMMABI from "./protocols/thales/ThalesAMMABI.json";` Speaks for: thalesAMM. The import is the contract's full ABI across every deployment; call it through the `Thales` namespace to have a function a chain's deployment does not run refused.

- `acceptOwnership()`
- `availableToBuyFromAMM(address market, uint8 position) view returns (uint256 _available)`
- `availableToSellToAMM(address market, uint8 position) view returns (uint256 _available)`
- `buyFromAMM(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage) returns (uint256)`
- `buyFromAmmQuote(address market, uint8 position, uint256 amount) view returns (uint256 _quote)`
- `buyFromAmmQuoteWithDifferentCollateral(address market, uint8 position, uint256 amount, address collateral) view returns (uint256 collateralQuote, uint256 sUSDToPay)`
- `buyFromAMMWithDifferentCollateralAndReferrer(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage, address collateral, address _referrer) returns (uint256)`
- `buyFromAMMWithReferrer(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage, address _referrer) returns (uint256)`
- `buyPriceImpact(address market, uint8 position, uint256 amount) view returns (int256 _priceImpact)`
- `capPerMarket() view returns (uint256)`
- `curveOnrampEnabled() view returns (bool)`
- `curveSUSD() view returns (address)`
- `dai() view returns (address)`
- `getCapPerAsset(bytes32 asset) view returns (uint256 _cap)`
- `impliedVolatilityPerAsset(bytes32) view returns (uint256)`
- `initialize(address _owner, address _priceFeed, address _sUSD, uint256 _capPerMarket, address _deciMath, uint256 _min_spread, uint256 _max_spread, uint256 _minimalTimeLeftToMaturity)`
- `initNonReentrant()`
- `isMarketInAMMTrading(address market) view returns (bool isTrading)`
- `lastPauseTime() view returns (uint256)`
- `liquidityPool() view returns (address)`
- `manager() view returns (address)`
- `max_spread() view returns (uint256)`
- `maxAllowedPegSlippagePercentage() view returns (uint256)`
- `maxSupportedPrice() view returns (uint256)`
- `min_spread() view returns (uint256)`
- `min_spreadPerAddress(address) view returns (uint256)`
- `minimalTimeLeftToMaturity() view returns (uint256)`
- `minSupportedPrice() view returns (uint256)`
- `nominatedOwner() view returns (address)`
- `nominateNewOwner(address _owner)`
- `owner() view returns (address)`
- `paused() view returns (bool)`
- `price(address market, uint8 position) view returns (uint256 priceToReturn)`
- `priceFeed() view returns (address)`
- `referrals() view returns (address)`
- `referrerFee() view returns (uint256)`
- `retrieveSUSDAmount(address account, uint256 amount)`
- `safeBox() view returns (address)`
- `safeBoxFeePerAddress(address) view returns (uint256)`
- `safeBoxImpact() view returns (uint256)`
- `sellPriceImpact(address market, uint8 position, uint256 amount) view returns (uint256 _impact)`
- `sellToAMM(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage) returns (uint256)`
- `sellToAmmQuote(address market, uint8 position, uint256 amount) view returns (uint256 _quote)`
- `setAmmUtils(address _ammUtils)`
- `setCapPerAsset(bytes32 asset, uint256 _cap)`
- `setCurveSUSD(address _curveSUSD, address _dai, address _usdc, address _usdt, bool _curveOnrampEnabled, uint256 _maxAllowedPegSlippagePercentage)`
- `setImpliedVolatilityPerAsset(bytes32 asset, uint256 _impliedVolatility)`
- `setLiquidityPool(address _liquidityPool)`
- `setMinimalTimeLeftToMaturity(uint256 _minimalTimeLeftToMaturity)`
- `setMinMaxSpread(uint256 _minspread, uint256 _maxspread)`
- `setMinMaxSupportedPriceAndCap(uint256 _minSupportedPrice, uint256 _maxSupportedPrice, uint256 _capPerMarket)`
- `setMinSpreadPerAddress(address _address, uint256 newFee)`
- `setOwner(address _owner)`
- `setPaused(bool _paused)`
- `setPositionalMarketManager(address _manager)`
- `setPriceFeedAndSUSD(address _priceFeed, address _sUSD)`
- `setSafeBoxData(address _safeBox, uint256 _safeBoxImpact)`
- `setSafeBoxFeePerAddress(address _address, uint256 newFee)`
- `setStakingThalesAndReferrals(address _stakingThales, address _referrals, uint256 _referrerFee)`
- `setWhitelistedAddress(address _address, bool enabled)`
- `spentOnMarket(address) view returns (uint256)`
- `stakingThales() view returns (address)`
- `sUSD() view returns (address)`
- `transferOwnershipAtInit(address proxyAddress)`
- `transferTokens(address[] tokens, address account, uint256 amount, bool all)`
- `usdc() view returns (address)`
- `usdt() view returns (address)`
- `whitelistedAddresses(address) view returns (bool)`

Left out of this ABI, though its deployments declare them:

- `event SetSafeBox` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
