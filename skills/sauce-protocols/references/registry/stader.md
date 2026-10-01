<!-- Generated from the SDK's registries. Do not edit. -->

# Stader (`stader`)

Multi-chain liquid staking protocol. ETHx is Stader's liquid staking token for Ethereum.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Stader` on ethereum |
| Chains | ethereum |
| Document | [stader.md](../stader.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Stader` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's ETHx, `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b`.
  require(Stader.ETHx != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `Stader.ETHx` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `Stader.StakePoolManager` |

## ABI

### `ETHxABI`

`import ETHxABI from "./protocols/stader/ETHxABI.json";` Speaks for: ETHx.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `StakePoolManagerABI`

`import StakePoolManagerABI from "./protocols/stader/StakePoolManagerABI.json";` Speaks for: stakePoolManager.

- `deposit(address _receiver) payable returns (uint256)`
- `getExchangeRate() view returns (uint256)`
