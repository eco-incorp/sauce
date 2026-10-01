# GHO

Aave-native decentralized stablecoin minted against Aave V3 collateral. Multi-collateral, transparent, and governed by Aave DAO.

## Category

cdp | Chains and addresses: [registry/gho.md](registry/gho.md)

## Key Operations

- **transfer**: Transfer GHO tokens
- **approve**: Approve GHO token spender

## SauceScript Examples

```typescript
// Transfer GHO
import { transfer } from "@sauce/token";
function main(ghoAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(ghoAddress, to, amount);
  return 1;
}

// Approve GHO spender
import { approve } from "@sauce/token";
function main(ghoAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(ghoAddress, spender, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gho.md](registry/gho.md).

## Notes

- Minted via Aave V3 borrow (use Aave V3 Pool.borrow with GHO token address)
- Facilitator-based model - Aave V3 Pool is the primary facilitator
- GHO has a variable borrow rate set by Aave governance
- stkAAVE holders get a discount on GHO borrow rate
- To mint GHO: supply collateral to Aave V3, then borrow GHO
- To repay: use Aave V3 Pool.repay with GHO token address
