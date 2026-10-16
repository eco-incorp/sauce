<!-- Generated from the SDK's registries. Do not edit. -->

# Abracadabra (`abracadabra`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Abracadabra is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against
> them. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Lending protocol that lets users borrow MIM stablecoin against yield-bearing collateral via isolated Cauldron markets built on DegenBox.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Abracadabra` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |

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

## Notes

- Isolated Cauldron markets - each has specific collateral type and risk parameters
- DegenBox is the underlying vault that holds all assets (BentoBox fork)
- Amounts use "part" (debt accounting) and "share" (DegenBox shares) - not raw token amounts
- skim=false means transfer tokens from caller; skim=true means use tokens already in DegenBox
- Deposit collateral to DegenBox first, then addCollateral to a Cauldron
- Common collateral: sSPELL, yv tokens, LP tokens, yield-bearing assets

## Its names in a program

On Ethereum, `Abracadabra` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's degenBox, `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce`.
  require(Abracadabra.DegenBox != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | degenBox | `0xd96f48665a1410C0cd669A88898ecA36B9Fc2cce` | `Abracadabra.DegenBox` |
| [Ethereum](../chains/ethereum.md) | mim | `0x99D8a9C45b2ecA8864373A26D1459e3Dff1e17F3` | `Abracadabra.Mim` |
| [Arbitrum One](../chains/arbitrum.md) | degenBox | `0x7C8FeF8eA9b1fE46A7689bfb8149341C90431D38` | `Abracadabra.DegenBox` |
| [Arbitrum One](../chains/arbitrum.md) | mim | `0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A` | `Abracadabra.Mim` |

## ABI

### `CauldronABI`

`import CauldronABI from "./protocols/abracadabra/CauldronABI.json";`

- `addCollateral(address to, bool skim, uint256 share)`
- `removeCollateral(address to, uint256 share)`
- `borrow(address to, uint256 amount) returns (uint256 part, uint256 share)`
- `repay(address to, bool skim, uint256 part) returns (uint256 amount)`
- `userCollateralShare(address user) view returns (uint256)`
- `userBorrowPart(address user) view returns (uint256)`

### `DegenBoxABI`

`import DegenBoxABI from "./protocols/abracadabra/DegenBoxABI.json";` Speaks for: degenBox.

- `deposit(address token, address from, address to, uint256 amount, uint256 share) payable returns (uint256 amountOut, uint256 shareOut)`
- `withdraw(address token, address from, address to, uint256 amount, uint256 share) returns (uint256 amountOut, uint256 shareOut)`
- `balanceOf(address token, address user) view returns (uint256)`
