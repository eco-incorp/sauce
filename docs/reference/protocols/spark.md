<!-- Generated from the SDK's registries. Do not edit. -->

# Spark (`spark`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Spark is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers DAI/USDS borrowing backed by the Maker protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Spark` on ethereum |
| Chains | ethereum |

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- interestRateMode: 2 = variable (stable rate being phased out)
- All supply/repay operations require ERC-20 approval to the Pool
- Ethereum-only deployment. TVL: $5B+. Audited

## Its names in a program

On Ethereum, `Spark` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's pool, `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`.
  require(Spark.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Ethereum](../chains/ethereum.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |

## ABI

### `SparkPoolABI`

`import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";` Speaks for: pool. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Spark` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
- `getReservesCount() view returns (uint256)`
- `getReservesList() view returns (address[])`
- `getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)`
- `getUserConfiguration(address user) view returns ((uint256 data))`
- `getUserEMode(address user) view returns (uint256)`
- `initialize(address provider)`
- `initialize(address _logic, bytes _data) payable`
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

Left out of this ABI, though its deployments declare them:

- `event ReserveUsedAsCollateralEnabled` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
