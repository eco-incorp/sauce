# Compound V3

Single-asset lending protocol (Comet) with isolated markets per base asset. Each market has one borrowable asset and multiple collateral assets.

## When to use it

- Each market (a Comet) has one base asset you can supply for interest or borrow, and a list of
  collateral assets you supply to borrow it. The namespace names each Comet by its base asset
  (`CUSDCv3`, `CWETHv3`).
- Choose it when you only need to borrow the base asset; for several borrowable assets against
  shared collateral, Aave V3.

## Pitfalls for a program

- Approve the Comet before `supply`.
- `supply(asset, amount)` credits its caller, the Pot: the position is then the Pot's, not the
  user's wallet's. `supplyTo(dst, asset, amount)` credits `dst`; ask the user which they want.
- Supplying the base asset while you have a borrow repays the borrow first.
- Withdrawing more base asset than you supplied **borrows** the rest, if your collateral allows:
  check `balanceOf` and `borrowBalanceOf` before and after.
- Collateral earns no interest, and each collateral asset has a supply cap.
- `balanceOf` is the base supply with interest: it grows on its own.

## In a Sauce program

Supply the Pot's USDC to the USDC market for `onBehalfOf` (the user's wallet, or `ctx.self()` to
keep the position in the Pot) and check it was credited:

```sauce chain=base,arbitrum
function main(onBehalfOf: Address, amount: Uint256) {
  const before = CompoundV3.CUSDCv3.balanceOf(onBehalfOf);
  USDC.approve(CompoundV3.CUSDCv3, amount);
  CompoundV3.CUSDCv3.supplyTo(onBehalfOf, USDC, amount);
  require(CompoundV3.CUSDCv3.balanceOf(onBehalfOf) > before, "supply not credited");
}
```

## Category

lending | Chains and addresses: [registry/compound-v3.md](registry/compound-v3.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### supply

Supply the base asset to earn interest, or supply collateral to enable borrowing.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supply(asset, amount);
  return 1;
}
```

- `cometAddress`: The specific Comet market (e.g. cUSDCv3, cWETHv3)
- `asset`: If base asset (e.g. USDC) -- earns interest. If collateral asset -- enables borrowing
- Requires ERC-20 approval to the Comet address

### withdraw

Withdraw base asset or collateral. If withdrawing more base than supplied, creates a borrow position.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdraw(asset, amount);
  return 1;
}
```

- Withdrawing base asset beyond your supply automatically borrows

### supplyTo

Supply assets on behalf of another address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, dst: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.supplyTo(dst, asset, amount);
  return 1;
}
```

- `dst`: Destination address that receives the supply position

### withdrawTo

Withdraw assets to a specific address.

```typescript
import { CometABI as IComet } from "./abis";

function main(cometAddress: Address, to: Address, asset: Address, amount: Uint256): Uint256 {
  const comet = IComet.at(cometAddress);
  comet.withdrawTo(to, asset, amount);
  return 1;
}
```

- `to`: Address that receives the withdrawn tokens

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/compound-v3.md](registry/compound-v3.md).

## Notes

- No separate borrow function -- withdrawing more base than supplied automatically borrows
- Each Comet market has ONE base asset (e.g. USDC) and multiple collateral assets
- No interest rate mode selection -- all borrows are variable rate
- Supply/withdraw of collateral does not earn interest, only the base asset earns
- Market names indicate the base asset: cUSDCv3 = USDC base, cWETHv3 = WETH base
- All supply operations require ERC-20 approval to the Comet address
- TVL: $3.5B+. Audited
