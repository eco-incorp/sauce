<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Premia` on arbitrum |
| Chains | arbitrum |
| Document | [premia.md](../premia.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Premia` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's poolFactory, `0xAE4fB6622F25f397587F11638dA8CE88C27b5645`.
  require(Premia.PoolFactory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | `Premia.PoolFactory` |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/premia/DiamondABI.json";`

- `trade(uint256 size, bool isBuy, uint256 premiumLimit, address referrer) returns (uint256 totalPremium, (int256 collateral, int256 longs, int256 shorts) delta)`
- `exercise() returns (uint256 exerciseValue, uint256 exerciseFee)`
- `settle() returns (uint256 collateral)`
