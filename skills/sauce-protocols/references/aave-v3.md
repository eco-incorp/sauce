# Aave V3

Non-custodial liquidity protocol for earning interest on deposits and borrowing assets. The most widely deployed lending protocol in DeFi.

## When to use it

- Earn interest on an asset the market lists, or borrow one against everything you supplied in
  that market. One Pool per market holds every reserve.
- Choose it over Compound V3 when you need to borrow more than one asset against shared
  collateral, and over Morpho Blue when you want one shared market rather than isolated ones.

## Pitfalls for a program

- `supply` pulls the asset with `transferFrom`: approve the Pool for exactly the amount first.
- `onBehalfOf` receives the aTokens, and with them the position. Every call comes from the Pot,
  so `ctx.self()` there keeps the position in the Pot, not in the user's wallet; choose which, and
  pass the wallet as a `main` parameter to give it to the user. A position in the wallet is the
  wallet's: `withdraw` burns the caller's aTokens, so a later cook withdraws it only once they are
  back in the Pot, and borrows against it only with the wallet's credit delegation.
- The aToken minted to `onBehalfOf` is rebasing: its balance grows with interest, so measure it
  as a delta, not as the amount supplied.
- A reserve can be frozen, paused or at its supply cap, and then `supply` reverts.
- Borrowing needs collateral and keeps the position's health factor (from
  `getUserAccountData`, scaled by 1e18) above 1; below it, anyone may liquidate.
- `withdraw` with `~0` withdraws everything; it reverts if that would leave a borrow
  undercollateralized.
- `flashLoanSimple` calls back a receiver contract, which a Sauce program cannot be.

## In a Sauce program

Supply the Pot's USDC for `onBehalfOf` (the user's wallet, or `ctx.self()` to keep the position in
the Pot) and check the position now has collateral:

```sauce chain=base,arbitrum
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV3.Pool, amount);
  AaveV3.Pool.supply(USDC, amount, onBehalfOf, 0);
  const account = AaveV3.Pool.getUserAccountData(onBehalfOf);
  require(account.totalCollateralBase > 0, "nothing supplied");
}
```

## Category

lending | Chains and addresses: [registry/aave-v3.md](registry/aave-v3.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### supply

Supply assets to earn interest. Mints aTokens to the supplier.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
```

- `poolAddress`: Pool contract for the target chain
- `asset`: ERC-20 token address to supply
- `amount`: Amount in token's native decimals. Use `type(uint256).max` for entire balance
- `onBehalfOf`: Address that receives the aTokens. In a Sauce program the caller is the Pot: pass the user's wallet to give them the position, or `ctx.self()` to keep it in the Pot
- Requires ERC-20 approval to the Pool before calling

### withdraw

Withdraw supplied assets by burning aTokens.

```typescript
import { PoolABI as IPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
```

- `amount`: Use `type(uint256).max` to withdraw entire balance
- Returns the actual withdrawn amount

### borrow

Borrow assets against supplied collateral.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
```

- `interestRateMode`: 1 = stable (being phased out), 2 = variable. Use 2 for variable rate
- Must have sufficient collateral supplied first

### repay

Repay borrowed assets to reduce debt.

```typescript
import { PoolABI as IPool } from "./abis";

function main(
  poolAddress: Address,
  asset: Address,
  amount: Uint256,
  interestRateMode: Uint256,
  onBehalfOf: Address,
): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
```

- `interestRateMode`: Must match the debt type (1 = stable, 2 = variable)
- `amount`: Use `type(uint256).max` to repay entire debt
- Requires ERC-20 approval to the Pool

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/aave-v3.md](registry/aave-v3.md).

## Notes

- interestRateMode: 1 = stable (deprecated on most markets), 2 = variable
- referralCode is always 0 (referral program inactive)
- V3 introduced efficiency mode (eMode) for correlated assets, isolation mode for new assets, and siloed borrowing
- All supply/repay operations require prior ERC-20 approval to the Pool address
- healthFactor < 1e18 means position is liquidatable
- TVL: $40B+. Audited
