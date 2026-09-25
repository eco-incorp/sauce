# Spark

Aave V3 fork operated by MakerDAO/Sky ecosystem. Offers competitive rates on DAI/USDS borrowing backed by the Maker protocol.

## Category

lending | Chains: Ethereum (1)

## SauceScript Functions

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
- `onBehalfOf`: Address receiving the spTokens (use msg.sender for self)
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

## Deployed Addresses

| Chain    | Contract              | Address                                      |
| -------- | --------------------- | -------------------------------------------- |
| Ethereum | pool                  | `0xC13e21B648A5Ee794902342038FF3aDAB66BE987` |
| Ethereum | poolAddressesProvider | `0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE` |

## ABI Reference

### SparkPoolABI

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)` - Supply asset to earn interest
- `withdraw(address asset, uint256 amount, address to) returns (uint256)` - Withdraw supplied asset
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)` - Borrow against collateral
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)` - Repay debt

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- Competitive DAI/USDS borrow rates subsidized by MakerDAO/Sky
- interestRateMode: 2 = variable (stable rate being phased out)
- All supply/repay operations require ERC-20 approval to the Pool
- Ethereum-only deployment. TVL: $5B+. Audited
