<!-- Generated from the SDK's registries. Do not edit. -->

# Swell (`swell`)

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Swell` on ethereum |
| Chains | ethereum |
| Document | [swell.md](../swell.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Swell` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's rswETH, `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0`.
  require(Swell.RswETH != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `Swell.RswETH` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `Swell.SwETH` |

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
