# Level Finance

Decentralized perpetual exchange with risk-tranched liquidity pools. Senior (low risk), Mezzanine (medium), and Junior (high risk/reward) tranches.

## Category

perpetuals | Chains and addresses: [registry/level-finance.md](registry/level-finance.md)

## Key Operations

- **addLiquidity**: Add liquidity to a specific risk tranche
- **removeLiquidity**: Remove liquidity from a tranche

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Add liquidity to tranche
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(
  poolAddress: Address,
  tranche: Address,
  token: Address,
  amountIn: Uint256,
  minLpAmount: Uint256,
  to: Address,
): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.addLiquidity(tranche, token, amountIn, minLpAmount, to);
  return 1;
}

// Remove liquidity from tranche
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(
  poolAddress: Address,
  tranche: Address,
  tokenOut: Address,
  lpAmount: Uint256,
  minOut: Uint256,
  to: Address,
): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.removeLiquidity(tranche, tokenOut, lpAmount, minOut, to);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/level-finance.md](registry/level-finance.md).

## Notes

- Risk-tranched pools: Senior (low risk, lower yield), Mezzanine (medium), Junior (high risk, higher yield)
- Each tranche has its own LP token address
- Approve input token to liquidityPool before adding liquidity
- minLpAmount/minOut provide slippage protection
