# Sommelier

ERC-4626 strategy vaults (Cellars) managed by off-chain strategists via Cosmos validators. Automated DeFi portfolio management.

## Category

yield | Chains and addresses: [registry/sommelier.md](registry/sommelier.md)

## Key Operations

- **deposit**: Deposit assets into Cellar vault
- **withdraw**: Withdraw assets from Cellar
- **redeem**: Redeem Cellar shares

## SauceScript Examples

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
