# Perpetual Protocol

Decentralized perpetual futures exchange (Curie v2) on Optimism. Concentrated-liquidity virtual AMM with cross-margin trading.

## Category

perpetuals | Chains and addresses: [registry/perpetual-protocol.md](registry/perpetual-protocol.md)

## Key Operations

- **deposit**: Deposit collateral into Vault for trading
- **withdraw**: Withdraw collateral from Vault
- **openPosition**: Open a leveraged perpetual position
- **closePosition**: Close an existing perpetual position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(token, amount);
  return 1;
}

// Withdraw collateral
import { VaultABI as IVault } from "./abis";
function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.withdraw(token, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/perpetual-protocol.md](registry/perpetual-protocol.md).

## Notes

- Virtual AMM (vAMM) based pricing - no actual liquidity pools
- Cross-margin trading - all positions share the same collateral
- isBaseToQuote: true = short (sell base for quote), false = long (buy base with quote)
- Deposit collateral to Vault first, then trade via ClearingHouse
- sqrtPriceLimitX96 = 0 means no price limit (market order)
