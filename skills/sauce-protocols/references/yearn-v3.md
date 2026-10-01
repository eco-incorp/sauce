# Yearn V3

Yield aggregator protocol. V3 vaults follow the ERC-4626 standard for automated yield optimization with multi-strategy allocations.

## Category

yield | Chains and addresses: [registry/yearn-v3.md](registry/yearn-v3.md)

## Key Operations

- **deposit**: Deposit assets into vault, receive yield-bearing shares
- **withdraw**: Withdraw assets by specifying asset amount
- **redeem**: Withdraw by specifying share amount

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit into Yearn V3 vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.deposit(assets, receiver);
}

// Withdraw from vault
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.withdraw(assets, receiver, owner);
}

// Redeem shares
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";
function main(vaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.redeem(shares, receiver, owner);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/yearn-v3.md](registry/yearn-v3.md).

## Notes

- TVL: $500M+. ERC-4626 compliant (same interface as sfrxETH, pufETH, sDAI)
- Each vault has a unique address per underlying asset + strategy combination
- Approve underlying token to vault before depositing
- Vaults are deployed via factory - no single canonical vault address
