# crvUSD

Curve Finance native stablecoin using LLAMMA (Lending-Liquidating AMM Algorithm) for soft liquidations.

## Category

cdp | Chains and addresses: [registry/crvusd.md](registry/crvusd.md)

## Key Operations

- **transfer**: Transfer crvUSD tokens
- **approve**: Approve crvUSD token spender

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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
