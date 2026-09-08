# Olympus DAO

Decentralized reserve currency protocol. OHM staking and bonding mechanism with protocol-owned liquidity and treasury management.

## Category

staking | Chains: Ethereum

## Key Operations

- **stake**: Stake OHM tokens
- **unstake**: Unstake OHM tokens

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/olympus";
```

## SauceScript Examples

```typescript
// Stake OHM
import { StakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, to: Address, amount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  return staking.stake(to, amount, 1, 1);
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Ethereum | ohm      | `0x64aa3364F17a4D01c6f1751Fd97C2BD3D7e7f1D5` |
| Ethereum | staking  | `0xB63cac384247597756545b500253ff8E607a8020` |

## ABI Methods

- `stake(address,uint256,bool,bool)` - Stake OHM
- `unstake(address,uint256,bool,bool)` - Unstake OHM

## Notes

- Protocol-owned liquidity model. Rebase mechanism for staking rewards.
