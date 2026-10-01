# Mantle mETH

Mantle's liquid staking token for Ethereum. Stake ETH and receive mETH, a non-rebasing token that accrues staking rewards over time.

## Category

liquid-staking | Chains and addresses: [registry/mantle-meth.md](registry/mantle-meth.md)

## Key Operations

- **stake**: Stake ETH for mETH with minimum output check

## SauceScript Examples

```typescript
// Stake ETH for mETH
import { METHStakingABI as IStaking } from "./abis";
function main(stakingAddress: Address, minMETHAmount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  staking.stake(minMETHAmount);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/mantle-meth.md](registry/mantle-meth.md).

## Notes

- TVL: $1.5B+. Non-rebasing token backed by Mantle treasury
- stake() is payable - send ETH as msg.value
- minMETHAmount param provides slippage protection
- Use mETHToETH()/ethToMETH() to preview exchange rates
- The Staking contract (`staking`), not the token.
- The mETH token (`mETH`).
