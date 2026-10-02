<!-- Generated from the SDK's registries. Do not edit. -->

# Olympus DAO (`olympus`)

Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.

| Fact | Value |
| --- | --- |
| Category | Staking |
| Family | none |
| Namespace | `Olympus` on ethereum |
| Chains | ethereum |

## Key Operations

- **stake**: Stake OHM tokens
- **unstake**: Unstake OHM tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

```typescript
// Stake OHM
import { StakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, to: Address, amount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  return staking.stake(to, amount, 1, 1);
}
```

## Notes

- Protocol-owned liquidity model. Rebase mechanism for staking rewards.

## Its names in a program

On Ethereum, `Olympus` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ohm, `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5`.
  require(Olympus.Ohm != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ohm | `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5` | `Olympus.Ohm` |
| [Ethereum](../chains/ethereum.md) | staking | `0xB63cac384247597756545b500253ff8E607a8020` | `Olympus.Staking` |
| [Ethereum](../chains/ethereum.md) | stakingHelper | `0xC8C436271f9A6F10a5B80c8b8eD7D0E8f37a612d` | `Olympus.StakingHelper` |

## ABI

### `StakingABI`

`import StakingABI from "./protocols/olympus/StakingABI.json";` Speaks for: staking.

- `stake(address to, uint256 amount, bool rebasing, bool claim) returns (uint256)`
- `unstake(address to, uint256 amount, bool trigger, bool rebasing) returns (uint256)`
- `claim(address to, bool rebasing) returns (uint256)`
