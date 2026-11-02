<!-- Generated from the SDK's registries. Do not edit. -->

# Benqi (`benqi`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Benqi is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Lending and borrowing protocol on Avalanche. Compound V2 fork with additional liquid staking (sAVAX) functionality.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Benqi` on avalanche |
| Chains | avalanche |

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also offers sAVAX liquid staking product (separate contract)
- Return values: 0 = success, non-zero = error code
- Avalanche-only deployment. TVL: $500M+. Audited

## Its names in a program

On Avalanche C-Chain, `Benqi` is a namespace: its contracts need no import.

```ts
function main() {
  // Avalanche C-Chain's comptroller, `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`.
  require(Benqi.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Avalanche C-Chain](../chains/avalanche.md) | comptroller | `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` | `Benqi.Comptroller` |

## ABI

### `BenqiComptrollerABI`

`import BenqiComptrollerABI from "./protocols/benqi/BenqiComptrollerABI.json";` Speaks for: comptroller. The import is the contract's full ABI across every deployment; call it through the `Benqi` namespace to have a function a chain's deployment does not run refused.

- `_become(address unitroller)`
- `_borrowGuardianPaused() view returns (bool)`
- `_grantQi(address recipient, uint256 amount)`
- `_mintGuardianPaused() view returns (bool)`
- `_setBorrowCapGuardian(address newBorrowCapGuardian)`
- `_setBorrowPaused(address qiToken, bool state) returns (bool)`
- `_setCloseFactor(uint256 newCloseFactorMantissa) returns (uint256)`
- `_setCollateralFactor(address qiToken, uint256 newCollateralFactorMantissa) returns (uint256)`
- `_setLiquidationIncentive(uint256 newLiquidationIncentiveMantissa) returns (uint256)`
- `_setMarketBorrowCaps(address[] qiTokens, uint256[] newBorrowCaps)`
- `_setMintPaused(address qiToken, bool state) returns (bool)`
- `_setPauseGuardian(address newPauseGuardian) returns (uint256)`
- `_setPriceOracle(address newOracle) returns (uint256)`
- `_setRewardSpeed(uint8 rewardType, address qiToken, uint256 supplyRewardSpeed, uint256 borrowRewardSpeed)`
- `_setSeizePaused(bool state) returns (bool)`
- `_setTransferPaused(bool state) returns (bool)`
- `_supportMarket(address qiToken) returns (uint256)`
- `accountAssets(address, uint256) view returns (address)`
- `admin() view returns (address)`
- `allMarkets(uint256) view returns (address)`
- `borrowAllowed(address qiToken, address borrower, uint256 borrowAmount) returns (uint256)`
- `borrowCapGuardian() view returns (address)`
- `borrowCaps(address) view returns (uint256)`
- `borrowGuardianPaused(address) view returns (bool)`
- `borrowRewardSpeeds(uint8, address) view returns (uint256)`
- `borrowVerify(address qiToken, address borrower, uint256 borrowAmount)`
- `checkMembership(address account, address qiToken) view returns (bool)`
- `claimReward(uint8 rewardType, address holder)`
- `claimReward(uint8 rewardType, address holder, address[] qiTokens)`
- `claimReward(uint8 rewardType, address[] holders, address[] qiTokens, bool borrowers, bool suppliers) payable`
- `closeFactorMantissa() view returns (uint256)`
- `comptrollerImplementation() view returns (address)`
- `enterMarkets(address[] qiTokens) returns (uint256[])`
- `exitMarket(address qiToken) returns (uint256)`
- `getAccountLiquidity(address account) view returns (uint256, uint256, uint256)`
- `getAllMarkets() view returns (address[])`
- `getAssetsIn(address account) view returns (address[])`
- `getBlockTimestamp() view returns (uint256)`
- `getHypotheticalAccountLiquidity(address account, address qiTokenModify, uint256 redeemTokens, uint256 borrowAmount) view returns (uint256, uint256, uint256)`
- `initialIndexConstant() view returns (uint224)`
- `isComptroller() view returns (bool)`
- `liquidateBorrowAllowed(address qiTokenBorrowed, address qiTokenCollateral, address liquidator, address borrower, uint256 repayAmount) returns (uint256)`
- `liquidateBorrowVerify(address qiTokenBorrowed, address qiTokenCollateral, address liquidator, address borrower, uint256 actualRepayAmount, uint256 seizeTokens)`
- `liquidateCalculateSeizeTokens(address qiTokenBorrowed, address qiTokenCollateral, uint256 actualRepayAmount) view returns (uint256, uint256)`
- `liquidationIncentiveMantissa() view returns (uint256)`
- `markets(address) view returns (bool isListed, uint256 collateralFactorMantissa, bool isQied)`
- `maxAssets() view returns (uint256)`
- `mintAllowed(address qiToken, address minter, uint256 mintAmount) returns (uint256)`
- `mintGuardianPaused(address) view returns (bool)`
- `mintVerify(address qiToken, address minter, uint256 actualMintAmount, uint256 mintTokens)`
- `oracle() view returns (address)`
- `pauseGuardian() view returns (address)`
- `pendingAdmin() view returns (address)`
- `pendingComptrollerImplementation() view returns (address)`
- `qiAddress() view returns (address)`
- `redeemAllowed(address qiToken, address redeemer, uint256 redeemTokens) returns (uint256)`
- `redeemVerify(address qiToken, address redeemer, uint256 redeemAmount, uint256 redeemTokens)`
- `repayBorrowAllowed(address qiToken, address payer, address borrower, uint256 repayAmount) returns (uint256)`
- `repayBorrowVerify(address qiToken, address payer, address borrower, uint256 actualRepayAmount, uint256 borrowerIndex)`
- `rewardAccrued(uint8, address) view returns (uint256)`
- `rewardAvax() view returns (uint8)`
- `rewardBorrowerIndex(uint8, address, address) view returns (uint256)`
- `rewardBorrowState(uint8, address) view returns (uint224 index, uint32 timestamp)`
- `rewardQi() view returns (uint8)`
- `rewardSupplierIndex(uint8, address, address) view returns (uint256)`
- `rewardSupplyState(uint8, address) view returns (uint224 index, uint32 timestamp)`
- `seizeAllowed(address qiTokenCollateral, address qiTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens) returns (uint256)`
- `seizeGuardianPaused() view returns (bool)`
- `seizeVerify(address qiTokenCollateral, address qiTokenBorrowed, address liquidator, address borrower, uint256 seizeTokens)`
- `setQiAddress(address newQiAddress)`
- `supplyRewardSpeeds(uint8, address) view returns (uint256)`
- `transferAllowed(address qiToken, address src, address dst, uint256 transferTokens) returns (uint256)`
- `transferGuardianPaused() view returns (bool)`
- `transferVerify(address qiToken, address src, address dst, uint256 transferTokens)`

Left out of this ABI, though its deployments declare them:

- `event ContributorQiSpeedUpdated` taking `(address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `QiTokenABI`

`import QiTokenABI from "./protocols/benqi/QiTokenABI.json";`

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
- `isQiToken() view returns (bool)`
- `liquidateBorrow(address borrower, uint256 repayAmount, address qiTokenCollateral) returns (uint256)`
- `mint(uint256 mintAmount) returns (uint256)`
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

Left out of this ABI, though its deployments declare them:

- `event AccrueInterest` taking `(uint256,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Approval` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Borrow` taking `(address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Failure` taking `(uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event LiquidateBorrow` taking `(address,address,uint256,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Mint` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewAdmin` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewComptroller` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewMarketInterestRateModel` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewPendingAdmin` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewProtocolSeizeShare` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event NewReserveFactor` taking `(uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Redeem` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event RepayBorrow` taking `(address,address,uint256,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ReservesAdded` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ReservesReduced` taking `(address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event Transfer` taking `(address,address,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
