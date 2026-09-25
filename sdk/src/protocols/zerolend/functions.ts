export const supply = `
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  pool.supply(asset, amount, onBehalfOf, 0);
  return 1;
}
`;

export const withdraw = `
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, to: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  return pool.withdraw(asset, amount, to);
}
`;

export const borrow = `
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, interestRateMode: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  pool.borrow(asset, amount, interestRateMode, 0, onBehalfOf);
  return 1;
}
`;

export const repay = `
import { ZeroLendPoolABI as IZeroLendPool } from "./abis";

function main(poolAddress: Address, asset: Address, amount: Uint256, interestRateMode: Uint256, onBehalfOf: Address): Uint256 {
  const pool = IZeroLendPool.at(poolAddress);
  return pool.repay(asset, amount, interestRateMode, onBehalfOf);
}
`;
