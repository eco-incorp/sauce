<!-- Generated from the SDK's registries. Do not edit. -->

# Olympus DAO (`olympus`)

Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.

| Fact | Value |
| --- | --- |
| Category | Staking |
| Family | none |
| Namespace | `Olympus` on ethereum |
| Chains | ethereum |
| Document | [olympus.md](../olympus.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Olympus` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ohm, `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5`.
  require(Olympus.Ohm != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ohm | `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5` | `Olympus.Ohm` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | staking | `0xB63cac384247597756545b500253ff8E607a8020` | `Olympus.Staking` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stakingHelper | `0xC8C436271f9A6F10a5B80c8b8eD7D0E8f37a612d` | `Olympus.StakingHelper` |

## ABI

### `StakingABI`

`import StakingABI from "./protocols/olympus/StakingABI.json";` Speaks for: staking.

- `stake(address to, uint256 amount, bool rebasing, bool claim) returns (uint256)`
- `unstake(address to, uint256 amount, bool trigger, bool rebasing) returns (uint256)`
- `claim(address to, bool rebasing) returns (uint256)`
