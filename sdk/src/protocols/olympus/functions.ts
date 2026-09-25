export const stake = `
import { StakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, to: Address, amount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  return staking.stake(to, amount, 1, 1);
}
`;

export const unstake = `
import { StakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, to: Address, amount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  return staking.unstake(to, amount, 1, 1);
}
`;
