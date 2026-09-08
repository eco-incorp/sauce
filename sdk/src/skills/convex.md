# Convex Finance

Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives without needing to lock CRV.

## Category

yield | Chains: Ethereum

## Key Operations

- **deposit**: Deposit Curve LP tokens into Convex pool (with auto-staking)
- **withdraw**: Withdraw Curve LP tokens from Convex pool
- **getReward**: Claim accumulated CRV + CVX + extra rewards

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/convex";
```

## SauceScript Examples

```typescript
// Deposit Curve LP into Convex (auto-stake in reward pool)
import { BoosterABI as IBooster } from "./abis";
function main(boosterAddress: Address, pid: Uint256, amount: Uint256): Uint256 {
  const booster = IBooster.at(boosterAddress);
  booster.deposit(pid, amount, true);
  return 1;
}

// Withdraw Curve LP from Convex
import { BoosterABI as IBooster } from "./abis";
function main(boosterAddress: Address, pid: Uint256, amount: Uint256): Uint256 {
  const booster = IBooster.at(boosterAddress);
  booster.withdraw(pid, amount);
  return 1;
}

// Claim rewards from reward pool
import { BaseRewardPoolABI as IBaseRewardPool } from "./abis";
function main(rewardPoolAddress: Address, account: Address): Uint256 {
  const pool = IBaseRewardPool.at(rewardPoolAddress);
  pool.getReward(account, true);
  return 1;
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Ethereum | booster       | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` |
| Ethereum | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` |

## ABI Methods

### BoosterABI

- `deposit(uint256,uint256,bool)` - Deposit LP tokens. Params: pool ID (pid), amount, stake in reward pool (true recommended)
- `withdraw(uint256,uint256)` - Withdraw LP tokens. Params: pool ID, amount
- `poolLength()` - Total number of pools
- `poolInfo(uint256)` - Get pool info: (lptoken, token, gauge, crvRewards, stash, shutdown)

### BaseRewardPoolABI

- `getReward(address,bool)` - Claim rewards. Params: account, claimExtras (true = claim extra reward tokens too)
- `earned(address)` - Query pending CRV rewards
- `balanceOf(address)` - Query staked balance in reward pool
- `withdrawAndUnwrap(uint256,bool)` - Withdraw and unwrap in one tx. Params: amount, claim rewards

## Notes

- TVL: $2B+. Pool IDs (pid) are sequential integers
- Third param in deposit = auto-stake in reward pool (always pass true for yield)
- Each pool has its own BaseRewardPool contract (get from poolInfo.crvRewards)
- Approve Curve LP token to Booster before depositing
- getReward with claimExtras=true claims CRV + CVX + any extra reward tokens
