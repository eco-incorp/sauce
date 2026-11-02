<!-- Generated from the SDK's registries. Do not edit. -->

# LayerBank (`layerbank`)

Lending protocol on Scroll. Compound V2 fork adapted for L2 rollups.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Layerbank` on scroll |
| Chains | scroll |
| Document | [layerbank.md](../layerbank.md): what it is for, how to choose it, its pitfalls |

## In a program

On Scroll, `Layerbank` is a namespace: its contracts need no import.

```sauce chain=scroll
function main() {
  // Scroll's core, `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa`.
  require(Layerbank.Core != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Scroll](../../../sauce-chains/references/scroll.md) | core | `0xEC53c830f4444a8A56455c6836b5D2aA794289Aa` | `Layerbank.Core` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `LTokenABI`

`import LTokenABI from "./protocols/layerbank/LTokenABI.json";`

- `_totalBorrow() view returns (uint256)`
- `accInterestIndex() view returns (uint256)`
- `accountSnapshot(address account) view returns ((uint256 lTokenBalance, uint256 borrowBalance, uint256 exchangeRate))`
- `accruedAccountSnapshot(address account) returns ((uint256 lTokenBalance, uint256 borrowBalance, uint256 exchangeRate))`
- `accruedBorrowBalanceOf(address account) returns (uint256)`
- `accruedExchangeRate() returns (uint256)`
- `accruedTotalBorrow() returns (uint256)`
- `allowance(address account, address spender) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `borrow(address account, uint256 amount) returns (uint256)`
- `borrowBalanceOf(address account) view returns (uint256)`
- `borrowBehalf(address account, address borrower, uint256 amount) returns (uint256)`
- `core() view returns (address)`
- `decimals() view returns (uint8)`
- `exchangeRate() view returns (uint256)`
- `getAccInterestIndex() view returns (uint256)`
- `getCash() view returns (uint256)`
- `getOwner() view returns (address)`
- `getRateModel() view returns (address)`
- `initialize(string _name, string _symbol, uint8 _decimals)`
- `initialized() view returns (bool)`
- `lastAccruedTime() view returns (uint256)`
- `liquidateBorrow(address lTokenCollateral, address liquidator, address borrower, uint256 amount) payable returns (uint256 seizeLAmount, uint256 rebateLAmount, uint256 liquidatorLAmount)`
- `name() view returns (string)`
- `owner() view returns (address)`
- `rateModel() view returns (address)`
- `rebateDistributor() view returns (address)`
- `redeemToken(address redeemer, uint256 lAmount) returns (uint256)`
- `redeemUnderlying(address redeemer, uint256 uAmount) returns (uint256)`
- `renounceOwnership()`
- `repayBorrow(address account, uint256 amount) payable returns (uint256)`
- `reserveFactor() view returns (uint256)`
- `seize(address liquidator, address borrower, uint256 lAmount)`
- `setCore(address _core)`
- `setRateModel(address _rateModel)`
- `setRebateDistributor(address _rebateDistributor)`
- `setReserveFactor(uint256 _reserveFactor)`
- `setUnderlying(address _underlying)`
- `supply(address account, uint256 uAmount) payable returns (uint256)`
- `supplyBehalf(address account, address supplier, uint256 uAmount) payable returns (uint256)`
- `symbol() view returns (string)`
- `totalBorrow() view returns (uint256)`
- `totalReserve() view returns (uint256)`
- `totalSupply() view returns (uint256)`
- `transfer(address dst, uint256 amount) returns (bool)`
- `transferFrom(address src, address dst, uint256 amount) returns (bool)`
- `transferOwnership(address newOwner)`
- `transferTokensInternal(address spender, address src, address dst, uint256 amount)`
- `underlying() view returns (address)`: the address is a token
- `underlyingBalanceOf(address account) view returns (uint256)`
- `withdrawReserves()`

### `LayerBankCoreABI`

`import LayerBankCoreABI from "./protocols/layerbank/LayerBankCoreABI.json";` Speaks for: core. The import is the contract's full ABI across every deployment; call it through the `Layerbank` namespace to have a function a chain's deployment does not run refused.

- `accountLiquidityOf(address account) view returns (uint256 collateralInUSD, uint256 supplyInUSD, uint256 borrowInUSD)`
- `allMarkets() view returns (address[])`
- `borrow(address lToken, uint256 amount)`
- `borrowBehalf(address borrower, address lToken, uint256 amount)`
- `checkMembership(address account, address lToken) view returns (bool)`
- `claimLab()`
- `claimLab(address market)`
- `claimLabBehalf(address[] accounts)`
- `closeFactor() view returns (uint256)`
- `compoundLab(uint256 lockDuration)`
- `enterMarkets(address[] lTokens)`
- `exitMarket(address lToken)`
- `initialize(address _priceCalculator)`
- `initialized() view returns (bool)`
- `keeper() view returns (address)`
- `labDistributor() view returns (address)`
- `leverager() view returns (address)`
- `liquidateBorrow(address lTokenBorrowed, address lTokenCollateral, address borrower, uint256 amount) payable`
- `liquidationIncentive() view returns (uint256)`
- `listMarket(address lToken, uint256 supplyCap, uint256 borrowCap, uint256 collateralFactor)`
- `marketInfoOf(address lToken) view returns ((bool isListed, uint256 supplyCap, uint256 borrowCap, uint256 collateralFactor))`
- `marketInfos(address) view returns (bool isListed, uint256 supplyCap, uint256 borrowCap, uint256 collateralFactor)`
- `marketListOf(address account) view returns (address[])`
- `marketListOfUsers(address, uint256) view returns (address)`
- `markets(uint256) view returns (address)`
- `owner() view returns (address)`
- `pause()`
- `paused() view returns (bool)`
- `priceCalculator() view returns (address)`
- `rebateDistributor() view returns (address)`
- `redeemToken(address lToken, uint256 lAmount) returns (uint256)`
- `redeemUnderlying(address lToken, uint256 uAmount) returns (uint256)`
- `removeMarket(address lToken)`
- `renounceOwnership()`
- `repayBorrow(address lToken, uint256 amount) payable`
- `setCloseFactor(uint256 newCloseFactor)`
- `setCollateralFactor(address lToken, uint256 newCollateralFactor)`
- `setKeeper(address _keeper)`
- `setLABDistributor(address _labDistributor)`
- `setLeverager(address _leverager)`
- `setLiquidationIncentive(uint256 newLiquidationIncentive)`
- `setMarketBorrowCaps(address[] lTokens, uint256[] newBorrowCaps)`
- `setMarketSupplyCaps(address[] lTokens, uint256[] newSupplyCaps)`
- `setPriceCalculator(address _priceCalculator)`
- `setRebateDistributor(address _rebateDistributor)`
- `setValidator(address _validator)`
- `supply(address lToken, uint256 uAmount) payable returns (uint256)`
- `supplyBehalf(address supplier, address lToken, uint256 uAmount) payable returns (uint256)`
- `transferOwnership(address newOwner)`
- `transferTokens(address spender, address src, address dst, uint256 amount)`
- `unpause()`
- `usersOfMarket(address, address) view returns (bool)`
- `validator() view returns (address)`

Left out of this ABI, though its deployments declare them:

- `event FlashLoan` taking `(address,address,address,uint256,uint256)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
