<!-- Generated from the SDK's registries. Do not edit. -->

# Stader (`stader`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Stader is a liquid staking protocol: stake a chain's coin and get back a token you can still use.
> This page lists the chains it is deployed on, the name a program writes for each of its contracts,
> and the functions a program can call.

Multi-chain liquid staking protocol. ETHx is Stader's non-rebasing liquid staking token for Ethereum.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Stader` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Stake ETH to receive ETHx

## Notes

- TVL: $300M+. ETHx is non-rebasing (value accrues over time)
- deposit() is payable - send ETH as msg.value, pass receiver address
- Compatible with EigenLayer restaking (can deposit into stETH/ETHx strategies)

## Its names in a program

On Ethereum, `Stader` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's ETHx, `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b`.
  require(Stader.ETHx != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `Stader.ETHx` |
| [Ethereum](../chains/ethereum.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `Stader.StakePoolManager` |

## ABI

### `ETHxABI`

`import ETHxABI from "./protocols/stader/ETHxABI.json";` Speaks for: ETHx.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `StakePoolManagerABI`

`import StakePoolManagerABI from "./protocols/stader/StakePoolManagerABI.json";` Speaks for: stakePoolManager.

- `deposit(address _receiver) payable returns (uint256)`
- `getExchangeRate() view returns (uint256)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
