# Alchemix

Self-repaying loan protocol. Deposit yield-bearing collateral to borrow synthetic assets (alUSD, alETH) that repay themselves over time via yield.

## Category

cdp | Chains and addresses: [registry/alchemix.md](registry/alchemix.md)

## Key Operations

- **deposit**: Deposit yield-bearing token as collateral
- **withdraw**: Withdraw collateral
- **mint**: Borrow synthetic asset (alUSD or alETH) against collateral
- **burn**: Repay synthetic asset debt

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit yield-bearing collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  amount: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.deposit(yieldToken, amount, recipient);
}

// Withdraw collateral
import { AlchemistABI as IAlchemist } from "./abis";
function main(
  alchemistAddress: Address,
  yieldToken: Address,
  shares: Uint256,
  recipient: Address,
): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.withdraw(yieldToken, shares, recipient);
}

// Borrow (mint) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  alchemist.mint(amount, recipient);
  return 1;
}

// Repay (burn) synthetic asset
import { AlchemistABI as IAlchemist } from "./abis";
function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.burn(amount, recipient);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/alchemix.md](registry/alchemix.md).

## Notes

- Self-repaying: yield from deposited collateral automatically reduces debt over time
- Two Alchemist contracts: alchemistAlUSD (for USD synthetics) and alchemistAlETH (for ETH synthetics)
- Max LTV: 50% - can borrow up to half the value of deposited collateral
- yieldToken is the yield-bearing version (e.g. yvDAI, aDAI, stETH), not the base token
- Approve yieldToken to the appropriate Alchemist contract before depositing
- debt is int256 because it can be negative (overpaid/surplus)
