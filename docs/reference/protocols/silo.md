<!-- Generated from the SDK's registries. Do not edit. -->

# Silo (`silo`)

Permissionless lending protocol with isolated risk markets (Silos). Each Silo is a pair of two assets with independent risk parameters, preventing cross-market contagion.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Silo` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- Each Silo is an isolated two-asset market -- risk from one market cannot spread to others
- `collateralOnly = true` gives higher LTV but your deposit cannot be lent out to borrowers
- Use `SiloRepository.getSilo(assetAddress)` to find the Silo contract for any asset
- Same SiloRepository address on Ethereum and Arbitrum
- All deposit/repay operations require ERC-20 approval
- TVL: $200M+. Audited

## Its names in a program

On Ethereum, `Silo` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's siloRepository, `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49`.
  require(Silo.SiloRepository != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | siloRepository | `0xbACBBefda6fD1FbF5a2d6A79916F4B6124eD2D49` | `Silo.SiloRepository` |
| [Arbitrum One](../chains/arbitrum.md) | siloRepository | `0x8658047e48CC09161f4152c79155Dac1d710Ff0a` | `Silo.SiloRepository` |

## ABI

### `SiloABI`

`import SiloABI from "./protocols/silo/SiloABI.json";`

- `deposit(address asset, uint256 amount, bool collateralOnly) returns (uint256 collateralAmount, uint256 collateralShare)`
- `withdraw(address asset, uint256 amount, bool collateralOnly) returns (uint256 withdrawnAmount, uint256 withdrawnShare)`
- `borrow(address asset, uint256 amount) returns (uint256 debtAmount, uint256 debtShare)`
- `repay(address asset, uint256 amount) returns (uint256 repaidAmount, uint256 repaidShare)`

### `SiloRepositoryABI`

`import SiloRepositoryABI from "./protocols/silo/SiloRepositoryABI.json";` Speaks for: siloRepository.

- `getSilo(address asset) view returns (address silo)`
