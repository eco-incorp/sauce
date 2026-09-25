export const deposit = `
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  pool.deposit(asset, amount, onBehalfOf, 0);
  return 1;
}
`;

export const withdraw = `
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  return pool.withdraw(asset, amount, to);
}
`;

export const borrow = `
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, interestRateMode: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
`;

export const repay = `
import { RadiantLendingPoolABI as IRadiantLendingPool } from "./abis";

function main(lendingPoolAddress: Address, asset: Address, amount: Uint256, rateMode: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IRadiantLendingPool.at(lendingPoolAddress);
  return pool.repay(asset, amount, rateMode, onBehalfOf);
}
`;
