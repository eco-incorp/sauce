# Rocket Pool

Decentralised Ethereum liquid staking protocol. Stake ETH and receive rETH, a non-rebasing liquid staking token backed by a decentralized network of permissionless node operators.

## Category

liquid-staking | Chains and addresses: [registry/rocket-pool.md](registry/rocket-pool.md)

## Key Operations

- **deposit**: Stake ETH and receive rETH
- **burn**: Burn rETH to redeem ETH (subject to pool liquidity)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit ETH for rETH
import { RocketDepositPoolABI as IRocketDepositPool } from "./abis";
function main(depositPoolAddress: Address): Uint256 {
  const pool = IRocketDepositPool.at(depositPoolAddress);
  pool.deposit();
  return 1;
}

// Burn rETH back to ETH
import { RETHABI as IRETH } from "./abis";
function main(rethAddress: Address, amount: Uint256): Uint256 {
  const reth = IRETH.at(rethAddress);
  reth.burn(amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/rocket-pool.md](registry/rocket-pool.md).

## Notes

- TVL: $3B+. Most decentralized LST with permissionless node operators
- rETH is non-rebasing: value increases over time relative to ETH
- deposit() is payable - send ETH as msg.value, no parameters needed
- burn() may fail if insufficient liquidity in the deposit pool
- Exchange rate only goes up (barring slashing events)
