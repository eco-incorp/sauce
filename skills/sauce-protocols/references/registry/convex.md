<!-- Generated from the SDK's registries. Do not edit. -->

# Convex Finance (`convex`)

Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum |
| Document | [convex.md](../convex.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's booster):

```sauce chain=ethereum
import BoosterABI from "./protocols/convex/BoosterABI.json";

const BOOSTER = 0xF403C135812408BFbE8713b5A23a04b3D48AAE31n;

function main() {
  const bound = BoosterABI.at(BOOSTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | `BoosterABI.at(0xF403C135812408BFbE8713b5A23a04b3D48AAE31n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` | no registry ABI |

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
