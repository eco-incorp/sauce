# Venus

Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

## Category

lending | Chains and addresses: [registry/venus.md](registry/venus.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### supply

Supply assets by minting vTokens. Exchange rate grows as interest accrues.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.mint(amount);
}
```

- `vTokenAddress`: A BEP-20 vToken market (each asset has its own vToken, e.g. vUSDC). vBNB takes native BNB instead: see `VBNBABI`
- Returns 0 on success, error code on failure
- Requires ERC-20 approval of underlying to the vToken

### withdraw

Withdraw underlying assets by specifying the exact amount.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.redeemUnderlying(amount);
}
```

### borrow

Borrow assets against vToken collateral. Must call enterMarkets first.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.borrow(amount);
}
```

- Must enable collateral via `VenusComptroller.enterMarkets([vTokenAddress])` first

### repay

Repay borrowed assets.

```typescript
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.repayBorrow(amount);
}
```

- Requires ERC-20 approval of underlying to the vToken

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/venus.md](registry/venus.md).

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also supports VAI stablecoin minting (separate contract)
- Return values: 0 = success, non-zero = error code
- BSC-only deployment. TVL: $3B+. Audited
- vBNB (`vBNB`) takes native BNB, so its `mint` and `repayBorrow` take no amount: the BNB sent with the call is the amount.
