<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V2 (`compound-v2`)

Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV2` on ethereum |
| Chains | ethereum |
| Document | [compound-v2.md](../compound-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CompoundV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cETH, `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5`.
  require(CompoundV2.CETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |

## ABI

### `CErc20ABI`

`import CErc20ABI from "./protocols/compound-v2/CErc20ABI.json";` Speaks for: cUSDC. The import is the contract's full ABI across every deployment; call it through the `CompoundV2` namespace to have a function a chain's deployment does not run refused.

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
- `decimals() view returns (uint256)`
- `exchangeRateCurrent() returns (uint256)`
- `exchangeRateStored() view returns (uint256)`
- `getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)`
- `getCash() view returns (uint256)`
- `initialExchangeRateMantissa() view returns (uint256)`
- `interestRateModel() view returns (address)`
- `isCToken() view returns (bool)`
- `liquidateBorrow(address borrower, uint256 repayAmount, address cTokenCollateral) returns (uint256)`
- `mint(uint256 mintAmount) returns (uint256)`
- `name() view returns (string)`
- `pendingAdmin() view returns (address)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)`
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
- `underlying() view returns (address)`

### `ComptrollerABI`

`import ComptrollerABI from "./protocols/compound-v2/ComptrollerABI.json";` Speaks for: comptroller. The import is the contract's full ABI across every deployment; call it through the `CompoundV2` namespace to have a function a chain's deployment does not run refused.

- `_become(address unitroller)`
- `_borrowGuardianPaused() view returns (bool)`
- `_grantComp(address recipient, uint256 amount)`
- `_mintGuardianPaused() view returns (bool)`
- `_setBorrowCapGuardian(address newBorrowCapGuardian)`
- `_setBorrowPaused(address cToken, bool state) returns (bool)`
- `_setCloseFactor(uint256 newCloseFactorMantissa) returns (uint256)`
- `_setCollateralFactor(address cToken, uint256 newCollateralFactorMantissa) returns (uint256)`
- `_setCompSpeeds(address[] cTokens, uint256[] supplySpeeds, uint256[] borrowSpeeds)`
- `_setContributorCompSpeed(address contributor, uint256 compSpeed)`
- `_setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa) returns (uint256)`
- `_setMarketBorrowCaps(address[] cTokens, uint256[] newBorrowCaps)`
- `_setMintPaused(address cToken, bool state) returns (bool)`
- `_setPauseGuardian(address newPauseGuardian) returns (uint256)`
- `_setPriceOracle(address newOracle) returns (uint256)`
- `_setSeizePaused(bool state) returns (bool)`
- `_setTransferPaused(bool state) returns (bool)`
- `_supportMarket(address cToken) returns (uint256)`
- `accountAssets(address, uint256) view returns (address)`
- `admin() view returns (address)`
- `allMarkets(uint256) view returns (address)`
- `borrowAllowed(address cToken, address borrower, uint256 borrowAmount) returns (uint256)`
- `borrowCapGuardian() view returns (address)`
- `borrowCaps(address) view returns (uint256)`
- `borrowGuardianPaused(address) view returns (bool)`
- `borrowVerify(address cToken, address borrower, uint256 borrowAmount)`
- `checkMembership(address account, address cToken) view returns (bool)`
- `claimComp(address holder)`
- `claimComp(address holder, address[] cTokens)`
- `claimComp(address[] holders, address[] cTokens, bool borrowers, bool suppliers)`
- `closeFactorMantissa() view returns (uint256)`
- `compAccrued(address) view returns (uint256)`
- `compBorrowerIndex(address, address) view returns (uint256)`
- `compBorrowSpeeds(address) view returns (uint256)`
- `compBorrowState(address) view returns (uint224 index, uint32 block)`
- `compContributorSpeeds(address) view returns (uint256)`
- `compInitialIndex() view returns (uint224)`
- `compRate() view returns (uint256)`
- `compReceivable(address) view returns (uint256)`
- `compSpeeds(address) view returns (uint256)`
- `compSupplierIndex(address, address) view returns (uint256)`
- `compSupplySpeeds(address) view returns (uint256)`
- `compSupplyState(address) view returns (uint224 index, uint32 block)`
- `comptrollerImplementation() view returns (address)`
- `enterMarkets(address[] cTokens) returns (uint256[])`
- `exitMarket(address cToken) returns (uint256)`
- `fixBadAccruals(address[] affectedUsers, uint256[] amounts)`
- `getAccountLiquidity(address account) view returns (uint256, uint256, uint256)`
- `getAllMarkets() view returns (address[])`
- `getAssetsIn(address account) view returns (address[])`
- `getBlockNumber() view returns (uint256)`
- `getCompAddress() view returns (address)`
- `getHypotheticalAccountLiquidity(address account, address cTokenModify, uint256 redeemTokens, uint256 borrowAmount) view returns (uint256, uint256, uint256)`
- `isComptroller() view returns (bool)`
- `isDeprecated(address cToken) view returns (bool)`
- `lastContributorBlock(address) view returns (uint256)`
- `liquidateBorrowAllowed(address cTokenBorrowed, address cTokenCollateral, address liquidator, address borrower, uint256 repayAmount) returns (uint256)`
- `liquidateBorrowVerify(address cTokenBorrowed, address cTokenCollateral, address liquidator, address borrower, uint256 actualRepayAmount, uint256 seizeTokens)`
- `liquidateCalculateSeizeTokens(address cTokenBorrowed, address cTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidationIncentiveMantissa() view returns (uint256)`
- `markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)`
- `maxAssets() view returns (uint256)`
- `mintAllowed(address cToken, address minter, uint256 mintAmount) returns (uint256)`
- `mintGuardianPaused(address) view returns (bool)`
- `mintVerify(address cToken, address minter, uint256 actualMintAmount, uint256 mintTokens)`
- `oracle() view returns (address)`
- `pauseGuardian() view returns (address)`
- `pendingAdmin() view returns (address)`
- `pendingComptrollerImplementation() view returns (address)`
- `proposal65FixExecuted() view returns (bool)`
- `redeemAllowed(address cToken, address redeemer, uint256 redeemTokens) returns (uint256)`
- `redeemVerify(address cToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens)`
- `repayBorrowAllowed(address cToken, address payer, address borrower, uint256 repayAmount) returns (uint256)`
- `repayBorrowVerify(address cToken, address payer, address borrower, uint256 actualRepayAmount, uint256 borrowerIndex)`
- `seizeAllowed(address cTokenCollateral, address cTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `seizeGuardianPaused() view returns (bool)`
- `seizeVerify(address cTokenCollateral, address cTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens)`
- `transferAllowed(address cToken, address src, address dst, uint256 transferTokens) returns (uint256)`
- `transferGuardianPaused() view returns (bool)`
- `transferVerify(address cToken, address src, address dst, uint256 transferTokens)`
- `updateContributorRewards(address contributor)`
