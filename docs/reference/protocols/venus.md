<!-- Generated from the SDK's registries. Do not edit. -->

# Venus (`venus`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Venus is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Venus` on bsc |
| Chains | bsc |

## Notes

- Same interface as Compound V2 (forked codebase)
- Must call `enterMarkets` on Comptroller before borrowing against any market
- Also supports VAI stablecoin minting (separate contract)
- Return values: 0 = success, non-zero = error code
- BSC-only deployment. TVL: $3B+. Audited
- vBNB (`vBNB`) takes native BNB, so its `mint` and `repayBorrow` take no amount: the BNB sent with the call is the amount.

## Its names in a program

On BNB Chain, `Venus` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's comptroller, `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  require(Venus.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `Venus.Comptroller` |
| [BNB Chain](../chains/bsc.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `Venus.VBNB` |

## ABI

### `VBNBABI`

`import VBNBABI from "./protocols/venus/VBNBABI.json";` Speaks for: vBNB.

- `mint() payable`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow() payable`
- `balanceOfUnderlying(address owner) returns (uint256)`

### `VTokenABI`

`import VTokenABI from "./protocols/venus/VTokenABI.json";`

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`

### `VenusComptrollerABI`

`import VenusComptrollerABI from "./protocols/venus/VenusComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] vTokens) returns (uint256[])`
- `exitMarket(address vToken) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
