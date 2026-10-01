<!-- Generated from the SDK's registries. Do not edit. -->

# Swell (`swell`)

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [swell.md](../swell.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's rswETH):

```sauce chain=ethereum
import RswETHABI from "./protocols/swell/RswETHABI.json";

const RSW_ETH = 0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0n;

function main() {
  const bound = RswETHABI.at(RSW_ETH);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rswETH | `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0` | `RswETHABI.at(0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | swETH | `0xf951E335afb289353dc249e82926178EaC7DEd78` | `SwETHABI.at(0xf951E335afb289353dc249e82926178EaC7DEd78n)` |

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
