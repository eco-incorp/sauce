<!-- Generated from the SDK's registries. Do not edit. -->

# Stader (`stader`)

Multi-chain liquid staking protocol. ETHx is Stader's liquid staking token for Ethereum.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [stader.md](../stader.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's ETHx):

```sauce chain=ethereum
import ETHxABI from "./protocols/stader/ETHxABI.json";

const ETHX = 0xA35b1B31Ce002FBF2058D22F30f95D405200A15bn;

function main() {
  const bound = ETHxABI.at(ETHX);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | ETHx | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` | `ETHxABI.at(0xA35b1B31Ce002FBF2058D22F30f95D405200A15bn)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` | `StakePoolManagerABI.at(0xcf5EA1b38380f6aF39068375516Daf40Ed70D299n)` |

## ABI

### `ETHxABI`

`import ETHxABI from "./protocols/stader/ETHxABI.json";` Speaks for: ETHx.

- `balanceOf(address account) view returns (uint256)`
- `approve(address spender, uint256 amount) returns (bool)`

### `StakePoolManagerABI`

`import StakePoolManagerABI from "./protocols/stader/StakePoolManagerABI.json";` Speaks for: stakePoolManager.

- `deposit(address _receiver) payable returns (uint256)`
- `getExchangeRate() view returns (uint256)`
