# Swell

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking via EigenLayer.

## Category

liquid-staking | Chains and addresses: [registry/swell.md](registry/swell.md)

## Key Operations

- **stakeSwETH**: Deposit ETH for swETH (liquid staking)
- **stakeRswETH**: Deposit ETH for rswETH (liquid restaking)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Stake ETH for swETH
import { SwETHABI as ISwETH } from "./abis";
function main(swethAddress: Address): Uint256 {
  const sweth = ISwETH.at(swethAddress);
  sweth.deposit();
  return 1;
}

// Stake ETH for rswETH (restaking)
import { RswETHABI as IRswETH } from "./abis";
function main(rswethAddress: Address): Uint256 {
  const rsweth = IRswETH.at(rswethAddress);
  rsweth.deposit();
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/swell.md](registry/swell.md).

## Notes

- TVL: $800M+. Both tokens are non-rebasing (value accrues)
- swETH = standard liquid staking. rswETH = liquid restaking via EigenLayer
- Both deposit() functions are payable - send ETH as msg.value
