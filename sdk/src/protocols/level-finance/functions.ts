export const addLiquidity = `
import { LiquidityPoolABI as ILiquidityPool } from "./abis";

function main(poolAddress: Address, tranche: Address, token: Address, amountIn: Uint256, minLpAmount: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.addLiquidity(tranche, token, amountIn, minLpAmount);
  return 1;
}
`;

export const removeLiquidity = `
import { LiquidityPoolABI as ILiquidityPool } from "./abis";

function main(poolAddress: Address, tranche: Address, tokenOut: Address, lpAmount: Uint256, minOut: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.removeLiquidity(tranche, tokenOut, lpAmount, minOut);
  return 1;
}
`;
