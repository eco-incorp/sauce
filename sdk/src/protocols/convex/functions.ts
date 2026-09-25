export const deposit = `
import { BoosterABI as IBooster } from "./abis";

function main(boosterAddress: Address, pid: Uint256, amount: Uint256): Uint256 {
  const booster = IBooster.at(boosterAddress);
  booster.deposit(pid, amount, true);
  return 1;
}
`;

export const withdraw = `
import { BoosterABI as IBooster } from "./abis";

function main(boosterAddress: Address, pid: Uint256, amount: Uint256): Uint256 {
  const booster = IBooster.at(boosterAddress);
  booster.withdraw(pid, amount);
  return 1;
}
`;

export const getReward = `
import { BaseRewardPoolABI as IBaseRewardPool } from "./abis";

function main(rewardPoolAddress: Address, account: Address): Uint256 {
  const pool = IBaseRewardPool.at(rewardPoolAddress);
  pool.getReward(account, true);
  return 1;
}
`;
