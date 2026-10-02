<!-- Generated from the SDK's registries. Do not edit. -->

# Venus (`venus`)

Leading lending and borrowing protocol on BNB Chain. Fork of Compound V2 with additional features including VAI stablecoin minting.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | none |
| Namespace | `Venus` on bsc |
| Chains | bsc |
| Document | [venus.md](../venus.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `Venus` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's comptroller, `0xfD36E2c2a6789Db23113685031d7F16329158384`.
  require(Venus.Comptroller != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | comptroller | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `Venus.Comptroller` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | vBNB | `0xA07c5b74C9B40447a954e1466938b865b6BBea36` | `Venus.VBNB` |

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
