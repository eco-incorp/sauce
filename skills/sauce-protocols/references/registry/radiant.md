<!-- Generated from the SDK's registries. Do not edit. -->

# Radiant (`radiant`)

Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Radiant` on arbitrum |
| Chains | arbitrum |
| Document | [radiant.md](../radiant.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Radiant` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's lendingPool, `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1`.
  require(Radiant.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `Radiant.LendingPool` |

## ABI

### `RadiantLendingPoolABI`

`import RadiantLendingPoolABI from "./protocols/radiant/RadiantLendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`
