# Tokemak

Liquidity routing protocol with Autopilot Autopools that automatically deploy and rebalance liquidity across DeFi destinations.

## Category

yield | Chains and addresses: [registry/tokemak.md](registry/tokemak.md)

## Key Operations

- **deposit**: Deposit assets into Autopool
- **withdraw**: Withdraw assets from Autopool
- **redeem**: Redeem Autopool shares

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit into Tokemak Autopool
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.deposit(assets, receiver);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/tokemak.md](registry/tokemak.md).

## Notes

- Autopools are ERC-4626 vaults. Autopilot automatically rebalances across DeFi venues.
