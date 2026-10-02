# Puffer Finance

Liquid restaking protocol that issues pufETH via an ERC-4626 vault. Deposits are natively restaked via EigenLayer for additional yield.

## Category

restaking | Chains and addresses: [registry/puffer.md](registry/puffer.md)

## Key Operations

- **deposit**: Deposit assets into PufferVault, receive pufETH shares
- **redeem**: Redeem pufETH shares for underlying assets

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into PufferVault
import { PufferVaultABI as IPufferVault } from "./abis";
function main(pufferVaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.deposit(assets, receiver);
}

// Redeem pufETH shares
import { PufferVaultABI as IPufferVault } from "./abis";
function main(
  pufferVaultAddress: Address,
  shares: Uint256,
  receiver: Address,
  owner: Address,
): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/puffer.md](registry/puffer.md).

## Notes

- TVL: $62M+. ERC-4626 vault interface (same as Yearn V3, sfrxETH, sDAI)
- pufETH is non-rebasing - exchange rate increases over time
- Natively restaked on EigenLayer
- Standard ERC-4626 deposit/redeem pattern
