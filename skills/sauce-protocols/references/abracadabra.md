# Abracadabra

Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.

## Category

cdp | Chains and addresses: [registry/abracadabra.md](registry/abracadabra.md)

## Key Operations

- **borrow**: Borrow MIM from a Cauldron
- **repay**: Repay MIM debt
- **addCollateral**: Add collateral to a Cauldron position
- **removeCollateral**: Remove collateral from a Cauldron position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Borrow MIM from Cauldron
import { CauldronABI as ICauldron } from "./abis";
function main(
  cauldronAddress: Address,
  to: Address,
  amount: Uint256,
): { part: Uint256; share: Uint256 } {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.borrow(to, amount);
}

// Repay MIM debt
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, part: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.repay(to, 0, part);
}

// Add collateral
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.addCollateral(to, 0, share);
  return 1;
}

// Remove collateral
import { CauldronABI as ICauldron } from "./abis";
function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.removeCollateral(to, share);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/abracadabra.md](registry/abracadabra.md).

## Notes

- Isolated Cauldron markets - each has specific collateral type and risk parameters
- DegenBox is the underlying vault that holds all assets (BentoBox fork)
- Amounts use "part" (debt accounting) and "share" (DegenBox shares) - not raw token amounts
- skim=false means transfer tokens from caller; skim=true means use tokens already in DegenBox
- Deposit collateral to DegenBox first, then addCollateral to a Cauldron
- Common collateral: sSPELL, yv tokens, LP tokens, yield-bearing assets
