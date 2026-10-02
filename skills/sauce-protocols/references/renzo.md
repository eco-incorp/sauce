# Renzo

Liquid restaking protocol built on EigenLayer. Deposit ETH or LSTs and receive ezETH, a non-rebasing liquid restaked token.

## Category

restaking | Chains and addresses: [registry/renzo.md](registry/renzo.md)

## Key Operations

- **depositETH**: Deposit ETH directly to receive ezETH
- **deposit**: Deposit LST collateral (stETH, etc.) to receive ezETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit ETH for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.depositETH();
  return 1;
}

// Deposit LST for ezETH
import { RestakeManagerABI as IRestakeManager } from "./abis";
function main(restakeManagerAddress: Address, collateralToken: Address, amount: Uint256): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.deposit(collateralToken, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/renzo.md](registry/renzo.md).

## Notes

- TVL: $389M+. Built on EigenLayer restaking
- ezETH is non-rebasing - value accrues over time
- depositETH() is payable - send ETH as msg.value
- For LST deposits, approve the collateral token to restakeManager first
