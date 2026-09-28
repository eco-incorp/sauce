export const exercise = `
import { DiamondABI as IPool } from "./abis";

function main(poolAddress: Address): { exerciseValue: Uint256, exerciseFee: Uint256 } {
  const pool = IPool.at(poolAddress);
  return pool.exercise();
}
`;

export const settle = `
import { DiamondABI as IPool } from "./abis";

function main(poolAddress: Address): Uint256 {
  const pool = IPool.at(poolAddress);
  return pool.settle();
}
`;
