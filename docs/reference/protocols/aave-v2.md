<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V2 (`aave-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aave V2 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Legacy version of Aave lending protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV2` on ethereum, polygon, avalanche |
| Chains | ethereum, polygon, avalanche |

## When to use it

- The previous Aave generation, where a chain still runs its market. Where a chain has both,
  Aave V3 is the current market (`aave-v3`).

## Pitfalls for a program

- The supply call is `deposit`, not `supply`; approve the LendingPool first.
- `onBehalfOf` receives the aTokens. The caller is the Pot, so `pot` keeps them in the
  Pot, not in the user's wallet: choose which, and pass the wallet as a `main` parameter to
  deliver them.
- aTokens are rebasing: measure balances as deltas.
- A frozen reserve refuses new deposits: check the reserve accepts them before relying on it.
- Borrowing and liquidation work as in Aave V3, by health factor.

## In a Sauce program

Deposit the Pot's USDC for `onBehalfOf`, the user's wallet or the Pot (`pot`):

```ts
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV2.LendingPool, amount);
  AaveV2.LendingPool.deposit(USDC, amount, onBehalfOf, 0);
}
```

## Notes

- interestRateMode: 1 = stable, 2 = variable. Most users use variable rate
- referralCode is always 0 (referral program inactive)
- Legacy protocol -- consider Aave V3 for new deployments
- All deposit/repay operations require prior ERC-20 approval to the LendingPool address
- TVL: $2B+. Audited

## Its names in a program

On Ethereum, `AaveV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lendingPool, `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Polygon](../chains/polygon.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool`; not on this deployment: `swapToVariable` |
| [Avalanche C-Chain](../chains/avalanche.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool`; not on this deployment: `swapToVariable` |

## ABI

### `LendingPoolABI`

`import LendingPoolABI from "./protocols/aave-v2/LendingPoolABI.json";` Speaks for: lendingPool. The import is the registry's ABI for this contract, the functions listed here and none of those left out below: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `AaveV2` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

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
- `initialize(address _logic, bytes _data) payable`
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

Not on Polygon's lendingPool (`0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf`), whose code does not dispatch them or does not declare them as listed here: `swapToVariable`. Do not call them there: a program compiled for Polygon is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Avalanche C-Chain's lendingPool (`0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C`), whose code does not dispatch them or does not declare them as listed here: `swapToVariable`. Do not call them there: a program compiled for Avalanche C-Chain is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Left out of this ABI, though its deployments declare them:

- `event LiquidationCall` taking `(address,address,address,uint256,uint256,address,bool)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `event ReserveUsedAsCollateralEnabled` taking `(address,address)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
