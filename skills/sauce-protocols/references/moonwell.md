# Moonwell

Leading lending protocol on Base. Compound V2 fork with governance and safety module features.

## Category

lending | Chains and addresses: [registry/moonwell.md](registry/moonwell.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### supply

Supply assets by minting mTokens. Exchange rate grows as interest accrues.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.mint(amount);
}
```

- `mTokenAddress`: The mToken market contract (each asset has its own mToken)
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the mToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against mToken collateral. Must call enterMarkets first.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.borrow(amount);
}
```

- Must enable collateral via `MoonwellComptroller.enterMarkets([mTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the mToken

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/moonwell.md](registry/moonwell.md).

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Return values: 0 = success, non-zero = error code
- Base-only deployment. TVL: $500M+. Audited
