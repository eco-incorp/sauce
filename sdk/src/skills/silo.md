# Silo

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

## Category

lending | Chains: Ethereum (1), Arbitrum (42161)

## SauceScript Functions

### deposit

Deposit assets into a Silo.

```typescript
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.deposit(asset, amount, false);
  return 1;
}
```

- `siloAddress`: The specific Silo contract (use SiloRepository.getSilo to find it)
- `asset`: Token to deposit
- `collateralOnly`: `false` = standard deposit (can be borrowed by others), `true` = collateral-only (higher LTV but cannot be lent out)
- Requires ERC-20 approval to the Silo

### withdraw

Withdraw deposited assets.

```typescript
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  return silo.withdraw(asset, amount, false);
}
```

- `collateralOnly`: Must match the deposit type
- Returns actual amount withdrawn

### borrow

Borrow assets from a Silo against deposited collateral.

```typescript
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.borrow(asset, amount);
  return 1;
}
```

- Must have collateral deposited in the same Silo first

### repay

Repay borrowed assets.

```typescript
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.repay(asset, amount);
  return 1;
}
```

- Requires ERC-20 approval to the Silo

## Deployed Addresses

| Chain    | Contract       | Address                                      |
| -------- | -------------- | -------------------------------------------- |
| Ethereum | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` |
| Arbitrum | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` |

## ABI Reference

### SiloABI

- `deposit(address asset, uint256 amount, bool collateralOnly) returns (uint256 collateralAmount, uint256 collateralShare)` - Deposit asset into Silo
- `withdraw(address asset, uint256 amount, bool collateralOnly) returns (uint256 withdrawnAmount)` - Withdraw deposited asset
- `borrow(address asset, uint256 amount) returns (uint256 debtAmount, uint256 debtShare)` - Borrow asset against collateral
- `repay(address asset, uint256 amount) returns (uint256 repaidAmount, uint256 repaidShare)` - Repay borrowed debt

### SiloRepositoryABI

- `getSilo(address asset) returns (address silo)` - Look up Silo address for a given asset (view)

## Notes

- Each Silo is an isolated two-asset market -- risk from one market cannot spread to others
- `collateralOnly = true` gives higher LTV but your deposit cannot be lent out to borrowers
- Use `SiloRepository.getSilo(assetAddress)` to find the Silo contract for any asset
- Same SiloRepository address on Ethereum and Arbitrum
- All deposit/repay operations require ERC-20 approval
- TVL: $200M+. Audited
