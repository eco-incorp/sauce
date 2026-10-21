<!-- Generated from the SDK's registries. Do not edit. -->

# Moonwell (`moonwell`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Moonwell is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leading lending protocol on Base. Compound V2 fork with governance and safety module features.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Moonwell` on base |
| Chains | base |

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Return values: 0 = success, non-zero = error code
- Base-only deployment. TVL: $500M+. Audited

## Its names in a program

On Base, `Moonwell` is a namespace: its contracts need no import.

```ts
function main() {
  // Base's comptroller, `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`.
  require(Moonwell.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../chains/base.md) | comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | `Moonwell.Comptroller` |

## ABI

### `MTokenABI`

`import MTokenABI from "./protocols/moonwell/MTokenABI.json";`

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`

### `MoonwellComptrollerABI`

`import MoonwellComptrollerABI from "./protocols/moonwell/MoonwellComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] mTokens) returns (uint256[])`
- `exitMarket(address mToken) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
