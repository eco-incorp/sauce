# Silo

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

## Category

lending | Chains and addresses: [registry/silo.md](registry/silo.md)

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
  const result = silo.withdraw(asset, amount, false);
  return result.withdrawnAmount;
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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/silo.md](registry/silo.md).

## Notes

- Each Silo is an isolated two-asset market -- risk from one market cannot spread to others
- `collateralOnly = true` gives higher LTV but your deposit cannot be lent out to borrowers
- Use `SiloRepository.getSilo(assetAddress)` to find the Silo contract for any asset
- Same SiloRepository address on Ethereum and Arbitrum
- All deposit/repay operations require ERC-20 approval
- TVL: $200M+. Audited
