# crvUSD

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

## Category

cdp | Chains and addresses: [registry/crvusd.md](registry/crvusd.md)

## Key Operations

- **transfer**: Transfer crvUSD tokens
- **approve**: Approve crvUSD token spender

## SauceScript Examples

```typescript
// Transfer crvUSD
import { transfer } from "@sauce/token";
function main(crvusdAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(crvusdAddress, to, amount);
  return 1;
}

// Approve crvUSD spender
import { approve } from "@sauce/token";
function main(crvusdAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(crvusdAddress, spender, amount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/crvusd.md](registry/crvusd.md).

## Notes

- TVL: $500M+. LLAMMA provides soft liquidations - collateral gradually converted to crvUSD during price drops
- Soft liquidation = collateral is progressively swapped rather than instant liquidation
- Borrowing happens through Curve lending controllers (per-market contracts)
- Supported collateral includes ETH, wstETH, sfrxETH, tBTC, wBTC
- crvUSD has a peg keeper mechanism to maintain $1 peg via Curve pools
