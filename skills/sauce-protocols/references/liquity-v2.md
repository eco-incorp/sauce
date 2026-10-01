# Liquity V2

Next generation of Liquity protocol with user-set interest rates, multi-collateral support, and the BOLD stablecoin.

## Category

cdp | Chains and addresses: [registry/liquity-v2.md](registry/liquity-v2.md)

## Key Operations

- **transfer**: Transfer BOLD tokens
- **approve**: Approve BOLD token spender

## SauceScript Examples

```typescript
// Transfer BOLD
import { transfer } from "@sauce/token";
function main(boldAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(boldAddress, to, amount);
  return 1;
}

// Approve BOLD spender
import { approve } from "@sauce/token";
function main(boldAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(boldAddress, spender, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/liquity-v2.md](registry/liquity-v2.md).

## Notes

- User-set interest rates - borrowers choose their own rate (higher rate = lower liquidation risk)
- Multi-collateral: ETH, wstETH, rETH, and other LSTs
- BOLD is fully redeemable 1:1 for collateral at any time
- Successor to Liquity V1 with improved capital efficiency
