# Kelp DAO

Liquid restaking protocol built on EigenLayer. Deposit LSTs (stETH, ETHx, etc.) and receive rsETH, a non-rebasing liquid restaked token.

## Category

restaking | Chains and addresses: [registry/kelp.md](registry/kelp.md)

## Key Operations

- **depositAsset**: Deposit LST to receive rsETH

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Deposit LST for rsETH
import { LRTDepositPoolABI as ILRTDepositPool } from "./abis";
function main(
  depositPoolAddress: Address,
  asset: Address,
  depositAmount: Uint256,
  minRSETHAmountExpected: Uint256,
): Uint256 {
  const pool = ILRTDepositPool.at(depositPoolAddress);
  pool.depositAsset(asset, depositAmount, minRSETHAmountExpected, "");
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/kelp.md](registry/kelp.md).

## Notes

- TVL: $2B+. Accepts stETH, ETHx, and other LSTs
- Approve the LST to lrtDepositPool before depositing
- minRSETHAmountExpected provides slippage protection
- Use getRsETHAmountToMint() to preview output before depositing
