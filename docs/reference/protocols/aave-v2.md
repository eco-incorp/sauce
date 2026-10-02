<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V2 (`aave-v2`)

Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV2` on ethereum, polygon, avalanche |
| Chains | ethereum, polygon, avalanche |

## When to use it

- The previous Aave generation, where a chain still runs its market. Where a chain has both,
  Aave V3 is the current market (`aave-v3`).

## Pitfalls for a program

- The supply call is `deposit`, not `supply`; approve the LendingPool first.
- aTokens are rebasing: measure balances as deltas.
- A frozen reserve refuses new deposits: check the reserve accepts them before relying on it.
- Borrowing and liquidation work as in Aave V3, by health factor.

## In a Sauce program

Deposit the Pot's USDC:

```ts
function main(amount: Uint256) {
  const self = ctx.self();
  USDC.approve(AaveV2.LendingPool, amount);
  AaveV2.LendingPool.deposit(USDC, amount, self, 0n);
}
```

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- interestRateMode: 1 = stable, 2 = variable. Most users use variable rate
- referralCode is always 0 (referral program inactive)
- Legacy protocol -- consider Aave V3 for new deployments
- All deposit/repay operations require prior ERC-20 approval to the LendingPool address
- TVL: $2B+. Audited

## Its names in a program

On Ethereum, `AaveV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lendingPool, `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Polygon](../chains/polygon.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool` |
| [Avalanche C-Chain](../chains/avalanche.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool` |

## ABI

### `LendingPoolABI`

`import LendingPoolABI from "./protocols/aave-v2/LendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
