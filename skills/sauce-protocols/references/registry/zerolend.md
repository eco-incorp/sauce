<!-- Generated from the SDK's registries. Do not edit. -->

# ZeroLend (`zerolend`)

Lending protocol on zkSync Era. Aave V3 fork for zero-knowledge rollups.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Zerolend` on zksync |
| Chains | zksync |
| Document | [zerolend.md](../zerolend.md): what it is for, how to choose it, its pitfalls |

## In a program

On zkSync Era, `Zerolend` is a namespace: its contracts need no import.

```sauce chain=zksync
function main() {
  // zkSync Era's pool, `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8`.
  require(Zerolend.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../../../sauce-chains/references/zksync.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `Zerolend.Pool` |

## ABI

### `ZeroLendPoolABI`

`import ZeroLendPoolABI from "./protocols/zerolend/ZeroLendPoolABI.json";` Speaks for: pool. The import is the contract's full ABI across every deployment; call it through the `Zerolend` namespace to have a function a chain's deployment does not run refused.

- `ADDRESSES_PROVIDER() view returns (address)`
- `backUnbacked(address asset, uint256 amount, uint256 fee) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `BRIDGE_PROTOCOL_FEE() view returns (uint256)`
- `configureEModeCategory(uint8 id, (uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus, address priceSource, string label) category)`
- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `dropReserve(address asset)`
- `finalizeTransfer(address asset, address from, address to, uint256 amount, uint256 balanceFromBefore, uint256 balanceToBefore)`
- `flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] interestRateModes, address onBehalfOf, bytes params, uint16 referralCode)`
- `FLASHLOAN_PREMIUM_TO_PROTOCOL() view returns (uint128)`
- `FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)`
- `flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes params, uint16 referralCode)`
- `getConfiguration(address asset) view returns ((uint256 data))`
- `getEModeCategoryData(uint8 id) view returns ((uint16 ltv, uint16 liquidationThreshold, uint16 liquidationBonus, address priceSource, string label))`
- `getReserveAddressById(uint16 id) view returns (address)`
- `getReserveData(address asset) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))`
- `getReserveNormalizedIncome(address asset) view returns (uint256)`
- `getReserveNormalizedVariableDebt(address asset) view returns (uint256)`
- `getReservesList() view returns (address[])`
- `getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)`
- `getUserConfiguration(address user) view returns ((uint256 data))`
- `getUserEMode(address user) view returns (uint256)`
- `initialize(address provider)`
- `initReserve(address asset, address aTokenAddress, address stableDebtAddress, address variableDebtAddress, address interestRateStrategyAddress)`
- `liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)`
- `MAX_NUMBER_RESERVES() view returns (uint16)`
- `MAX_STABLE_RATE_BORROW_SIZE_PERCENT() view returns (uint256)`
- `mintToTreasury(address[] assets)`
- `mintUnbacked(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `POOL_REVISION() view returns (uint256)`
- `rebalanceStableBorrowRate(address asset, address user)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
- `repayWithATokens(address asset, uint256 amount, uint256 interestRateMode) returns (uint256)`
- `repayWithPermit(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS) returns (uint256)`
- `rescueTokens(address token, address to, uint256 amount)`
- `resetIsolationModeTotalDebt(address asset)`
- `setConfiguration(address asset, (uint256 data) configuration)`
- `setReserveInterestRateStrategyAddress(address asset, address rateStrategyAddress)`
- `setUserEMode(uint8 categoryId)`
- `setUserUseReserveAsCollateral(address asset, bool useAsCollateral)`
- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)`
- `swapBorrowRateMode(address asset, uint256 interestRateMode)`
- `updateBridgeProtocolFee(uint256 protocolFee)`
- `updateFlashloanPremiums(uint128 flashLoanPremiumTotal, uint128 flashLoanPremiumToProtocol)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
