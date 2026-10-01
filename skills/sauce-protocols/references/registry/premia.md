<!-- Generated from the SDK's registries. Do not edit. -->

# Premia (`premia`)

Decentralized options protocol with an AMM-based pricing model and concentrated liquidity for options vaults.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [premia.md](../premia.md): what it is for, how to choose it, its pitfalls |

## In a program

The registry records no deployment: `DiamondABI` is an interface, bound to an address the
program is given.

```sauce chain=ethereum
import DiamondABI from "./protocols/premia/DiamondABI.json";

const TARGET = 0n; // the contract's address, as a define

function main() {
  const target = DiamondABI.at(TARGET);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolFactory | `0xAE4fB6622F25f397587F11638dA8CE88C27b5645` | no registry ABI |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/premia/DiamondABI.json";`

- `trade(uint256 size, bool isBuy, uint256 premiumLimit, address referrer) returns (uint256 totalPremium, (int256 collateral, int256 longs, int256 shorts) delta)`
- `exercise() returns (uint256 exerciseValue, uint256 exerciseFee)`
- `settle() returns (uint256 collateral)`
