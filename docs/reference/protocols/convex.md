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

- `addExtraReward(address _reward) returns (bool)`
- `balanceOf(address account) view returns (uint256)`
- `clearExtraRewards()`
- `currentRewards() view returns (uint256)`
- `donate(uint256 _amount) returns (bool)`
- `duration() view returns (uint256)`
- `earned(address account) view returns (uint256)`
- `extraRewards(uint256) view returns (address)`
- `extraRewardsLength() view returns (uint256)`
- `getReward(address _account, bool _claimExtras) returns (bool)`
- `getReward() returns (bool)`
- `historicalRewards() view returns (uint256)`
- `lastTimeRewardApplicable() view returns (uint256)`
- `lastUpdateTime() view returns (uint256)`
- `newRewardRatio() view returns (uint256)`
- `operator() view returns (address)`
- `periodFinish() view returns (uint256)`
- `pid() view returns (uint256)`
- `queuedRewards() view returns (uint256)`
- `queueNewRewards(uint256 _rewards) returns (bool)`
- `rewardManager() view returns (address)`
- `rewardPerToken() view returns (uint256)`
- `rewardPerTokenStored() view returns (uint256)`
- `rewardRate() view returns (uint256)`
- `rewards(address) view returns (uint256)`
- `rewardToken() view returns (address)`
- `stake(uint256 _amount) returns (bool)`
- `stakeAll() returns (bool)`
- `stakeFor(address _for, uint256 _amount) returns (bool)`
- `stakingToken() view returns (address)`
- `totalSupply() view returns (uint256)`
- `userRewardPerTokenPaid(address) view returns (uint256)`
- `withdraw(uint256 amount, bool claim) returns (bool)`
- `withdrawAll(bool claim)`
- `withdrawAllAndUnwrap(bool claim)`
- `withdrawAndUnwrap(uint256 amount, bool claim) returns (bool)`

### `BoosterABI`

`import BoosterABI from "./protocols/convex/BoosterABI.json";` Speaks for: booster. The import is the registry's ABI for this contract, the functions listed here: the same entries on every chain, nothing withheld or declared otherwise for one chain's deployment. Call the contract through the `Convex` namespace to have a function a chain's deployment does not run refused, and one it declares otherwise called as it declares it.

- `addPool(address _lptoken, address _gauge, uint256 _stashVersion) returns (bool)`
- `claimRewards(uint256 _pid, address _gauge) returns (bool)`
- `crv() view returns (address)`
- `deposit(uint256 _pid, uint256 _amount, bool _stake) returns (bool)`
- `depositAll(uint256 _pid, bool _stake) returns (bool)`
- `distributionAddressId() view returns (uint256)`
- `earmarkFees() returns (bool)`
- `earmarkIncentive() view returns (uint256)`
- `earmarkRewards(uint256 _pid) returns (bool)`
- `FEE_DENOMINATOR() view returns (uint256)`
- `feeDistro() view returns (address)`
- `feeManager() view returns (address)`
- `feeToken() view returns (address)`
- `gaugeMap(address) view returns (bool)`
- `isShutdown() view returns (bool)`
- `lockFees() view returns (address)`
- `lockIncentive() view returns (uint256)`
- `lockRewards() view returns (address)`
- `MaxFees() view returns (uint256)`
- `minter() view returns (address)`
- `owner() view returns (address)`
- `platformFee() view returns (uint256)`
- `poolInfo(uint256) view returns (address lptoken, address token, address gauge, address crvRewards, address stash, bool shutdown)`: `lptoken` is a token, `token` is a token, `crvRewards` is a `Convex.BaseRewardPool`
- `poolLength() view returns (uint256)`
- `poolManager() view returns (address)`
- `registry() view returns (address)`
- `rewardArbitrator() view returns (address)`
- `rewardClaimed(uint256 _pid, address _address, uint256 _amount) returns (bool)`
- `rewardFactory() view returns (address)`
- `setArbitrator(address _arb)`
- `setFactories(address _rfactory, address _sfactory, address _tfactory)`
- `setFeeInfo()`
- `setFeeManager(address _feeM)`
- `setFees(uint256 _lockFees, uint256 _stakerFees, uint256 _callerFees, uint256 _platform)`
- `setGaugeRedirect(uint256 _pid) returns (bool)`
- `setOwner(address _owner)`
- `setPoolManager(address _poolM)`
- `setRewardContracts(address _rewards, address _stakerRewards)`
- `setTreasury(address _treasury)`
- `setVoteDelegate(address _voteDelegate)`
- `shutdownPool(uint256 _pid) returns (bool)`
- `shutdownSystem()`
- `staker() view returns (address)`
- `stakerIncentive() view returns (uint256)`
- `stakerRewards() view returns (address)`
- `stashFactory() view returns (address)`
- `tokenFactory() view returns (address)`
- `treasury() view returns (address)`
- `vote(uint256 _voteId, address _votingAddress, bool _support) returns (bool)`
- `voteDelegate() view returns (address)`
- `voteGaugeWeight(address[] _gauge, uint256[] _weight) returns (bool)`
- `voteOwnership() view returns (address)`
- `voteParameter() view returns (address)`
- `withdraw(uint256 _pid, uint256 _amount) returns (bool)`
- `withdrawAll(uint256 _pid) returns (bool)`
- `withdrawTo(uint256 _pid, uint256 _amount, address _to) returns (bool)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
