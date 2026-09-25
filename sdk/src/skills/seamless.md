# Seamless

Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.

## Category

lending | Chains: Base (8453)

## SauceScript Functions

### supply

Supply assets to earn interest. Same interface as Aave V3.

```typescript
import { SeamlessPoolABI as ISeamlessPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = ISeamlessPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `onBehalfOf`: Address receiving the supply tokens (use msg.sender for self)
- Requires ERC-20 approval to the Pool

### withdraw

Withdraw supplied assets.

```typescript
import { SeamlessPoolABI as ISeamlessPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = ISeamlessPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw all
- Returns actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { SeamlessPoolABI as ISeamlessPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ISeamlessPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 2 = variable rate

### repay

Repay borrowed debt.

```typescript
import { SeamlessPoolABI as ISeamlessPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ISeamlessPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `amount`: Use `type(uint256).max` to repay full debt
- Requires ERC-20 approval to the Pool

## Deployed Addresses

| Chain | Contract              | Address                                      |
| ----- | --------------------- | -------------------------------------------- |
| Base  | pool                  | `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7` |
| Base  | poolAddressesProvider | `0x0E02EB705be564c2bF0067928A8f8DD89a82B26E` |

## ABI Reference

### SeamlessPoolABI

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` - Supply asset to earn interest
- `withdraw(address asset, uint256 amount, address to) returns (uint256)` - Withdraw supplied asset
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` - Borrow against collateral
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)` - Repay debt

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- ILMs (Integrated Liquidity Markets) enable one-click leveraged positions on yield-bearing assets
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- Base-only deployment. TVL: $100M+. Audited
