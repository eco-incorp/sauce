<!-- Generated from the SDK's registries. Do not edit. -->

# Olympus DAO (`olympus`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Olympus DAO is a staking protocol: lock a token to earn rewards. This page lists the chains it is
> deployed on, the name a program writes for each of its contracts, and the functions a program can
> call.

Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.

| Fact | Value |
| --- | --- |
| Category | Staking |
| Family | none |
| Namespace | `Olympus` on ethereum |
| Chains | ethereum |

## What it offers

- **stake**: Stake OHM tokens
- **unstake**: Unstake OHM tokens

## Notes

- Protocol-owned liquidity model. Rebase mechanism for staking rewards.

## Its names in a program

On Ethereum, `Olympus` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ohm, `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5`.
  require(Olympus.Ohm != 0);
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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
