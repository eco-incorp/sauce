# Aave V3

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets. The most widely deployed lending protocol in DeFi.

## Category

lending | Chains and addresses: [registry/aave-v3.md](registry/aave-v3.md)

## SauceScript Functions

### supply

Supply assets to earn interest. Mints aTokens to the supplier.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `poolAddress`: Pool contract for the target chain
- `asset`: ERC-20 token address to supply
- `amount`: Amount in token's native decimals. Use `type(uint256).max` for entire balance
- `onBehalfOf`: Address that receives aTokens (use msg.sender for self)
- Requires ERC-20 approval to the Pool before calling

### withdraw

Withdraw supplied assets by burning aTokens.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw entire balance
- Returns the actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 1 = stable (being phased out), 2 = variable. Use 2 for variable rate
- Must have sufficient collateral supplied first

### repay

Repay borrowed assets to reduce debt.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `interestRateMode`: Must match the debt type (1 = stable, 2 = variable)
- `amount`: Use `type(uint256).max` to repay entire debt
- Requires ERC-20 approval to the Pool

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aave-v3.md](registry/aave-v3.md).

## Notes

- interestRateMode: 1 = stable (deprecated on most markets), 2 = variable
- referralCode is always 0 (referral program inactive)
- V3 introduced efficiency mode (eMode) for correlated assets, isolation mode for new assets, and siloed borrowing
- All supply/repay operations require prior ERC-20 approval to the Pool address
- healthFactor < 1e18 means position is liquidatable
- TVL: $40B+. Audited
