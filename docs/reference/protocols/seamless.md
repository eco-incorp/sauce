<!-- Generated from the SDK's registries. Do not edit. -->

# Seamless (`seamless`)

> Seamless is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Seamless` on base |
| Chains | base |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

- `onBehalfOf`: Address receiving the supply tokens. In a Sauce program the caller is the Pot: pass the user's wallet to give them the position, or `ctx.self()` to keep it in the Pot
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

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- ILMs (Integrated Liquidity Markets) enable one-click leveraged positions on yield-bearing assets
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- Base-only deployment. TVL: $100M+. Audited

## Its names in a program

On Base, `Seamless` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's pool, `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7`.
  require(Seamless.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | pool | `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7` | `Seamless.Pool` |
| [Base](../chains/base.md) | poolAddressesProvider | `0x0E02EB705be564c2bF0067928A8f8DD89a82B26E` | `Seamless.PoolAddressesProvider` |

## ABI

### `SeamlessPoolABI`

`import SeamlessPoolABI from "./protocols/seamless/SeamlessPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
