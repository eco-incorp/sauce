<!-- Generated from the SDK's registries. Do not edit. -->

# Aave V2 (`aave-v2`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Aave V2 is a lending market: deposit tokens to earn interest, or borrow against them. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Legacy version of Aave lending protocol. Still holds significant TVL on Ethereum, Polygon, and Avalanche.

| Fact | Value |
| --- | --- |
| Category | Lending |
| Family | `Aave`: `aave-v2`, `aave-v3`, `aave-v4` |
| Namespace | `AaveV2` on ethereum, polygon, avalanche |
| Chains | ethereum, polygon, avalanche |

## When to use it

- The previous Aave generation, where a chain still runs its market. Where a chain has both,
  Aave V3 is the current market (`aave-v3`).

## Pitfalls for a program

- The supply call is `deposit`, not `supply`; approve the LendingPool first.
- `onBehalfOf` receives the aTokens. The caller is the Pot, so `ctx.self()` keeps them in the
  Pot, not in the user's wallet: choose which, and pass the wallet as a `main` parameter to
  deliver them.
- aTokens are rebasing: measure balances as deltas.
- A frozen reserve refuses new deposits: check the reserve accepts them before relying on it.
- Borrowing and liquidation work as in Aave V3, by health factor.

## In a Sauce program

Deposit the Pot's USDC for `onBehalfOf`, the user's wallet or the Pot (`ctx.self()`):

```ts
function main(onBehalfOf: Address, amount: Uint256) {
  USDC.approve(AaveV2.LendingPool, amount);
  AaveV2.LendingPool.deposit(USDC, amount, onBehalfOf, 0);
}
```

## Notes

- interestRateMode: 1 = stable, 2 = variable. Most users use variable rate
- referralCode is always 0 (referral program inactive)
- Legacy protocol -- consider Aave V3 for new deployments
- All deposit/repay operations require prior ERC-20 approval to the LendingPool address
- TVL: $2B+. Audited

## Its names in a program

On Ethereum, `AaveV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lendingPool, `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9`.
  require(AaveV2.LendingPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lendingPool | `0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9` | `AaveV2.LendingPool` |
| [Polygon](../chains/polygon.md) | lendingPool | `0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf` | `AaveV2.LendingPool` |
| [Avalanche C-Chain](../chains/avalanche.md) | lendingPool | `0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C` | `AaveV2.LendingPool` |

## ABI

### `LendingPoolABI`

`import LendingPoolABI from "./protocols/aave-v2/LendingPoolABI.json";` Speaks for: lendingPool.

- `deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
- `withdraw(address asset, uint256 amount, address to) returns (uint256)`
- `borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)`
- `repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
