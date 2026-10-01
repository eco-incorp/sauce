# ZeroLend

Leading lending protocol on zkSync Era. Aave V3 fork optimized for zero-knowledge rollups with low transaction costs.

## Category

lending | Chains and addresses: [registry/zerolend.md](registry/zerolend.md)

## SauceScript Functions

### supply

Supply assets to earn interest. Same interface as Aave V3.

```typescript
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `onBehalfOf`: Address receiving the supply tokens (use msg.sender for self)
- Requires ERC-20 approval to the Pool

### withdraw

Withdraw supplied assets.

```typescript
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw all
- Returns actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 2 = variable rate

### repay

Repay borrowed debt.

```typescript
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `amount`: Use `type(uint256).max` to repay full debt
- Requires ERC-20 approval to the Pool

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/zerolend.md](registry/zerolend.md).

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- zkSync Era-only deployment. TVL: $100M+. Audited
