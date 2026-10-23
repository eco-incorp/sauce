<!-- Generated from the SDK's registries. Do not edit. -->

# Compound V2 (`compound-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Compound V2 is a lending market: deposit tokens to earn interest, or borrow against them. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Legacy algorithmic money market protocol on Ethereum. Uses a cToken model where deposits mint interest-bearing tokens.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Compound`: `compound-v2`, `compound-v3` |
| Namespace | `CompoundV2` on ethereum |
| Chains | ethereum |

## Notes

- Must call `Comptroller.enterMarkets([cTokenAddress])` before borrowing against a market
- Return values: 0 = success, non-zero = error code (e.g. 3 = COMPTROLLER_REJECTION)
- cToken exchange rate grows over time -- holding cTokens earns interest automatically
- Each asset has its own cToken contract (not a shared pool like Aave)
- Legacy protocol -- consider Compound V3 (Comet) for new deployments
- TVL: $1B+. Audited

## Its names in a program

On Ethereum, `CompoundV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cETH, `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5`.
  require(CompoundV2.CETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cETH | `0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5` | `CompoundV2.CETH` |
| [Ethereum](../chains/ethereum.md) | cUSDC | `0x39AA39c021dfbaE8faC545936693aC917d5E7563` | `CompoundV2.CUSDC` |
| [Ethereum](../chains/ethereum.md) | comptroller | `0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B` | `CompoundV2.Comptroller` |

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
