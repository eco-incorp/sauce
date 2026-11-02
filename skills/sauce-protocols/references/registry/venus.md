<!-- Generated from the SDK's registries. Do not edit. -->

# Venus (`venus`)

Lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Venus` on bsc |
| Chains | bsc |
| Document | [venus.md](../venus.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `Venus` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's comptroller, `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  require(Venus.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `Venus.Comptroller` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `Venus.VBNB` |

## ABI

### `VBNBABI`

`import VBNBABI from "./protocols/venus/VBNBABI.json";` Speaks for: vBNB.

- `_acceptAdmin() returns (uint256)`
- `_reduceReserves(uint256 reduceAmount) returns (uint256)`
- `_setComptroller(address newComptroller) returns (uint256)`
- `_setInterestRateModel(address newInterestRateModel) returns (uint256)`
- `_setPendingAdmin(address newPendingAdmin) returns (uint256)`
- `_setReserveFactor(uint256 newReserveFactorMantissa) returns (uint256)`
- `accrualBlockNumber() view returns (uint256)`
- `accrueInterest() returns (uint256)`
- `admin() view returns (address)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address owner) view returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `borrowBalanceCurrent(address account) returns (uint256)`
- `borrowBalanceStored(address account) view returns (uint256)`
- `borrowIndex() view returns (uint256)`
- `borrowRatePerBlock() view returns (uint256)`
- `comptroller() view returns (address)`
- `decimals() view returns (uint8)`
- `exchangeRateCurrent() returns (uint256)`
- `exchangeRateStored() view returns (uint256)`
- `getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)`
- `getCash() view returns (uint256)`
- `initialize(address comptroller_, address interestRateModel_, uint256 initialExchangeRateMantissa_, string name_, string symbol_, uint8 decimals_)`
- `interestRateModel() view returns (address)`
- `isVToken() view returns (bool)`
- `liquidateBorrow(address borrower, address vTokenCollateral) payable`
- `mint() payable`
- `name() view returns (string)`
- `pendingAdmin() view returns (address)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `repayBorrow() payable`
- `repayBorrowBehalf(address borrower) payable`
- `reserveFactorMantissa() view returns (uint256)`
- `seize(address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `supplyRatePerBlock() view returns (uint256)`
- `symbol() view returns (string)`
- `totalBorrows() view returns (uint256)`
- `totalBorrowsCurrent() returns (uint256)`
- `totalReserves() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address dst, uint256 amount) returns (bool)`
- `transferFrom(address src, address dst, uint256 amount) returns (bool)`

### `VTokenABI`

`import VTokenABI from "./protocols/venus/VTokenABI.json";`

- `_acceptAdmin() returns (uint256)`
- `_addReserves(uint256 addAmount) returns (uint256)`
- `_becomeImplementation(bytes data)`
- `_reduceReserves(uint256 reduceAmount_) returns (uint256)`
- `_resignImplementation()`
- `_setComptroller(address newComptroller) returns (uint256)`
- `_setInterestRateModel(address newInterestRateModel_) returns (uint256)`
- `_setPendingAdmin(address newPendingAdmin) returns (uint256)`
- `_setReserveFactor(uint256 newReserveFactorMantissa_) returns (uint256)`
- `accessControlManager() view returns (address)`
- `accrualBlockNumber() view returns (uint256)`
- `accrueInterest() returns (uint256)`
- `admin() view returns (address)`
- `allowance(address owner, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address owner) view returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `borrowBalanceCurrent(address account) returns (uint256)`
- `borrowBalanceStored(address account) view returns (uint256)`
- `borrowBehalf(address borrower, uint256 borrowAmount) returns (uint256)`
- `borrowIndex() view returns (uint256)`
- `borrowRatePerBlock() view returns (uint256)`
- `calculateFlashLoanFee(uint256 amount) view returns (uint256, uint256)`
- `comptroller() view returns (address)`
- `decimals() view returns (uint8)`
- `exchangeRateCurrent() returns (uint256)`
- `exchangeRateStored() view returns (uint256)`
- `flashLoanAmount() view returns (uint256)`
- `flashLoanDebtPosition(address borrower, uint256 borrowAmount) returns (uint256)`
- `flashLoanFeeMantissa() view returns (uint256)`
- `flashLoanProtocolShareMantissa() view returns (uint256)`
- `getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)`
- `getCash() view returns (uint256)`
- `implementation() view returns (address)`
- `initialize(address comptroller_, address interestRateModel_, uint256 initialExchangeRateMantissa_, string name_, string symbol_, uint8 decimals_)`
- `initialize(address underlying_, address comptroller_, address interestRateModel_, uint256 initialExchangeRateMantissa_, string name_, string symbol_, uint8 decimals_)`
- `interestRateModel() view returns (address)`
- `internalCash() view returns (uint256)`
- `isFlashLoanEnabled() view returns (bool)`
- `isVToken() view returns (bool)`
- `liquidateBorrow(address borrower, uint256 repayAmount, address vTokenCollateral) returns (uint256)`
- `mint(uint256 mintAmount) returns (uint256)`
- `mintBehalf(address receiver, uint256 mintAmount) returns (uint256)`
- `name() view returns (string)`
- `pendingAdmin() view returns (address)`
- `protocolShareReserve() view returns (address)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemBehalf(address redeemer, uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `redeemUnderlyingBehalf(address redeemer, uint256 redeemAmount) returns (uint256)`
- `reduceReservesBlockDelta() view returns (uint256)`
- `reduceReservesBlockNumber() view returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)`
- `reserveFactorMantissa() view returns (uint256)`
- `seize(address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `setAccessControlManager(address newAccessControlManagerAddress) returns (uint256)`
- `setFlashLoanEnabled(bool enabled) returns (uint256)`
- `setFlashLoanFeeMantissa(uint256 flashLoanFeeMantissa_, uint256 flashLoanProtocolShare_) returns (uint256)`
- `setProtocolShareReserve(address protcolShareReserve_)`
- `setReduceReservesBlockDelta(uint256 newReduceReservesBlockDelta_)`
- `supplyRatePerBlock() view returns (uint256)`
- `sweepTokenAndSync(uint256 transferAmount)`
- `symbol() view returns (string)`
- `totalBorrows() view returns (uint256)`
- `totalBorrowsCurrent() returns (uint256)`
- `totalReserves() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address dst, uint256 amount) returns (bool)`
- `transferFrom(address src, address dst, uint256 amount) returns (bool)`
- `transferInUnderlyingFlashLoan(address from, uint256 repaymentAmount, uint256 totalFee, uint256 protocolFee) returns (uint256)`
- `transferOutUnderlyingFlashLoan(address to, uint256 amount)`
- `underlying() view returns (address)`

### `VenusComptrollerABI`

`import VenusComptrollerABI from "./protocols/venus/VenusComptrollerABI.json";` Speaks for: comptroller.

- `_become(address unitroller)`
- `_grantXVS(address recipient, uint256 amount)`
- `_setAccessControl(address newAccessControlAddress) returns (uint256)`
- `_setActionsPaused(address[] markets_, uint8[] actions_, bool paused_)`
- `_setCloseFactor(uint256 newCloseFactorMantissa) returns (uint256)`
- `_setComptrollerLens(address comptrollerLens_) returns (uint256)`
- `_setForcedLiquidation(address vTokenBorrowed, bool enable)`
- `_setForcedLiquidationForUser(address borrower, address vTokenBorrowed, bool enable)`
- `_setLiquidatorContract(address newLiquidatorContract_)`
- `_setMarketBorrowCaps(address[] vTokens, uint256[] newBorrowCaps)`
- `_setMarketSupplyCaps(address[] vTokens, uint256[] newSupplyCaps)`
- `_setPauseGuardian(address newPauseGuardian) returns (uint256)`
- `_setPriceOracle(address newOracle) returns (uint256)`
- `_setPrimeToken(address _prime) returns (uint256)`
- `_setProtocolPaused(bool state) returns (bool)`
- `_setTreasuryData(address newTreasuryGuardian, address newTreasuryAddress, uint256 newTreasuryPercent) returns (uint256)`
- `_setVAIController(address vaiController_) returns (uint256)`
- `_setVAIMintRate(uint256 newVAIMintRate) returns (uint256)`
- `_setVAIVaultInfo(address vault_, uint256 releaseStartBlock_, uint256 minReleaseAmount_)`
- `_setVenusSpeeds(address[] vTokens, uint256[] supplySpeeds, uint256[] borrowSpeeds)`
- `_setVenusVAIVaultRate(uint256 venusVAIVaultRate_)`
- `_setXVSToken(address xvs_)`
- `_setXVSVToken(address xvsVToken_)`
- `_supportMarket(address vToken) returns (uint256)`
- `accountAssets(address, uint256) view returns (address)`
- `actionPaused(address market, uint8 action) view returns (bool)`
- `addPoolMarkets(uint96[] poolIds, address[] vTokens)`
- `admin() view returns (address)`
- `allMarkets(uint256) view returns (address)`
- `approvedDelegates(address, address) view returns (bool)`
- `authorizedFlashLoan(address) view returns (bool)`
- `borrowAllowed(address vToken, address borrower, uint256 borrowAmount) returns (uint256)`
- `borrowCapGuardian() view returns (address)`
- `borrowCaps(address) view returns (uint256)`
- `borrowVerify(address vToken, address borrower, uint256 borrowAmount)`
- `checkMembership(address account, address vToken) view returns (bool)`
- `claimVenus(address holder)`
- `claimVenus(address holder, address[] vTokens)`
- `claimVenus(address[] holders, address[] vTokens, bool borrowers, bool suppliers)`
- `claimVenus(address[] holders, address[] vTokens, bool borrowers, bool suppliers, bool collateral)`
- `claimVenusAsCollateral(address holder)`
- `claimVenusAsCollateral(address holder, address[] vTokens)`
- `closeFactorMantissa() view returns (uint256)`
- `comptrollerImplementation() view returns (address)`
- `comptrollerLens() view returns (address)`
- `corePoolId() view returns (uint96)`
- `createPool(string label) returns (uint96)`
- `deviationBoundedOracle() view returns (address)`
- `diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] diamondCut_)`
- `enterMarketBehalf(address onBehalf, address vToken) returns (uint256)`
- `enterMarketForAccount(address account, address vToken) returns (uint256)`
- `enterMarkets(address[] vTokens) returns (uint256[])`
- `enterPool(uint96 poolId)`
- `executeFlashLoan(address onBehalf, address receiver, address[] vTokens, uint256[] underlyingAmounts, bytes param)`
- `exitMarket(address vToken) returns (uint256)`
- `facetAddress(bytes4 functionSelector) view returns ((address facetAddress, uint96 functionSelectorPosition))`
- `facetAddresses() view returns (address[])`
- `facetFunctionSelectors(address facet) view returns (bytes4[])`
- `facetPosition(address facet) view returns (uint256)`
- `facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])`
- `flashLoanPaused() view returns (bool)`
- `getAccountLiquidity(address account) view returns (uint256, uint256, uint256)`
- `getAllMarkets() view returns (address[])`
- `getAssetsIn(address account) view returns (address[])`
- `getBorrowingPower(address account) view returns (uint256, uint256, uint256)`
- `getCollateralFactor(address vToken) view returns (uint256)`
- `getEffectiveLiquidationIncentive(address account, address vToken) view returns (uint256)`
- `getEffectiveLtvFactor(address account, address vToken, uint8 weightingStrategy) view returns (uint256)`
- `getHypotheticalAccountLiquidity(address account, address vTokenModify, uint256 redeemTokens, uint256 borrowAmount) view returns (uint256, uint256, uint256)`
- `getLiquidationIncentive(address vToken) view returns (uint256)`
- `getLiquidationThreshold(address vToken) view returns (uint256)`
- `getPoolMarketIndex(uint96 poolId, address vToken) pure returns (bytes32)`
- `getPoolVTokens(uint96 poolId) view returns (address[])`
- `getXVSAddress() view returns (address)`
- `getXVSVTokenAddress() view returns (address)`
- `hasValidPoolBorrows(address account, uint96 targetPoolId) view returns (bool)`
- `isComptroller() pure returns (bool)`
- `isForcedLiquidationEnabled(address) view returns (bool)`
- `isForcedLiquidationEnabledForUser(address user, address market) view returns (bool)`
- `isMarketListed(address vToken) view returns (bool)`
- `lastPoolId() view returns (uint96)`
- `liquidateBorrowAllowed(address vTokenBorrowed, address vTokenCollateral, address liquidator, address borrower, uint256 repayAmount) view returns (uint256)`
- `liquidateBorrowVerify(address vTokenBorrowed, address vTokenCollateral, address liquidator, address borrower, uint256 actualRepayAmount, uint256 seizeTokens)`
- `liquidateCalculateSeizeTokens(address vTokenBorrowed, address vTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidateCalculateSeizeTokens(address borrower, address vTokenBorrowed, address vTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidateVAICalculateSeizeTokens(address vTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidatorContract() view returns (address)`
- `markets(address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus, uint256 liquidationThresholdMantissa, uint256 liquidationIncentiveMantissa, uint96 marketPoolId, bool isBorrowAllowed)`
- `minReleaseAmount() view returns (uint256)`
- `mintAllowed(address vToken, address minter, uint256 mintAmount) returns (uint256)`
- `mintedVAIs(address) view returns (uint256)`
- `mintVAIGuardianPaused() view returns (bool)`
- `mintVerify(address vToken, address minter, uint256 actualMintAmount, uint256 mintTokens)`
- `oracle() view returns (address)`
- `pauseGuardian() view returns (address)`
- `pendingAdmin() view returns (address)`
- `pendingComptrollerImplementation() view returns (address)`
- `poolMarkets(uint96 poolId, address vToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus, uint256 liquidationThresholdMantissa, uint256 liquidationIncentiveMantissa, uint96 marketPoolId, bool isBorrowAllowed)`
- `pools(uint96) view returns (string label, bool isActive, bool allowCorePoolFallback)`
- `prime() view returns (address)`
- `protocolPaused() view returns (bool)`
- `redeemAllowed(address vToken, address redeemer, uint256 redeemTokens) returns (uint256)`
- `redeemVerify(address vToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens)`
- `releaseStartBlock() view returns (uint256)`
- `removePoolMarket(uint96 poolId, address vToken)`
- `repayBorrowAllowed(address vToken, address payer, address borrower, uint256 repayAmount) returns (uint256)`
- `repayBorrowVerify(address vToken, address payer, address borrower, uint256 actualRepayAmount, uint256 borrowerIndex)`
- `repayVAIGuardianPaused() view returns (bool)`
- `seizeAllowed(address vTokenCollateral, address vTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `seizeVenus(address[] holders, address recipient) returns (uint256)`
- `seizeVenus(address[] holders, address recipient, address[] vTokens) returns (uint256)`
- `seizeVerify(address vTokenCollateral, address vTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens)`
- `setActionsPaused(address[] markets_, uint8[] actions_, bool paused_)`
- `setAllowCorePoolFallback(uint96 poolId, bool allowFallback)`
- `setCloseFactor(uint256 newCloseFactorMantissa) returns (uint256)`
- `setCollateralFactor(address vToken, uint256 newCollateralFactorMantissa, uint256 newLiquidationThresholdMantissa) returns (uint256)`
- `setCollateralFactor(uint96 poolId, address vToken, uint256 newCollateralFactorMantissa, uint256 newLiquidationThresholdMantissa) returns (uint256)`
- `setDeviationBoundedOracle(address newDeviationBoundedOracle) returns (uint256)`
- `setFlashLoanPaused(bool paused)`
- `setForcedLiquidation(address vTokenBorrowed, bool enable)`
- `setIsBorrowAllowed(uint96 poolId, address vToken, bool borrowAllowed)`
- `setLiquidationIncentive(address vToken, uint256 newLiquidationIncentiveMantissa) returns (uint256)`
- `setLiquidationIncentive(uint96 poolId, address vToken, uint256 newLiquidationIncentiveMantissa) returns (uint256)`
- `setMarketBorrowCaps(address[] vTokens, uint256[] newBorrowCaps)`
- `setMarketSupplyCaps(address[] vTokens, uint256[] newSupplyCaps)`
- `setMintedVAIOf(address owner, uint256 amount) returns (uint256)`
- `setPoolActive(uint96 poolId, bool active)`
- `setPoolLabel(uint96 poolId, string newLabel)`
- `setPriceOracle(address newOracle) returns (uint256)`
- `setPrimeToken(address _prime) returns (uint256)`
- `setWhiteListFlashLoanAccount(address account, bool isWhiteListed)`
- `supplyCaps(address) view returns (uint256)`
- `supportMarket(address vToken) returns (uint256)`
- `transferAllowed(address vToken, address src, address dst, uint256 transferTokens) returns (uint256)`
- `transferVerify(address vToken, address src, address dst, uint256 transferTokens)`
- `treasuryAddress() view returns (address)`
- `treasuryGuardian() view returns (address)`
- `treasuryPercent() view returns (uint256)`
- `unlistMarket(address market) returns (uint256)`
- `updateDelegate(address delegate, bool approved)`
- `userPoolId(address) view returns (uint96)`
- `vaiController() view returns (address)`
- `vaiMintRate() view returns (uint256)`
- `vaiVaultAddress() view returns (address)`
- `venusAccrued(address) view returns (uint256)`
- `venusBorrowerIndex(address, address) view returns (uint256)`
- `venusBorrowSpeeds(address) view returns (uint256)`
- `venusBorrowState(address) view returns (uint224 index, uint32 block)`
- `venusInitialIndex() view returns (uint224)`
- `venusSupplierIndex(address, address) view returns (uint256)`
- `venusSupplySpeeds(address) view returns (uint256)`
- `venusSupplyState(address) view returns (uint224 index, uint32 block)`
- `venusVAIVaultRate() view returns (uint256)`

Left out of this ABI, though its deployments declare them:

- `MAX_FLASHLOAN_ASSETS` taking `()`: no captured deployment dispatches it.
