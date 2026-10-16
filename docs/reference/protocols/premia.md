<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

> Premia is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Premia` on arbitrum |
| Chains | arbitrum |

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

## Notes

- Each pool is a proxy routed through the pool Diamond's facets
- Supports calls and puts on ETH, BTC, and other assets
- Long token = bought option, short token = sold/written option
- exercise returns the in-the-money value; settle returns remaining collateral to writers

## Its names in a program

On Arbitrum One, `Premia` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's poolFactory, `0xAE4fB6622F25f397587F11638dA8CE88C27b5645`.
  require(Premia.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | `Premia.PoolFactory` |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/premia/DiamondABI.json";`

- `trade(uint256 size, bool isBuy, uint256 premiumLimit, address referrer) returns (uint256 totalPremium, (int256 collateral, int256 longs, int256 shorts) delta)`
- `exercise() returns (uint256 exerciseValue, uint256 exerciseFee)`
- `settle() returns (uint256 collateral)`
