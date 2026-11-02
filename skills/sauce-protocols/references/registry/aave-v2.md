<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V2 (`aave-v2`)

Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV2` on ethereum, polygon, avalanche |
| Chains | ethereum, polygon, avalanche |
| Document | [aave-v2.md](../aave-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `AaveV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's lendingPool, `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Polygon](../../../sauce-chains/references/polygon.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool`; not on this deployment: `swapToVariable` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool`; not on this deployment: `swapToVariable` |

## ABI

### `LendingPoolABI`

`import LendingPoolABI from "./protocols/aave-v2/LendingPoolABI.json";` Speaks for: lendingPool.

- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `finalizeTransfer(address asset, address from, address to, uint256 amount, uint256 balanceFromBefore, uint256 balanceToBefore)`
- `flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode)`
- `FLASHLOAN_PREMIUM_TOTAL() view returns (uint256)`
- `getAddressesProvider() view returns (address)`
- `getConfiguration(address asset) view returns ((uint256 data))`
- `getReserveData(address asset) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id))`
- `getReserveNormalizedIncome(address asset) view returns (uint256)`
- `getReserveNormalizedVariableDebt(address asset) view returns (uint256)`
- `getReservesList() view returns (address[])`
- `getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)`
- `getUserConfiguration(address user) view returns ((uint256 data))`
- `initialize(address provider)`
- `initReserve(address asset, address aTokenAddress, address stableDebtAddress, address variableDebtAddress, address interestRateStrategyAddress)`
- `LENDINGPOOL_REVISION() view returns (uint256)`
- `liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)`
- `MAX_NUMBER_RESERVES() view returns (uint256)`
- `MAX_STABLE_RATE_BORROW_SIZE_PERCENT() view returns (uint256)`
- `paused() view returns (bool)`
- `rebalanceStableBorrowRate(address asset, address user)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
- `rescueTokens(address token, address to, uint256 amount)`
- `setConfiguration(address asset, uint256 configuration)`
- `setPause(bool val)`
- `setReserveInterestRateStrategyAddress(address asset, address rateStrategyAddress)`
- `setUserUseReserveAsCollateral(address asset, bool useAsCollateral)`
- `swapBorrowRateMode(address asset, uint256 rateMode)`
- `swapToVariable(address asset, address user)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`

Not on Polygon's lendingPool (`0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf`), whose code does not dispatch them or declares them otherwise: `swapToVariable`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's lendingPool (`0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C`), whose code does not dispatch them or declares them otherwise: `swapToVariable`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.
