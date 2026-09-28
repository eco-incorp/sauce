export const stake = `
import { METHABI as IMETH } from "./abis";

function main(stakingAddress: Address, minMETHAmount: Uint256): Uint256 {
  const staking = IMETH.at(stakingAddress);
  staking.stake(minMETHAmount);
  return 1;
}
`;
