# Liquity V1

Decentralized borrowing protocol offering interest-free loans against ETH collateral. Issues LUSD stablecoin with minimum 110% collateral ratio.

## Category

cdp | Chains and addresses: [registry/liquity-v1.md](registry/liquity-v1.md)

## Key Operations

- **closeTrove**: Close an existing Trove (repay all debt and withdraw collateral)
- **repayLUSD**: Repay LUSD debt on an open Trove
- **openTrove**: Open a new Trove by depositing ETH and borrowing LUSD
- **adjustTrove**: Adjust Trove collateral and/or debt

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Close Trove
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";
function main(borrowerOpsAddress: Address): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.closeTrove();
  return 1;
}

// Repay LUSD debt
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";
function main(borrowerOpsAddress: Address, amount: Uint256): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.repayLUSD(
    amount,
    0x0000000000000000000000000000000000000000,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/liquity-v1.md](registry/liquity-v1.md).

## Notes

- TVL: $500M+. Interest-free loans with one-time borrowing fee (0.5% - 5%)
- Minimum collateral ratio: 110%. Below this, Trove can be liquidated
- Hint addresses (upperHint, lowerHint) optimize sorted trove list insertion - use Liquity frontend SDK to compute
- Minimum debt: 2000 LUSD (including 200 LUSD gas reserve)
- closeTrove requires repaying all debt including the 200 LUSD gas reserve
