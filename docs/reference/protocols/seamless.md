<!-- Generated from the SDK's registries. Do not edit. -->

# Seamless (`seamless`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Seamless is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Native lending and borrowing protocol on Base. Aave V3 fork with integrated leverage strategies (ILMs) for one-click leveraged yield.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Seamless` on base |
| Chains | base |

## Notes

- Same interface as Aave V3 (forked codebase) -- referralCode always 0
- ILMs (Integrated Liquidity Markets) enable one-click leveraged positions on yield-bearing assets
- interestRateMode: 2 = variable (stable rate not supported)
- All supply/repay operations require ERC-20 approval to the Pool
- Base-only deployment. TVL: $100M+. Audited

## Its names in a program

On Base, `Seamless` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's pool, `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7`.
  require(Seamless.Pool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | pool | `0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7` | `Seamless.Pool` |
| [Base](../chains/base.md) | poolAddressesProvider | `0x0E02EB705be564c2bF0067928A8f8DD89a82B26E` | `Seamless.PoolAddressesProvider` |

## ABI

### `SeamlessPoolABI`

`import SeamlessPoolABI from "./protocols/seamless/SeamlessPoolABI.json";` Speaks for: pool.

- `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
