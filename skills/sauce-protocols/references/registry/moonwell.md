<!-- Generated from the SDK's registries. Do not edit. -->

# Moonwell (`moonwell`)

Lending protocol on Base. Compound V2 fork with governance and safety module features.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Moonwell` on base |
| Chains | base |
| Document | [moonwell.md](../moonwell.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Moonwell` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's comptroller, `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`.
  require(Moonwell.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | comptroller | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | `Moonwell.Comptroller` |

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
