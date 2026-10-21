<!-- Generated from the SDK's registries. Do not edit. -->

# Swell (`swell`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Swell is a liquid staking protocol: stake a chain's coin and get back a token you can still use.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking via EigenLayer.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Swell` on ethereum |
| Chains | ethereum |

## What it offers

- **stakeSwETH**: Deposit ETH for swETH (liquid staking)
- **stakeRswETH**: Deposit ETH for rswETH (liquid restaking)

## Notes

- TVL: $800M+. Both tokens are non-rebasing (value accrues)
- swETH = standard liquid staking. rswETH = liquid restaking via EigenLayer
- Both deposit() functions are payable - send ETH as msg.value

## Its names in a program

On Ethereum, `Swell` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's rswETH, `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0`.
  require(Swell.RswETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `Swell.RswETH` |
| [Ethereum](../chains/ethereum.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `Swell.SwETH` |

## ABI

### `RswETHABI`

`import RswETHABI from "./protocols/swell/RswETHABI.json";` Speaks for: rswETH.

- `deposit() payable`
- `rswETHToETHRate() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`

### `SwETHABI`

`import SwETHABI from "./protocols/swell/SwETHABI.json";` Speaks for: swETH.

- `deposit() payable`
- `swETHToETHRate() view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
