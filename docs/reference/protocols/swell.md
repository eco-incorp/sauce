<!-- Generated from the SDK's registries. Do not edit. -->

# Swell (`swell`)

Liquid staking and restaking protocol for Ethereum. Offers swETH for liquid staking and rswETH for liquid restaking via EigenLayer.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Swell` on ethereum |
| Chains | ethereum |

## Key Operations

- **stakeSwETH**: Deposit ETH for swETH (liquid staking)
- **stakeRswETH**: Deposit ETH for rswETH (liquid restaking)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Stake ETH for swETH
import { SwETHABI as ISwETH } from "./abis";
function main(swethAddress: Address): Uint256 {
  const sweth = ISwETH.at(swethAddress);
  sweth.deposit();
  return 1;
}

// Stake ETH for rswETH (restaking)
import { RswETHABI as IRswETH } from "./abis";
function main(rswethAddress: Address): Uint256 {
  const rsweth = IRswETH.at(rswethAddress);
  rsweth.deposit();
  return 1;
}
```

## Notes

- TVL: $800M+. Both tokens are non-rebasing (value accrues)
- swETH = standard liquid staking. rswETH = liquid restaking via EigenLayer
- Both deposit() functions are payable - send ETH as msg.value

## Its names in a program

On Ethereum, `Swell` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's rswETH, `0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0`.
  require(Swell.RswETH != 0n);
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
