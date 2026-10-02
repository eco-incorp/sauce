# Harvest Finance

Yield farming protocol that automatically compounds rewards across DeFi strategies via Vault+Strategy pattern.

## Category

yield | Chains and addresses: [registry/harvest.md](registry/harvest.md)

## Key Operations

- **deposit**: Deposit tokens into Harvest vault
- **withdraw**: Withdraw tokens from vault
- **getPricePerFullShare**: Query vault share price

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Harvest vault
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/harvest.md](registry/harvest.md).

## Notes

- FARM token for governance. Auto-compounds strategy rewards.
