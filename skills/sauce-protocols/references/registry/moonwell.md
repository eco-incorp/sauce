<!-- Generated from the SDK's registries. Do not edit. -->

# Moonwell (`moonwell`)

Lending protocol on Base. Compound V2 fork with governance and safety module features.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Moonwell` on base |
| Chains | base |
| Document | [moonwell.md](../moonwell.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Moonwell` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's comptroller, `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`.
  require(Moonwell.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | `Moonwell.Comptroller` |

## ABI

### `MTokenABI`

`import MTokenABI from "./protocols/moonwell/MTokenABI.json";`

- `_acceptAdmin() returns (uint256)`
- `_addReserves(uint256 addAmount) returns (uint256)`
- `_reduceReserves(uint256 reduceAmount) returns (uint256)`
- `_setComptroller(address newComptroller) returns (uint256)`
- `_setImplementation(address implementation_, bool allowResign, bytes becomeImplementationData)`
- `_setInterestRateModel(address newInterestRateModel) returns (uint256)`
- `_setPendingAdmin(address newPendingAdmin) returns (uint256)`
- `_setProtocolSeizeShare(uint256 newProtocolSeizeShareMantissa) returns (uint256)`
- `_setReserveFactor(uint256 newReserveFactorMantissa) returns (uint256)`
- `accrualBlockTimestamp() view returns (uint256)`
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
- `borrowRatePerTimestamp() view returns (uint256)`
- `comptroller() view returns (address)`
- `decimals() view returns (uint8)`
- `delegateToImplementation(bytes data) returns (bytes)`
- `delegateToViewImplementation(bytes data) view returns (bytes)`
- `exchangeRateCurrent() returns (uint256)`
- `exchangeRateStored() view returns (uint256)`
- `getAccountSnapshot(address account) view returns (uint256, uint256, uint256, uint256)`
- `getCash() view returns (uint256)`
- `implementation() view returns (address)`
- `interestRateModel() view returns (address)`
- `isMToken() view returns (bool)`
- `liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) returns (uint256)`
- `mint(uint256 mintAmount) returns (uint256)`
- `mintWithPermit(uint256 mintAmount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)`
- `name() view returns (string)`
- `pendingAdmin() view returns (address)`
- `protocolSeizeShareMantissa() view returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)`
- `reserveFactorMantissa() view returns (uint256)`
- `seize(address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `supplyRatePerTimestamp() view returns (uint256)`
- `sweepToken(address token)`
- `symbol() view returns (string)`
- `totalBorrows() view returns (uint256)`
- `totalBorrowsCurrent() returns (uint256)`
- `totalReserves() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address dst, uint256 amount) returns (bool)`
- `transferFrom(address src, address dst, uint256 amount) returns (bool)`
- `underlying() view returns (address)`

### `MoonwellComptrollerABI`

`import MoonwellComptrollerABI from "./protocols/moonwell/MoonwellComptrollerABI.json";` Speaks for: comptroller. The import is the contract's full ABI across every deployment; call it through the `Moonwell` namespace to have a function a chain's deployment does not run refused.

- `_become(address unitroller)`
- `_rescueFunds(address _tokenAddress, uint256 _amount)`
- `_setBorrowCapGuardian(address newBorrowCapGuardian)`
- `_setBorrowPaused(address mToken, bool state) returns (bool)`
- `_setCloseFactor(uint256 newCloseFactorMantissa) returns (uint256)`
- `_setCollateralFactor(address mToken, uint256 newCollateralFactorMantissa) returns (uint256)`
- `_setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa) returns (uint256)`
- `_setMarketBorrowCaps(address[] mTokens, uint256[] newBorrowCaps)`
- `_setMarketSupplyCaps(address[] mTokens, uint256[] newSupplyCaps)`
- `_setMintPaused(address mToken, bool state) returns (bool)`
- `_setPauseGuardian(address newPauseGuardian) returns (uint256)`
- `_setPriceOracle(address newOracle) returns (uint256)`
- `_setRewardDistributor(address newRewardDistributor)`
- `_setSeizePaused(bool state) returns (bool)`
- `_setSupplyCapGuardian(address newSupplyCapGuardian)`
- `_setTransferPaused(bool state) returns (bool)`
- `_supportMarket(address mToken) returns (uint256)`
- `accountAssets(address, uint256) view returns (address)`
- `admin() view returns (address)`
- `allMarkets(uint256) view returns (address)`
- `borrowAllowed(address mToken, address borrower, uint256 borrowAmount) returns (uint256)`
- `borrowCapGuardian() view returns (address)`
- `borrowCaps(address) view returns (uint256)`
- `borrowGuardianPaused(address) view returns (bool)`
- `checkMembership(address account, address mToken) view returns (bool)`
- `claimReward()`
- `claimReward(address holder)`
- `claimReward(address holder, address[] mTokens)`
- `claimReward(address[] holders, address[] mTokens, bool borrowers, bool suppliers)`
- `closeFactorMantissa() view returns (uint256)`
- `comptrollerImplementation() view returns (address)`
- `enterMarkets(address[] mTokens) returns (uint256[])`
- `exitMarket(address mToken) returns (uint256)`
- `getAccountLiquidity(address account) view returns (uint256, uint256, uint256)`
- `getAllMarkets() view returns (address[])`
- `getAssetsIn(address account) view returns (address[])`
- `getBlockTimestamp() view returns (uint256)`
- `getHypotheticalAccountLiquidity(address account, address mTokenModify, uint256 redeemTokens, uint256 borrowAmount) view returns (uint256, uint256, uint256)`
- `isComptroller() view returns (bool)`
- `liquidateBorrowAllowed(address mTokenBorrowed, address mTokenCollateral, address liquidator, address borrower, uint256 repayAmount) view returns (uint256)`
- `liquidateCalculateSeizeTokens(address mTokenBorrowed, address mTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidationIncentiveMantissa() view returns (uint256)`
- `markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)`
- `mintAllowed(address mToken, address minter, uint256 mintAmount) returns (uint256)`
- `mintGuardianPaused(address) view returns (bool)`
- `oracle() view returns (address)`
- `pauseGuardian() view returns (address)`
- `pendingAdmin() view returns (address)`
- `pendingComptrollerImplementation() view returns (address)`
- `redeemAllowed(address mToken, address redeemer, uint256 redeemTokens) returns (uint256)`
- `redeemVerify(address mToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens) pure`
- `repayBorrowAllowed(address mToken, address payer, address borrower, uint256 repayAmount) returns (uint256)`
- `rewardDistributor() view returns (address)`
- `seizeAllowed(address mTokenCollateral, address mTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `seizeGuardianPaused() view returns (bool)`
- `supplyCapGuardian() view returns (address)`
- `supplyCaps(address) view returns (uint256)`
- `transferAllowed(address mToken, address src, address dst, uint256 transferTokens) returns (uint256)`
- `transferGuardianPaused() view returns (bool)`
