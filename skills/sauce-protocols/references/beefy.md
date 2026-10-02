# Beefy Finance

Multi-chain yield optimizer. Auto-compounds rewards from LP tokens and other yield sources across many chains.

## Category

yield | Chains and addresses: [registry/beefy.md](registry/beefy.md)

## Key Operations

- **deposit**: Deposit want tokens into Beefy vault
- **depositAll**: Deposit entire balance of want token
- **withdraw**: Withdraw by specifying share amount
- **withdrawAll**: Withdraw entire position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Beefy vault
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}

// Deposit entire balance
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.depositAll();
  return 1;
}

// Withdraw shares
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdraw(shares);
  return 1;
}

// Withdraw all
import { BeefyVaultABI as IBeefyVault } from "./abis";
function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdrawAll();
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/beefy.md](registry/beefy.md).

## Notes

- TVL: $300M+. Each vault has a unique address per strategy
- Approve want token to vault before depositing
- Use want() to discover which token a vault accepts
- getPricePerFullShare() returns the exchange rate between shares and want tokens
- Auto-compounds rewards - no manual claiming needed
