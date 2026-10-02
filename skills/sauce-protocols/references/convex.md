# Convex Finance

Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives without needing to lock CRV.

## Category

yield | Chains and addresses: [registry/convex.md](registry/convex.md)

## Key Operations

- **deposit**: Deposit Curve LP tokens into Convex pool (with auto-staking)
- **withdraw**: Withdraw Curve LP tokens from Convex pool
- **getReward**: Claim accumulated CRV + CVX + extra rewards

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/convex.md](registry/convex.md).

## Notes

- TVL: $2B+. Pool IDs (pid) are sequential integers
- Third param in deposit = auto-stake in reward pool (always pass true for yield)
- Each pool has its own BaseRewardPool contract (get from poolInfo.crvRewards)
- Approve Curve LP token to Booster before depositing
- getReward with claimExtras=true claims CRV + CVX + any extra reward tokens
