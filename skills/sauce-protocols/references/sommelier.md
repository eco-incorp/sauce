# Sommelier

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

## Category

yield | Chains and addresses: [registry/sommelier.md](registry/sommelier.md)

## Key Operations

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Deposit into Sommelier Cellar
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.deposit(assets, receiver);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/sommelier.md](registry/sommelier.md).

## Notes

- Cellars are ERC-4626 vaults. Strategies managed off-chain via Cosmos governance.
