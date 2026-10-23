# Spark

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers DAI/USDS borrowing backed by the Maker protocol.

## Category

lending | Chains and addresses: [registry/spark.md](registry/spark.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/spark.md](registry/spark.md).

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- interestRateMode: 2 = variable (stable rate being phased out)
- All supply/repay operations require ERC-20 approval to the Pool
- Ethereum-only deployment. TVL: $5B+. Audited
