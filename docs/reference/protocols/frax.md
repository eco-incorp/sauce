<!-- Generated from the SDK's registries. Do not edit. -->

# Frax Finance (`frax`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Frax Finance is a stablecoin protocol: lock tokens as collateral and mint a stablecoin against
> them. This page lists the chains it is deployed on, the name a program writes for each of its
> contracts, and the functions a program can call.

Fractional-algorithmic stablecoin protocol with FRAX stablecoin, sFRAX staking, and FXS governance.

| Fact | Value |
| --- | --- |
| Category | CDPs and stablecoins |
| Family | none |
| Namespace | `Frax` on ethereum |
| Chains | ethereum |

## What it offers

- **transfer**: Transfer FRAX tokens
- **approve**: Approve FRAX token spender

## Notes

- TVL: $1B+. V1 was fractional-algorithmic, V2 (Frax v3) is fully collateralized
- FXS is the governance/value accrual token
- sFRAX is the staked FRAX vault (ERC-4626) for earning yield - see frax-ether module for sfrxETH
- Frax ecosystem includes: FRAX (stablecoin), frxETH/sfrxETH (liquid staking), FPI (inflation-pegged)

## Its names in a program

On Ethereum, `Frax` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's frax, `0x853d955aCEf822Db058eb8505911ED77F175b99e`.
  require(Frax.Frax != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | frax | `0x853d955aCEf822Db058eb8505911ED77F175b99e` | `Frax.Frax` |

## ABI

### `FraxERC20ABI`

`import FraxERC20ABI from "./protocols/frax/FraxERC20ABI.json";` Speaks for: frax.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`
- `transfer(address to, uint256 amount) returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
