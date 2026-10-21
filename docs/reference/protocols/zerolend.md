<!-- Generated from the SDK's registries. Do not edit. -->

# ZeroLend (`zerolend`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> ZeroLend is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leading lending protocol on zkSync Era. Aave V3 fork optimized for zero-knowledge rollups with low transaction costs.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Zerolend` on zksync |
| Chains | zksync |

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- zkSync Era-only deployment. TVL: $100M+. Audited

## Its names in a program

On zkSync Era, `Zerolend` is a namespace: its contracts need no import.

```ts
function main() {
  // zkSync Era's pool, `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8`.
  require(Zerolend.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [zkSync Era](../chains/zksync.md) | pool | `0x4d9429246EA989C9CeE203B43F6d1C7D83e3B8F8` | `Zerolend.Pool` |

## ABI

### `ZeroLendPoolABI`

`import ZeroLendPoolABI from "./protocols/zerolend/ZeroLendPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
