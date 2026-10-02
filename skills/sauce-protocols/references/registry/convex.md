<!-- Generated from the SDK's registries. Do not edit. -->

# Convex Finance (`convex`)

Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Convex` on ethereum |
| Chains | ethereum |
| Document | [convex.md](../convex.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Convex` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's booster, `0xF403C135812408BFbE8713b5A23a04b3D48AAE31`.
  require(Convex.Booster != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | `Convex.Booster` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` | `Convex.CvxRewardPool` |

## ABI

### `BaseRewardPoolABI`

`import BaseRewardPoolABI from "./protocols/convex/BaseRewardPoolABI.json";`

- `getReward(address _account, bool _claimExtras) returns (bool)`
- `earned(address account) view returns (uint256)`
- `balanceOf(address account) view returns (uint256)`
- `withdrawAndUnwrap(uint256 amount, bool claim) returns (bool)`

### `BoosterABI`

`import BoosterABI from "./protocols/convex/BoosterABI.json";` Speaks for: booster.

- `deposit(uint256 _pid, uint256 _amount, bool _stake) returns (bool)`
- `withdraw(uint256 _pid, uint256 _amount) returns (bool)`
- `poolLength() view returns (uint256)`
- `poolInfo(uint256) view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)`
