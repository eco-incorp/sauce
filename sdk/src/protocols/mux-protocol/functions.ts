export const addLiquidity = `
import { LiquidityPoolABI as ILiquidityPool } from "./abis";

function main(poolAddress: Address, tokenId: Uint256, tokenAmount: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.addLiquidity(tokenId, tokenAmount);
  return 1;
}
`;

export const removeLiquidity = `
import { LiquidityPoolABI as ILiquidityPool } from "./abis";

function main(poolAddress: Address, tokenId: Uint256, mlpAmount: Uint256): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.removeLiquidity(tokenId, mlpAmount);
  return 1;
}
`;
