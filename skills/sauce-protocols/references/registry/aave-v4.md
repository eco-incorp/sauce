<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V4 (`aave-v4`)

Hub-and-spoke lending. Liquidity sits in a Hub; users supply, borrow and repay through Spokes, each addressing its assets by reserve id.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV4` on ethereum, arc, base, avalanche |
| Chains | ethereum, arc, base, avalanche |
| Document | [aave-v4.md](../aave-v4.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `AaveV4` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's bluechipSpoke, `0x973a023A77420ba610f06b3858aD991Df6d85A08`.
  require(AaveV4.BluechipSpoke != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | bluechipSpoke | `0x973a023A77420ba610f06b3858aD991Df6d85A08` | `AaveV4.BluechipSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | coreHub | `0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9` | `AaveV4.CoreHub` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethenaCorrelatedSpoke | `0x58131E79531caB1d52301228d1f7b842F26B9649` | `AaveV4.EthenaCorrelatedSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ethenaEcosystemSpoke | `0xba1B3D55D249692b669A164024A838309B7508AF` | `AaveV4.EthenaEcosystemSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | etherfiESpoke | `0xbF10BDfE177dE0336aFD7fcCF80A904E15386219` | `AaveV4.EtherfiESpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | forexSpoke | `0xD8B93635b8C6d0fF98CbE90b5988E3F2d1Cd9da1` | `AaveV4.ForexSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | globalDollarHub | `0x62d63197660c080236193CA60b70E49A08E90368` | `AaveV4.GlobalDollarHub` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | goldSpoke | `0x65407b940966954b23dfA3caA5C0702bB42984DC` | `AaveV4.GoldSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | kelpESpoke | `0x3131FE68C4722e726fe6B2819ED68e514395B9a4` | `AaveV4.KelpESpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lidoESpoke | `0xe1900480ac69f0B296841Cd01cC37546d92F35Cd` | `AaveV4.LidoESpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lombardBtcSpoke | `0x7EC68b5695e803e98a21a9A05d744F28b0a7753D` | `AaveV4.LombardBtcSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | mainSpoke | `0x94e7A5dCbE816e498b89aB752661904E2F56c485` | `AaveV4.MainSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | paxgGoldSpoke | `0xAD75cE6354f87F3135cE10621d385d8D1e2562C2` | `AaveV4.PaxgGoldSpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | plusHub | `0x06002e9c4412CB7814a791eA3666D905871E536A` | `AaveV4.PlusHub` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | primeHub | `0x943827DCA022D0F354a8a8c332dA1e5Eb9f9F931` | `AaveV4.PrimeHub` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usdgMapleESpoke | `0x774b9655413c34809c1f1b16b654465A89EBE989` | `AaveV4.UsdgMapleESpoke` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | usdgPendleSpoke | `0x956d8e0A89cfa3744428C4641b5a53B56167a7f9` | `AaveV4.UsdgPendleSpoke` |
| [Arc](../../../sauce-chains/references/arc.md) | coreHub | `0x17288dfc86205301064577b98B02b81017e6F79C` | `AaveV4.CoreHub` |
| [Arc](../../../sauce-chains/references/arc.md) | forexSpoke | `0x4164EBCAF74670aa74C8D4F59de6157c0780F1bB` | `AaveV4.ForexSpoke` |
| [Arc](../../../sauce-chains/references/arc.md) | mainSpoke | `0xB843bdC3a87A05E77E07Df9FE48928b3A34b134d` | `AaveV4.MainSpoke` |
| [Base](../../../sauce-chains/references/base.md) | equitiesHub | `0xa4d5947Eb727A052bae69C593FfC84247EC9864E` | `AaveV4.EquitiesHub` |
| [Base](../../../sauce-chains/references/base.md) | mag7Spoke | `0x17905Db0e4A3514467539956c084180616AE7B8D` | `AaveV4.Mag7Spoke` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | avaxCorrelatedSpoke | `0x3b517594277c67307CF2d7CBE6FE1D4399B68c41` | `AaveV4.AvaxCorrelatedSpoke` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | coreHub | `0xd07369fAE4A5BB13c9Ce446B052c7867B1AbDf6e` | `AaveV4.CoreHub` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | forexSpoke | `0x6a37776B5E026dBdF043b4F933c323C84DD1B514` | `AaveV4.ForexSpoke` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | mainSpoke | `0x435272CefF93a1E657E8ABfdf0A13e95900A3a56` | `AaveV4.MainSpoke` |

## ABI

### `AaveV4HubABI`

`import AaveV4HubABI from "./protocols/aave-v4/AaveV4HubABI.json";` Speaks for: coreHub, plusHub, primeHub, globalDollarHub, equitiesHub. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV4` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `add(uint256 assetId, uint256 amount) returns (uint256)`
- `addAsset(address underlying, uint8 decimals, address feeReceiver, address irStrategy, bytes irData) returns (uint256)`
- `addSpoke(uint256 assetId, address spoke, (uint40 addCap, uint40 drawCap, uint24 riskPremiumThreshold, bool active, bool halted) config)`
- `authority() view returns (address)`
- `draw(uint256 assetId, uint256 amount, address to) returns (uint256)`
- `eliminateDeficit(uint256 assetId, uint256 amount, address spoke) returns (uint256, uint256)`
- `getAddedAssets(uint256 assetId) view returns (uint256)`
- `getAddedShares(uint256 assetId) view returns (uint256)`
- `getAsset(uint256 assetId) view returns ((uint120 liquidity, uint120 realizedFees, uint8 decimals, uint120 addedShares, uint120 swept, int200 premiumOffsetRay, uint120 drawnShares, uint120 premiumShares, uint16 liquidityFee, uint120 drawnIndex, uint96 drawnRate, uint40 lastUpdateTimestamp, address underlying, address irStrategy, address reinvestmentController, address feeReceiver, uint200 deficitRay))`
- `getAssetAccruedFees(uint256 assetId) view returns (uint256)`
- `getAssetConfig(uint256 assetId) view returns ((address feeReceiver, uint16 liquidityFee, address irStrategy, address reinvestmentController))`
- `getAssetCount() view returns (uint256)`
- `getAssetDeficitRay(uint256 assetId) view returns (uint256)`
- `getAssetDrawnIndex(uint256 assetId) view returns (uint256)`
- `getAssetDrawnRate(uint256 assetId) view returns (uint256)`
- `getAssetDrawnShares(uint256 assetId) view returns (uint256)`
- `getAssetId(address underlying) view returns (uint256)`
- `getAssetLiquidity(uint256 assetId) view returns (uint256)`
- `getAssetOwed(uint256 assetId) view returns (uint256, uint256)`
- `getAssetPremiumData(uint256 assetId) view returns (uint256, int256)`
- `getAssetPremiumRay(uint256 assetId) view returns (uint256)`
- `getAssetSwept(uint256 assetId) view returns (uint256)`
- `getAssetTotalOwed(uint256 assetId) view returns (uint256)`
- `getAssetUnderlyingAndDecimals(uint256 assetId) view returns (address, uint8)`
- `getSpoke(uint256 assetId, address spoke) view returns ((uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 addedShares, uint40 addCap, uint40 drawCap, uint24 riskPremiumThreshold, bool active, bool halted, uint200 deficitRay))`
- `getSpokeAddedAssets(uint256 assetId, address spoke) view returns (uint256)`
- `getSpokeAddedShares(uint256 assetId, address spoke) view returns (uint256)`
- `getSpokeAddress(uint256 assetId, uint256 index) view returns (address)`
- `getSpokeConfig(uint256 assetId, address spoke) view returns ((uint40 addCap, uint40 drawCap, uint24 riskPremiumThreshold, bool active, bool halted))`
- `getSpokeCount(uint256 assetId) view returns (uint256)`
- `getSpokeDeficitRay(uint256 assetId, address spoke) view returns (uint256)`
- `getSpokeDrawnShares(uint256 assetId, address spoke) view returns (uint256)`
- `getSpokeOwed(uint256 assetId, address spoke) view returns (uint256, uint256)`
- `getSpokePremiumData(uint256 assetId, address spoke) view returns (uint256, int256)`
- `getSpokePremiumRay(uint256 assetId, address spoke) view returns (uint256)`
- `getSpokeTotalOwed(uint256 assetId, address spoke) view returns (uint256)`
- `HUB_REVISION() view returns (uint64)`
- `initialize(address authority)`
- `isConsumingScheduledOp() view returns (bytes4)`
- `isSpokeListed(uint256 assetId, address spoke) view returns (bool)`
- `isUnderlyingListed(address underlying) view returns (bool)`
- `MAX_ALLOWED_SPOKE_CAP() view returns (uint40)`
- `MAX_ALLOWED_UNDERLYING_DECIMALS() view returns (uint8)`
- `MAX_RISK_PREMIUM_THRESHOLD() view returns (uint24)`
- `MIN_ALLOWED_UNDERLYING_DECIMALS() view returns (uint8)`
- `mintFeeShares(uint256 assetId) returns (uint256)`
- `payFeeShares(uint256 assetId, uint256 shares)`
- `previewAddByAssets(uint256 assetId, uint256 assets) view returns (uint256)`
- `previewAddByShares(uint256 assetId, uint256 shares) view returns (uint256)`
- `previewDrawByAssets(uint256 assetId, uint256 assets) view returns (uint256)`
- `previewDrawByShares(uint256 assetId, uint256 shares) view returns (uint256)`
- `previewRemoveByAssets(uint256 assetId, uint256 assets) view returns (uint256)`
- `previewRemoveByShares(uint256 assetId, uint256 shares) view returns (uint256)`
- `previewRestoreByAssets(uint256 assetId, uint256 assets) view returns (uint256)`
- `previewRestoreByShares(uint256 assetId, uint256 shares) view returns (uint256)`
- `reclaim(uint256 assetId, uint256 amount)`
- `refreshPremium(uint256 assetId, (int256 sharesDelta, int256 offsetRayDelta, uint256 restoredPremiumRay) premiumDelta)`
- `remove(uint256 assetId, uint256 amount, address to) returns (uint256)`
- `reportDeficit(uint256 assetId, uint256 drawnAmount, (int256 sharesDelta, int256 offsetRayDelta, uint256 restoredPremiumRay) premiumDelta) returns (uint256, uint256)`
- `restore(uint256 assetId, uint256 drawnAmount, (int256 sharesDelta, int256 offsetRayDelta, uint256 restoredPremiumRay) premiumDelta) returns (uint256)`
- `setAuthority(address newAuthority)`
- `setInterestRateData(uint256 assetId, bytes irData)`
- `sweep(uint256 assetId, uint256 amount)`
- `transferShares(uint256 assetId, uint256 shares, address toSpoke)`
- `updateAssetConfig(uint256 assetId, (address feeReceiver, uint16 liquidityFee, address irStrategy, address reinvestmentController) config, bytes irData)`
- `updateSpokeConfig(uint256 assetId, address spoke, (uint40 addCap, uint40 drawCap, uint24 riskPremiumThreshold, bool active, bool halted) config)`

Left out of this ABI, though its deployments declare them:

- `error AccessManagedRequiredDelay` taking `(address,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `AaveV4SpokeABI`

`import AaveV4SpokeABI from "./protocols/aave-v4/AaveV4SpokeABI.json";` Speaks for: mainSpoke, forexSpoke, bluechipSpoke, ethenaCorrelatedSpoke, ethenaEcosystemSpoke, goldSpoke, paxgGoldSpoke, lombardBtcSpoke, usdgPendleSpoke, etherfiESpoke, kelpESpoke, lidoESpoke, usdgMapleESpoke, mag7Spoke, avaxCorrelatedSpoke. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV4` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addDynamicReserveConfig(uint256 reserveId, (uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee) dynamicConfig) returns (uint32)`
- `addReserve(address hub, uint256 assetId, address priceSource, (uint24 collateralRisk, bool paused, bool frozen, bool borrowable, bool receiveSharesEnabled) config, (uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee) dynamicConfig) returns (uint256)`
- `authority() view returns (address)`
- `borrow(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `DOMAIN_SEPARATOR() view returns (bytes32)`
- `eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
- `extSload(bytes32 slot) view returns (bytes32 ret)`
- `extSloads(bytes32[] slots) view returns (bytes32[])`
- `getDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey) view returns ((uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee))`
- `getLiquidationBonus(uint256 reserveId, address user, uint256 healthFactor) view returns (uint256)`
- `getLiquidationConfig() view returns ((uint128 targetHealthFactor, uint64 healthFactorForMaxBonus, uint16 liquidationBonusFactor))`
- `getLiquidationLogic() pure returns (address)`
- `getReserve(uint256 reserveId) view returns ((address underlying, address hub, uint16 assetId, uint8 decimals, uint24 collateralRisk, uint8 flags, uint32 dynamicConfigKey))`
- `getReserveConfig(uint256 reserveId) view returns ((uint24 collateralRisk, bool paused, bool frozen, bool borrowable, bool receiveSharesEnabled))`
- `getReserveCount() view returns (uint256)`
- `getReserveDebt(uint256 reserveId) view returns (uint256, uint256)`
- `getReserveId(address hub, uint256 assetId) view returns (uint256)`
- `getReserveSuppliedAssets(uint256 reserveId) view returns (uint256)`
- `getReserveSuppliedShares(uint256 reserveId) view returns (uint256)`
- `getReserveTotalDebt(uint256 reserveId) view returns (uint256)`
- `getUserAccountData(address user) view returns ((uint256 riskPremium, uint256 avgCollateralFactor, uint256 healthFactor, uint256 totalCollateralValue, uint256 totalDebtValueRay, uint256 activeCollateralCount, uint256 borrowCount))`
- `getUserDebt(uint256 reserveId, address user) view returns (uint256, uint256)`
- `getUserLastRiskPremium(address user) view returns (uint256)`
- `getUserPosition(uint256 reserveId, address user) view returns ((uint120 drawnShares, uint120 premiumShares, int200 premiumOffsetRay, uint120 suppliedShares, uint32 dynamicConfigKey))`
- `getUserPremiumDebtRay(uint256 reserveId, address user) view returns (uint256)`
- `getUserReserveStatus(uint256 reserveId, address user) view returns (bool, bool)`
- `getUserSuppliedAssets(uint256 reserveId, address user) view returns (uint256)`
- `getUserSuppliedShares(uint256 reserveId, address user) view returns (uint256)`
- `getUserTotalDebt(uint256 reserveId, address user) view returns (uint256)`
- `initialize(address authority)`
- `isConsumingScheduledOp() view returns (bytes4)`
- `isPositionManager(address user, address positionManager) view returns (bool)`
- `isPositionManagerActive(address positionManager) view returns (bool)`
- `liquidationCall(uint256 collateralReserveId, uint256 debtReserveId, address user, uint256 debtToCover, bool receiveShares)`
- `MAX_USER_RESERVES_LIMIT() view returns (uint16)`
- `multicall(bytes[] data) returns (bytes[])`
- `nonces(address owner, uint192 key) view returns (uint256)`
- `ORACLE() view returns (address)`
- `permitReserve(uint256 reserveId, address onBehalfOf, uint256 value, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)`
- `renouncePositionManagerRole(address onBehalfOf)`
- `repay(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `SET_USER_POSITION_MANAGERS_TYPEHASH() view returns (bytes32)`
- `setAuthority(address newAuthority)`
- `setUserPositionManager(address positionManager, bool approve)`
- `setUserPositionManagersWithSig((address onBehalfOf, (address positionManager, bool approve)[] updates, uint256 nonce, uint256 deadline) params, bytes signature)`
- `setUsingAsCollateral(uint256 reserveId, bool usingAsCollateral, address onBehalfOf)`
- `SPOKE_REVISION() view returns (uint64)`
- `supply(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`
- `updateDynamicReserveConfig(uint256 reserveId, uint32 dynamicConfigKey, (uint16 collateralFactor, uint32 maxLiquidationBonus, uint16 liquidationFee) dynamicConfig)`
- `updateLiquidationConfig((uint128 targetHealthFactor, uint64 healthFactorForMaxBonus, uint16 liquidationBonusFactor) config)`
- `updatePositionManager(address positionManager, bool active)`
- `updateReserveConfig(uint256 reserveId, (uint24 collateralRisk, bool paused, bool frozen, bool borrowable, bool receiveSharesEnabled) config)`
- `updateReservePriceSource(uint256 reserveId, address priceSource)`
- `updateUserDynamicConfig(address onBehalfOf)`
- `updateUserRiskPremium(address onBehalfOf)`
- `useNonce(uint192 key) returns (uint256)`
- `withdraw(uint256 reserveId, uint256 amount, address onBehalfOf) returns (uint256, uint256)`

Left out of this ABI, though its deployments declare them:

- `error AccessManagedInvalidAuthority` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AccessManagedRequiredDelay` taking `(address,uint32)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AccessManagedUnauthorized` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAccountNonce` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidAssetId` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidCollateralFactor` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidLiquidationFee` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidMaxUserReservesLimit` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidOracleDecimals` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxDataSizeExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaximumDynamicConfigKeyReached` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaximumUserReservesExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotInitializing` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReserveExists` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReserveNotBorrowable` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Unauthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
