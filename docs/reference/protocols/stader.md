<!-- Generated from the SDK's registries. Do not edit. -->

# Stader (`stader`)

Multi-chain liquid staking protocol. ETHx is Stader's non-rebasing liquid staking token for Ethereum.

| Fact | Value |
| --- | --- |
| Category | Liquid staking |
| Family | none |
| Namespace | `Stader` on ethereum |
| Chains | ethereum |

## Key Operations

- **deposit**: Stake ETH to receive ETHx

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Stake ETH for ETHx
import { StakePoolManagerABI as IStakePoolManager } from "./abis";
function main(stakePoolManagerAddress: Address, receiver: Address): Uint256 {
  const pool = IStakePoolManager.at(stakePoolManagerAddress);
  return pool.deposit(receiver);
}
```

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
