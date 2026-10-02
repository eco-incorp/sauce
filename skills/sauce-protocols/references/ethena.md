# Ethena

Synthetic dollar protocol providing USDe, a crypto-native dollar backed by delta-neutral positions. sUSDe offers yield from staking and funding rates.

## Category

cdp | Chains and addresses: [registry/ethena.md](registry/ethena.md)

## Key Operations

- **stakeUSDe**: Stake USDe to receive sUSDe (yield-bearing)
- **cooldownAssets**: Start cooldown period to unstake (by asset amount)
- **cooldownShares**: Start cooldown period to unstake (by share amount)
- **unstake**: Complete unstake after cooldown period

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Stake USDe for sUSDe
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.deposit(amount, receiver);
}

// Start cooldown to unstake
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, assets: Uint256): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.cooldownAssets(assets);
}

// Complete unstake after cooldown
import { StakedUSDeABI as IStakedUSDe } from "./abis";
function main(susdeAddress: Address, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  susde.unstake(receiver);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/ethena.md](registry/ethena.md).

## Notes

- TVL: $3B+. Yield comes from ETH staking rewards + perpetual funding rates
- 7-day cooldown period required before unstaking
- Flow: deposit (stake) -> cooldownAssets/cooldownShares (start cooldown) -> unstake (after 7 days)
- Approve USDe to sUSDe contract before depositing
- sUSDe appreciates against USDe as yield accrues
