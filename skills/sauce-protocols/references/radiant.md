# Radiant

Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.

## Category

lending | Chains and addresses: [registry/radiant.md](registry/radiant.md)

## SauceScript Functions

### deposit

Deposit assets to earn interest and receive rTokens.

```typescript
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  pool.deposit(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `onBehalfOf`: Address that receives rTokens (use msg.sender for self)
- Requires ERC-20 approval to the LendingPool

### withdraw

Withdraw deposited assets by burning rTokens.

```typescript
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw all
- Returns actual withdrawn amount

### borrow

Borrow assets against deposited collateral.

```typescript
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 1 = stable, 2 = variable

### repay

Repay borrowed debt.

```typescript
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(
  lendingPoolAddress: Address,
  asset: Address,
  amount: Uint256,
  rateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  return pool.repay(asset, amount, rateMode, onBehalfOf);
}
```

- `rateMode`: Must match existing debt type (1 = stable, 2 = variable)
- Requires ERC-20 approval to the LendingPool

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/radiant.md](registry/radiant.md).

## Notes

- Same interface as Aave V2 (forked codebase) -- referralCode always 0
- Requires dLP (dynamic liquidity provision) locking to be eligible for RDNT emissions
- Users must lock at least 5% of deposit value in dLP to earn platform fees
- interestRateMode: 1 = stable, 2 = variable
- All deposit/repay operations require ERC-20 approval to LendingPool
- Arbitrum-only deployment. TVL: $100M+. Audited
