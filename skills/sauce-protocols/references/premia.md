# Premia

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

## Category

options | Chains and addresses: [registry/premia.md](registry/premia.md)

## Key Operations

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

Premia v3 has one pool contract per market (base, quote, strike, maturity, call/put), deployed by the PoolFactory; its `PoolDeployed` event names each pool. `exercise` and `settle` act on the caller's own position in that pool.

```typescript
// Exercise a long position after maturity
import { DiamondABI as IPool } from "./abis";
function main(poolAddress: Address): { exerciseValue: Uint256; exerciseFee: Uint256 } {
  const pool = IPool.at(poolAddress);
  return pool.exercise();
}

// Settle a short position after maturity
import { DiamondABI as IPool } from "./abis";
function main(poolAddress: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.settle();
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/premia.md](registry/premia.md).

## Notes

- Each pool is a proxy routed through the pool Diamond's facets
- Supports calls and puts on ETH, BTC, and other assets
- Long token = bought option, short token = sold/written option
- exercise returns the in-the-money value; settle returns remaining collateral to writers
