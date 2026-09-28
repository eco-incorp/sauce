export const stake = `
import { METHStakingABI as IStaking } from "./abis";

function main(stakingAddress: Address, minMETHAmount: Uint256): Uint256 {
  const staking = IStaking.at(stakingAddress);
  staking.stake(minMETHAmount);
  return 1;
}
`;
