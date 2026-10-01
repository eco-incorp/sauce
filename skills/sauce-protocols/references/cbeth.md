# Coinbase Wrapped Staked ETH

Coinbase's liquid staking token for Ethereum. cbETH represents staked ETH plus accrued staking rewards. Non-rebasing.

## Category

liquid-staking | Chains and addresses: [registry/cbeth.md](registry/cbeth.md)

## Key Operations

- **transfer**: Transfer cbETH tokens
- **approve**: Approve spender for cbETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Transfer cbETH
import { transfer } from "@sauce/token";
function main(cbethAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(cbethAddress, to, amount);
  return 1;
}

// Approve cbETH
import { approve } from "@sauce/token";
function main(cbethAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(cbethAddress, spender, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/cbeth.md](registry/cbeth.md).

## Notes

- TVL: $2.5B+. Non-rebasing - exchange rate increases over time
- Minted by Coinbase (mint is permissioned). On-chain operations are transfer/approve
- Compatible with EigenLayer restaking (cbETH strategy available)
- Available natively on Base L2
