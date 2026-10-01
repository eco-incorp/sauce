# Frax Finance

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

## Category

cdp | Chains and addresses: [registry/frax.md](registry/frax.md)

## Key Operations

- **transfer**: Transfer FRAX tokens
- **approve**: Approve FRAX token spender

## SauceScript Examples

```typescript
// Transfer FRAX
import { transfer } from "@sauce/token";
function main(fraxAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(fraxAddress, to, amount);
  return 1;
}

// Approve FRAX spender
import { approve } from "@sauce/token";
function main(fraxAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(fraxAddress, spender, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/frax.md](registry/frax.md).

## Notes

- TVL: $1B+. V1 was fractional-algorithmic, V2 (Frax v3) is fully collateralized
- FXS is the governance/value accrual token
- sFRAX is the staked FRAX vault (ERC-4626) for earning yield - see frax-ether module for sfrxETH
- Frax ecosystem includes: FRAX (stablecoin), frxETH/sfrxETH (liquid staking), FPI (inflation-pegged)
