<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

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

## What it offers

- **exercise**: Exercise a long options position to claim profit
- **settle**: Settle a short options position after expiry
- **trade**: Buy or sell options via the Premia AMM

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
