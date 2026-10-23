<!-- Generated from the SDK's registries. Do not edit. -->

# Radiant (`radiant`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Radiant is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Omnichain lending protocol on Arbitrum. Aave V2 fork with cross-chain lending capabilities via LayerZero. Requires dLP locking for emission eligibility.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Radiant` on arbitrum |
| Chains | arbitrum |

## Notes

- Same interface as Aave V2 (forked codebase) -- referralCode always 0
- Requires dLP (dynamic liquidity provision) locking to be eligible for RDNT emissions
- Users must lock at least 5% of deposit value in dLP to earn platform fees
- interestRateMode: 1 = stable, 2 = variable
- All deposit/repay operations require ERC-20 approval to LendingPool
- Arbitrum-only deployment. TVL: $100M+. Audited

## Its names in a program

On Arbitrum One, `Radiant` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's lendingPool, `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1`.
  require(Radiant.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | lendingPool | `0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1` | `Radiant.LendingPool` |

## ABI

### `RadiantLendingPoolABI`

`import RadiantLendingPoolABI from "./protocols/radiant/RadiantLendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
