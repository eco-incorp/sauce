<!-- Generated from the SDK's registries. Do not edit. -->

# Convex Finance (`convex`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Convex Finance is a yield vault: deposits are put to work to earn interest. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Yield optimizer for Curve Finance LP tokens. Deposit Curve LP tokens to earn boosted CRV rewards plus CVX incentives without needing to lock CRV.

| Fact | Value |
| --- | --- |
| Category | Yield and vaults |
| Family | none |
| Namespace | `Convex` on ethereum |
| Chains | ethereum |

## What it offers

- **deposit**: Deposit Curve LP tokens into Convex pool (with auto-staking)
- **withdraw**: Withdraw Curve LP tokens from Convex pool
- **getReward**: Claim accumulated CRV + CVX + extra rewards

## Notes

- TVL: $2B+. Pool IDs (pid) are sequential integers
- Third param in deposit = auto-stake in reward pool (always pass true for yield)
- Each pool has its own BaseRewardPool contract (get from poolInfo.crvRewards)
- Approve Curve LP token to Booster before depositing
- getReward with claimExtras=true claims CRV + CVX + any extra reward tokens

## Its names in a program

On Ethereum, `Convex` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's booster, `0xF403C135812408BFbE8713b5A23a04b3D48AAE31`.
  require(Convex.Booster != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | booster | `0xF403C135812408BFbE8713b5A23a04b3D48AAE31` | `Convex.Booster` |
| [Ethereum](../chains/ethereum.md) | cvxRewardPool | `0xCF50b810E57Ac33B91dCF525C6ddd9881B139332` | `Convex.CvxRewardPool` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

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
- `poolInfo(uint256) view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)`: `lptoken` is a token, `token` is a token, `crvRewards` is a `Convex.BaseRewardPool`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
