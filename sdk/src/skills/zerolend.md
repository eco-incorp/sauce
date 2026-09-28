# ZeroLend

Leading lending protocol on zkSync Era. Aave V3 fork optimized for zero-knowledge rollups with low transaction costs.

## Category

lending | Chains: zkSync (324)

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

## Deployed Addresses

| Chain  | Contract | Address                                      |
| ------ | -------- | -------------------------------------------- |
| zkSync | pool     | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` |

## ABI Reference

### ZeroLendPoolABI

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` - Supply asset to earn interest
- `withdraw(address asset, uint256 amount, address to) returns (uint256)` - Withdraw supplied asset
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` - Borrow against collateral
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)` - Repay debt

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- zkSync Era-only deployment. TVL: $100M+. Audited
