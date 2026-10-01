# Stader

Multi-chain liquid staking protocol. ETHx is Stader's non-rebasing liquid staking token for Ethereum.

## Category

liquid-staking | Chains: Ethereum

## Key Operations

- **deposit**: Stake ETH to receive ETHx

## SDK Usage

```typescript
import { protocolInfo, deployments, deposit } from "@eco-incorp/sauce/protocols/stader";
```

## SauceScript Examples

```typescript
// Stake ETH for ETHx
import { StakePoolManagerABI as IStakePoolManager } from "./abis";
function main(stakePoolManagerAddress: Address, receiver: Address): Uint256 {
  const pool = IStakePoolManager.at(stakePoolManagerAddress);
  return pool.deposit(receiver);
}
```

## Key Addresses

| Chain    | Contract         | Address                                      |
| -------- | ---------------- | -------------------------------------------- |
| Ethereum | ETHx             | `0xA35b1B31Ce002FBF2058D22F30f95D405200A15b` |
| Ethereum | stakePoolManager | `0xcf5EA1b38380f6aF39068375516Daf40Ed70D299` |

## ABI Methods

### StakePoolManagerABI

- `deposit(address)` - Stake ETH (payable), receive ETHx. Param: receiver address. Returns ETHx amount
- `getExchangeRate()` - Current ETHx/ETH exchange rate

### ETHxABI

- `balanceOf(address)` - Query ETHx balance
- `approve(address,uint256)` - Approve ETHx spending

## Notes

- TVL: $300M+. ETHx is non-rebasing (value accrues over time)
- deposit() is payable - send ETH as msg.value, pass receiver address
- Compatible with EigenLayer restaking (can deposit into stETH/ETHx strategies)
