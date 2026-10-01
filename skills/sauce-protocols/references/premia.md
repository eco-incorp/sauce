# Premia

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

## Category

options | Chains: Arbitrum

## Key Operations

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

## SDK Usage

```typescript
import { protocolInfo, deployments, exercise, settle } from "@eco-incorp/sauce/protocols/premia";
```

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

## Key Addresses

| Chain    | Contract    | Address                                      |
| -------- | ----------- | -------------------------------------------- |
| Arbitrum | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` |

## ABI Methods

### DiamondABI (a Premia v3 pool)

- `trade(uint256 size, bool isBuy, uint256 premiumLimit, address referrer) returns (uint256 totalPremium, (int256 collateral, int256 longs, int256 shorts) delta)` - Buy/sell options from the pool's AMM. `size` is 18-decimal
- `exercise() returns (uint256 exerciseValue, uint256 exerciseFee)` - Exercise the caller's long position after maturity
- `settle() returns (uint256 collateral)` - Settle the caller's short position after maturity

## Notes

- Each pool is a proxy routed through the pool Diamond's facets
- Supports calls and puts on ETH, BTC, and other assets
- Long token = bought option, short token = sold/written option
- exercise returns the in-the-money value; settle returns remaining collateral to writers
