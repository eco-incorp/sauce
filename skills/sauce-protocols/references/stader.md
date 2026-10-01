# Stader

Multi-chain liquid staking protocol. ETHx is Stader's non-rebasing liquid staking token for Ethereum.

## Category

liquid-staking | Chains and addresses: [registry/stader.md](registry/stader.md)

## Key Operations

- **deposit**: Stake ETH to receive ETHx

## SauceScript Examples

```typescript
// Stake ETH for ETHx
import { StakePoolManagerABI as IStakePoolManager } from "./abis";
function main(stakePoolManagerAddress: Address, receiver: Address): Uint256 {
  const pool = IStakePoolManager.at(stakePoolManagerAddress);
  return pool.deposit(receiver);
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/stader.md](registry/stader.md).

## Notes

- TVL: $300M+. ETHx is non-rebasing (value accrues over time)
- deposit() is payable - send ETH as msg.value, pass receiver address
- Compatible with EigenLayer restaking (can deposit into stETH/ETHx strategies)
