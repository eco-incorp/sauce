<!-- Generated from the SDK's registries. Do not edit. -->

# Spark (`spark`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Spark is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers competitive rates on DAI/USDS borrowing backed by the Maker protocol.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Spark` on ethereum |
| Chains | ethereum |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### supply

Supply assets to earn interest. Same interface as Aave V3.

```typescript
import { SparkPoolABI as ISparkPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = ISparkPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `asset`: ERC-20 token to supply (e.g. DAI, WETH, wstETH)
- `onBehalfOf`: Address receiving the spTokens. In a Sauce program the caller is the Pot: pass the user's wallet to give them the position, or `ctx.self()` to keep it in the Pot
- Requires ERC-20 approval to the Pool

### withdraw

Withdraw supplied assets.

```typescript
import { SparkPoolABI as ISparkPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = ISparkPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw entire balance
- Returns actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { SparkPoolABI as ISparkPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ISparkPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 2 = variable rate (stable rate deprecated)
- DAI/USDS borrow rates are subsidized by MakerDAO -- often lower than market rates

### repay

Repay borrowed debt.

```typescript
import { SparkPoolABI as ISparkPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = ISparkPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `amount`: Use `type(uint256).max` to repay full debt
- Requires ERC-20 approval to the Pool

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- Competitive DAI/USDS borrow rates subsidized by MakerDAO/Sky
- interestRateMode: 2 = variable (stable rate being phased out)
- All supply/repay operations require ERC-20 approval to the Pool
- Ethereum-only deployment. TVL: $5B+. Audited

## Its names in a program

On Ethereum, `Spark` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's pool, `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`.
  require(Spark.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | pool | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` | `Spark.Pool` |
| [Ethereum](../chains/ethereum.md) | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` | `Spark.PoolAddressesProvider` |

## ABI

### `SparkPoolABI`

`import SparkPoolABI from "./protocols/spark/SparkPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`
