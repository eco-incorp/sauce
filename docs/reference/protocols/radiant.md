<!-- Generated from the SDK's registries. Do not edit. -->

# Radiant (`radiant`)

Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Radiant` on arbitrum |
| Chains | arbitrum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

- `onBehalfOf`: Address receiving the rTokens. In a Sauce program the caller is the Pot: pass the user's wallet to give them the position, or `ctx.self()` to keep it in the Pot
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

## Notes

- Same interface as Aave V2 (forked codebase) -- referralCode always 0
- Requires dLP (dynamic liquidity provision) locking to be eligible for RDNT emissions
- Users must lock at least 5% of deposit value in dLP to earn platform fees
- interestRateMode: 1 = stable, 2 = variable
- All deposit/repay operations require ERC-20 approval to LendingPool
- Arbitrum-only deployment. TVL: $100M+. Audited

## Its names in a program

On Arbitrum One, `Radiant` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's lendingPool, `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1`.
  require(Radiant.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `Radiant.LendingPool` |

## ABI

### `RadiantLendingPoolABI`

`import RadiantLendingPoolABI from "./protocols/radiant/RadiantLendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
