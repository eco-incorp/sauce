<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V2 (`compound-v2`)

Legacy algorithmic money market protocol on Ethereum. Pioneered cToken model where deposits mint interest-bearing tokens.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV2` on ethereum |
| Chains | ethereum |
| Document | [compound-v2.md](../compound-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `CompoundV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cETH, `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5`.
  require(CompoundV2.CETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |

## ABI

### `CErc20ABI`

`import CErc20ABI from "./protocols/compound-v2/CErc20ABI.json";` Speaks for: cUSDC.

- `mint(uint256 mintAmount) returns (uint256)`
- `redeem(uint256 redeemTokens) returns (uint256)`
- `redeemUnderlying(uint256 redeemAmount) returns (uint256)`
- `borrow(uint256 borrowAmount) returns (uint256)`
- `repayBorrow(uint256 repayAmount) returns (uint256)`
- `balanceOfUnderlying(address owner) returns (uint256)`
- `borrowBalanceCurrent(address account) returns (uint256)`

### `ComptrollerABI`

`import ComptrollerABI from "./protocols/compound-v2/ComptrollerABI.json";` Speaks for: comptroller.

- `enterMarkets(address[] cTokens) returns (uint256[])`
- `exitMarket(address cToken) returns (uint256)`
