<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V3 (`compound-v3`)

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV3` on ethereum, optimism, polygon, base, arbitrum, scroll |
| Chains | ethereum, optimism, polygon, base, arbitrum, scroll |
| Document | [compound-v3.md](../compound-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CompoundV3` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cUSDCv3, `0xc3d688B66703497DAA19211EEdff47f25384cdc3`.
  require(CompoundV3.CUSDCv3 != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDCv3 | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `CompoundV3.CUSDCv3`; not on this deployment: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDTv3 | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | `CompoundV3.CUSDTv3`; not on this deployment: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cWETHv3 | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | `CompoundV3.CWETHv3`; not on this deployment: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cometRewards | `0x1B0e765F6224C21223AeA2af16c1C46E38885a40` | `CompoundV3.CometRewards`; not on this deployment: `setRewardConfigWithMultiplier`, `setRewardsClaimed`; declared otherwise by this deployment: `rewardConfig` |
| [Optimism](../../../sauce-chains/references/optimism.md) | cUSDCv3 | `0x2e44e174f7D53F0212823acC11C01A11d58c5bCB` | `CompoundV3.CUSDCv3` |
| [Optimism](../../../sauce-chains/references/optimism.md) | cometRewards | `0x443EA0340cb75a160F31A440722dec7b5bc3C2E9` | `CompoundV3.CometRewards` |
| [Polygon](../../../sauce-chains/references/polygon.md) | cUSDCv3 | `0xF25212E676D1F7F89Cd72fFEe66158f541246445` | `CompoundV3.CUSDCv3` |
| [Polygon](../../../sauce-chains/references/polygon.md) | cometRewards | `0x45939657d1CA34A8FA39A924B71D28Fe8431e581` | `CompoundV3.CometRewards`; not on this deployment: `setRewardConfigWithMultiplier`, `setRewardsClaimed`; declared otherwise by this deployment: `rewardConfig` |
| [Base](../../../sauce-chains/references/base.md) | cUSDCv3 | `0xb125E6687d4313864e53df431d5425969c15Eb2F` | `CompoundV3.CUSDCv3` |
| [Base](../../../sauce-chains/references/base.md) | cWETHv3 | `0x46e6b214b524310239732D51387075E0e70970bf` | `CompoundV3.CWETHv3` |
| [Base](../../../sauce-chains/references/base.md) | cometRewards | `0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1` | `CompoundV3.CometRewards` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cUSDCv3 | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | `CompoundV3.CUSDCv3` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cUSDTv3 | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | `CompoundV3.CUSDTv3` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | cometRewards | `0x88730d254A2f7e6AC8388c3198aFd694bA9f7fae` | `CompoundV3.CometRewards` |
| [Scroll](../../../sauce-chains/references/scroll.md) | cUSDCv3 | `0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44` | `CompoundV3.CUSDCv3` |
| [Scroll](../../../sauce-chains/references/scroll.md) | cometRewards | `0x70167D30964cbFDc315ECAe02441Af747bE0c5Ee` | `CompoundV3.CometRewards` |

## ABI

### `CometABI`

`import CometABI from "./protocols/compound-v3/CometABI.json";` Speaks for: cUSDCv3, cWETHv3, cUSDTv3. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `CompoundV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `absorb(address absorber, address[] accounts)`
- `accrueAccount(address account)`
- `activateCollateral(uint24 assetIndex)`
- `allow(address manager, bool isAllowed_)`
- `allowance(address owner, address spender) view returns (uint256)`
- `allowBySig(address owner, address manager, bool isAllowed_, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s)`
- `approve(address spender, uint256 amount) returns (bool)`
- `approveThis(address manager, address asset, uint256 amount)`
- `assetList() view returns (address)`
- `assetListFactory() view returns (address)`
- `balanceOf(address account) view returns (uint256)`
- `baseAccrualScale() pure returns (uint64)`
- `baseBorrowMin() view returns (uint256)`
- `baseIndexScale() pure returns (uint64)`
- `baseMinForRewards() view returns (uint256)`
- `baseScale() view returns (uint256)`
- `baseToken() view returns (address)`
- `baseTokenPriceFeed() view returns (address)`
- `baseTrackingAccrued(address account) view returns (uint64)`
- `baseTrackingBorrowSpeed() view returns (uint256)`
- `baseTrackingSupplySpeed() view returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
- `borrowKink() view returns (uint256)`
- `borrowPerSecondInterestRateBase() view returns (uint256)`
- `borrowPerSecondInterestRateSlopeHigh() view returns (uint256)`
- `borrowPerSecondInterestRateSlopeLow() view returns (uint256)`
- `buyCollateral(address asset, uint256 minAmount, uint256 baseAmount, address recipient)`
- `collateralBalanceOf(address account, address asset) view returns (uint128)`
- `collateralsSupplyPauseFlags() view returns (uint24)`
- `collateralsTransferPauseFlags() view returns (uint24)`
- `collateralsWithdrawPauseFlags() view returns (uint24)`
- `deactivateCollateral(uint24 assetIndex)`
- `deactivatedCollaterals() view returns (uint24)`
- `decimals() view returns (uint8)`
- `extendedPauseFlags() view returns (uint24)`
- `extensionDelegate() view returns (address)`
- `factorScale() pure returns (uint64)`
- `getAssetInfo(uint8 i) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))`
- `getAssetInfoByAddress(address asset) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))`
- `getBorrowRate(uint256 utilization) view returns (uint64)`
- `getCollateralReserves(address asset) view returns (uint256)`
- `getPrice(address priceFeed) view returns (uint256)`
- `getReserves() view returns (int256)`
- `getSupplyRate(uint256 utilization) view returns (uint64)`
- `getUtilization() view returns (uint256)`
- `governor() view returns (address)`
- `hasPermission(address owner, address manager) view returns (bool)`
- `initializeStorage()`
- `isAbsorbPaused() view returns (bool)`
- `isAllowed(address, address) view returns (bool)`
- `isBaseSupplyPaused() view returns (bool)`
- `isBorrowCollateralized(address account) view returns (bool)`
- `isBorrowersTransferPaused() view returns (bool)`
- `isBorrowersWithdrawPaused() view returns (bool)`
- `isBuyPaused() view returns (bool)`
- `isCollateralAssetSupplyPaused(uint24 assetIndex) view returns (bool)`
- `isCollateralAssetTransferPaused(uint24 assetIndex) view returns (bool)`
- `isCollateralAssetWithdrawPaused(uint24 assetIndex) view returns (bool)`
- `isCollateralDeactivated(uint24 assetIndex) view returns (bool)`
- `isCollateralSupplyPaused() view returns (bool)`
- `isCollateralTransferPaused() view returns (bool)`
- `isCollateralWithdrawPaused() view returns (bool)`
- `isLendersTransferPaused() view returns (bool)`
- `isLendersWithdrawPaused() view returns (bool)`
- `isLiquidatable(address account) view returns (bool)`
- `isSupplyPaused() view returns (bool)`
- `isTransferPaused() view returns (bool)`
- `isWithdrawPaused() view returns (bool)`
- `liquidatorPoints(address) view returns (uint32 numAbsorbs, uint64 numAbsorbed, uint128 approxSpend, uint32 _reserved)`
- `MAX_SUPPORTED_UTILIZATION() view returns (uint256)`
- `maxAssets() pure returns (uint8)`
- `name() view returns (string)`
- `numAssets() view returns (uint8)`
- `pause(bool supplyPaused, bool transferPaused, bool withdrawPaused, bool absorbPaused, bool buyPaused)`
- `pauseBaseSupply(bool paused)`
- `pauseBorrowersTransfer(bool paused)`
- `pauseBorrowersWithdraw(bool paused)`
- `pauseCollateralAssetSupply(uint24 assetIndex, bool paused)`
- `pauseCollateralAssetTransfer(uint24 assetIndex, bool paused)`
- `pauseCollateralAssetWithdraw(uint24 assetIndex, bool paused)`
- `pauseCollateralSupply(bool paused)`
- `pauseCollateralTransfer(bool paused)`
- `pauseCollateralWithdraw(bool paused)`
- `pauseGuardian() view returns (address)`
- `pauseLendersTransfer(bool paused)`
- `pauseLendersWithdraw(bool paused)`
- `priceScale() pure returns (uint64)`
- `quoteCollateral(address asset, uint256 baseAmount) view returns (uint256)`
- `storeFrontPriceFactor() view returns (uint256)`
- `supply(address asset, uint256 amount)`
- `supplyFrom(address from, address dst, address asset, uint256 amount)`
- `supplyKink() view returns (uint256)`
- `supplyPerSecondInterestRateBase() view returns (uint256)`
- `supplyPerSecondInterestRateSlopeHigh() view returns (uint256)`
- `supplyPerSecondInterestRateSlopeLow() view returns (uint256)`
- `supplyTo(address dst, address asset, uint256 amount)`
- `symbol() view returns (string)`
- `targetReserves() view returns (uint256)`
- `totalBorrow() view returns (uint256)`
- `totalsBasic() view returns ((uint64 baseSupplyIndex, uint64 baseBorrowIndex, uint64 trackingSupplyIndex, uint64 trackingBorrowIndex, uint104 totalSupplyBase, uint104 totalBorrowBase, uint40 lastAccrualTime, uint8 pauseFlags))`
- `totalsCollateral(address) view returns (uint128 totalSupplyAsset, uint128 _reserved)`
- `totalSupply() view returns (uint256)`
- `trackingIndexScale() view returns (uint256)`
- `transfer(address dst, uint256 amount) returns (bool)`
- `transferAsset(address dst, address asset, uint256 amount)`
- `transferAssetFrom(address src, address dst, address asset, uint256 amount)`
- `transferFrom(address src, address dst, uint256 amount) returns (bool)`
- `userBasic(address) view returns (int104 principal, uint64 baseTrackingIndex, uint64 baseTrackingAccrued, uint16 assetsIn, uint8 _reserved)`
- `userCollateral(address, address) view returns (uint128 balance, uint128 _reserved)`
- `userNonce(address) view returns (uint256)`
- `version() view returns (string)`
- `withdraw(address asset, uint256 amount)`
- `withdrawFrom(address src, address to, address asset, uint256 amount)`
- `withdrawReserves(address to, uint256 amount)`
- `withdrawTo(address to, address asset, uint256 amount)`

Not on Ethereum's cUSDCv3 (`0xc3d688B66703497DAA19211EEdff47f25384cdc3`), whose code does not dispatch them or does not declare them as listed here: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum's cUSDTv3 (`0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840`), whose code does not dispatch them or does not declare them as listed here: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum's cWETHv3 (`0xA17581A9E3356d9A858b789D68B4d866e593aE94`), whose code does not dispatch them or does not declare them as listed here: `activateCollateral`, `collateralsSupplyPauseFlags`, `collateralsTransferPauseFlags`, `collateralsWithdrawPauseFlags`, `deactivateCollateral`, `deactivatedCollaterals`, `extendedPauseFlags`, `isBaseSupplyPaused`, `isBorrowersTransferPaused`, `isBorrowersWithdrawPaused`, `isCollateralAssetSupplyPaused`, `isCollateralAssetTransferPaused`, `isCollateralAssetWithdrawPaused`, `isCollateralDeactivated`, `isCollateralSupplyPaused`, `isCollateralTransferPaused`, `isCollateralWithdrawPaused`, `isLendersTransferPaused`, `isLendersWithdrawPaused`, `MAX_SUPPORTED_UTILIZATION`, `pauseBaseSupply`, `pauseBorrowersTransfer`, `pauseBorrowersWithdraw`, `pauseCollateralAssetSupply`, `pauseCollateralAssetTransfer`, `pauseCollateralAssetWithdraw`, `pauseCollateralSupply`, `pauseCollateralTransfer`, `pauseCollateralWithdraw`, `pauseLendersTransfer`, `pauseLendersWithdraw`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `error Absurd` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error AlreadyInitialized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BadDecimals` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BadDiscount` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BadMinimum` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BadNonce` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BadSignatory` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BaseSupplyPaused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowCFTooLarge` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowersTransferPaused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowersWithdrawPaused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error BorrowTooSmall` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralAssetOffsetStatusAlreadySet` taking `(uint24,uint24,bool)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralAssetSupplyPaused` taking `(uint24)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CollateralIsDeactivated` taking `(uint24)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DeactivatedCollateralBorrowBlocked` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error DeactivatedCollateralTransferBlocked` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InsufficientReserves` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidUInt104` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidUInt128` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidUInt64` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LendersTransferPaused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LendersWithdrawPaused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LiqPenaltyTooHigh` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error LiquidateCFTooLarge` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NegativeNumber` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotCollateralized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotLiquidatable` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OffsetStatusAlreadySet` taking `(uint24,bool)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyGovernor` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyPauseGuardian` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyPauseGuardianOrGovernor` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Paused` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error ReentrantCallBlocked` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SupplyCapExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TooManyAssets` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TransferInFailed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error Unauthorized` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `CometRewardsABI`

`import CometRewardsABI from "./protocols/compound-v3/CometRewardsABI.json";` Speaks for: cometRewards. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `CompoundV3` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `claim(address comet, address src, bool shouldAccrue)`
- `claimTo(address comet, address src, address to, bool shouldAccrue)`
- `getRewardOwed(address comet, address account) returns ((address token, uint256 owed))`
- `governor() view returns (address)`
- `rewardConfig(address) view returns (address token, uint64 rescaleFactor, bool shouldUpscale, uint256 multiplier)`
- `rewardsClaimed(address, address) view returns (uint256)`
- `setRewardConfig(address comet, address token)`
- `setRewardConfigWithMultiplier(address comet, address token, uint256 multiplier)`
- `setRewardsClaimed(address comet, address[] users, uint256[] claimedAmounts)`
- `transferGovernor(address newGovernor)`
- `withdrawToken(address token, address to, uint256 amount)`

Not on Ethereum's cometRewards (`0x1B0e765F6224C21223AeA2af16c1C46E38885a40`), whose code does not dispatch them or does not declare them as listed here: `setRewardConfigWithMultiplier`, `setRewardsClaimed`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Polygon's cometRewards (`0x45939657d1CA34A8FA39A924B71D28Fe8431e581`), whose code does not dispatch them or does not declare them as listed here: `setRewardConfigWithMultiplier`, `setRewardsClaimed`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Declared otherwise by Ethereum's cometRewards (`0x1B0e765F6224C21223AeA2af16c1C46E38885a40`), and called as it declares them by a program compiled for Ethereum through the `CompoundV3` namespace:

- `rewardConfig(address) view returns (address token, uint64 rescaleFactor, bool shouldUpscale)`

The import above declares them as listed for this ABI, which that deployment does not run as declared: on Ethereum, call them through the namespace.

Declared otherwise by Polygon's cometRewards (`0x45939657d1CA34A8FA39A924B71D28Fe8431e581`), and called as it declares them by a program compiled for Polygon through the `CompoundV3` namespace:

- `rewardConfig(address) view returns (address token, uint64 rescaleFactor, bool shouldUpscale)`

The import above declares them as listed for this ABI, which that deployment does not run as declared: on Polygon, call them through the namespace.

Left out of this ABI, though its deployments declare them:

- `error InvalidUInt64` taking `(uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotPermitted` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NotSupported` taking `(address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
