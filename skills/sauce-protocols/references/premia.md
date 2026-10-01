# Premia

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

## Category

options | Chains and addresses: [registry/premia.md](registry/premia.md)

## Key Operations

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

## SauceScript Examples

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
