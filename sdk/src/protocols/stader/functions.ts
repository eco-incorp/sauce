export const deposit = `
import { StakePoolManagerABI as IStakePoolManager } from "./abis";

function main(stakePoolManagerAddress: Address, receiver: Address): Uint256 {
  const pool = IStakePoolManager.at(stakePoolManagerAddress);
  return pool.deposit(receiver);
}
`;
