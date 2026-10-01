# Olympus DAO

Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.

## Category

staking | Chains and addresses: [registry/olympus.md](registry/olympus.md)

## Key Operations

- **stake**: Stake OHM tokens
- **unstake**: Unstake OHM tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Stake OHM
import { StakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, to: Address, amount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  return staking.stake(to, amount, 1, 1);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/olympus.md](registry/olympus.md).

## Notes

- Protocol-owned liquidity model. Rebase mechanism for staking rewards.
