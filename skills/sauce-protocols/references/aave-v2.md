# Aave V2

Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.

## Category

lending | Chains and addresses: [registry/aave-v2.md](registry/aave-v2.md)

## SauceScript Functions

### deposit

Deposit assets into the lending pool to earn interest. Mints aTokens to the depositor.

```typescript
import { LendingPoolABI as ILendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ILendingPool.at(lendingPoolAddress);
  pool.deposit(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `lendingPoolAddress`: LendingPool contract for the target chain
- `asset`: ERC-20 token address to deposit
- `amount`: Amount in token's native decimals (e.g. 1e6 for 1 USDC). Use `type(uint256).max` to deposit entire balance
- `onBehalfOf`: Address that receives the aTokens (use msg.sender for self)
- Requires ERC-20 approval to the LendingPool before calling

### withdraw

Withdraw deposited assets by burning aTokens.

```typescript
import { LendingPoolABI as ILendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = ILendingPool.at(lendingPoolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Amount to withdraw. Use `type(uint256).max` to withdraw entire deposited balance
- `to`: Address that receives the underlying tokens
- Returns the actual withdrawn amount

### borrow

Borrow assets against deposited collateral.

```typescript
import { LendingPoolABI as ILendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ILendingPool.at(lendingPoolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 1 = stable rate, 2 = variable rate. Variable is more common and typically lower
- `onBehalfOf`: Address that receives the debt tokens (must have delegated credit if not msg.sender)
- Must have sufficient collateral deposited first

### repay

Repay borrowed assets to reduce debt.

```typescript
import { LendingPoolABI as ILendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  rateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ILendingPool.at(lendingPoolAddress);
  return pool.repay(asset, amount, rateMode, onBehalfOf);
}
```

- `rateMode`: Must match the rate mode of the existing debt (1 = stable, 2 = variable)
- `amount`: Use `type(uint256).max` to repay entire debt
- Requires ERC-20 approval to the LendingPool
- Returns the actual repaid amount

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aave-v2.md](registry/aave-v2.md).

## Notes

- interestRateMode: 1 = stable, 2 = variable. Most users use variable rate
- referralCode is always 0 (referral program inactive)
- Legacy protocol -- consider Aave V3 for new deployments
- All deposit/repay operations require prior ERC-20 approval to the LendingPool address
- TVL: $2B+. Audited
